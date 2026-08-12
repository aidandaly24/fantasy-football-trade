#!/usr/bin/env python3
"""Collect and audit consolidation trades without changing live market values.

The pipeline has two deliberately separate targets:

* exchange premium: the extra point-in-time market value in an accepted 2-for-1
  or 3-for-1 package;
* outcome: the later market return of the single-asset side versus the package
  side. Structure-only and premium-aware challengers are evaluated separately.

Raw responses and normalized rows are gitignored. Only the compact health report
and portable coefficients are committed. A model is usable by the Trade Lab only
after its chronological held-out gates pass.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "trade_models" / "fantasycalc"
CURRENT = RAW / "current"
TRADES = RAW / "trades"
HISTORIES = RAW / "histories"
IMPORTS = RAW / "imports"
PROCESSED = ROOT / "data" / "processed" / "trade_models"
REPORT_JSON = ROOT / "ml" / "reports" / "trade-model-health.json"
REPORT_MD = ROOT / "ml" / "reports" / "trade-model-health.md"
PUBLIC_JSON = ROOT / "public" / "data" / "trade-model-health.json"
TRADE_AVAILABILITY_JSON = ROOT / "ml" / "reports" / "fantasycalc-trade-availability-v7.3.json"
TRADE_AVAILABILITY_MD = ROOT / "ml" / "reports" / "fantasycalc-trade-availability-v7.3.md"

BASE = "https://api.fantasycalc.com"
TERMS = "https://fantasycalc.com/terms-of-usage"
FAQ = "https://fantasycalc.com/frequently-asked-questions"
CURRENT_PARAMS = {
    "isDynasty": "true",
    "numQbs": "2",
    "numTeams": "12",
    "ppr": "1",
    "tep": "te+",
    "includeAdp": "false",
    "includeRosterPercent": "false",
}
DAY = 86_400
HORIZONS = (90, 180, 365)

EXCHANGE_FEATURES = [
    "elite_percentile",
    "package_size",
    "pick_count",
    "elite_is_pick",
    "elite_age",
    "elite_age_missing",
    "package_average_age",
    "package_age_missing",
    "num_teams",
    "num_qbs",
    "ppr",
    "te_premium",
    "roster_size",
    "starter_count",
    "depth_ratio",
]
OUTCOME_STRUCTURE_FEATURES = EXCHANGE_FEATURES.copy()
OUTCOME_PREMIUM_FEATURES = [*OUTCOME_STRUCTURE_FEATURES, "paid_premium"]

_request_lock = threading.Lock()
_last_request_at = 0.0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_dirs() -> None:
    for path in (CURRENT, TRADES, HISTORIES, IMPORTS, PROCESSED, REPORT_JSON.parent, PUBLIC_JSON.parent):
        path.mkdir(parents=True, exist_ok=True)


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True))
    temporary.replace(path)


def _write_training_tape(path: Path, payload: dict[str, Any]) -> None:
    """Preserve provider-export key order because schema v1 hashes JSON.stringify rows."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    temporary.replace(path)


def _wait_for_slot() -> None:
    global _last_request_at
    with _request_lock:
        remaining = 0.15 - (time.monotonic() - _last_request_at)
        if remaining > 0:
            time.sleep(remaining)
        _last_request_at = time.monotonic()


def fetch_json(url: str, attempts: int = 2) -> Any:
    headers = {
        "Accept": "application/json",
        "User-Agent": "RosterLab/1.0 (private model research; cached daily)",
    }
    for attempt in range(attempts):
        _wait_for_slot()
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < attempts - 1:
                time.sleep(max(10, int(error.headers.get("Retry-After", "15"))))
                continue
            if error.code >= 500 and attempt < attempts - 1:
                time.sleep(2**attempt)
                continue
            raise
        except (TimeoutError, urllib.error.URLError):
            if attempt == attempts - 1:
                raise
            time.sleep(2**attempt)
    raise RuntimeError(f"Unable to fetch {url}")


def _url(path: str, params: dict[str, Any]) -> str:
    return f"{BASE}{path}?{urllib.parse.urlencode(params, doseq=True)}"


def load_current(offline: bool = False, refresh: bool = False) -> list[dict[str, Any]]:
    today = datetime.now(timezone.utc).date().isoformat()
    path = CURRENT / f"{today}.json"
    if not path.exists() and offline:
        cached = sorted(CURRENT.glob("*.json"))
        if not cached:
            raise FileNotFoundError("No cached FantasyCalc current snapshot")
        path = cached[-1]
    if refresh or not path.exists():
        if offline:
            raise FileNotFoundError(path)
        payload = fetch_json(_url("/values/current", CURRENT_PARAMS))
        if not isinstance(payload, list):
            raise ValueError("FantasyCalc current endpoint did not return a list")
        _write_json(path, payload)
    payload = json.loads(path.read_text())
    if not isinstance(payload, list):
        raise ValueError("Cached FantasyCalc current snapshot is invalid")
    return payload


def select_anchors(catalog: Iterable[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    """Take an even value-rank sample within each player position."""
    players = []
    for item in catalog:
        player = item.get("player") if isinstance(item, dict) else None
        if not isinstance(player, dict) or player.get("position") not in {"QB", "RB", "WR", "TE"}:
            continue
        if not player.get("id") or float(item.get("value") or 0) <= 0:
            continue
        players.append(item)
    selected: list[dict[str, Any]] = []
    positions = ("QB", "RB", "WR", "TE")
    base, remainder = divmod(min(count, len(players)), len(positions))
    for position_index, position in enumerate(positions):
        rows = sorted(
            (item for item in players if item["player"]["position"] == position),
            key=lambda item: (-float(item.get("value") or 0), int(item["player"]["id"])),
        )
        quota = min(len(rows), base + (1 if position_index < remainder else 0))
        for index in range(quota):
            selected.append(rows[min(len(rows) - 1, math.floor((index + 0.5) * len(rows) / quota))])
    return sorted(selected, key=lambda item: int(item["player"]["id"]))


def collect_anchor_trades(anchor: dict[str, Any], offline: bool, refresh: bool) -> tuple[int, int]:
    player = anchor["player"]
    anchor_id = int(player["id"])
    day_dir = TRADES / datetime.now(timezone.utc).date().isoformat()
    path = day_dir / f"{anchor_id}.json"
    if refresh or not path.exists():
        if offline:
            raise FileNotFoundError(path)
        payload = fetch_json(_url("/trades", {
            "isDynasty": "true",
            "side1": anchor_id,
            "minPlayers": 2,
            "maxPlayers": 4,
        }))
        if not isinstance(payload, list):
            raise ValueError(f"Trade query for {anchor_id} did not return a list")
        _write_json(path, payload)
    payload = json.loads(path.read_text())
    return anchor_id, len(payload)


def _trade_probe_summary(payload: Any) -> dict[str, Any]:
    rows = payload if isinstance(payload, list) else []
    identifiers = [str(item.get("id")) for item in rows if isinstance(item, dict) and item.get("id")]
    dates = sorted(
        observed.isoformat()
        for item in rows
        if isinstance(item, dict) and (observed := _parse_date(item.get("date")))
    )
    return {
        "rows": len(rows),
        "firstTradeAt": dates[0] if dates else None,
        "latestTradeAt": dates[-1] if dates else None,
        "orderedIdDigest": hashlib.sha256("\n".join(identifiers).encode("utf-8")).hexdigest(),
    }


def audit_trade_availability(offline: bool = False) -> dict[str, Any]:
    """Bounded V7.3 probe for proven completed-trade history controls.

    FantasyCalc's public database UI exposes filters but no documented cursor.
    We compare the unmodified response with common page and offset parameters;
    equality is evidence that those parameters are ignored, not proof that no
    other private or future backfill route can exist.
    """
    ensure_dirs()
    if offline:
        if not TRADE_AVAILABILITY_JSON.exists():
            raise FileNotFoundError("No cached V7.3 trade-availability audit")
        return json.loads(TRADE_AVAILABILITY_JSON.read_text())
    catalog = load_current()
    selected = select_anchors(catalog, 4)
    if not selected:
        raise ValueError("No current FantasyCalc player is available for the pagination probe")
    anchor = max(selected, key=lambda item: float(item.get("value") or 0))
    anchor_id = int(anchor["player"]["id"])
    parameters = {
        "isDynasty": "true",
        "side1": anchor_id,
        "minPlayers": 2,
        "maxPlayers": 4,
    }
    base = _trade_probe_summary(fetch_json(_url("/trades", parameters)))
    page = _trade_probe_summary(fetch_json(_url("/trades", {**parameters, "page": 2})))
    offset = _trade_probe_summary(fetch_json(_url("/trades", {**parameters, "offset": 100})))
    page_identical = page["orderedIdDigest"] == base["orderedIdDigest"] and page["rows"] == base["rows"]
    offset_identical = offset["orderedIdDigest"] == base["orderedIdDigest"] and offset["rows"] == base["rows"]
    local_trades = load_all_trades()
    local_dates = sorted(observed for trade in local_trades if (observed := _parse_date(trade.get("date"))))
    result = {
        "schemaVersion": 1,
        "auditedAt": utc_now(),
        "source": {
            "name": "FantasyCalc public completed-trade endpoint",
            "endpoint": f"{BASE}/trades",
            "methodology": FAQ,
            "terms": TERMS,
        },
        "anchor": {
            "id": anchor_id,
            "name": str(anchor["player"].get("name") or anchor_id),
            "position": str(anchor["player"].get("position") or ""),
        },
        "probes": {"base": base, "page2": page, "offset100": offset},
        "page2Identical": page_identical,
        "offset100Identical": offset_identical,
        "observedRowCap": base["rows"],
        "paginationProven": not page_identical or not offset_identical,
        "olderBackfillProven": False,
        "localTape": {
            "trades": len(local_trades),
            "firstTradeAt": local_dates[0].isoformat() if local_dates else None,
            "latestTradeAt": local_dates[-1].isoformat() if local_dates else None,
            "dateSpanDays": (local_dates[-1] - local_dates[0]).days if local_dates else 0,
            "anchorQueryFiles": len(list(TRADES.glob("*/*.json"))),
        },
        "conclusion": (
            "The observed endpoint returned the same capped rows for base, page=2, and offset=100. "
            "No older-page contract is proven; keep incremental cached collection for exchange-price research "
            "and use the separate daily asset histories for return/risk modeling."
            if page_identical and offset_identical
            else "At least one pagination probe changed the response; investigate and validate ordering before backfill."
        ),
    }
    _write_json(TRADE_AVAILABILITY_JSON, result)
    TRADE_AVAILABILITY_MD.write_text("\n".join([
        "# FantasyCalc completed-trade availability audit (V7.3)",
        "",
        f"Audited: `{result['auditedAt']}`",
        "",
        f"- Probe anchor: **{result['anchor']['name']}** (`{anchor_id}`)",
        f"- Base response: **{base['rows']} rows**, {base['firstTradeAt']} to {base['latestTradeAt']}",
        f"- `page=2` identical: **{page_identical}**",
        f"- `offset=100` identical: **{offset_identical}**",
        f"- Local deduplicated tape: **{len(local_trades)} trades** across **{result['localTape']['dateSpanDays']} days**",
        "",
        "## Decision",
        "",
        result["conclusion"],
        "",
        "This is a bounded observed-contract audit. It does not claim that an undocumented or future provider route cannot exist.",
        "",
    ]))
    return result


def _history_paths(asset_id: int, num_qbs: int) -> tuple[Path, Path]:
    primary = HISTORIES / f"{num_qbs}qb" / f"{asset_id}.json"
    primary_meta = primary.with_name(f"{asset_id}.meta.json")
    legacy = HISTORIES / f"{asset_id}.json"
    legacy_meta = HISTORIES / f"{asset_id}.meta.json"
    if num_qbs == 2 and not primary.exists() and legacy.exists():
        return legacy, legacy_meta
    return primary, primary_meta


def collect_history(asset_id: int, num_qbs: int, offline: bool, refresh: bool) -> tuple[int, int, int]:
    path, meta_path = _history_paths(asset_id, num_qbs)
    if refresh or not path.exists():
        if offline:
            raise FileNotFoundError(path)
        payload = fetch_json(_url(f"/trades/historical/{asset_id}", {"isDynasty": "true", "numQbs": num_qbs}))
        if not isinstance(payload, list):
            raise ValueError(f"History query for {asset_id} did not return a list")
        _write_json(path, payload)
        _write_json(meta_path, {"retrievedAt": utc_now(), "endpoint": f"/trades/historical/{asset_id}", "numQbs": num_qbs})
    payload = json.loads(path.read_text())
    return asset_id, num_qbs, len(payload)


def validate_training_tape(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
        raise ValueError("Training tape must use schemaVersion 1")
    trades = payload.get("trades")
    dataset_id = str(payload.get("datasetId") or "")
    if not isinstance(trades, list) or not dataset_id.startswith("sha256:"):
        raise ValueError("Training tape is missing trades or datasetId")
    canonical = json.dumps(trades, ensure_ascii=False, separators=(",", ":"))
    expected = f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"
    if dataset_id != expected:
        raise ValueError("Training tape datasetId does not match its canonical trades")
    if int(payload.get("totalTrades") or -1) != len(trades):
        raise ValueError("Training tape totalTrades does not match its rows")
    for trade in trades:
        if not isinstance(trade, dict) or not trade.get("id") or not trade.get("date"):
            raise ValueError("Training tape contains a malformed trade")
        for side in (trade.get("side1"), trade.get("side2")):
            if not isinstance(side, list) or not side:
                raise ValueError("Training tape contains an empty trade side")
    return payload


def import_training_tape(source: Path) -> dict[str, Any]:
    ensure_dirs()
    try:
        payload = validate_training_tape(json.loads(source.read_text()))
    except (json.JSONDecodeError, OSError) as error:
        raise ValueError(f"Unable to read training tape: {error}") from error
    exported = str(payload.get("exportedAt") or "unknown")[:10]
    short_id = str(payload["datasetId"]).split(":", 1)[1][:12]
    target = IMPORTS / f"{exported}-{short_id}.json"
    _write_training_tape(target, payload)
    try:
        target_label = str(target.relative_to(ROOT))
    except ValueError:
        target_label = str(target)
    return {
        "datasetId": payload["datasetId"],
        "totalTrades": len(payload["trades"]),
        "uniqueLeagues": int(payload.get("uniqueLeagues") or 0),
        "target": target_label,
    }


def load_imported_tapes() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    deduped: dict[str, dict[str, Any]] = {}
    manifests: dict[str, dict[str, Any]] = {}
    for path in sorted(IMPORTS.glob("*.json")):
        try:
            payload = validate_training_tape(json.loads(path.read_text()))
        except (json.JSONDecodeError, OSError, ValueError):
            continue
        manifests[str(payload["datasetId"])] = payload
        for trade in payload["trades"]:
            deduped[str(trade["id"])] = trade
    return (
        sorted(deduped.values(), key=lambda trade: (str(trade.get("date") or ""), str(trade["id"]))),
        sorted(manifests.values(), key=lambda item: (str(item.get("exportedAt") or ""), str(item["datasetId"]))),
    )


def load_all_trades() -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for path in sorted(TRADES.glob("*/*.json")):
        try:
            payload = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        for trade in payload if isinstance(payload, list) else []:
            if isinstance(trade, dict) and trade.get("id"):
                deduped[str(trade["id"])] = trade
    imported, _ = load_imported_tapes()
    for trade in imported:
        deduped[str(trade["id"])] = trade
    return sorted(deduped.values(), key=lambda trade: (str(trade.get("date") or ""), str(trade["id"])))


def collect(anchors: int, offline: bool, refresh: bool, history_scope: str) -> dict[str, Any]:
    ensure_dirs()
    catalog = load_current(offline=offline, refresh=refresh)
    selected = select_anchors(catalog, anchors)
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {executor.submit(collect_anchor_trades, item, offline, refresh): item for item in selected}
        for index, future in enumerate(as_completed(futures), 1):
            item = futures[future]
            try:
                anchor_id, rows = future.result()
                print(f"  trades {index:>3}/{len(selected)} {anchor_id}: {rows}", flush=True)
            except Exception as error:  # network failures belong in the audit
                failures.append(f"trades:{item['player']['id']}:{error}")

    trades = load_all_trades()
    trade_asset_ids = {
        int(asset["id"])
        for trade in trades
        for side in (trade.get("side1") or [], trade.get("side2") or [])
        for asset in side
        if isinstance(asset, dict) and asset.get("id") is not None
    }
    catalog_ids = {
        int(item["player"]["id"])
        for item in catalog
        if isinstance(item, dict) and isinstance(item.get("player"), dict) and item["player"].get("id") is not None
    }
    history_ids = trade_asset_ids | (catalog_ids if history_scope == "universe" else set())
    history_pairs = [(asset_id, num_qbs) for num_qbs in (1, 2) for asset_id in sorted(history_ids)]
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {executor.submit(collect_history, asset_id, num_qbs, offline, refresh): (asset_id, num_qbs) for asset_id, num_qbs in history_pairs}
        for index, future in enumerate(as_completed(futures), 1):
            asset_id, num_qbs = futures[future]
            try:
                _, _, rows = future.result()
                if index % 25 == 0 or index == len(history_pairs):
                    print(f"  history {index:>3}/{len(history_pairs)} latest={asset_id} qb={num_qbs} rows={rows}", flush=True)
            except Exception as error:
                failures.append(f"history:{asset_id}:{num_qbs}qb:{error}")
    result = {
        "retrievedAt": utc_now(),
        "anchors": len(selected),
        "trades": len(trades),
        "historyAssetsRequested": len(history_ids),
        "historySeriesRequested": len(history_pairs),
        "failures": failures,
        "sources": [BASE, FAQ, TERMS],
    }
    _write_json(PROCESSED / "collection.json", result)
    return result


def _parse_date(value: Any) -> date | None:
    compact = str(value or "").strip()
    try:
        if "/" in compact:
            return datetime.strptime(compact[:10], "%m/%d/%Y").date()
        return date.fromisoformat(compact[:10])
    except ValueError:
        return None


class History:
    def __init__(self, points: Iterable[dict[str, Any]]):
        normalized: dict[date, float] = {}
        for point in points:
            observed = _parse_date(point.get("date")) if isinstance(point, dict) else None
            try:
                value = float(point.get("value") or 0) if isinstance(point, dict) else 0
            except (TypeError, ValueError):
                value = 0
            if observed and value > 0 and math.isfinite(value):
                normalized[observed] = value
        self.dates = sorted(normalized)
        self.values = [normalized[item] for item in self.dates]

    def at(self, target: date, backward_days: int = 3, forward_days: int = 1) -> float | None:
        if not self.dates:
            return None
        index = bisect.bisect_right(self.dates, target) - 1
        if index >= 0 and (target - self.dates[index]).days <= backward_days:
            return self.values[index]
        next_index = index + 1
        if next_index < len(self.dates) and (self.dates[next_index] - target).days <= forward_days:
            return self.values[next_index]
        return None

    def future(self, anchor: date, horizon: int) -> float | None:
        target = anchor + timedelta(days=horizon)
        return self.at(target, backward_days=max(7, horizon // 18), forward_days=max(7, horizon // 18))


def load_histories(num_qbs: int) -> dict[int, History]:
    histories: dict[int, History] = {}
    paths = list((HISTORIES / f"{num_qbs}qb").glob("*.json"))
    if num_qbs == 2:
        paths.extend(HISTORIES.glob("*.json"))
    for path in paths:
        if path.name.endswith(".meta.json"):
            continue
        try:
            asset_id = int(path.stem)
            payload = json.loads(path.read_text())
        except (ValueError, json.JSONDecodeError, OSError):
            continue
        if isinstance(payload, list):
            histories[asset_id] = History(payload)
    return histories


def age_on(asset: dict[str, Any], observed: date) -> float | None:
    birthday = _parse_date(asset.get("maybeBirthday"))
    if birthday:
        return round((observed - birthday).days / 365.2425, 3)
    try:
        age = float(asset.get("maybeAge"))
    except (TypeError, ValueError):
        return None
    return age if age > 0 else None


def _number(value: Any, fallback: float = 0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def _percentile_rank(values: list[float], target: float) -> float | None:
    usable = sorted(value for value in values if value > 0 and math.isfinite(value))
    if len(usable) < 25:
        return None
    return bisect.bisect_right(usable, target) / len(usable)


def normalize_exchange_trade(
    trade: dict[str, Any], histories: dict[int, History], cross_section: list[float]
) -> dict[str, Any] | None:
    side1 = trade.get("side1") or []
    side2 = trade.get("side2") or []
    if sorted((len(side1), len(side2))) not in ([1, 2], [1, 3]):
        return None
    observed = _parse_date(trade.get("date"))
    history_num_qbs = int(_number(trade.get("numQbs")))
    if not observed or history_num_qbs not in (1, 2):
        return None
    elite_side = side1 if len(side1) == 1 else side2
    package_side = side2 if len(side1) == 1 else side1
    elite = elite_side[0]
    all_assets = [elite, *package_side]
    values: dict[int, float] = {}
    for asset in all_assets:
        try:
            asset_id = int(asset["id"])
        except (KeyError, TypeError, ValueError):
            return None
        value = histories.get(asset_id, History([])).at(observed)
        if value is None:
            return None
        values[asset_id] = value
    elite_id = int(elite["id"])
    elite_value = values[elite_id]
    package_values = [values[int(asset["id"])] for asset in package_side]
    package_value = sum(package_values)
    percentile = _percentile_rank(cross_section, elite_value)
    if percentile is None or elite_value < max(package_values) or percentile < 0.70:
        return None
    premium = package_value / elite_value - 1
    if not math.isfinite(premium) or premium < -0.75 or premium > 3:
        return None
    elite_age = age_on(elite, observed)
    package_ages = [age for asset in package_side if (age := age_on(asset, observed)) is not None]
    starters = _number(trade.get("numStarters"))
    roster_size = _number(trade.get("rosterSize"))
    return {
        "trade_id": str(trade.get("id")),
        "league_id": str(trade.get("leagueId") or ""),
        "date": observed.isoformat(),
        "elite_asset_id": elite_id,
        "elite_asset_name": str(elite.get("name") or elite_id),
        "elite_side": 1 if len(side1) == 1 else 2,
        "elite_value": elite_value,
        "package_value": package_value,
        "paid_premium": premium,
        "elite_percentile": percentile,
        "package_size": float(len(package_side)),
        "pick_count": float(sum(asset.get("position") == "PICK" for asset in package_side)),
        "elite_is_pick": float(elite.get("position") == "PICK"),
        "elite_age": elite_age or 0,
        "elite_age_missing": float(elite_age is None),
        "package_average_age": statistics.mean(package_ages) if package_ages else 0,
        "package_age_missing": float(not package_ages),
        "num_teams": _number(trade.get("numTeams")),
        "num_qbs": _number(trade.get("numQbs")),
        "ppr": _number(trade.get("ppr")),
        "te_premium": _number(trade.get("tePremium")),
        "roster_size": roster_size,
        "starter_count": starters,
        "depth_ratio": roster_size / starters if starters > 0 else 0,
        "format_complete": float(
            _number(trade.get("numTeams")) > 0
            and _number(trade.get("numQbs")) > 0
            and starters > 0
            and roster_size > 0
        ),
        "historical_format_exact": 0.0,
        "history_num_qbs": history_num_qbs,
        "age_complete": float(elite_age is not None and bool(package_ages)),
        "asset_ids": [int(asset["id"]) for asset in all_assets],
        "package_asset_ids": [int(asset["id"]) for asset in package_side],
    }


def build_examples(trades: list[dict[str, Any]], histories_by_qb: dict[int, dict[int, History]]) -> list[dict[str, Any]]:
    observed_dates = sorted({
        (observed, int(_number(trade.get("numQbs"))))
        for trade in trades
        if (observed := _parse_date(trade.get("date"))) and int(_number(trade.get("numQbs"))) in (1, 2)
    })
    cross_sections = {
        (observed, num_qbs): [value for history in histories_by_qb[num_qbs].values() if (value := history.at(observed)) is not None]
        for observed, num_qbs in observed_dates
    }
    examples = []
    for trade in trades:
        observed = _parse_date(trade.get("date"))
        num_qbs = int(_number(trade.get("numQbs")))
        if not observed or num_qbs not in (1, 2):
            continue
        normalized = normalize_exchange_trade(trade, histories_by_qb[num_qbs], cross_sections.get((observed, num_qbs), []))
        if normalized:
            examples.append(normalized)
    return sorted(examples, key=lambda row: (row["date"], row["trade_id"]))


def add_outcome_labels(examples: list[dict[str, Any]], histories_by_qb: dict[int, dict[int, History]]) -> None:
    for row in examples:
        observed = date.fromisoformat(row["date"])
        histories = histories_by_qb[int(row["history_num_qbs"])]
        elite_history = histories.get(int(row["elite_asset_id"]))
        for horizon in HORIZONS:
            elite_future = elite_history.future(observed, horizon) if elite_history else None
            package_future = []
            for asset_id in row["package_asset_ids"]:
                history = histories.get(int(asset_id))
                future = history.future(observed, horizon) if history else None
                if future is None:
                    package_future = []
                    break
                package_future.append(future)
            target = None
            if elite_future is not None and package_future:
                elite_return = elite_future / row["elite_value"] - 1
                package_return = sum(package_future) / row["package_value"] - 1
                target = elite_return - package_return
            row[f"outcome_{horizon}d"] = target


def has_point_in_time_values(trade: dict[str, Any], histories_by_qb: dict[int, dict[int, History]]) -> bool:
    observed = _parse_date(trade.get("date"))
    num_qbs = int(_number(trade.get("numQbs")))
    assets = [
        asset
        for side in (trade.get("side1") or [], trade.get("side2") or [])
        for asset in side
        if isinstance(asset, dict)
    ]
    if not observed or num_qbs not in histories_by_qb or not assets:
        return False
    for asset in assets:
        try:
            asset_id = int(asset["id"])
        except (KeyError, TypeError, ValueError):
            return False
        history = histories_by_qb[num_qbs].get(asset_id)
        if history is None or history.at(observed) is None:
            return False
    return True


def build_training_manifest(
    trades: list[dict[str, Any]], histories_by_qb: dict[int, dict[int, History]]
) -> dict[str, Any]:
    imported, imports = load_imported_tapes()
    imported_ids = {str(trade["id"]) for trade in imported}
    observed_dates = sorted(observed for trade in trades if (observed := _parse_date(trade.get("date"))))
    latest_import = imports[-1] if imports else None
    point_in_time = sum(has_point_in_time_values(trade, histories_by_qb) for trade in trades)
    imported_point_in_time = sum(has_point_in_time_values(trade, histories_by_qb) for trade in imported)
    dataset_ids = [str(item["datasetId"]) for item in imports]
    if dataset_ids:
        joined_id = "\n".join(dataset_ids).encode("utf-8")
        dataset_id = dataset_ids[0] if len(dataset_ids) == 1 else f"sha256:{hashlib.sha256(joined_id).hexdigest()}"
    else:
        canonical_ids = json.dumps([str(trade["id"]) for trade in trades], separators=(",", ":"))
        dataset_id = f"local-cache:{hashlib.sha256(canonical_ids.encode('utf-8')).hexdigest()}"
    return {
        "schemaVersion": 1,
        "datasetId": dataset_id,
        "datasetIds": dataset_ids,
        "source": "FantasyCalc hosted D1 export and local collector cache" if imports else "FantasyCalc local collector cache",
        "exportedAt": str(latest_import.get("exportedAt") or "") if latest_import else utc_now(),
        "totalTrades": len(trades),
        "importedTrades": len(imported_ids),
        "localCacheTrades": len({str(trade["id"]) for trade in trades} - imported_ids),
        "uniqueLeagues": len({str(trade.get("leagueId") or "") for trade in trades if trade.get("leagueId")}),
        "firstTradeAt": observed_dates[0].isoformat() if observed_dates else None,
        "latestTradeAt": observed_dates[-1].isoformat() if observed_dates else None,
        "pointInTimeValuedTrades": point_in_time,
        "pointInTimeCoverage": point_in_time / len(trades) if trades else 0,
        "importedPointInTimeValuedTrades": imported_point_in_time,
        "importedPointInTimeCoverage": imported_point_in_time / len(imported) if imported else 0,
        "historyAssetCount": len(set(histories_by_qb[1]) | set(histories_by_qb[2])),
        "historySeriesCount": sum(len(histories) for histories in histories_by_qb.values()),
    }


def _gate(identifier: str, label: str, passed: bool, actual: float, requirement: str) -> dict[str, Any]:
    return {"id": identifier, "label": label, "passed": bool(passed), "actual": actual, "requirement": requirement}


def _metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    if not len(actual):
        return {"mae": 0, "rmse": 0}
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
    }


def _split(frame: pd.DataFrame, test_share: float = 0.2) -> tuple[pd.DataFrame, pd.DataFrame]:
    ordered = frame.sort_values(["date", "trade_id"]).reset_index(drop=True)
    cut = max(1, min(len(ordered) - 1, math.floor(len(ordered) * (1 - test_share))))
    return ordered.iloc[:cut].copy(), ordered.iloc[cut:].copy()


def _fit_model(train: pd.DataFrame, test: pd.DataFrame, features: list[str], target: str) -> tuple[dict[str, Any], np.ndarray]:
    pipeline = Pipeline([("scale", StandardScaler()), ("ridge", Ridge(alpha=10.0))])
    pipeline.fit(train[features].to_numpy(float), train[target].to_numpy(float))
    predictions = pipeline.predict(test[features].to_numpy(float))
    scaler: StandardScaler = pipeline.named_steps["scale"]
    ridge: Ridge = pipeline.named_steps["ridge"]
    return {
        "kind": "standardized-ridge-v1",
        "features": features,
        "means": [float(value) for value in scaler.mean_],
        "scales": [float(value) if value else 1.0 for value in scaler.scale_],
        "coefficients": [float(value) for value in ridge.coef_],
        "intercept": float(ridge.intercept_),
    }, predictions


def _exchange_segment_keys(frame: pd.DataFrame) -> pd.Series:
    elite_band = pd.cut(
        frame["elite_percentile"], bins=[0.69, 0.85, 0.95, 1.01], labels=["70-84", "85-94", "95+"]
    ).astype(str)
    return (
        elite_band
        + "|" + frame["package_size"].round().astype(int).astype(str)
        + "|" + np.where(frame["num_qbs"] >= 2, "sf", "1qb")
        + "|" + np.where(frame["pick_count"] > 0, "picks", "players")
    )


def _segmented_median_predictions(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    if train.empty or test.empty:
        return np.zeros(len(test))
    working = train.copy()
    working["segment_key"] = _exchange_segment_keys(working)
    counts = working.groupby("segment_key")["paid_premium"].count()
    medians = working.groupby("segment_key")["paid_premium"].median()
    fallback = float(working["paid_premium"].median())
    keys = _exchange_segment_keys(test)
    return np.array([
        float(medians[key]) if key in medians and int(counts[key]) >= 10 else fallback
        for key in keys
    ])


def _league_balanced_mae(frame: pd.DataFrame, actual: np.ndarray, predicted: np.ndarray) -> float:
    if frame.empty or not len(actual):
        return 0.0
    working = pd.DataFrame({
        "league_id": frame["league_id"].astype(str).to_numpy(),
        "error": np.abs(actual - predicted),
    })
    return float(working.groupby("league_id")["error"].mean().mean())


def build_anchor_sampling_audit(trades: list[dict[str, Any]]) -> dict[str, Any]:
    """Describe what the bounded anchor queries can and cannot represent."""
    exposure: dict[str, int] = defaultdict(int)
    anchor_ids: set[str] = set()
    query_rows = 0
    for path in sorted(TRADES.glob("*/*.json")):
        anchor_ids.add(path.stem)
        try:
            payload = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        for trade in payload if isinstance(payload, list) else []:
            if not isinstance(trade, dict) or not trade.get("id"):
                continue
            query_rows += 1
            exposure[str(trade["id"])] += 1
    imported, _ = load_imported_tapes()
    exposed = list(exposure.values())
    return {
        "selection": "position/value-stratified current-player anchors plus the private hosted anchor sample",
        "anchorQueryFiles": len(list(TRADES.glob("*/*.json"))),
        "queriedAnchorIds": len(anchor_ids),
        "queryRows": query_rows,
        "uniqueQueryTrades": len(exposure),
        "importedTrades": len(imported),
        "combinedDeduplicatedTrades": len(trades),
        "meanAnchorExposure": float(statistics.mean(exposed)) if exposed else 0.0,
        "maximumAnchorExposure": max(exposed) if exposed else 0,
        "multiAnchorTradeShare": (
            sum(value > 1 for value in exposed) / len(exposed) if exposed else 0.0
        ),
        "warning": "Anchor discovery is not a probability sample of all trades. Deduplication removes repeated rows but cannot remove selection bias; promotion still requires later independent leagues and exact historical format coverage.",
    }


def _segments(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    working = frame.copy()
    working["elite_band"] = pd.cut(
        working["elite_percentile"], bins=[0.69, 0.85, 0.95, 1.01], labels=["70–84th", "85–94th", "95th+"]
    )
    working["format"] = np.where(working["num_qbs"] >= 2, "Superflex", "1QB")
    working["picks"] = np.where(working["pick_count"] > 0, "Includes picks", "Players only")
    working["age"] = np.where(
        working["elite_age_missing"] > 0, "Pick/no age", np.where(working["elite_age"] < 25, "Under 25", "25+")
    )
    result = []
    for dimension in ("elite_band", "package_size", "format", "picks", "age"):
        for label, group in working.groupby(dimension, observed=True):
            if len(group) < 10:
                continue
            result.append({
                "dimension": dimension,
                "label": str(label),
                "rows": int(len(group)),
                "medianPremium": float(group["paid_premium"].median()),
                "p25Premium": float(group["paid_premium"].quantile(0.25)),
                "p75Premium": float(group["paid_premium"].quantile(0.75)),
            })
    return result


def train_exchange(frame: pd.DataFrame) -> dict[str, Any]:
    rows = len(frame)
    span = (date.fromisoformat(frame["date"].max()) - date.fromisoformat(frame["date"].min())).days if rows else 0
    unique_leagues = int(frame["league_id"].nunique()) if rows else 0
    train, test = _split(frame) if rows >= 2 else (frame, frame.iloc[0:0])
    model = None
    baseline_metrics = {"mae": 0, "rmse": 0}
    global_baseline_metrics = {"mae": 0, "rmse": 0}
    segmented_baseline_metrics = {"mae": 0, "rmse": 0}
    model_metrics = {"mae": 0, "rmse": 0}
    improvement = 0.0
    cluster_improvement = 0.0
    novel_league_rows = 0
    novel_league_metrics = {"mae": 0, "rmse": 0}
    selected_baseline = "global median"
    test_start = str(test["date"].min()) if len(test) else None
    if len(train) >= 20 and len(test) >= 5:
        baseline_value = float(train["paid_premium"].median())
        actual = test["paid_premium"].to_numpy(float)
        global_baseline = np.full(len(test), baseline_value)
        segmented_baseline = _segmented_median_predictions(train, test)
        model, predicted = _fit_model(train, test, EXCHANGE_FEATURES, "paid_premium")
        global_baseline_metrics = _metrics(actual, global_baseline)
        segmented_baseline_metrics = _metrics(actual, segmented_baseline)
        if segmented_baseline_metrics["mae"] < global_baseline_metrics["mae"]:
            selected_baseline = "structure-segmented median"
            baseline = segmented_baseline
            baseline_metrics = segmented_baseline_metrics
        else:
            baseline = global_baseline
            baseline_metrics = global_baseline_metrics
        model_metrics = _metrics(actual, predicted)
        improvement = (baseline_metrics["mae"] - model_metrics["mae"]) / baseline_metrics["mae"] if baseline_metrics["mae"] else 0
        baseline_cluster_mae = _league_balanced_mae(test, actual, baseline)
        model_cluster_mae = _league_balanced_mae(test, actual, predicted)
        cluster_improvement = (
            (baseline_cluster_mae - model_cluster_mae) / baseline_cluster_mae if baseline_cluster_mae else 0.0
        )
        train_leagues = set(train["league_id"].astype(str))
        novel_mask = ~test["league_id"].astype(str).isin(train_leagues)
        novel_league_rows = int(novel_mask.sum())
        if novel_league_rows:
            novel_league_metrics = _metrics(actual[novel_mask.to_numpy()], predicted[novel_mask.to_numpy()])
    format_coverage = float(frame["format_complete"].mean()) if rows else 0
    age_coverage = float(frame["age_complete"].mean()) if rows else 0
    historical_format_coverage = float(frame["historical_format_exact"].mean()) if rows else 0
    gates = [
        _gate("rows", "Eligible accepted trades", rows >= 400, float(rows), ">= 400 deduplicated elite 1-for-2/3 trades"),
        _gate("heldout", "Chronological held-out rows", len(test) >= 80, float(len(test)), ">= 80 later trades"),
        _gate("novelLeagues", "Held-out rows from unseen leagues", novel_league_rows >= 60, float(novel_league_rows), ">= 60 later trades from leagues absent in training"),
        _gate("leagues", "Independent leagues", unique_leagues >= 100, float(unique_leagues), ">= 100 source leagues"),
        _gate("span", "Historical span", span >= 90, float(span), ">= 90 days"),
        _gate("format", "League-format coverage", format_coverage >= 0.95, format_coverage, ">= 95%"),
        _gate("historicalFormat", "Exact historical value format", historical_format_coverage >= 0.95, historical_format_coverage, ">= 95% exact QB/PPR/TEP/team-count history"),
        _gate("age", "Age coverage", age_coverage >= 0.75, age_coverage, ">= 75%"),
        _gate("mae", "Held-out MAE beats best simple baseline", improvement >= 0.02, improvement, ">= 2% improvement"),
        _gate("clusterMae", "League-balanced MAE lift", cluster_improvement >= 0.02, cluster_improvement, ">= 2% improvement"),
    ]
    data_ready = all(gate["passed"] for gate in gates[:-1])
    validated = all(gate["passed"] for gate in gates)
    status = "validated" if validated else "shadow" if data_ready else "needs-data"
    return {
        "status": status,
        "enabled": validated,
        "target": "accepted package value / elite value - 1 at trade date",
        "rows": rows,
        "trainingRows": len(train),
        "testRows": len(test),
        "testStart": test_start,
        "novelLeagueTestRows": novel_league_rows,
        "dateSpanDays": span,
        "uniqueLeagues": unique_leagues,
        "medianPremium": float(frame["paid_premium"].median()) if rows else None,
        "baseline": baseline_metrics,
        "baselines": {
            "selected": selected_baseline,
            "globalMedian": global_baseline_metrics,
            "structureSegmentedMedian": segmented_baseline_metrics,
        },
        "modelMetrics": model_metrics,
        "maeImprovement": improvement,
        "leagueBalancedMaeImprovement": cluster_improvement,
        "novelLeagueMetrics": novel_league_metrics,
        "model": model,
        "segments": _segments(frame),
        "gates": gates,
    }


def train_outcome(frame: pd.DataFrame, horizon: int) -> dict[str, Any]:
    target = f"outcome_{horizon}d"
    labeled = frame[frame[target].notna()].copy()
    rows = len(labeled)
    span = (date.fromisoformat(labeled["date"].max()) - date.fromisoformat(labeled["date"].min())).days if rows else 0
    train, test = _split(labeled) if rows >= 2 else (labeled, labeled.iloc[0:0])
    baseline_metrics = {"mae": 0, "rmse": 0}
    structure_metrics = {"mae": 0, "rmse": 0}
    premium_metrics = {"mae": 0, "rmse": 0}
    structure_model = None
    premium_model = None
    structure_lift = 0.0
    premium_lift = 0.0
    if len(train) >= 20 and len(test) >= 5:
        actual = test[target].to_numpy(float)
        baseline_value = float(train[target].median())
        baseline = np.full(len(test), baseline_value)
        structure_model, structure_pred = _fit_model(train, test, OUTCOME_STRUCTURE_FEATURES, target)
        premium_model, premium_pred = _fit_model(train, test, OUTCOME_PREMIUM_FEATURES, target)
        baseline_metrics = _metrics(actual, baseline)
        structure_metrics = _metrics(actual, structure_pred)
        premium_metrics = _metrics(actual, premium_pred)
        structure_lift = (baseline_metrics["mae"] - structure_metrics["mae"]) / baseline_metrics["mae"] if baseline_metrics["mae"] else 0
        premium_lift = (structure_metrics["mae"] - premium_metrics["mae"]) / structure_metrics["mae"] if structure_metrics["mae"] else 0
    minimum_rows = {90: 300, 180: 220, 365: 120}[horizon]
    minimum_test = {90: 60, 180: 44, 365: 24}[horizon]
    gates = [
        _gate("rows", f"{horizon}-day labels", rows >= minimum_rows, float(rows), f">= {minimum_rows} point-in-time outcomes"),
        _gate("heldout", "Chronological held-out rows", len(test) >= minimum_test, float(len(test)), f">= {minimum_test} later outcomes"),
        _gate("span", "Trade-date span", span >= 90, float(span), ">= 90 days"),
        _gate("structure", "Structure model beats median", structure_lift >= 0.02, structure_lift, ">= 2% MAE improvement"),
        _gate("premium", "Premium feature adds held-out value", premium_lift >= 0.02, premium_lift, ">= 2% MAE improvement vs structure-only"),
    ]
    data_ready = all(gate["passed"] for gate in gates[:3])
    validated = all(gate["passed"] for gate in gates)
    return {
        "status": "validated" if validated else "shadow" if data_ready else "needs-data",
        "enabled": validated,
        "horizonDays": horizon,
        "target": "elite-side market return minus package-side market return",
        "rows": rows,
        "trainingRows": len(train),
        "testRows": len(test),
        "baseline": baseline_metrics,
        "structureOnly": {"metrics": structure_metrics, "maeImprovement": structure_lift, "model": structure_model},
        "premiumAware": {"metrics": premium_metrics, "maeImprovementVsStructure": premium_lift, "model": premium_model},
        "gates": gates,
    }


def report_markdown(report: dict[str, Any]) -> str:
    exchange = report["exchange"]
    manifest = report["trainingManifest"]
    lines = [
        "# Trade model health",
        "",
        f"Generated: `{report['generatedAt']}`",
        "",
        f"Training dataset: `{manifest['datasetId']}`",
        f"Point-in-time coverage: **{manifest['pointInTimeValuedTrades']}/{manifest['totalTrades']} trades**",
        "",
        "The raw provider total remains unchanged. These models are separate evidence layers.",
        "",
        "## Exchange-premium model",
        "",
        f"- Status: **{exchange['status']}**",
        f"- Eligible completed trades: **{exchange['rows']}**",
        f"- Unique source leagues: **{exchange['uniqueLeagues']}**",
        f"- Date span: **{exchange['dateSpanDays']} days**",
        f"- Median observed premium: **{exchange['medianPremium'] if exchange['medianPremium'] is not None else 'unavailable'}**",
        f"- Best simple baseline: **{exchange.get('baselines', {}).get('selected', 'global median')}**",
        f"- Later unseen-league rows: **{exchange.get('novelLeagueTestRows', 0)}**",
        f"- Held-out MAE lift vs best baseline: **{exchange['maeImprovement']:.1%}**",
        f"- League-balanced MAE lift: **{exchange.get('leagueBalancedMaeImprovement', 0):.1%}**",
        "",
        "## Outcome challengers",
        "",
    ]
    for horizon in report["outcomes"]:
        lines.append(
            f"- {horizon['horizonDays']}d: **{horizon['status']}**, {horizon['rows']} labels; "
            f"premium-aware lift vs structure-only {horizon['premiumAware']['maeImprovementVsStructure']:.1%}"
        )
    lines.extend([
        "",
        "## Known boundary",
        "",
        "FantasyCalc exposes completed packages, format fields, ages and point-in-time market values, but not the full historical rosters needed to measure lineup outcomes. The lineup target still needs league-local snapshots and cannot be substituted with market return.",
        "",
        f"Sources: {FAQ}, {TERMS}",
        "",
    ])
    return "\n".join(lines)


def train() -> dict[str, Any]:
    ensure_dirs()
    trades = load_all_trades()
    histories_by_qb = {num_qbs: load_histories(num_qbs) for num_qbs in (1, 2)}
    examples = build_examples(trades, histories_by_qb)
    add_outcome_labels(examples, histories_by_qb)
    safe_examples = [{key: value for key, value in row.items() if key not in {"asset_ids", "package_asset_ids"}} for row in examples]
    _write_json(PROCESSED / "examples.json", safe_examples)
    frame = pd.DataFrame(examples)
    if frame.empty:
        frame = pd.DataFrame(columns=["date", "trade_id", "league_id", "paid_premium", "format_complete", "historical_format_exact", "age_complete", *EXCHANGE_FEATURES, *[f"outcome_{h}d" for h in HORIZONS]])
    report = {
        "generatedAt": utc_now(),
        "source": {
            "name": "FantasyCalc public completed-trade and player-history APIs",
            "methodology": FAQ,
            "terms": TERMS,
            "acceptedTradesOnly": True,
            "warning": "Accepted trades cannot identify rejected-offer acceptance probability.",
            "historicalFormatWarning": "The historical endpoint matches 1QB versus superflex but does not expose point-in-time PPR, TE-premium, or team-count variants.",
        },
        "trainingManifest": build_training_manifest(trades, histories_by_qb),
        "rawTradeCount": len(trades),
        "historyAssetCount": len(set(histories_by_qb[1]) | set(histories_by_qb[2])),
        "historySeriesCount": sum(len(histories) for histories in histories_by_qb.values()),
        "samplingAudit": build_anchor_sampling_audit(trades),
        "exchange": train_exchange(frame),
        "outcomes": [train_outcome(frame, horizon) for horizon in HORIZONS],
        "lineupOutcome": {
            "status": "needs-data",
            "enabled": False,
            "target": "90/180/365-day change in legal projected lineup output",
            "rows": 0,
            "reason": "External completed trades do not expose point-in-time full rosters or legal lineups. League-local snapshots are required.",
        },
    }
    _write_json(REPORT_JSON, report)
    _write_json(PUBLIC_JSON, report)
    REPORT_MD.write_text(report_markdown(report))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("collect", "train", "refresh", "import-tape", "audit-trades"))
    parser.add_argument("--tape", type=Path)
    parser.add_argument("--anchors", type=int, default=80)
    parser.add_argument("--history-scope", choices=("trades", "universe"), default="universe")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.command == "audit-trades":
        print(json.dumps(audit_trade_availability(offline=args.offline), indent=2))
        return
    if args.command == "import-tape":
        if args.tape is None:
            raise SystemExit("--tape is required for import-tape")
        print(json.dumps(import_training_tape(args.tape), indent=2))
        return
    if args.command in {"collect", "refresh"}:
        result = collect(args.anchors, args.offline, args.refresh, args.history_scope)
        print(json.dumps(result, indent=2))
    if args.command in {"train", "refresh"}:
        report = train()
        print(json.dumps({
            "exchange": report["exchange"]["status"],
            "exchangeRows": report["exchange"]["rows"],
            "outcomes": {item["horizonDays"]: item["status"] for item in report["outcomes"]},
        }, indent=2))


if __name__ == "__main__":
    main()

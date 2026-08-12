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
PROCESSED = ROOT / "data" / "processed" / "trade_models"
REPORT_JSON = ROOT / "ml" / "reports" / "trade-model-health.json"
REPORT_MD = ROOT / "ml" / "reports" / "trade-model-health.md"
PUBLIC_JSON = ROOT / "public" / "data" / "trade-model-health.json"

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
    for path in (CURRENT, TRADES, HISTORIES, PROCESSED, REPORT_JSON.parent, PUBLIC_JSON.parent):
        path.mkdir(parents=True, exist_ok=True)


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True))
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


def _cached_today(meta_path: Path) -> bool:
    if not meta_path.exists():
        return False
    try:
        return str(json.loads(meta_path.read_text()).get("retrievedAt") or "")[:10] == datetime.now(timezone.utc).date().isoformat()
    except (json.JSONDecodeError, OSError):
        return False


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
    if refresh or not path.exists() or (not offline and not _cached_today(meta_path)):
        if offline:
            raise FileNotFoundError(path)
        payload = fetch_json(_url(f"/trades/historical/{asset_id}", {"isDynasty": "true", "numQbs": num_qbs}))
        if not isinstance(payload, list):
            raise ValueError(f"History query for {asset_id} did not return a list")
        _write_json(path, payload)
        _write_json(meta_path, {"retrievedAt": utc_now(), "endpoint": f"/trades/historical/{asset_id}", "numQbs": num_qbs})
    payload = json.loads(path.read_text())
    return asset_id, num_qbs, len(payload)


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
    model_metrics = {"mae": 0, "rmse": 0}
    improvement = 0.0
    if len(train) >= 20 and len(test) >= 5:
        baseline_value = float(train["paid_premium"].median())
        actual = test["paid_premium"].to_numpy(float)
        baseline = np.full(len(test), baseline_value)
        model, predicted = _fit_model(train, test, EXCHANGE_FEATURES, "paid_premium")
        baseline_metrics = _metrics(actual, baseline)
        model_metrics = _metrics(actual, predicted)
        improvement = (baseline_metrics["mae"] - model_metrics["mae"]) / baseline_metrics["mae"] if baseline_metrics["mae"] else 0
    format_coverage = float(frame["format_complete"].mean()) if rows else 0
    age_coverage = float(frame["age_complete"].mean()) if rows else 0
    historical_format_coverage = float(frame["historical_format_exact"].mean()) if rows else 0
    gates = [
        _gate("rows", "Eligible accepted trades", rows >= 400, float(rows), ">= 400 deduplicated elite 1-for-2/3 trades"),
        _gate("heldout", "Chronological held-out rows", len(test) >= 80, float(len(test)), ">= 80 later trades"),
        _gate("leagues", "Independent leagues", unique_leagues >= 100, float(unique_leagues), ">= 100 source leagues"),
        _gate("span", "Historical span", span >= 90, float(span), ">= 90 days"),
        _gate("format", "League-format coverage", format_coverage >= 0.95, format_coverage, ">= 95%"),
        _gate("historicalFormat", "Exact historical value format", historical_format_coverage >= 0.95, historical_format_coverage, ">= 95% exact QB/PPR/TEP/team-count history"),
        _gate("age", "Age coverage", age_coverage >= 0.75, age_coverage, ">= 75%"),
        _gate("mae", "Held-out MAE beats median", improvement >= 0, improvement, ">= 0% regression"),
    ]
    data_ready = all(gate["passed"] for gate in gates[:-1])
    validated = all(gate["passed"] for gate in gates)
    status = "validated" if validated else "shadow" if data_ready else "collecting"
    return {
        "status": status,
        "enabled": validated,
        "target": "accepted package value / elite value - 1 at trade date",
        "rows": rows,
        "trainingRows": len(train),
        "testRows": len(test),
        "dateSpanDays": span,
        "uniqueLeagues": unique_leagues,
        "medianPremium": float(frame["paid_premium"].median()) if rows else None,
        "baseline": baseline_metrics,
        "modelMetrics": model_metrics,
        "maeImprovement": improvement,
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
        "status": "validated" if validated else "shadow" if data_ready else "collecting",
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
    lines = [
        "# Trade model health",
        "",
        f"Generated: `{report['generatedAt']}`",
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
        "FantasyCalc exposes completed packages, format fields, ages and point-in-time market values, but not the full historical rosters needed to measure lineup outcomes. The lineup target remains collecting from league-local snapshots and cannot be substituted with market return.",
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
        "rawTradeCount": len(trades),
        "historyAssetCount": len(set(histories_by_qb[1]) | set(histories_by_qb[2])),
        "historySeriesCount": sum(len(histories) for histories in histories_by_qb.values()),
        "exchange": train_exchange(frame),
        "outcomes": [train_outcome(frame, horizon) for horizon in HORIZONS],
        "lineupOutcome": {
            "status": "collecting",
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
    parser.add_argument("command", choices=("collect", "train", "refresh"))
    parser.add_argument("--anchors", type=int, default=80)
    parser.add_argument("--history-scope", choices=("trades", "universe"), default="universe")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
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

#!/usr/bin/env python3
"""Audit external historical market and news sources before model training.

This command is deliberately offline-first and isolated from the live app. It
caches raw provider responses, writes normalized research rows under
``data/processed`` (gitignored), and commits only a compact evidence report.
Nothing collected here can change rankings or trade recommendations.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed" / "source_audit"
TRADYR = RAW / "tradyr"
TRADYR_FULL = TRADYR / "full"
TRADYR_HISTORY = TRADYR / "history"
NFLVERSE = RAW / "nflverse"
GDELT = RAW / "source_audit" / "gdelt"
FANTASYCALC = RAW / "source_audit" / "fantasycalc"
FANTASYCALC_CURRENT = FANTASYCALC / "current"
FANTASYCALC_HISTORY = FANTASYCALC / "history"
REPORTS = ROOT / "ml" / "reports"

TRADYR_BASE = "https://api.tradyr.app/v1"
TRADYR_DOCS = "https://api.tradyr.app/docs"
NFLVERSE_ROSTER_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "weekly_rosters/roster_weekly_{season}.csv"
)
NFLVERSE_INJURY_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "injuries/injuries_{season}.csv"
)
NFLVERSE_REPO = "https://github.com/nflverse/nflverse-data"
GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_DOCS = "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/"
FANTASYCALC_BASE = "https://api.fantasycalc.com"
FANTASYCALC_RANKINGS = "https://fantasycalc.com/dynasty-rankings"
FANTASYCALC_TERMS = "https://fantasycalc.com/terms-of-usage"
FANTASYCALC_FAQ = "https://fantasycalc.com/frequently-asked-questions"
FANTASYCALC_CURRENT_FORMAT = {
    "isDynasty": "true",
    "numQbs": "2",
    "numTeams": "12",
    "ppr": "1",
    # FantasyCalc defines te+ as 0.5-1.0 TEP, which contains this league's 0.75.
    "tep": "te+",
    "includeAdp": "false",
    "includeRosterPercent": "false",
}

POSITIONS = ("QB", "RB", "WR", "TE")
POSITION_SHARES = {"QB": 0.20, "RB": 0.28, "WR": 0.32, "TE": 0.20}
ACTIVE_STATUSES = {"ACT"}
TERMINAL_STATUSES = {"CUT", "RET"}
DAY_SECONDS = 86_400


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_dirs() -> None:
    for path in (
        PROCESSED,
        TRADYR_FULL,
        TRADYR_HISTORY,
        NFLVERSE,
        GDELT,
        FANTASYCALC_CURRENT,
        FANTASYCALC_HISTORY,
        REPORTS,
    ):
        path.mkdir(parents=True, exist_ok=True)


def request_bytes(url: str, attempts: int = 3, timeout: int = 30) -> bytes:
    headers = {
        "Accept": "application/json,text/csv;q=0.9,*/*;q=0.8",
        "User-Agent": "RosterLab/1.0 (private historical source audit)",
    }
    api_key = os.environ.get("TRADYR_API_KEY", "").strip()
    if api_key and url.startswith(TRADYR_BASE):
        headers["Authorization"] = f"Bearer {api_key}"
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < attempts - 1:
                time.sleep(max(5, int(error.headers.get("Retry-After", "15"))))
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


def fetch_json(url: str, attempts: int = 3, timeout: int = 30) -> Any:
    return json.loads(request_bytes(url, attempts=attempts, timeout=timeout))


def download(url: str, path: Path, refresh: bool, offline: bool) -> None:
    if path.exists() and not refresh:
        return
    if offline:
        raise FileNotFoundError(f"Offline audit is missing cached source: {path}")
    payload = request_bytes(url)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(payload)
    temporary.replace(path)


def normalize_history_date(value: str) -> str | None:
    compact = str(value or "").strip()
    try:
        if len(compact) == 6 and compact.isdigit():
            parsed = datetime.strptime(compact, "%y%m%d").date()
        elif len(compact) == 10 and "/" in compact:
            parsed = datetime.strptime(compact, "%m/%d/%Y").date()
        elif len(compact) >= 10:
            parsed = date.fromisoformat(compact[:10])
        else:
            return None
    except ValueError:
        return None
    return parsed.isoformat()


def _position_quotas(limit: int) -> dict[str, int]:
    quotas = {position: math.floor(limit * share) for position, share in POSITION_SHARES.items()}
    remainder = limit - sum(quotas.values())
    order = sorted(POSITIONS, key=lambda position: (-POSITION_SHARES[position], POSITIONS.index(position)))
    for position in order[:remainder]:
        quotas[position] += 1
    return quotas


def _evenly_spaced(rows: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    if count >= len(rows):
        return rows
    return [rows[min(len(rows) - 1, math.floor((index + 0.5) * len(rows) / count))] for index in range(count)]


def select_stratified_players(players: Iterable[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Select a deterministic cross-position and cross-value player sample."""
    valid: dict[str, dict[str, Any]] = {}
    for player in players:
        slug = str(player.get("slug") or "")
        position = str(player.get("position") or "")
        value = float(player.get("composite") or 0)
        if slug and position in POSITIONS and value > 0:
            valid.setdefault(slug, player)
    quotas = _position_quotas(min(limit, len(valid)))
    selected: list[dict[str, Any]] = []
    used: set[str] = set()
    for position in POSITIONS:
        rows = sorted(
            (player for player in valid.values() if player["position"] == position),
            key=lambda player: (-float(player["composite"]), str(player["slug"])),
        )
        for player in _evenly_spaced(rows, min(quotas[position], len(rows))):
            selected.append(player)
            used.add(str(player["slug"]))
    if len(selected) < min(limit, len(valid)):
        remaining = sorted(
            (player for slug, player in valid.items() if slug not in used),
            key=lambda player: (-float(player["composite"]), str(player["slug"])),
        )
        selected.extend(remaining[: min(limit, len(valid)) - len(selected)])
    return selected


def count_return_labels(
    observed_dates: list[str], horizon_days: int, tolerance_days: int, spacing_days: int
) -> int:
    dates = sorted({normalized for value in observed_dates if (normalized := normalize_history_date(value))})
    parsed = [date.fromisoformat(value) for value in dates]
    labels = 0
    last_anchor: date | None = None
    for index, anchor in enumerate(parsed):
        if last_anchor and (anchor - last_anchor).days < spacing_days:
            continue
        if any(
            horizon_days - tolerance_days <= (candidate - anchor).days <= horizon_days + tolerance_days
            for candidate in parsed[index + 1 :]
        ):
            labels += 1
            last_anchor = anchor
    return labels


def summarize_history(history: Iterable[dict[str, Any]], current_value: float | None = None) -> dict[str, Any]:
    normalized: dict[str, dict[str, Any]] = {}
    invalid = 0
    duplicates = 0
    for point in history:
        observed_at = normalize_history_date(str(point.get("date") or ""))
        try:
            value = float(point.get("value"))
        except (TypeError, ValueError):
            value = 0
        raw_value = point.get("raw")
        try:
            raw = float(raw_value) if raw_value is not None else None
        except (TypeError, ValueError):
            raw = None
        if not observed_at or not math.isfinite(value) or value <= 0:
            invalid += 1
            continue
        if observed_at in normalized:
            duplicates += 1
        normalized[observed_at] = {
            "observedAt": observed_at,
            "value": value,
            "rawValue": raw if raw is not None and math.isfinite(raw) and raw > 0 else None,
        }
    observations = [normalized[key] for key in sorted(normalized)]
    observed_dates = [point["observedAt"] for point in observations]
    gaps = [
        (date.fromisoformat(observed_dates[index]) - date.fromisoformat(observed_dates[index - 1])).days
        for index in range(1, len(observed_dates))
    ]
    first = observed_dates[0] if observed_dates else None
    last = observed_dates[-1] if observed_dates else None
    latest_value = observations[-1]["value"] if observations else None
    scale_gap = None
    if latest_value and current_value and current_value > 0:
        scale_gap = abs(latest_value - current_value) / current_value
    return {
        "observations": observations,
        "observationCount": len(observations),
        "invalidPointCount": invalid,
        "duplicateDateCount": duplicates,
        "firstObservedAt": first,
        "lastObservedAt": last,
        "spanDays": (date.fromisoformat(last) - date.fromisoformat(first)).days if first and last else 0,
        "medianGapDays": statistics.median(gaps) if gaps else 0,
        "p90GapDays": _percentile(gaps, 0.9) if gaps else 0,
        "currentScaleGap": scale_gap,
        "labels": {
            "7d": count_return_labels(observed_dates, 7, 3, 7),
            "30d": count_return_labels(observed_dates, 30, 10, 21),
            "90d": count_return_labels(observed_dates, 90, 20, 60),
        },
    }


def _percentile(values: list[float] | list[int], quantile: float) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(ordered[lower])
    weight = position - lower
    return float(ordered[lower] * (1 - weight) + ordered[upper] * weight)


def _safe_median(values: Iterable[float | int | None]) -> float:
    usable = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    return statistics.median(usable) if usable else 0


def _gate(identifier: str, label: str, passed: bool, actual: Any, requirement: str) -> dict[str, Any]:
    return {"id": identifier, "label": label, "passed": bool(passed), "actual": actual, "requirement": requirement}


def load_tradyr_catalog(refresh: bool, offline: bool) -> dict[str, Any]:
    path = TRADYR / "players.json"
    cached = json.loads(path.read_text()) if path.exists() else None
    complete = bool(cached and len(cached.get("data", [])) >= int(cached.get("meta", {}).get("total", 0)))
    if refresh or not complete:
        if offline:
            if not cached:
                raise FileNotFoundError(f"Missing cached Tradyr catalog: {path}")
            return cached
        query = urllib.parse.urlencode({"format": "dynasty", "numQbs": 2, "tep": "true", "limit": 1000})
        cached = fetch_json(f"{TRADYR_BASE}/players?{query}")
        path.write_text(json.dumps(cached, separators=(",", ":")))
    return cached


def collect_tradyr_history(
    sample_size: int, refresh: bool, offline: bool
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    catalog = load_tradyr_catalog(refresh, offline)
    selected = select_stratified_players(catalog.get("data", []), sample_size)
    results_by_slug: dict[str, dict[str, Any]] = {}
    observations_by_slug: dict[str, list[dict[str, Any]]] = {}
    normalized_rows: list[dict[str, Any]] = []
    request_interval = 0.05 if os.environ.get("TRADYR_API_KEY") else 1.05
    request_lock = Lock()
    last_request_at = [0.0]

    def wait_for_request_slot() -> None:
        with request_lock:
            remaining = request_interval - (time.monotonic() - last_request_at[0])
            if remaining > 0:
                time.sleep(remaining)
            last_request_at[0] = time.monotonic()

    def audit_player(catalog_player: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        slug = str(catalog_player["slug"])
        full_path = TRADYR_FULL / f"{slug}.json"
        history_path = TRADYR_HISTORY / f"{slug}.json"
        status = "complete"
        error_message = None
        try:
            if not refresh and full_path.exists():
                payload = json.loads(full_path.read_text())
            elif not refresh and history_path.exists():
                payload = json.loads(history_path.read_text())
            else:
                if offline:
                    raise FileNotFoundError(f"Missing cached Tradyr history: {history_path}")
                wait_for_request_slot()
                payload = fetch_json(
                    f"{TRADYR_BASE}/players/{urllib.parse.quote(slug)}/history",
                    attempts=1,
                    timeout=20,
                )
                history_path.write_text(json.dumps(payload, separators=(",", ":")))
            detail = payload.get("data", {})
            summary = summarize_history(detail.get("history", []), float(catalog_player.get("composite") or 0))
            if not summary["observationCount"]:
                status = "missing"
            meta = payload.get("meta", {})
        except (OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError) as error:
            status = "failed"
            error_message = str(error)[:300]
            detail = {}
            summary = summarize_history([])
            meta = {}
        sleeper_id = str(detail.get("sleeperId") or catalog_player.get("sleeperId") or "") or None
        result = {
            "slug": slug,
            "name": detail.get("name") or catalog_player.get("name"),
            "position": detail.get("position") or catalog_player.get("position"),
            "sleeperId": sleeper_id,
            "currentValue": float(catalog_player.get("composite") or 0),
            "status": status,
            "error": error_message,
            "provenanceComplete": bool(meta.get("generatedAt") and meta.get("sources") and meta.get("attribution")),
            "providerVersion": meta.get("version"),
            **{key: value for key, value in summary.items() if key != "observations"},
        }
        player_rows: list[dict[str, Any]] = []
        for point in summary["observations"]:
            player_rows.append({
                "provider": "tradyr",
                "asset_id": sleeper_id or slug,
                "asset_name": result["name"],
                "position": result["position"],
                "observed_at": point["observedAt"],
                "provider_value": point["value"],
                "raw_value": point["rawValue"],
                "source_version": meta.get("version"),
                "retrieved_at": meta.get("generatedAt"),
                "source_format": "provider-history-unspecified",
            })
        return result, player_rows

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(audit_player, player): str(player["slug"]) for player in selected}
        completed = 0
        for future in as_completed(futures):
            slug = futures[future]
            result, player_rows = future.result()
            results_by_slug[slug] = result
            observations_by_slug[slug] = player_rows
            completed += 1
            print(
                f"  market {completed:>3}/{len(selected)} {slug}: "
                f"{result['status']}, {result['observationCount']} observations",
                flush=True,
            )

    results = [results_by_slug[str(player["slug"])] for player in selected]
    for player in selected:
        normalized_rows.extend(observations_by_slug[str(player["slug"])])
    return catalog, results, normalized_rows


def _latest_months(latest: str, count: int) -> list[str]:
    cursor = date.fromisoformat(latest).replace(day=1)
    months: list[str] = []
    for _ in range(count):
        months.append(cursor.strftime("%Y-%m"))
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    return sorted(months)


def market_report(
    catalog: dict[str, Any], results: list[dict[str, Any]], rows: list[dict[str, Any]]
) -> dict[str, Any]:
    covered = [result for result in results if result["status"] == "complete" and result["observationCount"]]
    coverage_rate = len(covered) / len(results) if results else 0
    provenance_rate = sum(bool(result["provenanceComplete"]) for result in covered) / len(covered) if covered else 0
    latest_date = max((row["observed_at"] for row in rows), default=None)
    monthly_coverage: list[dict[str, Any]] = []
    if latest_date:
        points_by_month: dict[str, set[str]] = defaultdict(set)
        first_by_asset: dict[str, str] = {}
        for row in rows:
            asset_id = str(row["asset_id"])
            month = str(row["observed_at"])[:7]
            points_by_month[month].add(asset_id)
            first_by_asset[asset_id] = min(first_by_asset.get(asset_id, month), month)
        for month in _latest_months(latest_date, 12):
            eligible = {asset_id for asset_id, first in first_by_asset.items() if first <= month}
            observed = points_by_month.get(month, set())
            monthly_coverage.append({
                "month": month,
                "eligibleAssets": len(eligible),
                "observedAssets": len(observed & eligible),
                "coverage": len(observed & eligible) / len(eligible) if eligible else 0,
            })
    median_monthly_coverage = _safe_median(row["coverage"] for row in monthly_coverage)
    current_scale_gaps = [result["currentScaleGap"] for result in covered if result["currentScaleGap"] is not None]
    metrics = {
        "catalogAssetsLoaded": len(catalog.get("data", [])),
        "catalogAssetsReported": int(catalog.get("meta", {}).get("total", len(catalog.get("data", [])))),
        "sampleAssets": len(results),
        "coveredAssets": len(covered),
        "missingAssets": sum(result["status"] == "missing" for result in results),
        "failedAssets": sum(result["status"] == "failed" for result in results),
        "coverageRate": coverage_rate,
        "observations": len(rows),
        "medianObservations": _safe_median(result["observationCount"] for result in covered),
        "medianSpanDays": _safe_median(result["spanDays"] for result in covered),
        "medianGapDays": _safe_median(result["medianGapDays"] for result in covered),
        "medianCurrentScaleGap": _safe_median(current_scale_gaps),
        "provenanceRate": provenance_rate,
        "labelCounts": {
            horizon: sum(int(result["labels"][horizon]) for result in covered)
            for horizon in ("7d", "30d", "90d")
        },
        "medianLatest12MonthlyCoverage": median_monthly_coverage,
    }
    gates = [
        _gate("coverage", "Current-player history coverage", coverage_rate >= 0.85, coverage_rate, ">= 85%"),
        _gate("historyDepth", "Median historical depth", metrics["medianSpanDays"] >= 730, metrics["medianSpanDays"], ">= 730 days"),
        _gate("cadence", "Median observation gap", 0 < metrics["medianGapDays"] <= 35, metrics["medianGapDays"], "1-35 days"),
        _gate("crossSection", "Recent monthly cross-section", median_monthly_coverage >= 0.80, median_monthly_coverage, ">= 80%"),
        _gate("labels30", "Independent 30-day labels", metrics["labelCounts"]["30d"] >= 500, metrics["labelCounts"]["30d"], ">= 500"),
        _gate("labels90", "Independent 90-day labels", metrics["labelCounts"]["90d"] >= 250, metrics["labelCounts"]["90d"], ">= 250"),
        _gate("provenance", "Provider provenance", provenance_rate == 1, provenance_rate, "100%"),
        _gate("survivorBias", "Delisted-player universe", False, "current catalog only", "historical universe includes delisted players"),
        _gate("historicalFormat", "Historical format provenance", False, "unspecified", "SF/TEP or validated source-relative mapping"),
    ]
    pilot_gate_ids = {"coverage", "cadence", "crossSection", "provenance"}
    return {
        "provider": "tradyr",
        "role": "historical market labels",
        "requestedCurrentFormat": {"format": "dynasty", "numQbs": 2, "tep": True},
        "historicalFormat": "provider-history-unspecified",
        "metrics": metrics,
        "monthlyCoverage": monthly_coverage,
        "gates": gates,
        "pilotReady": all(gate["passed"] for gate in gates if gate["id"] in pilot_gate_ids),
        "trainingReady": all(gate["passed"] for gate in gates),
        "sample": results,
    }


def _write_json_atomic(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(value, separators=(",", ":")))
    temporary.replace(path)


def _fantasycalc_current_url() -> str:
    return f"{FANTASYCALC_BASE}/values/current?{urllib.parse.urlencode(FANTASYCALC_CURRENT_FORMAT)}"


def _fantasycalc_history_url(player_id: str) -> str:
    query = urllib.parse.urlencode({"isDynasty": "true", "numQbs": "2"})
    return f"{FANTASYCALC_BASE}/trades/historical/{urllib.parse.quote(player_id)}?{query}"


def load_fantasycalc_current(refresh: bool, offline: bool) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Load one current FantasyCalc snapshot, never requesting it more than daily."""
    today = datetime.now(timezone.utc).date().isoformat()
    path = FANTASYCALC_CURRENT / f"{today}.json"
    meta_path = FANTASYCALC_CURRENT / f"{today}.meta.json"
    if offline and not path.exists():
        cached = sorted(
            candidate
            for candidate in FANTASYCALC_CURRENT.glob("*.json")
            if not candidate.name.endswith(".meta.json")
        )
        if not cached:
            raise FileNotFoundError("Offline audit is missing a FantasyCalc current snapshot")
        path = cached[-1]
        meta_path = path.with_name(f"{path.stem}.meta.json")
    if refresh or not path.exists():
        if offline:
            raise FileNotFoundError(f"Offline audit is missing cached source: {path}")
        payload = fetch_json(_fantasycalc_current_url())
        if not isinstance(payload, list):
            raise ValueError("FantasyCalc current endpoint did not return a list")
        metadata = {
            "retrievedAt": utc_now(),
            "endpoint": "/values/current",
            "params": FANTASYCALC_CURRENT_FORMAT,
            "attribution": FANTASYCALC_RANKINGS,
        }
        _write_json_atomic(path, payload)
        _write_json_atomic(meta_path, metadata)
    else:
        payload = json.loads(path.read_text())
        metadata = json.loads(meta_path.read_text()) if meta_path.exists() else {
            "retrievedAt": f"{path.stem}T00:00:00Z",
            "endpoint": "/values/current",
            "params": FANTASYCALC_CURRENT_FORMAT,
            "attribution": FANTASYCALC_RANKINGS,
        }
    if not isinstance(payload, list):
        raise ValueError("Cached FantasyCalc current response is not a list")
    return payload, metadata


def _load_fantasycalc_history(
    player_id: str, refresh: bool, offline: bool
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    path = FANTASYCALC_HISTORY / f"{player_id}.json"
    meta_path = FANTASYCALC_HISTORY / f"{player_id}.meta.json"
    cached_meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    today = datetime.now(timezone.utc).date().isoformat()
    fresh_today = str(cached_meta.get("retrievedAt") or "")[:10] == today
    if refresh or not path.exists() or (not offline and not fresh_today):
        if offline:
            raise FileNotFoundError(f"Offline audit is missing cached source: {path}")
        payload = fetch_json(_fantasycalc_history_url(player_id), attempts=2, timeout=30)
        if not isinstance(payload, list):
            raise ValueError(f"FantasyCalc history for {player_id} did not return a list")
        cached_meta = {
            "retrievedAt": utc_now(),
            "endpoint": f"/trades/historical/{player_id}",
            "params": {"isDynasty": "true", "numQbs": "2"},
            "attribution": FANTASYCALC_RANKINGS,
        }
        _write_json_atomic(path, payload)
        _write_json_atomic(meta_path, cached_meta)
    else:
        payload = json.loads(path.read_text())
    if not isinstance(payload, list):
        raise ValueError(f"Cached FantasyCalc history for {player_id} is not a list")
    return payload, cached_meta


def collect_fantasycalc_history(
    sample_size: int, refresh: bool, offline: bool
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Audit a bounded, deterministic player sample from FantasyCalc's own API."""
    current, current_meta = load_fantasycalc_current(refresh, offline)
    candidates: list[dict[str, Any]] = []
    snapshot_rows: list[dict[str, Any]] = []
    for item in current:
        player = item.get("player") if isinstance(item, dict) else None
        if not isinstance(player, dict):
            continue
        position = str(player.get("position") or "")
        fantasycalc_id = str(player.get("id") or "")
        sleeper_id = str(player.get("sleeperId") or "") or None
        try:
            value = float(item.get("value") or 0)
        except (TypeError, ValueError):
            value = 0
        if not fantasycalc_id or value <= 0:
            continue
        snapshot_rows.append({
            "provider": "fantasycalc",
            "asset_id": sleeper_id or f"fantasycalc:{fantasycalc_id}",
            "fantasycalc_id": fantasycalc_id,
            "asset_name": player.get("name"),
            "position": position,
            "observed_at": str(current_meta.get("retrievedAt") or "")[:10],
            "provider_value": value,
            "overall_rank": item.get("overallRank"),
            "position_rank": item.get("positionRank"),
            "trend_30_day": item.get("trend30Day"),
            "trade_frequency": item.get("maybeTradeFrequency"),
            "retrieved_at": current_meta.get("retrievedAt"),
            "source_format": "dynasty-12-team-superflex-full-ppr-tep-plus",
        })
        if position in POSITIONS and sleeper_id:
            candidates.append({
                "slug": fantasycalc_id,
                "fantasycalcId": fantasycalc_id,
                "sleeperId": sleeper_id,
                "name": player.get("name"),
                "position": position,
                "composite": value,
            })

    selected = select_stratified_players(candidates, sample_size)
    results_by_id: dict[str, dict[str, Any]] = {}
    rows_by_id: dict[str, list[dict[str, Any]]] = {}
    request_lock = Lock()
    last_request_at = [0.0]

    def wait_for_request_slot() -> None:
        with request_lock:
            remaining = 0.15 - (time.monotonic() - last_request_at[0])
            if remaining > 0:
                time.sleep(remaining)
            last_request_at[0] = time.monotonic()

    def audit_player(player: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        player_id = str(player["fantasycalcId"])
        error_message = None
        try:
            wait_for_request_slot()
            history, metadata = _load_fantasycalc_history(player_id, refresh, offline)
            summary = summarize_history(history, float(player["composite"]))
            status = "complete" if summary["observationCount"] else "missing"
        except (OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError) as error:
            metadata = {}
            summary = summarize_history([])
            status = "failed"
            error_message = str(error)[:300]
        result = {
            "slug": player_id,
            "fantasycalcId": player_id,
            "sleeperId": player["sleeperId"],
            "name": player["name"],
            "position": player["position"],
            "currentValue": float(player["composite"]),
            "status": status,
            "error": error_message,
            "provenanceComplete": bool(metadata.get("retrievedAt") and metadata.get("endpoint")),
            **{key: value for key, value in summary.items() if key != "observations"},
        }
        rows = [{
            "provider": "fantasycalc",
            "asset_id": player["sleeperId"],
            "fantasycalc_id": player_id,
            "asset_name": player["name"],
            "position": player["position"],
            "observed_at": point["observedAt"],
            "provider_value": point["value"],
            "raw_value": point["rawValue"],
            "source_version": "public-player-history",
            "retrieved_at": metadata.get("retrievedAt"),
            "source_format": "dynasty-superflex; historical endpoint has no PPR, TEP, or team-count parameter",
        } for point in summary["observations"]]
        return result, rows

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(audit_player, player): str(player["fantasycalcId"]) for player in selected}
        completed = 0
        for future in as_completed(futures):
            player_id = futures[future]
            result, rows = future.result()
            results_by_id[player_id] = result
            rows_by_id[player_id] = rows
            completed += 1
            print(
                f"  fantasycalc {completed:>3}/{len(selected)} {result['name']}: "
                f"{result['status']}, {result['observationCount']} observations",
                flush=True,
            )

    results = [results_by_id[str(player["fantasycalcId"])] for player in selected]
    history_rows = [row for player in selected for row in rows_by_id[str(player["fantasycalcId"])]]
    catalog = {"data": candidates, "rawAssetCount": len(current), "metadata": current_meta}
    return catalog, results, history_rows, snapshot_rows


def fantasycalc_report(
    catalog: dict[str, Any], results: list[dict[str, Any]], rows: list[dict[str, Any]], snapshot_rows: list[dict[str, Any]]
) -> dict[str, Any]:
    covered = [result for result in results if result["status"] == "complete" and result["observationCount"]]
    coverage_rate = len(covered) / len(results) if results else 0
    sleeper_rate = (
        sum(bool(asset.get("sleeperId")) for asset in catalog.get("data", [])) / len(catalog.get("data", []))
        if catalog.get("data") else 0
    )
    latest_date = max((str(row["observed_at"]) for row in rows), default=None)
    recent_cross_section = 0.0
    if latest_date and covered:
        cutoff = date.fromisoformat(latest_date) - timedelta(days=2)
        last_by_asset: dict[str, str] = {}
        for row in rows:
            asset_id = str(row["asset_id"])
            last_by_asset[asset_id] = max(last_by_asset.get(asset_id, ""), str(row["observed_at"]))
        recent_cross_section = sum(
            date.fromisoformat(observed_at) >= cutoff for observed_at in last_by_asset.values()
        ) / len(covered)
    provenance_rate = sum(bool(result["provenanceComplete"]) for result in covered) / len(covered) if covered else 0
    player_positions = Counter(str(row.get("position") or "") for row in snapshot_rows)
    scale_gap_by_position = {
        position: _safe_median(
            result["currentScaleGap"]
            for result in covered
            if result.get("position") == position and result.get("currentScaleGap") is not None
        )
        for position in POSITIONS
    }
    metrics = {
        "catalogAssetsLoaded": int(catalog.get("rawAssetCount") or 0),
        "catalogPlayers": len(catalog.get("data", [])),
        "catalogPicks": player_positions.get("PICK", 0),
        "playerSleeperIdRate": sleeper_rate,
        "sampleAssets": len(results),
        "coveredAssets": len(covered),
        "missingAssets": sum(result["status"] == "missing" for result in results),
        "failedAssets": sum(result["status"] == "failed" for result in results),
        "coverageRate": coverage_rate,
        "observations": len(rows),
        "medianObservations": _safe_median(result["observationCount"] for result in covered),
        "medianSpanDays": _safe_median(result["spanDays"] for result in covered),
        "medianGapDays": _safe_median(result["medianGapDays"] for result in covered),
        "medianCurrentScaleGap": _safe_median(result["currentScaleGap"] for result in covered),
        "medianCurrentScaleGapByPosition": scale_gap_by_position,
        "recentCrossSection": recent_cross_section,
        "provenanceRate": provenance_rate,
        "labelCounts": {
            horizon: sum(int(result["labels"][horizon]) for result in covered)
            for horizon in ("7d", "30d", "90d")
        },
    }
    gates = [
        _gate("catalog", "Current market cross-section", metrics["catalogAssetsLoaded"] >= 400, metrics["catalogAssetsLoaded"], ">= 400 assets"),
        _gate("identity", "Sleeper player identity coverage", sleeper_rate >= 0.99, sleeper_rate, ">= 99%"),
        _gate("coverage", "Sample historical coverage", coverage_rate >= 0.85, coverage_rate, ">= 85%"),
        _gate("historyDepth", "Median historical depth", metrics["medianSpanDays"] >= 365, metrics["medianSpanDays"], ">= 365 days"),
        _gate("cadence", "Median observation gap", 0 < metrics["medianGapDays"] <= 2, metrics["medianGapDays"], "1-2 days"),
        _gate("crossSection", "Current historical cross-section", recent_cross_section >= 0.80, recent_cross_section, ">= 80% within two days"),
        _gate("labels30", "Independent 30-day labels", metrics["labelCounts"]["30d"] >= 500, metrics["labelCounts"]["30d"], ">= 500"),
        _gate("labels90", "Independent 90-day labels", metrics["labelCounts"]["90d"] >= 250, metrics["labelCounts"]["90d"], ">= 250"),
        _gate("provenance", "Endpoint and retrieval provenance", provenance_rate == 1, provenance_rate, "100%"),
        _gate("personalUse", "Private noncommercial use boundary", True, "private; no raw mirror", "private noncommercial use with attribution"),
        _gate("survivorBias", "Delisted-player universe", False, "current catalog only", "historical universe includes delisted players"),
        _gate(
            "historicalFormat",
            "Historical league-format fidelity",
            False,
            "dynasty + superflex only",
            "TEP/PPR/team-count history or validated source-relative normalization",
        ),
    ]
    pilot_gate_ids = {"catalog", "identity", "coverage", "historyDepth", "cadence", "crossSection", "provenance", "personalUse"}
    return {
        "provider": "fantasycalc",
        "role": "primary historical market-label candidate",
        "methodology": "values inferred from completed real-world fantasy trades",
        "requestedCurrentFormat": FANTASYCALC_CURRENT_FORMAT,
        "leagueFormatMapping": "0.75 TEP maps to FantasyCalc TEP+ (published 0.5-1.0 bucket)",
        "historicalFormat": "dynasty + superflex; endpoint does not accept PPR, TEP, or team-count",
        "termsBoundary": "private noncommercial research; once-daily cache; attribution retained; no public raw-data mirror",
        "metrics": metrics,
        "gates": gates,
        "pilotReady": all(gate["passed"] for gate in gates if gate["id"] in pilot_gate_ids),
        "trainingReady": all(gate["passed"] for gate in gates),
        "sample": results,
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("")
        return
    with path.open("w", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def collect_nflverse_files(seasons: tuple[int, ...], refresh: bool, offline: bool) -> None:
    for season in seasons:
        download(
            NFLVERSE_ROSTER_URL.format(season=season),
            NFLVERSE / f"roster_weekly_{season}.csv",
            refresh,
            offline,
        )
        download(
            NFLVERSE_INJURY_URL.format(season=season),
            NFLVERSE / f"injuries_{season}.csv",
            refresh,
            offline,
        )


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", errors="replace") as source:
        return list(csv.DictReader(source))


def structured_event_report(
    seasons: tuple[int, ...], market_assets: list[dict[str, Any]]
) -> dict[str, Any]:
    roster_rows = [
        row
        for season in seasons
        for row in _read_csv(NFLVERSE / f"roster_weekly_{season}.csv")
        if row.get("position") in POSITIONS and row.get("sleeper_id")
    ]
    roster_by_sleeper: dict[str, list[dict[str, str]]] = defaultdict(list)
    gsis_by_sleeper: dict[str, set[str]] = defaultdict(set)
    for row in roster_rows:
        sleeper_id = str(row["sleeper_id"])
        roster_by_sleeper[sleeper_id].append(row)
        if row.get("gsis_id"):
            gsis_by_sleeper[sleeper_id].add(str(row["gsis_id"]))
    transition_counts: Counter[str] = Counter()
    players_with_events: set[str] = set()
    for sleeper_id, rows in roster_by_sleeper.items():
        unique: dict[tuple[int, int], dict[str, str]] = {}
        for row in rows:
            key = (int(row.get("season") or 0), int(row.get("week") or 0))
            unique[key] = row
        ordered = [unique[key] for key in sorted(unique)]
        for previous, current in zip(ordered, ordered[1:]):
            if previous.get("team") and current.get("team") and previous["team"] != current["team"]:
                transition_counts["team_change"] += 1
                players_with_events.add(sleeper_id)
            previous_status = str(previous.get("status") or "UNK")
            current_status = str(current.get("status") or "UNK")
            if previous_status != current_status:
                transition_counts["status_change"] += 1
                players_with_events.add(sleeper_id)
                if previous_status not in ACTIVE_STATUSES and current_status in ACTIVE_STATUSES:
                    transition_counts["availability_up"] += 1
                if previous_status in ACTIVE_STATUSES and current_status not in ACTIVE_STATUSES:
                    transition_counts["availability_down"] += 1
                if current_status in TERMINAL_STATUSES:
                    transition_counts["roster_exit"] += 1

    injury_rows = [
        row
        for season in seasons
        for row in _read_csv(NFLVERSE / f"injuries_{season}.csv")
    ]
    injury_ids = {
        str(row.get("gsis_id") or row.get("player_id") or "")
        for row in injury_rows
        if row.get("gsis_id") or row.get("player_id")
    }
    max_season = max(seasons)
    eligible = [
        asset for asset in market_assets
        if asset.get("sleeperId")
        and asset.get("firstObservedAt")
        and str(asset["firstObservedAt"]) <= f"{max_season}-12-31"
    ]
    roster_joined = [asset for asset in eligible if str(asset["sleeperId"]) in roster_by_sleeper]
    injury_eligible = [
        asset for asset in eligible
        if any(gsis in injury_ids for gsis in gsis_by_sleeper.get(str(asset["sleeperId"]), set()))
    ]
    roster_join_rate = len(roster_joined) / len(eligible) if eligible else 0
    injury_join_rate = len(injury_eligible) / len(eligible) if eligible else 0
    metrics = {
        "seasons": list(seasons),
        "rosterRows": len(roster_rows),
        "rosterPlayers": len(roster_by_sleeper),
        "injuryRows": len(injury_rows),
        "injuryPlayers": len(injury_ids),
        "samplePlayersEligibleForJoin": len(eligible),
        "sampleRosterJoinRate": roster_join_rate,
        "sampleInjuryJoinRate": injury_join_rate,
        "playersWithRosterEvents": len(players_with_events),
        "eventCounts": dict(sorted(transition_counts.items())),
        "timestampResolution": "season-week for roster transitions; report fields for injuries",
    }
    gates = [
        _gate("rosterIdentity", "Sleeper-to-roster identity join", roster_join_rate >= 0.95, roster_join_rate, ">= 95%"),
        _gate("injuryIdentity", "Sleeper-to-injury identity join", injury_join_rate >= 0.80, injury_join_rate, ">= 80%"),
        _gate("eventVolume", "Structured roster-event volume", sum(transition_counts.values()) >= 2_000, sum(transition_counts.values()), ">= 2,000"),
        _gate("pointInTime", "Exact event publication time", False, "weekly/report granularity", "source publication timestamp"),
    ]
    return {
        "provider": "nflverse",
        "role": "structured factual event backbone",
        "metrics": metrics,
        "gates": gates,
        "pilotReady": all(gate["passed"] for gate in gates if gate["id"] != "pointInTime"),
        "trainingReady": all(gate["passed"] for gate in gates),
    }


def gdelt_query_url(player_name: str, start: date, end: date, records: int) -> str:
    query = f'"{player_name}" (NFL OR football)'
    params = urllib.parse.urlencode({
        "query": query,
        "mode": "artlist",
        "maxrecords": records,
        "format": "json",
        "sort": "datedesc",
        "startdatetime": start.strftime("%Y%m%d000000"),
        "enddatetime": end.strftime("%Y%m%d235959"),
    })
    return f"{GDELT_DOC_URL}?{params}"


def collect_gdelt_pilot(
    market_assets: list[dict[str, Any]], player_count: int, refresh: bool, offline: bool
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    selected = sorted(
        (asset for asset in market_assets if asset["status"] == "complete"),
        key=lambda asset: (POSITIONS.index(str(asset["position"])), -float(asset["currentValue"]), str(asset["slug"])),
    )
    # One high-value and one lower-value player per position before filling.
    audited: list[dict[str, Any]] = []
    for position in POSITIONS:
        rows = [asset for asset in selected if asset["position"] == position]
        if rows:
            audited.append(rows[0])
        if len(rows) > 1:
            audited.append(rows[-1])
    for asset in selected:
        if asset not in audited:
            audited.append(asset)
    audited = audited[:player_count]
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=730)
    review_rows: list[dict[str, Any]] = []
    failed = 0
    for index, asset in enumerate(audited, start=1):
        slug = str(asset["slug"])
        path = GDELT / f"{slug}.json"
        try:
            if refresh or not path.exists():
                if offline:
                    raise FileNotFoundError(f"Missing cached GDELT result: {path}")
                payload = fetch_json(
                    gdelt_query_url(str(asset["name"]), start, end, 50),
                    attempts=1,
                    timeout=20,
                )
                path.write_text(json.dumps(payload, separators=(",", ":")))
                if index < len(audited):
                    time.sleep(6)
            else:
                payload = json.loads(path.read_text())
        except (OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError):
            payload = {"articles": []}
            failed += 1
        normalized_name = " ".join(str(asset["name"]).lower().split())
        for article in payload.get("articles", []):
            title = " ".join(str(article.get("title") or "").split())
            review_rows.append({
                "player_slug": slug,
                "player_name": asset["name"],
                "title": title,
                "seen_at": article.get("seendate"),
                "domain": article.get("domain"),
                "url": article.get("url"),
                "exact_name_in_title": normalized_name in title.lower(),
                "manual_relevant": "",
                "manual_event_type": "",
            })
    exact_title_rate = (
        sum(bool(row["exact_name_in_title"]) for row in review_rows) / len(review_rows)
        if review_rows else 0
    )
    report = {
        "provider": "gdelt",
        "role": "historical article discovery pilot only",
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "playersAudited": len(audited),
        "queriesFailed": failed,
        "articlesReturned": len(review_rows),
        "exactNameInTitleRate": exact_title_rate,
        "manualReviewPath": "data/processed/source_audit/gdelt-review.csv",
        "gates": [
            _gate("retrieval", "Historical article retrieval", len(review_rows) >= 50, len(review_rows), ">= 50 metadata records"),
            _gate("entityPrecision", "Manually reviewed player precision", False, "not reviewed", ">= 95%"),
            _gate("publicationTime", "Publication timestamp fidelity", False, "GDELT seen date", "original publication time validated"),
            _gate("contentRights", "Training-content rights", False, "article URLs and titles only", "licensed text or structured facts"),
        ],
        "pilotReady": len(review_rows) >= 50 and failed == 0,
        "trainingReady": False,
    }
    return report, review_rows


def build_report(
    market_comparison: dict[str, Any],
    market: dict[str, Any],
    structured: dict[str, Any],
    news: dict[str, Any],
    generated_at: str,
) -> dict[str, Any]:
    pilot_ready = bool(market["pilotReady"] and structured["pilotReady"] and news["pilotReady"])
    training_ready = bool(market["trainingReady"] and structured["trainingReady"] and news["trainingReady"])
    blockers = [
        {"source": source["provider"], "gate": gate["id"], "reason": gate["requirement"], "actual": gate["actual"]}
        for source in (market, structured, news)
        for gate in source["gates"]
        if not gate["passed"]
    ]
    comparison_warnings = [
        {"source": market_comparison["provider"], "gate": gate["id"], "reason": gate["requirement"], "actual": gate["actual"]}
        for gate in market_comparison["gates"]
        if not gate["passed"]
    ]
    return {
        "schemaVersion": 2,
        "generatedAt": generated_at,
        "decision": {
            "pilotReady": pilot_ready,
            "trainingReady": training_ready,
            "liveRecommendationsEnabled": False,
            "selectedMarketTape": "fantasycalc",
            "blockers": blockers,
            "candidateWarnings": comparison_warnings,
            "nextExperiment": (
                "Validate FantasyCalc source-relative returns against TEP+ daily snapshots and overlapping Tradyr players, "
                "reconstruct a delisted-player universe, and manually label the GDELT review sample."
            ),
        },
        "scope": {
            "outcome": "point-in-time 7/30/90-day source-relative dynasty market returns after factual player events",
            "excluded": [
                "live trade recommendations",
                "manager acceptance prediction",
                "article full-text scraping",
                "absolute conversion of format-limited historical values to exact 0.75 TEP prices",
                "public redistribution of FantasyCalc raw data",
            ],
        },
        "sources": [
            {
                "provider": "tradyr",
                "endpoint": "/v1/players/:slug/history",
                "documentation": TRADYR_DOCS,
                "provenancePolicy": "retain provider version, sources, attribution, raw response, and retrieval time",
            },
            {
                "provider": "fantasycalc",
                "endpoints": ["/values/current", "/trades/historical/:playerId"],
                "methodology": FANTASYCALC_FAQ,
                "rankingsAndExport": FANTASYCALC_RANKINGS,
                "terms": FANTASYCALC_TERMS,
                "provenancePolicy": "private noncommercial audit; once-daily cache; retain endpoint, format, retrieval time, and attribution; never publish raw mirror",
            },
            {
                "provider": "nflverse",
                "datasets": ["weekly_rosters", "injuries"],
                "documentation": NFLVERSE_REPO,
                "provenancePolicy": "retain season-specific release URL and identifiers",
            },
            {
                "provider": "gdelt",
                "endpoint": "/api/v2/doc/doc",
                "documentation": GDELT_DOCS,
                "provenancePolicy": "metadata discovery only; no article body is copied",
            },
        ],
        "marketTape": market,
        "marketComparison": market_comparison,
        "structuredEvents": structured,
        "newsArchive": news,
    }


def render_markdown(report: dict[str, Any]) -> str:
    decision = report["decision"]
    market = report["marketTape"]
    comparison = report["marketComparison"]
    structured = report["structuredEvents"]
    news = report["newsArchive"]
    status = "TRAINING READY" if decision["trainingReady"] else "BLOCKED FROM TRAINING"
    lines = [
        "# Historical source audit",
        "",
        f"Generated: `{report['generatedAt']}`",
        "",
        f"## Decision: {status}",
        "",
        "This audit is isolated from live rankings and recommendations.",
        "",
        "## Evidence summary",
        "",
        "| Source | Role | Pilot ready | Training ready | Key evidence |",
        "|---|---|---:|---:|---|",
        (
            f"| FantasyCalc | Primary market labels | {market['pilotReady']} | {market['trainingReady']} | "
            f"{market['metrics']['coveredAssets']}/{market['metrics']['sampleAssets']} players; "
            f"{market['metrics']['observations']} observations; "
            f"{market['metrics']['labelCounts']['30d']} 30-day labels |"
        ),
        (
            f"| Tradyr | Market comparator | {comparison['pilotReady']} | {comparison['trainingReady']} | "
            f"{comparison['metrics']['coveredAssets']}/{comparison['metrics']['sampleAssets']} players; "
            f"{comparison['metrics']['observations']} observations |"
        ),
        (
            f"| nflverse | Structured events | {structured['pilotReady']} | {structured['trainingReady']} | "
            f"{structured['metrics']['rosterRows']} roster rows; "
            f"{sum(structured['metrics']['eventCounts'].values())} detected transitions |"
        ),
        (
            f"| GDELT | Article discovery pilot | {news['pilotReady']} | {news['trainingReady']} | "
            f"{news['articlesReturned']} metadata records; manual precision unresolved |"
        ),
        "",
        "## Blocking gates",
        "",
    ]
    for blocker in decision["blockers"]:
        lines.append(
            f"- **{blocker['source']} / {blocker['gate']}**: requires {blocker['reason']}; "
            f"observed `{blocker['actual']}`."
        )
    lines.extend([
        "",
        "## Next bounded experiment",
        "",
        decision["nextExperiment"],
        "",
    ])
    return "\n".join(lines)


def parse_seasons(value: str) -> tuple[int, ...]:
    seasons = tuple(sorted({int(item.strip()) for item in value.split(",") if item.strip()}))
    if not seasons:
        raise argparse.ArgumentTypeError("At least one season is required")
    return seasons


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", type=int, default=50, help="Stratified player sample per market source")
    parser.add_argument("--gdelt-players", type=int, default=8, help="Players in metadata-only news pilot")
    parser.add_argument("--seasons", type=parse_seasons, default=(2022, 2023, 2024, 2025))
    parser.add_argument("--refresh", action="store_true", help="Refresh cached provider responses")
    parser.add_argument("--offline", action="store_true", help="Use caches only; fail if a source is missing")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_dirs()
    sample_size = max(20, min(200, int(args.sample)))
    gdelt_players = max(4, min(20, int(args.gdelt_players)))
    print(f"Auditing Tradyr market history for {sample_size} stratified players")
    catalog, market_assets, market_rows = collect_tradyr_history(sample_size, args.refresh, args.offline)
    write_csv(PROCESSED / "tradyr-market-history.csv", market_rows)
    market_comparison = market_report(catalog, market_assets, market_rows)

    print(f"Auditing FantasyCalc market history for {sample_size} stratified players")
    fc_catalog, fc_assets, fc_rows, fc_snapshot_rows = collect_fantasycalc_history(
        sample_size, args.refresh, args.offline
    )
    write_csv(PROCESSED / "fantasycalc-market-history.csv", fc_rows)
    write_csv(PROCESSED / "fantasycalc-current-snapshot.csv", fc_snapshot_rows)
    market = fantasycalc_report(fc_catalog, fc_assets, fc_rows, fc_snapshot_rows)

    print(f"Auditing nflverse structured events for seasons {args.seasons}")
    collect_nflverse_files(args.seasons, args.refresh, args.offline)
    structured = structured_event_report(args.seasons, fc_assets)

    print(f"Auditing GDELT metadata retrieval for {gdelt_players} players")
    news, review_rows = collect_gdelt_pilot(fc_assets, gdelt_players, args.refresh, args.offline)
    write_csv(PROCESSED / "gdelt-review.csv", review_rows)

    report = build_report(market_comparison, market, structured, news, utc_now())
    report_path = REPORTS / "historical-source-audit.json"
    markdown_path = REPORTS / "historical-source-audit.md"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    markdown_path.write_text(render_markdown(report))
    print(f"Report: {report_path}")
    print(f"Decision: {'training ready' if report['decision']['trainingReady'] else 'blocked from training'}")


if __name__ == "__main__":
    main()

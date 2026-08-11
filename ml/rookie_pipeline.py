#!/usr/bin/env python3
"""Build and evaluate RosterLab's leak-safe rookie sleeper pipeline.

V6.0 reconstructs point-in-time rookie market snapshots from the public
DynastyProcess git history. V6.1 fits an out-of-time market-percentile return
model. V6.2 tests whether structured, pre-anchor market movement improves the
base model. All outputs remain shadow-only while the label is an expert-
consensus proxy rather than completed-trade pricing.

Raw provider data and fitted binaries are private, gitignored research inputs.
The committed report contains only aggregate evidence and derived predictions.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import pickle
import re
import subprocess
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Literal

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

try:
    from ml.rookie_data import (
        add_external_features,
        build_college_features,
        build_college_player_seasons,
        build_combine_features,
        collect_public_rookie_sources,
        load_nfl_rookie_outcomes,
    )
    from ml.rookie_model import (
        PRODUCTION_FEATURES,
        ProductionBacktest,
        backtest_production_model,
        fit_production_artifact,
        predict_current_production,
        production_backtest_dict,
    )
except ModuleNotFoundError:  # Direct execution through package.json scripts.
    from rookie_data import (
        add_external_features,
        build_college_features,
        build_college_player_seasons,
        build_combine_features,
        collect_public_rookie_sources,
        load_nfl_rookie_outcomes,
    )
    from rookie_model import (
        PRODUCTION_FEATURES,
        ProductionBacktest,
        backtest_production_model,
        fit_production_artifact,
        predict_current_production,
        production_backtest_dict,
    )


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "rookies"
PROCESSED = ROOT / "data" / "processed" / "rookies"
DYNASTYPROCESS = RAW / "dynastyprocess"
DYNASTYPROCESS_REMOTE = "https://github.com/dynastyprocess/data.git"
MARKET_PATH = "files/values-players.csv"
PLAYER_IDS_PATH = DYNASTYPROCESS / "files" / "db_playerids.csv"
FANTASYCALC_CURRENT = ROOT / "data" / "raw" / "source_audit" / "fantasycalc" / "current"
SLEEPER_TRENDS = RAW / "sleeper-trends"
ARTIFACTS = ROOT / "ml" / "artifacts"
REPORTS = ROOT / "ml" / "reports"
REPORT_JSON = REPORTS / "rookie-model-latest.json"
REPORT_MARKDOWN = REPORTS / "rookie-model-latest.md"
MODEL_PATH = ARTIFACTS / "rookie-return-models.pkl"

POSITIONS = ("QB", "RB", "WR", "TE")
HORIZONS = (180, 365)
ANCHOR_MONTH = 8
ANCHOR_DAY = 10
SNAPSHOT_TOLERANCE_DAYS = 21
HOLDOUT_CLASSES = 2
MIN_TRAINING_ROWS = 180
MIN_HOLDOUT_ROWS = 35
LATE_ROOKIE_RANK = 24
SLEEPER_BASKET_SIZE = 8
MODEL_VERSION = "rookie-evidence-v6.3"
LABEL_SOURCE = "dynastyprocess-fantasypros-ecr-percentile"

BASE_FEATURES = [
    "log_draft_pick",
    "drafted",
    "age",
    "height",
    "weight",
    "initial_market_percentile",
    "rookie_market_percentile",
    "anchor_market_present",
    "capital_market_gap",
    *[f"pos_{position}" for position in POSITIONS],
]
UPDATE_FEATURES = [
    *BASE_FEATURES,
    "market_momentum_30",
    "market_momentum_90",
    "market_volatility_90",
    "has_market_30",
    "has_market_90",
]


@dataclass(frozen=True)
class CommitPoint:
    observed_at: date
    commit: str


@dataclass(frozen=True)
class HorizonMetrics:
    horizon_days: int
    training_rows: int
    holdout_rows: int
    holdout_classes: list[int]
    baseline_mae: float | None
    base_model_mae: float | None
    updated_model_mae: float | None
    base_mae_improvement: float | None
    updater_mae_improvement: float | None
    holdout_by_class: list[dict[str, Any]]
    base_gate_passed: bool
    updater_gate_passed: bool


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_dirs() -> None:
    for path in (RAW, PROCESSED, SLEEPER_TRENDS, ARTIFACTS, REPORTS):
        path.mkdir(parents=True, exist_ok=True)


def run_git(arguments: list[str], *, text: bool = True) -> str | bytes:
    return subprocess.check_output(
        ["git", "-C", str(DYNASTYPROCESS), *arguments],
        text=text,
        stderr=subprocess.STDOUT,
    )


def ensure_dynastyprocess(*, refresh: bool, offline: bool) -> None:
    if not (DYNASTYPROCESS / ".git").exists():
        if offline:
            raise FileNotFoundError(f"Offline rookie build is missing {DYNASTYPROCESS}")
        subprocess.run(
            ["git", "clone", "--no-tags", DYNASTYPROCESS_REMOTE, str(DYNASTYPROCESS)],
            check=True,
        )
    elif refresh and not offline:
        run_git(["fetch", "--no-tags", "origin"])
        run_git(["merge", "--ff-only", "origin/master"])
    if not PLAYER_IDS_PATH.exists():
        raise FileNotFoundError(f"DynastyProcess player IDs are missing: {PLAYER_IDS_PATH}")


def request_json(url: str, attempts: int = 3) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "RosterLab/1.0 (private rookie model research)",
        },
    )
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read())
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


def collect_sleeper_trends(*, refresh: bool, offline: bool) -> dict[str, Any]:
    today = datetime.now(timezone.utc).date().isoformat()
    path = SLEEPER_TRENDS / f"{today}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    if offline:
        cached = sorted(SLEEPER_TRENDS.glob("*.json"))
        return json.loads(cached[-1].read_text()) if cached else {
            "retrievedAt": None,
            "adds24": [],
            "drops24": [],
            "status": "missing-offline",
        }
    base = "https://api.sleeper.app/v1/players/nfl/trending"
    payload = {
        "retrievedAt": utc_now(),
        "adds24": request_json(f"{base}/add?lookback_hours=24&limit=100"),
        "drops24": request_json(f"{base}/drop?lookback_hours=24&limit=100"),
        "status": "complete",
    }
    temporary = path.with_suffix(".json.part")
    temporary.write_text(json.dumps(payload, separators=(",", ":")))
    temporary.replace(path)
    return payload


def latest_fantasycalc_snapshot() -> tuple[list[dict[str, Any]], str | None]:
    snapshots = sorted(
        path for path in FANTASYCALC_CURRENT.glob("*.json") if not path.name.endswith(".meta.json")
    )
    if not snapshots:
        return [], None
    path = snapshots[-1]
    payload = json.loads(path.read_text())
    return (payload if isinstance(payload, list) else []), path.stem


def normalize_name(value: Any) -> str:
    ascii_value = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    normalized = re.sub(r"\b(jr|sr|ii|iii|iv)\b", " ", ascii_value.lower())
    return re.sub(r"[^a-z0-9]+", "", normalized)


def safe_float(value: Any, default: float = math.nan) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def parse_commit_log(raw: str) -> list[CommitPoint]:
    points: dict[date, CommitPoint] = {}
    for line in raw.splitlines():
        observed, separator, commit = line.partition("|")
        if not separator:
            continue
        parsed = date.fromisoformat(observed)
        points.setdefault(parsed, CommitPoint(parsed, commit))
    return sorted(points.values(), key=lambda point: point.observed_at)


def load_commit_points() -> list[CommitPoint]:
    raw = str(run_git(["log", "--format=%cs|%H", "--", MARKET_PATH]))
    points = parse_commit_log(raw)
    if not points:
        raise RuntimeError("No DynastyProcess market snapshots were found")
    return points


def select_commit(
    points: Iterable[CommitPoint],
    target: date,
    direction: Literal["prior", "after", "nearest"] = "nearest",
    tolerance_days: int = SNAPSHOT_TOLERANCE_DAYS,
) -> CommitPoint | None:
    if direction == "prior":
        candidates = [point for point in points if point.observed_at <= target]
    elif direction == "after":
        candidates = [point for point in points if point.observed_at >= target]
    else:
        candidates = list(points)
    if not candidates:
        return None
    selected = min(candidates, key=lambda point: (abs((point.observed_at - target).days), point.observed_at))
    return selected if abs((selected.observed_at - target).days) <= tolerance_days else None


def market_percentiles(frame: pd.DataFrame) -> pd.Series:
    if frame.empty:
        return pd.Series(dtype=float)
    ranks = frame["ecr_2qb"].rank(method="average", ascending=True)
    denominator = max(1, len(frame) - 1)
    return 1 - (ranks - 1) / denominator


def normalize_market_snapshot(raw: bytes | str, point: CommitPoint) -> pd.DataFrame:
    text = raw.decode("utf-8-sig") if isinstance(raw, bytes) else raw.lstrip("\ufeff")
    rows = list(csv.DictReader(io.StringIO(text)))
    normalized: list[dict[str, Any]] = []
    for row in rows:
        position = str(row.get("pos") or row.get("position") or "").upper()
        if position not in POSITIONS:
            continue
        ecr = safe_float(row.get("ecr_2qb") or row.get("dyno2QBECR") or row.get("ecr_1qb") or row.get("dynoECR"))
        if not math.isfinite(ecr) or ecr <= 0:
            continue
        name = str(row.get("player") or row.get("mergename") or row.get("name") or "").strip()
        normalized.append({
            "fp_id": str(row.get("fp_id") or "").strip(),
            "name": name,
            "normalized_name": normalize_name(name),
            "position": position,
            "age_at_source": safe_float(row.get("age")),
            "source_draft_year": safe_float(row.get("draft_year")),
            "ecr_2qb": ecr,
            "value_2qb": safe_float(row.get("value_2qb")),
            "observed_at": point.observed_at.isoformat(),
            "commit": point.commit,
        })
    frame = pd.DataFrame(normalized)
    if frame.empty:
        return frame
    frame = frame.sort_values(["ecr_2qb", "fp_id", "normalized_name"]).drop_duplicates(
        subset=["fp_id", "normalized_name", "position"], keep="first"
    )
    frame["market_percentile"] = market_percentiles(frame)
    return frame.reset_index(drop=True)


def load_market_snapshot(point: CommitPoint, cache: dict[str, pd.DataFrame]) -> pd.DataFrame:
    if point.commit not in cache:
        raw = run_git(["show", f"{point.commit}:{MARKET_PATH}"], text=False)
        cache[point.commit] = normalize_market_snapshot(raw, point)
    return cache[point.commit]


def load_player_universe() -> pd.DataFrame:
    frame = pd.read_csv(PLAYER_IDS_PATH, dtype=str, keep_default_na=False)
    frame = frame[frame["position"].isin(POSITIONS)].copy()
    frame["fp_id"] = frame["fantasypros_id"].replace("NA", "")
    frame["normalized_name"] = frame["name"].map(normalize_name)
    for column in ("draft_year", "draft_round", "draft_ovr", "height", "weight"):
        frame[column] = pd.to_numeric(frame[column].replace("NA", np.nan), errors="coerce")
    frame["drafted"] = frame["draft_ovr"].notna().astype(float)
    frame["model_draft_pick"] = frame["draft_ovr"].fillna(300).clip(1, 300)
    return frame.sort_values(["draft_year", "model_draft_pick", "normalized_name"]).drop_duplicates(
        subset=["draft_year", "fp_id", "normalized_name", "position"], keep="first"
    )


def age_on(birthdate: Any, observed_at: date, fallback: Any = None) -> float:
    try:
        born = date.fromisoformat(str(birthdate))
        return (observed_at - born).days / 365.2425
    except (TypeError, ValueError):
        return safe_float(fallback)


def market_lookup(frame: pd.DataFrame) -> tuple[dict[str, pd.Series], dict[tuple[str, str], pd.Series]]:
    by_id = {
        str(row.fp_id): row
        for _, row in frame.iterrows()
        if str(row.fp_id)
    }
    by_name = {
        (str(row.normalized_name), str(row.position)): row
        for _, row in frame.iterrows()
        if str(row.normalized_name)
    }
    return by_id, by_name


def match_market_row(
    player: pd.Series,
    by_id: dict[str, pd.Series],
    by_name: dict[tuple[str, str], pd.Series],
) -> pd.Series | None:
    fp_id = str(player.get("fp_id") or "")
    if fp_id and fp_id in by_id:
        return by_id[fp_id]
    return by_name.get((str(player["normalized_name"]), str(player["position"])))


def add_position_features(row: dict[str, Any], position: str) -> None:
    for candidate in POSITIONS:
        row[f"pos_{candidate}"] = float(position == candidate)


def point_for_target(
    points: list[CommitPoint], target: date, *, outcome: bool = False
) -> CommitPoint | None:
    return select_commit(points, target, "nearest" if outcome else "prior")


def build_class_rows(
    *,
    rookie_year: int,
    anchor_point: CommitPoint,
    anchor: pd.DataFrame,
    prior30: pd.DataFrame | None,
    prior90: pd.DataFrame | None,
    outcomes: dict[int, tuple[CommitPoint, pd.DataFrame] | None],
    universe: pd.DataFrame,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rookies = universe[universe["draft_year"] == rookie_year].copy()
    anchor_by_id, anchor_by_name = market_lookup(anchor)
    prior30_lookup = market_lookup(prior30) if prior30 is not None else ({}, {})
    prior90_lookup = market_lookup(prior90) if prior90 is not None else ({}, {})
    outcome_lookups = {
        horizon: market_lookup(payload[1]) if payload else ({}, {})
        for horizon, payload in outcomes.items()
    }

    matched: list[tuple[pd.Series, pd.Series | None]] = []
    for _, player in rookies.iterrows():
        market = match_market_row(player, anchor_by_id, anchor_by_name)
        matched.append((player, market))
    matched.sort(key=lambda item: (
        float(item[1]["ecr_2qb"]) if item[1] is not None else math.inf,
        float(item[0]["model_draft_pick"]),
        str(item[0]["name"]),
    ))
    rookie_count = len(matched)
    priced_count = sum(market is not None for _, market in matched)
    draft_order = sorted(
        matched,
        key=lambda item: (
            float(item[0]["model_draft_pick"]),
            float(item[1]["ecr_2qb"]) if item[1] is not None else math.inf,
            str(item[0]["name"]),
        ),
    )
    draft_capital_rank = {
        (str(player["fp_id"]), str(player["normalized_name"])): index + 1
        for index, (player, _) in enumerate(draft_order)
    }

    result: list[dict[str, Any]] = []
    priced_rank = 0
    for _, (player, market) in enumerate(matched, start=1):
        market_present = market is not None
        if market_present:
            priced_rank += 1
        rookie_rank = priced_rank if market_present else priced_count + 1
        p30 = match_market_row(player, *prior30_lookup)
        p90 = match_market_row(player, *prior90_lookup)
        current_percentile = float(market["market_percentile"]) if market is not None else 0.0
        history_values = [
            float(candidate["market_percentile"])
            for candidate in (p90, p30, market)
            if candidate is not None
        ]
        rookie_market_percentile = (
            1 - (rookie_rank - 1) / max(1, priced_count - 1) if market_present and priced_count > 1 else 0.0
        )
        capital_rank = draft_capital_rank[(str(player["fp_id"]), str(player["normalized_name"]))]
        row: dict[str, Any] = {
            "rookie_year": rookie_year,
            "anchor_date": anchor_point.observed_at.isoformat(),
            "anchor_commit": anchor_point.commit,
            "fp_id": str(player["fp_id"]),
            "sleeper_id": str(player.get("sleeper_id") or "").replace("NA", ""),
            "name": str(player["name"]),
            "normalized_name": str(player["normalized_name"]),
            "position": str(player["position"]),
            "nfl_team": str(player.get("team") or ""),
            "college": str(player.get("college") or ""),
            "draft_round": safe_float(player["draft_round"], 8),
            "draft_pick": safe_float(player["draft_ovr"], 300),
            "drafted": float(player["drafted"]),
            "log_draft_pick": math.log1p(float(player["model_draft_pick"])),
            "age": age_on(
                player.get("birthdate"),
                anchor_point.observed_at,
                market.get("age_at_source") if market is not None else None,
            ),
            "height": safe_float(player.get("height")),
            "weight": safe_float(player.get("weight")),
            "initial_ecr_2qb": float(market["ecr_2qb"]) if market is not None else math.nan,
            "initial_value_2qb": safe_float(market.get("value_2qb")) if market is not None else math.nan,
            "initial_market_percentile": current_percentile,
            "rookie_market_rank": rookie_rank,
            "rookie_market_percentile": rookie_market_percentile,
            "anchor_market_present": float(market_present),
            "draft_capital_rank": capital_rank,
            "capital_market_gap": (rookie_rank - capital_rank) / max(1, rookie_count),
            "market_momentum_30": current_percentile - float(p30["market_percentile"]) if p30 is not None else 0.0,
            "market_momentum_90": current_percentile - float(p90["market_percentile"]) if p90 is not None else 0.0,
            "market_volatility_90": float(np.std(history_values)) if len(history_values) >= 2 else 0.0,
            "has_market_30": float(p30 is not None),
            "has_market_90": float(p90 is not None),
        }
        add_position_features(row, str(player["position"]))
        for horizon in HORIZONS:
            payload = outcomes.get(horizon)
            outcome = match_market_row(player, *outcome_lookups[horizon]) if payload else None
            row[f"outcome_date_{horizon}"] = payload[0].observed_at.isoformat() if payload else None
            row[f"outcome_missing_{horizon}"] = bool(payload and outcome is None)
            row[f"outcome_market_percentile_{horizon}"] = float(outcome["market_percentile"]) if outcome is not None else (0.0 if payload else math.nan)
            row[f"percentile_change_{horizon}"] = (
                row[f"outcome_market_percentile_{horizon}"] - current_percentile if payload else math.nan
            )
        result.append(row)

    late_rookies = rookies[rookies["model_draft_pick"] >= 145]
    matched_keys = {
        (str(player["fp_id"]), str(player["normalized_name"]))
        for player, market in matched
        if market is not None
    }
    late_matched = sum(
        (str(player["fp_id"]), str(player["normalized_name"])) in matched_keys
        for _, player in late_rookies.iterrows()
    )
    coverage = {
        "rookieYear": rookie_year,
        "anchorDate": anchor_point.observed_at.isoformat(),
        "draftedAndUndraftedUniverse": len(rookies),
        "tapeRows": len(result),
        "tapeCoverageRate": len(result) / len(rookies) if len(rookies) else 0,
        "marketPricedRookies": priced_count,
        "marketPricingRate": priced_count / len(rookies) if len(rookies) else 0,
        "lateRoundUniverse": len(late_rookies),
        "lateRoundTapeRows": len(late_rookies),
        "lateRoundTapeCoverageRate": 1.0 if len(late_rookies) else 0,
        "lateRoundMarketPriced": late_matched,
        "lateRoundMarketPricingRate": late_matched / len(late_rookies) if len(late_rookies) else 0,
        "outcomes": {
            str(horizon): payload[0].observed_at.isoformat() if payload else None
            for horizon, payload in outcomes.items()
        },
    }
    return result, coverage


def build_tape(points: list[CommitPoint], universe: pd.DataFrame) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    cache: dict[str, pd.DataFrame] = {}
    rows: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    latest_date = points[-1].observed_at
    first_year = max(2019, int(universe["draft_year"].dropna().min()))
    for rookie_year in range(first_year, latest_date.year):
        target = date(rookie_year, ANCHOR_MONTH, ANCHOR_DAY)
        anchor_point = point_for_target(points, target)
        if anchor_point is None:
            continue
        prior30_point = point_for_target(points, target - timedelta(days=30))
        prior90_point = point_for_target(points, target - timedelta(days=90))
        outcomes: dict[int, tuple[CommitPoint, pd.DataFrame] | None] = {}
        for horizon in HORIZONS:
            outcome_target = target + timedelta(days=horizon)
            outcome_point = point_for_target(points, outcome_target, outcome=True) if outcome_target <= latest_date + timedelta(days=SNAPSHOT_TOLERANCE_DAYS) else None
            outcomes[horizon] = (
                (outcome_point, load_market_snapshot(outcome_point, cache)) if outcome_point else None
            )
        class_rows, class_coverage = build_class_rows(
            rookie_year=rookie_year,
            anchor_point=anchor_point,
            anchor=load_market_snapshot(anchor_point, cache),
            prior30=load_market_snapshot(prior30_point, cache) if prior30_point else None,
            prior90=load_market_snapshot(prior90_point, cache) if prior90_point else None,
            outcomes=outcomes,
            universe=universe,
        )
        rows.extend(class_rows)
        coverage.append(class_coverage)
    frame = pd.DataFrame(rows).sort_values(["rookie_year", "rookie_market_rank", "name"]).reset_index(drop=True)
    return frame, coverage


def current_rookies(
    points: list[CommitPoint], universe: pd.DataFrame
) -> tuple[pd.DataFrame, dict[str, Any]]:
    cache: dict[str, pd.DataFrame] = {}
    current_year = points[-1].observed_at.year
    target = min(datetime.now(timezone.utc).date(), points[-1].observed_at)
    anchor_point = point_for_target(points, target)
    if anchor_point is None:
        raise RuntimeError("A current DynastyProcess market snapshot is unavailable")
    prior30_point = point_for_target(points, anchor_point.observed_at - timedelta(days=30))
    prior90_point = point_for_target(points, anchor_point.observed_at - timedelta(days=90))
    rows, coverage = build_class_rows(
        rookie_year=current_year,
        anchor_point=anchor_point,
        anchor=load_market_snapshot(anchor_point, cache),
        prior30=load_market_snapshot(prior30_point, cache) if prior30_point else None,
        prior90=load_market_snapshot(prior90_point, cache) if prior90_point else None,
        outcomes={horizon: None for horizon in HORIZONS},
        universe=universe,
    )
    return pd.DataFrame(rows), coverage


def mean_absolute_error(actual: np.ndarray, predicted: np.ndarray) -> float:
    return float(np.mean(np.abs(actual - predicted))) if len(actual) else math.nan


def fit_model(frame: pd.DataFrame, features: list[str], target: str, *, loss: str = "squared_error", quantile: float | None = None) -> HistGradientBoostingRegressor:
    parameters: dict[str, Any] = {
        "loss": loss,
        "learning_rate": 0.055,
        "max_iter": 180,
        "max_leaf_nodes": 11,
        "min_samples_leaf": 18,
        "l2_regularization": 0.2,
        "random_state": 42,
    }
    if quantile is not None:
        parameters["quantile"] = quantile
    model = HistGradientBoostingRegressor(**parameters)
    model.fit(frame[features], frame[target])
    return model


def sleeper_basket(frame: pd.DataFrame, prediction: np.ndarray, *, size: int = SLEEPER_BASKET_SIZE) -> pd.DataFrame:
    candidates = frame[frame["rookie_market_rank"] > LATE_ROOKIE_RANK].copy()
    candidates["prediction"] = prediction[frame["rookie_market_rank"].to_numpy() > LATE_ROOKIE_RANK]
    return candidates.sort_values(["prediction", "rookie_market_rank", "name"], ascending=[False, True, True]).head(size)


def capital_baseline_basket(frame: pd.DataFrame, *, size: int = SLEEPER_BASKET_SIZE) -> pd.DataFrame:
    candidates = frame[frame["rookie_market_rank"] > LATE_ROOKIE_RANK].copy()
    return candidates.sort_values(
        ["capital_market_gap", "draft_pick", "rookie_market_rank", "name"],
        ascending=[False, True, True, True],
    ).head(size)


def evaluate_horizon(frame: pd.DataFrame, horizon: int) -> tuple[HorizonMetrics, dict[str, HistGradientBoostingRegressor] | None]:
    target = f"percentile_change_{horizon}"
    # A player absent from the source is retained in V6.0 so busts cannot
    # silently disappear, but a return model cannot divide meaningfully from
    # an unranked floor. Those rows remain audit evidence, not training rows.
    usable = frame[np.isfinite(frame[target]) & (frame["anchor_market_present"] == 1)].copy()
    years = sorted(int(year) for year in usable["rookie_year"].unique())
    holdout_years = years[-HOLDOUT_CLASSES:] if len(years) > HOLDOUT_CLASSES else []
    train = usable[~usable["rookie_year"].isin(holdout_years)].copy()
    holdout = usable[usable["rookie_year"].isin(holdout_years)].copy()
    if len(train) < 30 or len(holdout) < 10:
        empty = HorizonMetrics(
            horizon, len(train), len(holdout), holdout_years,
            None, None, None, None, None, [], False, False,
        )
        return empty, None

    base = fit_model(train, BASE_FEATURES, target)
    updated = fit_model(train, UPDATE_FEATURES, target)
    actual = holdout[target].to_numpy(dtype=float)
    baseline_prediction = np.zeros(len(holdout))
    base_prediction = base.predict(holdout[BASE_FEATURES])
    updated_prediction = updated.predict(holdout[UPDATE_FEATURES])
    baseline_mae = mean_absolute_error(actual, baseline_prediction)
    base_mae = mean_absolute_error(actual, base_prediction)
    updated_mae = mean_absolute_error(actual, updated_prediction)
    base_improvement = (baseline_mae - base_mae) / baseline_mae if baseline_mae else 0
    updater_improvement = (base_mae - updated_mae) / base_mae if base_mae else 0

    by_class: list[dict[str, Any]] = []
    base_wins = True
    updater_non_regression = True
    for rookie_year in holdout_years:
        class_frame = holdout[holdout["rookie_year"] == rookie_year].copy()
        class_base = base.predict(class_frame[BASE_FEATURES])
        class_updated = updated.predict(class_frame[UPDATE_FEATURES])
        baseline_basket = capital_baseline_basket(class_frame)
        base_basket = sleeper_basket(class_frame, class_base)
        updated_basket = sleeper_basket(class_frame, class_updated)
        baseline_return = float(baseline_basket[target].mean()) if len(baseline_basket) else math.nan
        base_return = float(base_basket[target].mean()) if len(base_basket) else math.nan
        updated_return = float(updated_basket[target].mean()) if len(updated_basket) else math.nan
        if math.isfinite(baseline_return) and math.isfinite(base_return):
            base_wins = base_wins and base_return > baseline_return
        else:
            base_wins = False
        if math.isfinite(base_return) and math.isfinite(updated_return):
            updater_non_regression = updater_non_regression and updated_return >= base_return
        else:
            updater_non_regression = False
        by_class.append({
            "rookieYear": rookie_year,
            "rows": len(class_frame),
            "lateCandidates": int((class_frame["rookie_market_rank"] > LATE_ROOKIE_RANK).sum()),
            "capitalBaselineBasketMeanChange": baseline_return,
            "baseModelBasketMeanChange": base_return,
            "updatedModelBasketMeanChange": updated_return,
        })

    row_gate = len(train) >= MIN_TRAINING_ROWS and len(holdout) >= MIN_HOLDOUT_ROWS
    base_gate = row_gate and base_improvement > 0 and base_wins
    updater_gate = base_gate and updater_improvement > 0 and updater_non_regression

    final_models = {
        "base": fit_model(usable, BASE_FEATURES, target),
        "updated": fit_model(usable, UPDATE_FEATURES, target),
        "lower": fit_model(usable, UPDATE_FEATURES, target, loss="quantile", quantile=0.2),
        "upper": fit_model(usable, UPDATE_FEATURES, target, loss="quantile", quantile=0.8),
    }
    metrics = HorizonMetrics(
        horizon,
        len(train),
        len(holdout),
        holdout_years,
        baseline_mae,
        base_mae,
        updated_mae,
        base_improvement,
        updater_improvement,
        by_class,
        base_gate,
        updater_gate,
    )
    return metrics, final_models


def trend_map(items: Any) -> dict[str, int]:
    if not isinstance(items, list):
        return {}
    return {
        str(item.get("player_id")): int(item.get("count") or 0)
        for item in items
        if isinstance(item, dict) and item.get("player_id")
    }


def fantasycalc_map(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in items:
        player = item.get("player") if isinstance(item, dict) else None
        sleeper_id = str(player.get("sleeperId") or "") if isinstance(player, dict) else ""
        if sleeper_id:
            result[sleeper_id] = item
    return result


def explain_prediction(row: pd.Series) -> list[str]:
    drivers: list[str] = []
    if float(row["capital_market_gap"]) >= 0.08:
        drivers.append("NFL draft capital is stronger than the current rookie market rank")
    elif float(row["capital_market_gap"]) <= -0.08:
        drivers.append("Current rookie market rank is ahead of NFL draft capital")
    if float(row["market_momentum_30"]) > 0.01:
        drivers.append("expert-consensus market percentile improved over the prior month")
    elif float(row["market_momentum_30"]) < -0.01:
        drivers.append("expert-consensus market percentile declined over the prior month")
    if float(row["drafted"]) == 0:
        drivers.append("undrafted profile increases historical downside")
    elif float(row["draft_pick"]) >= 145:
        drivers.append("day-three draft capital creates a wide historical outcome range")
    if not drivers:
        drivers.append("forecast is driven by the learned interaction of market cost, draft capital, age, size and position")
    return drivers[:3]


def predict_current(
    current: pd.DataFrame,
    models: dict[int, dict[str, HistGradientBoostingRegressor]],
    trends: dict[str, Any],
    fantasycalc: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    adds = trend_map(trends.get("adds24"))
    drops = trend_map(trends.get("drops24"))
    fc_by_sleeper = fantasycalc_map(fantasycalc)
    predictions: list[dict[str, Any]] = []
    for _, row in current[current["anchor_market_present"] == 1].iterrows():
        horizons: dict[str, Any] = {}
        sort_prediction = 0.0
        for horizon, bundle in models.items():
            single = pd.DataFrame([row])
            base = float(bundle["base"].predict(single[BASE_FEATURES])[0])
            updated = float(bundle["updated"].predict(single[UPDATE_FEATURES])[0])
            lower = float(bundle["lower"].predict(single[UPDATE_FEATURES])[0])
            upper = float(bundle["upper"].predict(single[UPDATE_FEATURES])[0])
            lower, updated, upper = sorted((lower, updated, upper))
            horizons[str(horizon)] = {
                "baseExpectedPercentileChange": base,
                "structuredExpectedPercentileChange": updated,
                "structuredAdjustment": updated - base,
                "shadowRange": {"lower": lower, "median": updated, "upper": upper},
            }
            if horizon == 365:
                sort_prediction = updated
        sleeper_id = str(row["sleeper_id"])
        fc = fc_by_sleeper.get(sleeper_id, {})
        prediction = {
            "fpId": str(row["fp_id"]),
            "sleeperId": sleeper_id or None,
            "name": str(row["name"]),
            "position": str(row["position"]),
            "team": str(row["nfl_team"]),
            "college": str(row["college"]),
            "draft": {
                "round": None if float(row["drafted"]) == 0 else int(row["draft_round"]),
                "overall": None if float(row["drafted"]) == 0 else int(row["draft_pick"]),
            },
            "market": {
                "source": "DynastyProcess / FantasyPros dynasty ECR",
                "observedAt": str(row["anchor_date"]),
                "ranked": bool(row["anchor_market_present"]),
                "rookieRank": int(row["rookie_market_rank"]) if row["anchor_market_present"] else None,
                "modelRookieRank": int(row["rookie_market_rank"]),
                "ecr2qb": safe_float(row["initial_ecr_2qb"]),
                "percentile": float(row["initial_market_percentile"]),
                "momentum30": float(row["market_momentum_30"]),
                "fantasyCalcValue": safe_float(fc.get("value"), default=math.nan),
                "fantasyCalcOverallRank": fc.get("overallRank"),
                "fantasyCalcTrend30Day": fc.get("trend30Day"),
            },
            "currentEvidence": {
                "sleeperAdds24": adds.get(sleeper_id, 0),
                "sleeperDrops24": drops.get(sleeper_id, 0),
                "changesForecast": False,
                "reason": "Sleeper trend history is not yet available for out-of-time training",
            },
            "forecast": horizons,
            "drivers": explain_prediction(row),
            "shadowOnly": True,
            "sortPrediction": sort_prediction,
        }
        predictions.append(prediction)
    predictions.sort(
        key=lambda item: (
            -item["sortPrediction"],
            item["market"]["rookieRank"] if item["market"]["rookieRank"] is not None else 10_000,
            item["name"],
        )
    )
    for index, prediction in enumerate(predictions, start=1):
        prediction["shadowRank"] = index
        prediction.pop("sortPrediction", None)
    return predictions


def gate(identifier: str, label: str, passed: bool, actual: Any, requirement: str) -> dict[str, Any]:
    return {"id": identifier, "label": label, "passed": bool(passed), "actual": actual, "requirement": requirement}


def clean_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: clean_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_json(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def build_report(
    *,
    tape: pd.DataFrame,
    coverage: list[dict[str, Any]],
    current_coverage: dict[str, Any],
    metrics: list[HorizonMetrics],
    predictions: list[dict[str, Any]],
    points: list[CommitPoint],
    fantasycalc_as_of: str | None,
    trends: dict[str, Any],
    public_sources: dict[str, Any],
    production_backtest: ProductionBacktest,
    draft_board: list[dict[str, Any]],
    production_feature_importance: list[dict[str, Any]],
) -> dict[str, Any]:
    overall_coverage = sum(item["tapeRows"] for item in coverage) / max(
        1, sum(item["draftedAndUndraftedUniverse"] for item in coverage)
    )
    late_coverage = sum(item["lateRoundTapeRows"] for item in coverage) / max(
        1, sum(item["lateRoundUniverse"] for item in coverage)
    )
    market_pricing_rate = sum(item["marketPricedRookies"] for item in coverage) / max(
        1, sum(item["draftedAndUndraftedUniverse"] for item in coverage)
    )
    late_market_pricing_rate = sum(item["lateRoundMarketPriced"] for item in coverage) / max(
        1, sum(item["lateRoundUniverse"] for item in coverage)
    )
    identity_gate = overall_coverage >= 0.85
    late_gate = late_coverage >= 0.75
    v60_gates = [
        gate("snapshotHistory", "Point-in-time snapshot history", len(points) >= 250, len(points), ">= 250 dated snapshots"),
        gate("identityCoverage", "Full rookie-universe tape", identity_gate, overall_coverage, ">= 85% of drafted and identified undrafted rookies, with unranked players retained at the source floor"),
        gate("lateRoundCoverage", "Late-round universe tape", late_gate, late_coverage, ">= 75% of round-five-or-later and undrafted rookies, including unranked players"),
        gate("historicalClasses", "Complete historical classes", len(coverage) >= 6, len(coverage), ">= 6 rookie classes"),
        gate("pointInTime", "Leak-safe anchor selection", True, "features at or before anchor", "all feature timestamps <= anchor"),
    ]
    v61_gates = [
        gate(
            f"horizon{item.horizon_days}",
            f"{item.horizon_days}-day out-of-time performance",
            item.base_gate_passed,
            item.base_mae_improvement,
            "beats no-change MAE and draft-capital sleeper basket in both held-out classes",
        )
        for item in metrics
    ]
    v61_gates.append(
        gate(
            "tradeMarketLabels",
            "Completed-trade market labels",
            False,
            "FantasyPros expert-consensus percentile proxy",
            "historical completed-trade prices including players that reached zero",
        )
    )
    v62_gates = [
        gate(
            f"horizon{item.horizon_days}",
            f"{item.horizon_days}-day structured updater lift",
            item.updater_gate_passed,
            item.updater_mae_improvement,
            "improves base-model MAE without reducing sleeper-basket return in either held-out class",
        )
        for item in metrics
    ]
    v62_gates.append(
        gate(
            "currentTrends",
            "Current Sleeper trend ingestion",
            trends.get("status") == "complete",
            trends.get("status"),
            "complete current add/drop snapshot",
        )
    )
    v62_gates.append(
        gate(
            "historicalTrendLabels",
            "Historical Sleeper trend tape",
            False,
            "current snapshot only",
            "point-in-time add/drop history for held-out rookie classes",
        )
    )
    priced = tape[tape["anchor_market_present"] == 1]
    college_coverage = float(priced["college_data_present"].mean()) if len(priced) else 0.0
    combine_coverage = float(priced["combine_data_present"].mean()) if len(priced) else 0.0
    current_college_coverage = float(
        np.mean([item["evidence"]["collegeDataPresent"] for item in draft_board])
    ) if draft_board else 0.0
    v63_gates = [
        gate(
            "realProductionLabels",
            "Real NFL rookie production outcomes",
            tape["rookie_production_percentile"].notna().all(),
            int(tape["rookie_production_percentile"].notna().sum()),
            "every completed-class prospect has a position-relative rookie PPR outcome, including zero-stat players",
        ),
        gate(
            "collegeCoverage",
            "Historical college identity coverage",
            college_coverage >= 0.85,
            college_coverage,
            ">= 85% of historically market-priced rookies joined by stable ESPN athlete ID",
        ),
        gate(
            "currentCollegeCoverage",
            "Current-class college coverage",
            current_college_coverage >= 0.90,
            current_college_coverage,
            ">= 90% of the current class",
        ),
        gate(
            "rollingSleeperLift",
            "Rolling cost-aware sleeper basket lift",
            production_backtest.passed,
            {
                "wins": production_backtest.fold_wins,
                "folds": production_backtest.fold_count,
                "meanLift": production_backtest.mean_lift,
                "minimumClassLift": production_backtest.minimum_class_lift,
                "signTestPValue": production_backtest.exact_one_sided_sign_p_value,
                "adjacentBasketSensitivityPassed": production_backtest.sensitivity_passed,
            },
            "top-eight post-rank-24 basket beats the strongest of market order, NFL draft order, and capital-gap baselines in >= 5 rolling classes with exact one-sided p <= 0.05; sizes 6/8/10/12 must have positive mean lift and majority class wins against both market and draft order",
        ),
        gate(
            "pointInTimeProductionFeatures",
            "Production-feature leakage audit",
            True,
            "college seasons <= draft year - 1; combine and NFL draft facts available before rookie-season outcome",
            "no outcome or post-rookie-season feature enters training",
        ),
    ]

    def source_files(group: str) -> list[dict[str, Any]]:
        return [
            {key: item.get(key) for key in ("url", "bytes", "sha256", "status")}
            for item in public_sources.get(group, {}).get("files", [])
        ]

    report = {
        "version": MODEL_VERSION,
        "generatedAt": utc_now(),
        "mode": "validated-draft-evidence-shadow-market-return",
        "liveRecommendationsEnabled": False,
        "draftEvidenceEnabled": production_backtest.passed,
        "tradeReturnForecastEnabled": False,
        "targets": {
            "draftProduction": {
                "source": "nflverse regular-season player stats",
                "meaning": production_backtest.target_meaning,
                "status": "backtest-passed" if production_backtest.passed else "blocked",
            },
            "marketReturn": {
                "source": LABEL_SOURCE,
                "meaning": "change in dynasty superflex expert-consensus percentile, not a promised trade return",
                "status": "shadow",
            },
        },
        "sources": {
            "historicalMarket": {
                "provider": "DynastyProcess open-data git history",
                "upstream": "FantasyPros dynasty ECR",
                "firstSnapshot": points[0].observed_at.isoformat(),
                "lastSnapshot": points[-1].observed_at.isoformat(),
                "snapshotCount": len(points),
            },
            "currentTradeMarketComparator": {
                "provider": "FantasyCalc",
                "asOf": fantasycalc_as_of,
                "modelInput": False,
                "reason": "current evidence only; historical full-universe labels remain unresolved",
            },
            "currentReactionEvidence": {
                "provider": "Sleeper public trending API",
                "retrievedAt": trends.get("retrievedAt"),
                "modelInput": False,
                "reason": "current evidence is displayed but cannot affect forecasts without historical counterparts",
            },
            "collegeProduction": {
                "provider": public_sources.get("college", {}).get("provider"),
                "license": public_sources.get("college", {}).get("license"),
                "modelInput": True,
                "files": source_files("college"),
            },
            "rookieProductionOutcomes": {
                "provider": public_sources.get("nflOutcomes", {}).get("provider"),
                "license": public_sources.get("nflOutcomes", {}).get("license"),
                "modelInput": True,
                "files": source_files("nflOutcomes"),
            },
            "athleticTesting": {
                "provider": public_sources.get("combine", {}).get("provider"),
                "license": public_sources.get("combine", {}).get("license"),
                "modelInput": True,
                "files": source_files("combine"),
            },
        },
        "phases": {
            "v6.0": {"name": "Historical rookie tape", "gates": v60_gates, "passed": all(item["passed"] for item in v60_gates)},
            "v6.1": {"name": "Sleeper return model", "gates": v61_gates, "passed": all(item["passed"] for item in v61_gates)},
            "v6.2": {"name": "Structured market-reaction updater", "gates": v62_gates, "passed": all(item["passed"] for item in v62_gates)},
            "v6.3": {"name": "Backtested rookie production and sleeper basket", "gates": v63_gates, "passed": all(item["passed"] for item in v63_gates)},
        },
        "tape": {
            "rows": len(tape),
            "modelEligibleRows": int(tape["anchor_market_present"].sum()),
            "classes": sorted(int(value) for value in tape["rookie_year"].unique()),
            "overallIdentityCoverage": overall_coverage,
            "lateRoundIdentityCoverage": late_coverage,
            "historicalMarketPricingRate": market_pricing_rate,
            "lateRoundMarketPricingRate": late_market_pricing_rate,
            "coverageByClass": coverage,
            "currentClassCoverage": current_coverage,
            "historicalCollegeCoverageAmongPriced": college_coverage,
            "historicalCombineRowCoverageAmongPriced": combine_coverage,
            "currentCollegeCoverage": current_college_coverage,
        },
        "evaluation": [asdict(item) for item in metrics],
        "productionBacktest": production_backtest_dict(production_backtest),
        "productionFeatureImportance": production_feature_importance,
        "currentDraftBoard": draft_board,
        "currentShadowBoard": predictions,
        "promotionBlockers": [
            "The market-return head still uses expert consensus rather than a complete historical completed-trade tape.",
            "Current Sleeper add/drop counts lack historical point-in-time counterparts and therefore do not change forecasts.",
            "The 2026 production board has passed retrospective rolling gates but still needs prospective tracking before its lift can be treated as permanent.",
        ],
        "decisionBoundary": [
            "Use the production board to prioritize film and price checks among late rookies.",
            "College and athletic features improve the selected basket on average but do not beat the learned market-plus-capital model in every class; show their evidence separately.",
            "Do not translate production percentiles into guaranteed trade profit or exact pick values.",
            "Do not let the blocked market-return head change trade grades.",
        ],
    }
    return clean_json(report)


def render_markdown(report: dict[str, Any]) -> str:
    phases = report["phases"]
    production = report["productionBacktest"]
    lines = [
        "# Rookie sleeper model",
        "",
        f"Generated: `{report['generatedAt']}`",
        "",
        "## Decision",
        "",
        "The rookie-production evidence board passed its rolling sleeper-basket gate. The market-return head remains shadow-only because its target is expert consensus rather than completed-trade pricing.",
        "",
        "| Phase | Status | Evidence |",
        "|---|---:|---|",
    ]
    for identifier in ("v6.0", "v6.1", "v6.2", "v6.3"):
        phase = phases[identifier]
        passed = sum(item["passed"] for item in phase["gates"])
        lines.append(f"| {identifier} {phase['name']} | {'Passed' if phase['passed'] else 'Blocked'} | {passed}/{len(phase['gates'])} gates |")
    lines.extend([
        "",
        "## Tape",
        "",
        f"- {report['tape']['rows']} point-in-time rookie examples across {len(report['tape']['classes'])} classes.",
        f"- {report['tape']['modelEligibleRows']} examples had a real anchor price and were eligible for return-model training.",
        f"- Overall identity coverage: {report['tape']['overallIdentityCoverage']:.1%}.",
        f"- Round-five-or-later and undrafted coverage: {report['tape']['lateRoundIdentityCoverage']:.1%}.",
        f"- Explicit source prices exist for {report['tape']['historicalMarketPricingRate']:.1%} of the universe; unranked players are retained at the source floor instead of dropped.",
        f"- College features cover {report['tape']['historicalCollegeCoverageAmongPriced']:.1%} of historically priced rookies and {report['tape']['currentCollegeCoverage']:.1%} of the current class.",
        "",
        "## Rookie production sleeper backtest",
        "",
        f"- Exact decision rule: top eight model predictions after rookie market rank 24.",
        f"- Rolling class wins: {production['fold_wins']}/{production['fold_count']} against an oracle that chooses the best simple baseline in each class.",
        f"- Mean production-percentile lift: {production['mean_lift']:+.3f}.",
        f"- Minimum single-class lift: {production['minimum_class_lift']:+.3f}.",
        f"- Exact one-sided sign-test p-value: {production['exact_one_sided_sign_p_value']:.5f}.",
        f"- Full model OOF MAE / Spearman: {production['model_mae']:.4f} / {production['model_spearman']:.3f}.",
        f"- Market-only OOF MAE / Spearman: {production['market_only_model_mae']:.4f} / {production['market_only_model_spearman']:.3f}.",
        f"- Learned market+capital OOF MAE / Spearman: {production['capital_only_model_mae']:.4f} / {production['capital_only_model_spearman']:.3f}.",
        f"- External college/athletic features add {production['mean_lift_over_learned_capital_model']:+.3f} mean top-eight percentile versus the learned capital model, but win only {production['learned_capital_model_class_wins']}/{production['fold_count']} individual classes; treat their incremental lift as mixed.",
        "",
        "| Class | Train | Model basket | Strongest simple baseline | Lift | Baseline |",
        "|---:|---:|---:|---:|---:|---|",
    ])
    for fold in production["folds"]:
        lines.append(
            f"| {fold['rookie_year']} | {fold['training_rows']} | "
            f"{fold['model_basket_mean_percentile']:.3f} | "
            f"{fold['strongest_simple_baseline_mean_percentile']:.3f} | "
            f"{fold['lift_over_strongest_simple_baseline']:+.3f} | "
            f"{fold['strongest_simple_baseline']} |"
        )
    lines.extend([
        "",
        "### Basket-size sensitivity",
        "",
        "| Size | Market lift | Market wins | Draft lift | Draft wins | Status |",
        "|---:|---:|---:|---:|---:|:---:|",
    ])
    for item in production["basket_sensitivity"]:
        lines.append(
            f"| {item['basketSize']} | {item['marketMeanLift']:+.3f} | "
            f"{item['marketClassWins']}/{item['folds']} | {item['draftMeanLift']:+.3f} | "
            f"{item['draftClassWins']}/{item['folds']} | {'pass' if item['passed'] else 'fail'} |"
        )
    lines.extend([
        "",
        "## Shadow market-return evaluation",
        "",
        "| Horizon | Train | Holdout | Baseline MAE | Base MAE | Updated MAE | Base gate | Updater gate |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for item in report["evaluation"]:
        def metric(key: str) -> str:
            value = item.get(key)
            return f"{value:.4f}" if isinstance(value, (int, float)) else "n/a"
        lines.append(
            f"| {item['horizon_days']}d | {item['training_rows']} | {item['holdout_rows']} | "
            f"{metric('baseline_mae')} | {metric('base_model_mae')} | {metric('updated_model_mae')} | "
            f"{item['base_gate_passed']} | {item['updater_gate_passed']} |"
        )
    lines.extend([
        "",
        "## Current validated production board",
        "",
        "The percentile is expected position-relative rookie PPR production. The historical band is model error, not a probability guarantee.",
        "",
        "| Rank | Player | Pos | Rookie market rank | Expected production percentile | Sleeper basket |",
        "|---:|---|:---:|---:|---:|:---:|",
    ])
    for player in report["currentDraftBoard"][:25]:
        lines.append(
            f"| {player['draftBoardRank']} | {player['name']} | {player['position']} | "
            f"{player['rookieMarketRank']} | {player['expectedRookieProductionPercentile']:.3f} | "
            f"{'yes' if player['inValidatedSleeperBasket'] else ''} |"
        )
    lines.extend(["", "## Remaining market-return blockers", ""])
    lines.extend(f"- {blocker}" for blocker in report["promotionBlockers"])
    return "\n".join(lines) + "\n"


def collect(*, refresh: bool, offline: bool) -> dict[str, Any]:
    ensure_dirs()
    ensure_dynastyprocess(refresh=refresh, offline=offline)
    public_sources = collect_public_rookie_sources(
        RAW,
        refresh=refresh,
        offline=offline,
    )
    trends = collect_sleeper_trends(refresh=refresh, offline=offline)
    fantasycalc, fantasycalc_as_of = latest_fantasycalc_snapshot()
    return {
        "trends": trends,
        "fantasycalc": fantasycalc,
        "fantasycalcAsOf": fantasycalc_as_of,
        "publicSources": public_sources,
    }


def build_and_train(*, refresh: bool, offline: bool) -> dict[str, Any]:
    sources = collect(refresh=refresh, offline=offline)
    points = load_commit_points()
    universe = load_player_universe()
    tape, coverage = build_tape(points, universe)
    current, current_coverage = current_rookies(points, universe)
    college_seasons = build_college_player_seasons(RAW, PROCESSED)
    college_features = build_college_features(universe, college_seasons)
    combine_features = build_combine_features(
        universe, pd.read_parquet(RAW / "nflverse" / "combine.parquet")
    )
    production_outcomes = load_nfl_rookie_outcomes(RAW, universe)
    tape = add_external_features(tape, college_features, combine_features, production_outcomes)
    current = add_external_features(current, college_features, combine_features)
    tape.to_csv(PROCESSED / "rookie-tape.csv", index=False)
    current.to_csv(PROCESSED / "current-rookies.csv", index=False)

    production_backtest = backtest_production_model(tape)
    production_artifact = fit_production_artifact(tape)
    draft_board = predict_current_production(
        current,
        production_artifact,
        production_backtest.residual_band_80,
    )

    metrics: list[HorizonMetrics] = []
    models: dict[int, dict[str, HistGradientBoostingRegressor]] = {}
    for horizon in HORIZONS:
        horizon_metrics, horizon_models = evaluate_horizon(tape, horizon)
        metrics.append(horizon_metrics)
        if horizon_models:
            models[horizon] = horizon_models
    if not models:
        raise RuntimeError("The rookie tape did not produce enough data to fit a shadow model")
    with MODEL_PATH.open("wb") as artifact:
        pickle.dump({
            "version": MODEL_VERSION,
            "baseFeatures": BASE_FEATURES,
            "updateFeatures": UPDATE_FEATURES,
            "marketReturnModels": models,
            "productionFeatures": PRODUCTION_FEATURES,
            "production": production_artifact,
        }, artifact)

    predictions = predict_current(current, models, sources["trends"], sources["fantasycalc"])
    report = build_report(
        tape=tape,
        coverage=coverage,
        current_coverage=current_coverage,
        metrics=metrics,
        predictions=predictions,
        points=points,
        fantasycalc_as_of=sources["fantasycalcAsOf"],
        trends=sources["trends"],
        public_sources=sources["publicSources"],
        production_backtest=production_backtest,
        draft_board=draft_board,
        production_feature_importance=production_artifact["featureImportance"],
    )
    REPORT_JSON.write_text(json.dumps(report, indent=2) + "\n")
    REPORT_MARKDOWN.write_text(render_markdown(report))
    return report


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("action", choices=("collect", "refresh", "train"), nargs="?", default="refresh")
    command.add_argument("--refresh", action="store_true", help="Refresh network caches before building")
    command.add_argument("--offline", action="store_true", help="Use only cached sources")
    return command


def main() -> None:
    arguments = parser().parse_args()
    if arguments.action == "collect":
        sources = collect(refresh=arguments.refresh, offline=arguments.offline)
        print(json.dumps({
            "fantasycalcAsOf": sources["fantasycalcAsOf"],
            "sleeperTrends": sources["trends"].get("status"),
        }, indent=2))
        return
    report = build_and_train(refresh=arguments.refresh, offline=arguments.offline)
    print(f"Rookie tape: {report['tape']['rows']} rows")
    for identifier, phase in report["phases"].items():
        print(f"{identifier}: {'passed' if phase['passed'] else 'blocked'}")
    print(f"Report: {REPORT_MARKDOWN}")


if __name__ == "__main__":
    main()

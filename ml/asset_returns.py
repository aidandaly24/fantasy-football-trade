#!/usr/bin/env python3
"""Train point-in-time asset return, risk, and decay research models.

The input is FantasyCalc's cached daily player/pick value history.  The target
is the same asset's later percentage market-value return at a declared horizon.
This module never edits the application's current market value.  A horizon is
only exported as enabled when a genuinely later chronological holdout clears
every declared gate.

Raw histories and normalized examples remain gitignored.  The committed JSON
contains aggregate audit facts, held-out metrics, portable linear coefficients,
and current-asset forecasts.  It is deliberately small enough for a private
browser client and deliberately explicit about survivor/population boundaries.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import os
import re
import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

try:
    from ml.trade_models import (
        FAQ,
        TERMS,
        History,
        age_on,
        load_all_trades,
        load_current,
        load_histories,
        utc_now,
    )
except ModuleNotFoundError:  # Direct `python ml/asset_returns.py ...` execution.
    from trade_models import (  # type: ignore[no-redef]
        FAQ,
        TERMS,
        History,
        age_on,
        load_all_trades,
        load_current,
        load_histories,
        utc_now,
    )


ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed" / "asset_returns"
REPORT_JSON = ROOT / "ml" / "reports" / "asset-return-health.json"
REPORT_MD = ROOT / "ml" / "reports" / "asset-return-health.md"
PUBLIC_JSON = ROOT / "public" / "data" / "asset-return-health.json"

HORIZONS = (30, 90, 180, 365)
SAMPLE_STEP_DAYS = 7
LOOKBACK_DAYS = 30
POSITIONS = ("QB", "RB", "WR", "TE", "PICK")
FEATURES = [
    "log_value",
    "market_percentile",
    "position_percentile",
    "age",
    "age_missing",
    "is_qb",
    "is_rb",
    "is_wr",
    "is_te",
    "is_pick",
    "return_7d",
    "return_30d",
    "volatility_30d",
    "max_drawdown_30d",
    "pick_years_away",
]


def ensure_dirs() -> None:
    for path in (PROCESSED, REPORT_JSON.parent, PUBLIC_JSON.parent):
        path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True))
    temporary.replace(path)


def write_compact_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    temporary.replace(path)


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def percent_return(start: float | None, end: float | None) -> float | None:
    if start is None or end is None or start <= 0 or end <= 0:
        return None
    result = end / start - 1
    return result if math.isfinite(result) else None


def max_drawdown(values: Iterable[float]) -> float:
    peak = 0.0
    worst = 0.0
    for value in values:
        if value <= 0 or not math.isfinite(value):
            continue
        peak = max(peak, value)
        if peak > 0:
            worst = min(worst, value / peak - 1)
    return worst


def volatility(values: Iterable[float]) -> float:
    usable = [value for value in values if value > 0 and math.isfinite(value)]
    returns = [usable[index] / usable[index - 1] - 1 for index in range(1, len(usable))]
    return float(statistics.pstdev(returns) * math.sqrt(30)) if len(returns) >= 3 else 0.0


def percentile(values: Iterable[float], target: float) -> float:
    usable = sorted(value for value in values if value > 0 and math.isfinite(value))
    if not usable:
        return 0.0
    return bisect.bisect_right(usable, target) / len(usable)


def parse_pick_year(name: str) -> int | None:
    match = re.match(r"\s*(20\d{2})", name)
    return int(match.group(1)) if match else None


def stable_asset_key(num_qbs: int, asset_id: int) -> str:
    return f"{num_qbs}qb:{asset_id}"


def asset_metadata(catalog: list[dict[str, Any]], trades: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Prefer the current catalog, then retain trade-observed disappeared assets."""
    result: dict[int, dict[str, Any]] = {}
    for trade in trades:
        for side in (trade.get("side1") or [], trade.get("side2") or []):
            for asset in side if isinstance(side, list) else []:
                if not isinstance(asset, dict) or asset.get("id") is None:
                    continue
                try:
                    result[int(asset["id"])] = dict(asset)
                except (TypeError, ValueError):
                    continue
    for item in catalog:
        player = item.get("player") if isinstance(item, dict) else None
        if not isinstance(player, dict) or player.get("id") is None:
            continue
        try:
            asset_id = int(player["id"])
        except (TypeError, ValueError):
            continue
        result[asset_id] = {**player, "currentRanking": item}
    return result


def history_value(history: History, observed: date, tolerance: int = 2) -> float | None:
    return history.at(observed, backward_days=tolerance, forward_days=tolerance)


def history_window(history: History, start: date, end: date) -> list[float]:
    left = bisect.bisect_left(history.dates, start)
    right = bisect.bisect_right(history.dates, end)
    return [value for value in history.values[left:right] if value > 0 and math.isfinite(value)]


def observed_age(metadata: dict[str, Any], observed: date) -> float | None:
    return age_on(metadata, observed)


def feature_row(
    *,
    asset_id: int,
    metadata: dict[str, Any],
    history: History,
    observed: date,
    cross_section: list[float],
    position_section: list[float],
) -> dict[str, float] | None:
    value = history_value(history, observed)
    if value is None:
        return None
    position = str(metadata.get("position") or "").upper()
    if position not in POSITIONS:
        return None
    previous_7 = history_value(history, observed - timedelta(days=7), tolerance=3)
    previous_30 = history_value(history, observed - timedelta(days=30), tolerance=4)
    return_7 = percent_return(previous_7, value)
    return_30 = percent_return(previous_30, value)
    if return_30 is None:
        return None
    age = observed_age(metadata, observed)
    window = history_window(history, observed - timedelta(days=30), observed)
    pick_year = parse_pick_year(str(metadata.get("name") or "")) if position == "PICK" else None
    return {
        "asset_id": float(asset_id),
        "value": value,
        "log_value": math.log(max(1.0, value)),
        "market_percentile": percentile(cross_section, value),
        "position_percentile": percentile(position_section, value),
        "age": age or 0.0,
        "age_missing": float(age is None),
        "is_qb": float(position == "QB"),
        "is_rb": float(position == "RB"),
        "is_wr": float(position == "WR"),
        "is_te": float(position == "TE"),
        "is_pick": float(position == "PICK"),
        "return_7d": return_7 or 0.0,
        "return_30d": return_30,
        "volatility_30d": volatility(window),
        "max_drawdown_30d": max_drawdown(window),
        "pick_years_away": float(max(-1, min(5, pick_year - observed.year))) if pick_year else 0.0,
    }


def build_examples_for_format(
    num_qbs: int,
    histories: dict[int, History],
    metadata_by_id: dict[int, dict[str, Any]],
    horizon: int,
) -> pd.DataFrame:
    valid_histories = {
        asset_id: history
        for asset_id, history in histories.items()
        if asset_id in metadata_by_id and len(history.dates) >= LOOKBACK_DAYS + 2
    }
    if not valid_histories:
        return pd.DataFrame()
    # Players and future-pick buckets enter and leave the catalog at different
    # times.  Requiring a full intersection would silently discard the entire
    # panel when one rookie has a short history; each row instead proves its own
    # lookback and label coverage below.
    earliest = min(min(history.dates) for history in valid_histories.values()) + timedelta(days=LOOKBACK_DAYS)
    latest = max(max(history.dates) for history in valid_histories.values()) - timedelta(days=horizon)
    if earliest > latest:
        return pd.DataFrame()
    dates = []
    cursor = earliest
    while cursor <= latest:
        dates.append(cursor)
        cursor += timedelta(days=SAMPLE_STEP_DAYS)
    rows: list[dict[str, Any]] = []
    for observed in dates:
        current_values: dict[int, float] = {}
        by_position: dict[str, list[float]] = defaultdict(list)
        for asset_id, history in valid_histories.items():
            value = history_value(history, observed)
            position = str(metadata_by_id[asset_id].get("position") or "").upper()
            if value is None or position not in POSITIONS:
                continue
            current_values[asset_id] = value
            by_position[position].append(value)
        cross_section = list(current_values.values())
        if len(cross_section) < 50:
            continue
        for asset_id, value in current_values.items():
            metadata = metadata_by_id[asset_id]
            position = str(metadata.get("position") or "").upper()
            features = feature_row(
                asset_id=asset_id,
                metadata=metadata,
                history=valid_histories[asset_id],
                observed=observed,
                cross_section=cross_section,
                position_section=by_position[position],
            )
            future = history_value(valid_histories[asset_id], observed + timedelta(days=horizon), tolerance=max(3, horizon // 30))
            target = percent_return(value, future)
            if features is None or target is None or target <= -0.98 or target >= 6:
                continue
            rows.append({
                **features,
                "date": observed.isoformat(),
                "label_date": (observed + timedelta(days=horizon)).isoformat(),
                "position": position,
                "target_return": target,
                "target_log_return": math.log1p(target),
            })
    return pd.DataFrame(rows)


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    if not len(actual):
        return {"mae": 0.0, "rmse": 0.0, "rankCorrelation": 0.0}
    actual_series = pd.Series(actual)
    predicted_series = pd.Series(predicted)
    rank = (
        actual_series.corr(predicted_series, method="spearman")
        if len(actual) >= 3 and actual_series.nunique() > 1 and predicted_series.nunique() > 1
        else 0.0
    )
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "rankCorrelation": finite(rank),
    }


def cross_section_rank(frame: pd.DataFrame, predictions: np.ndarray) -> float:
    if frame.empty:
        return 0.0
    working = frame[["date", "target_return"]].copy()
    working["prediction"] = predictions
    correlations = []
    for _, group in working.groupby("date"):
        if len(group) < 20:
            continue
        if group["target_return"].nunique() <= 1 or group["prediction"].nunique() <= 1:
            continue
        correlation = group["target_return"].corr(group["prediction"], method="spearman")
        if correlation is not None and math.isfinite(correlation):
            correlations.append(float(correlation))
    return float(statistics.median(correlations)) if correlations else 0.0


def fit_model(train: pd.DataFrame, kind: str) -> Any:
    if kind == "ridge":
        model: Any = Pipeline([("scale", StandardScaler()), ("ridge", Ridge(alpha=10.0))])
    elif kind == "hist-gradient":
        model = HistGradientBoostingRegressor(
            loss="absolute_error",
            learning_rate=0.05,
            max_iter=160,
            max_leaf_nodes=15,
            min_samples_leaf=30,
            l2_regularization=1.0,
            random_state=7,
        )
    else:
        raise ValueError(f"Unknown asset-return model: {kind}")
    model.fit(train[FEATURES].to_numpy(float), train["target_log_return"].to_numpy(float))
    return model


def predict_returns(model: Any, frame: pd.DataFrame) -> np.ndarray:
    predicted = model.predict(frame[FEATURES].to_numpy(float))
    return np.expm1(np.clip(predicted, math.log(0.02), math.log(7.0)))


def portable_model(model: Any, kind: str) -> dict[str, Any]:
    if kind != "ridge":
        return {
            "kind": "hist-gradient-boosting-log-return-v1",
            "portable": False,
            "parameters": {
                "learningRate": 0.05,
                "maxIterations": 160,
                "maxLeafNodes": 15,
                "minimumLeafRows": 30,
                "l2Regularization": 1.0,
            },
        }
    scaler: StandardScaler = model.named_steps["scale"]
    ridge: Ridge = model.named_steps["ridge"]
    return {
        "kind": "standardized-ridge-log-return-v1",
        "portable": True,
        "features": FEATURES,
        "means": [float(value) for value in scaler.mean_],
        "scales": [float(value) if value else 1.0 for value in scaler.scale_],
        "coefficients": [float(value) for value in ridge.coef_],
        "intercept": float(ridge.intercept_),
    }


def value_band_boundaries(train: pd.DataFrame) -> list[float]:
    if train.empty:
        return []
    return [float(train["log_value"].quantile(value)) for value in (0.2, 0.4, 0.6, 0.8)]


def value_band(value: float, boundaries: list[float]) -> int:
    return bisect.bisect_right(boundaries, value)


def cohort_baseline(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    if train.empty or test.empty:
        return np.zeros(len(test))
    boundaries = value_band_boundaries(train)
    working = train.copy()
    working["value_band"] = working["log_value"].map(lambda value: value_band(float(value), boundaries))
    grouped = working.groupby(["position", "value_band"])["target_return"].median().to_dict()
    position_median = working.groupby("position")["target_return"].median().to_dict()
    global_median = float(working["target_return"].median())
    return np.array([
        finite(grouped.get((row.position, value_band(float(row.log_value), boundaries)), position_median.get(row.position, global_median)))
        for row in test.itertuples()
    ])


def chronological_split(frame: pd.DataFrame, horizon: int) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Hold out the latest anchors and embargo every training label after them."""
    if frame.empty:
        return frame, frame, {"testStart": None, "embargoDays": horizon}
    dates = sorted(frame["date"].unique())
    test_index = max(1, min(len(dates) - 1, math.floor(len(dates) * 0.90)))
    test_start = str(dates[test_index])
    train = frame[frame["label_date"] < test_start].copy()
    test = frame[frame["date"] >= test_start].copy()
    return train, test, {"testStart": test_start, "embargoDays": horizon}


def calibration_split(frame: pd.DataFrame, horizon: int) -> tuple[pd.DataFrame, pd.DataFrame, str | None]:
    """Create a pre-test model-selection window with the same label embargo."""
    if frame.empty:
        return frame, frame, None
    dates = sorted(frame["date"].unique())
    if len(dates) < 6:
        return frame, frame.iloc[0:0], None
    calibration_index = max(1, min(len(dates) - 1, math.floor(len(dates) * 0.80)))
    calibration_start = str(dates[calibration_index])
    fit = frame[frame["label_date"] < calibration_start].copy()
    calibration = frame[frame["date"] >= calibration_start].copy()
    if len(fit) < 100 or len(calibration) < 20:
        return frame, frame.iloc[0:0], None
    return fit, calibration, calibration_start


def gate(identifier: str, label: str, passed: bool, actual: float, requirement: str) -> dict[str, Any]:
    return {"id": identifier, "label": label, "passed": bool(passed), "actual": float(actual), "requirement": requirement}


def current_feature_frame(
    histories: dict[int, History],
    metadata_by_id: dict[int, dict[str, Any]],
    observed: date,
) -> pd.DataFrame:
    values: dict[int, float] = {}
    by_position: dict[str, list[float]] = defaultdict(list)
    for asset_id, history in histories.items():
        metadata = metadata_by_id.get(asset_id)
        position = str(metadata.get("position") or "").upper() if metadata else ""
        value = history_value(history, observed, tolerance=7)
        if metadata and position in POSITIONS and value is not None:
            values[asset_id] = value
            by_position[position].append(value)
    rows = []
    for asset_id in sorted(values):
        metadata = metadata_by_id[asset_id]
        position = str(metadata.get("position") or "").upper()
        features = feature_row(
            asset_id=asset_id,
            metadata=metadata,
            history=histories[asset_id],
            observed=observed,
            cross_section=list(values.values()),
            position_section=by_position[position],
        )
        if features:
            rows.append({**features, "position": position})
    return pd.DataFrame(rows)


def cohort_summaries(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    working = frame.copy()
    working["age_band"] = np.where(
        working["age_missing"] > 0,
        "Pick/no age",
        pd.cut(working["age"], bins=[0, 23, 26, 29, 100], labels=["Under 23", "23–25", "26–28", "29+"]),
    )
    result = []
    for (position, age_band), group in working.groupby(["position", "age_band"], observed=True):
        if len(group) < 50:
            continue
        result.append({
            "position": str(position),
            "ageBand": str(age_band),
            "rows": int(len(group)),
            "assets": int(group["asset_id"].nunique()),
            "medianReturn": float(group["target_return"].median()),
            "p10Return": float(group["target_return"].quantile(0.10)),
            "p90Return": float(group["target_return"].quantile(0.90)),
        })
    return sorted(result, key=lambda item: (item["position"], item["ageBand"]))


@dataclass
class TrainedHorizon:
    health: dict[str, Any]
    current: pd.DataFrame
    predictions: np.ndarray
    lower: np.ndarray
    upper: np.ndarray


def train_horizon(
    *,
    num_qbs: int,
    horizon: int,
    histories: dict[int, History],
    metadata_by_id: dict[int, dict[str, Any]],
    observed: date,
) -> TrainedHorizon:
    frame = build_examples_for_format(num_qbs, histories, metadata_by_id, horizon)
    train, test, split = chronological_split(frame, horizon)
    rows = len(frame)
    source_assets = int(frame["asset_id"].nunique()) if rows else 0
    heldout_assets = int(test["asset_id"].nunique()) if len(test) else 0
    anchor_dates = int(frame["date"].nunique()) if rows else 0
    train_span = (
        (date.fromisoformat(train["date"].max()) - date.fromisoformat(train["date"].min())).days
        if len(train) else 0
    )
    baseline_zero = np.zeros(len(test))
    baseline_cohort = cohort_baseline(train, test)
    actual = test["target_return"].to_numpy(float) if len(test) else np.array([])
    zero_metrics = metrics(actual, baseline_zero)
    cohort_metrics = metrics(actual, baseline_cohort)
    baseline_name = "position-value cohort median" if cohort_metrics["mae"] <= zero_metrics["mae"] else "zero return"
    baseline_predictions = baseline_cohort if baseline_name.startswith("position") else baseline_zero
    baseline_metrics = metrics(actual, baseline_predictions)
    model_metrics = {"mae": 0.0, "rmse": 0.0, "rankCorrelation": 0.0}
    cross_rank = 0.0
    improvement = 0.0
    interval_coverage = 0.0
    interval_width = 0.0
    portable = None
    model_kind = "ridge"
    challenger_validation: list[dict[str, Any]] = []
    final_model = None
    residual_lower = 0.0
    residual_upper = 0.0
    if len(train) >= 100 and len(test) >= 20:
        model_fit, calibration, calibration_start = calibration_split(train, horizon)
        if len(calibration):
            validation_actual = calibration["target_return"].to_numpy(float)
            for kind in ("ridge", "hist-gradient"):
                candidate = fit_model(model_fit, kind)
                validation_prediction = predict_returns(candidate, calibration)
                validation_metrics = metrics(validation_actual, validation_prediction)
                challenger_validation.append({"kind": kind, "metrics": validation_metrics})
            model_kind = min(challenger_validation, key=lambda item: (item["metrics"]["mae"], item["kind"]))["kind"]
            calibration_model = fit_model(model_fit, model_kind)
            calibration_predictions = predict_returns(calibration_model, calibration)
            interval_residuals = validation_actual - calibration_predictions
        else:
            calibration_start = None
            interval_residuals = np.array([])
        evaluation_model = fit_model(train, model_kind)
        predicted = predict_returns(evaluation_model, test)
        model_metrics = metrics(actual, predicted)
        cross_rank = cross_section_rank(test, predicted)
        improvement = (
            (baseline_metrics["mae"] - model_metrics["mae"]) / baseline_metrics["mae"]
            if baseline_metrics["mae"] else 0.0
        )
        if len(interval_residuals) < 20:
            train_predictions = predict_returns(evaluation_model, train)
            interval_residuals = train["target_return"].to_numpy(float) - train_predictions
        residuals = interval_residuals
        residual_lower = float(np.quantile(residuals, 0.10))
        residual_upper = float(np.quantile(residuals, 0.90))
        lower = predicted + residual_lower
        upper = predicted + residual_upper
        interval_coverage = float(np.mean((actual >= lower) & (actual <= upper)))
        interval_width = float(np.mean(upper - lower))
        final_model = fit_model(frame, model_kind)
        portable = portable_model(final_model, model_kind)

    minimum_rows = {30: 6_000, 90: 4_000, 180: 2_000, 365: 1_000}[horizon]
    minimum_heldout = {30: 800, 90: 500, 180: 300, 365: 150}[horizon]
    minimum_dates = {30: 24, 90: 18, 180: 12, 365: 8}[horizon]
    gates = [
        gate("rows", "Time-safe labeled rows", rows >= minimum_rows, rows, f">= {minimum_rows}"),
        gate("assets", "Distinct tracked assets", source_assets >= 200, source_assets, ">= 200"),
        gate("anchorDates", "Distinct weekly anchors", anchor_dates >= minimum_dates, anchor_dates, f">= {minimum_dates}"),
        gate("heldout", "Later embargoed holdout rows", len(test) >= minimum_heldout, len(test), f">= {minimum_heldout}"),
        gate("heldoutAssets", "Later holdout assets", heldout_assets >= 150, heldout_assets, ">= 150"),
        gate("trainSpan", "Training-anchor span", train_span >= max(60, horizon), train_span, f">= {max(60, horizon)} days"),
        gate("mae", "MAE lift over best simple baseline", improvement >= 0.02, improvement, ">= 2%"),
        gate("rank", "Median held-out cross-sectional rank", cross_rank >= 0.05, cross_rank, ">= 0.05"),
        gate("interval", "Held-out 80% interval calibration", 0.70 <= interval_coverage <= 0.90, interval_coverage, "70%–90%"),
    ]
    validated = bool(portable) and all(item["passed"] for item in gates)
    data_ready = bool(portable) and all(item["passed"] for item in gates[:6])
    current = current_feature_frame(histories, metadata_by_id, observed)
    if final_model is not None and not current.empty:
        current_predictions = predict_returns(final_model, current)
        current_lower = current_predictions + residual_lower
        current_upper = current_predictions + residual_upper
    else:
        current_predictions = np.array([])
        current_lower = np.array([])
        current_upper = np.array([])
    health = {
        "format": f"{num_qbs}qb",
        "horizonDays": horizon,
        "target": "same-asset later FantasyCalc market-value percentage return",
        "status": "validated" if validated else "shadow" if data_ready else "needs-data",
        "enabled": validated,
        "rows": rows,
        "assets": source_assets,
        "anchorDates": anchor_dates,
        "trainingRows": len(train),
        "testRows": len(test),
        "heldoutAssets": heldout_assets,
        "trainSpanDays": train_span,
        "split": split,
        "calibrationStart": calibration_start if len(train) >= 100 and len(test) >= 20 else None,
        "selectedModel": model_kind,
        "challengerValidation": challenger_validation,
        "baselineName": baseline_name,
        "baseline": baseline_metrics,
        "zeroReturnBaseline": zero_metrics,
        "cohortBaseline": cohort_metrics,
        "modelMetrics": model_metrics,
        "maeImprovement": improvement,
        "crossSectionRankCorrelation": cross_rank,
        "interval": {"targetCoverage": 0.80, "heldoutCoverage": interval_coverage, "meanWidth": interval_width},
        "model": portable,
        "cohorts": cohort_summaries(frame),
        "gates": gates,
    }
    return TrainedHorizon(health, current, current_predictions, current_lower, current_upper)


def source_audit(
    catalog: list[dict[str, Any]],
    histories_by_qb: dict[int, dict[int, History]],
    metadata_by_id: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    current_ids = {
        int(item["player"]["id"])
        for item in catalog
        if isinstance(item, dict) and isinstance(item.get("player"), dict) and item["player"].get("id") is not None
    }
    observed_ids = set().union(*(set(histories) for histories in histories_by_qb.values()))
    formats = []
    for num_qbs, histories in histories_by_qb.items():
        usable = [history for asset_id, history in histories.items() if asset_id in metadata_by_id and len(history.dates) >= 2]
        gaps = []
        spans = []
        observations = []
        for history in usable:
            spans.append((history.dates[-1] - history.dates[0]).days)
            observations.append(len(history.dates))
            gaps.extend((history.dates[index] - history.dates[index - 1]).days for index in range(1, len(history.dates)))
        formats.append({
            "format": f"{num_qbs}qb",
            "series": len(usable),
            "currentCatalogCoverage": len(current_ids & set(histories)) / len(current_ids) if current_ids else 0.0,
            "medianSpanDays": float(statistics.median(spans)) if spans else 0.0,
            "medianObservations": float(statistics.median(observations)) if observations else 0.0,
            "medianGapDays": float(statistics.median(gaps)) if gaps else 0.0,
        })
    digest_rows = []
    for num_qbs, histories in histories_by_qb.items():
        for asset_id, history in histories.items():
            if not history.dates:
                continue
            digest_rows.append(f"{num_qbs}:{asset_id}:{history.dates[0]}:{history.dates[-1]}:{len(history.dates)}")
    dataset_id = "sha256:" + hashlib.sha256("\n".join(sorted(digest_rows)).encode("utf-8")).hexdigest()
    return {
        "datasetId": dataset_id,
        "currentCatalogAssets": len(current_ids),
        "historyAssets": len(observed_ids),
        "tradeObservedAssetsOutsideCurrentCatalog": len(observed_ids - current_ids),
        "formats": formats,
        "populationBoundary": "Current FantasyCalc catalog plus assets observed in the locally collected completed-trade tape.",
        "survivorWarning": "The source does not provide a versioned full historical catalog. Failure/disappearance risk is therefore not complete and is never folded into a false confidence score.",
    }


def asset_risk(history: History, observed: date) -> dict[str, Any]:
    values_30 = history_window(history, observed - timedelta(days=30), observed)
    values_90 = history_window(history, observed - timedelta(days=90), observed)
    values_180 = history_window(history, observed - timedelta(days=180), observed)
    start_30 = history_value(history, observed - timedelta(days=30), tolerance=7)
    start_90 = history_value(history, observed - timedelta(days=90), tolerance=7)
    latest = history_value(history, observed, tolerance=7)
    return {
        "observed30dReturn": percent_return(start_30, latest),
        "observed90dReturn": percent_return(start_90, latest),
        "monthlyVolatility30d": volatility(values_30),
        "maxDrawdown90d": max_drawdown(values_90),
        "maxDrawdown180d": max_drawdown(values_180),
        "observations180d": len(values_180),
    }


def current_catalog_by_id(catalog: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    result = {}
    for item in catalog:
        player = item.get("player") if isinstance(item, dict) else None
        if not isinstance(player, dict) or player.get("id") is None:
            continue
        try:
            result[int(player["id"])] = item
        except (TypeError, ValueError):
            continue
    return result


def build_asset_artifact(
    *,
    catalog: list[dict[str, Any]],
    histories_by_qb: dict[int, dict[int, History]],
    metadata_by_id: dict[int, dict[str, Any]],
    trained: list[TrainedHorizon],
    observed: date,
) -> dict[str, Any]:
    catalog_by_id = current_catalog_by_id(catalog)
    assets: dict[str, Any] = {}
    for result in trained:
        num_qbs = int(result.health["format"][0])
        enabled = bool(result.health["enabled"])
        for index, row in result.current.reset_index(drop=True).iterrows():
            asset_id = int(row["asset_id"])
            metadata = metadata_by_id.get(asset_id, {})
            catalog_item = catalog_by_id.get(asset_id, {})
            player = catalog_item.get("player") if isinstance(catalog_item.get("player"), dict) else metadata
            key = stable_asset_key(num_qbs, asset_id)
            entry = assets.setdefault(key, {
                "fantasyCalcId": asset_id,
                "sleeperId": player.get("sleeperId"),
                "name": str(player.get("name") or metadata.get("name") or f"Asset {asset_id}"),
                "position": str(player.get("position") or metadata.get("position") or "NA"),
                "format": f"{num_qbs}qb",
                "currentValue": finite(catalog_item.get("value"), finite(row["value"])),
                "overallRank": int(finite(catalog_item.get("overallRank"), 0)) or None,
                "age": observed_age(metadata, observed),
                "tradeFrequency": finite(catalog_item.get("maybeTradeFrequency"), 0.0) or None,
                "consensusVariancePercent": finite(catalog_item.get("maybeMovingStandardDeviationPerc"), 0.0) or None,
                "risk": asset_risk(histories_by_qb[num_qbs][asset_id], observed),
                "horizons": {},
            })
            prediction = finite(result.predictions[index]) if index < len(result.predictions) else None
            lower = finite(result.lower[index]) if index < len(result.lower) else None
            upper = finite(result.upper[index]) if index < len(result.upper) else None
            horizon_entry: dict[str, Any] = {
                "status": result.health["status"],
                "enabled": enabled,
            }
            if enabled and prediction is not None and lower is not None and upper is not None:
                horizon_entry.update({
                    "expectedReturn": round(prediction, 6),
                    "trackedAssetLower": round(lower, 6),
                    "trackedAssetUpper": round(upper, 6),
                })
            entry["horizons"][str(result.health["horizonDays"])] = horizon_entry
    return assets


def report_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Asset return model health",
        "",
        f"Generated: `{report['generatedAt']}`",
        f"History dataset: `{report['sourceAudit']['datasetId']}`",
        "",
        "This model forecasts later FantasyCalc market-value return. It does not overwrite current price, predict manager acceptance, or turn a tracked-asset interval into complete failure risk.",
        "",
        "## Historical source audit",
        "",
    ]
    for item in report["sourceAudit"]["formats"]:
        lines.append(
            f"- {item['format']}: {item['series']} series, {item['medianSpanDays']:.0f}-day median span, "
            f"{item['medianGapDays']:.1f}-day median gap, {item['currentCatalogCoverage']:.1%} current-catalog coverage."
        )
    lines.extend(["", "## Chronological horizon models", ""])
    for item in report["models"]:
        lines.append(
            f"- {item['format']} {item['horizonDays']}d: **{item['status']}**, {item['rows']} rows / "
            f"{item['testRows']} embargoed holdout; MAE lift {item['maeImprovement']:.1%}; "
            f"cross-sectional rank {item['crossSectionRankCorrelation']:.3f}."
        )
    lines.extend([
        "",
        "## Population boundary",
        "",
        report["sourceAudit"]["populationBoundary"],
        "",
        report["sourceAudit"]["survivorWarning"],
        "",
        f"Sources: {FAQ}, {TERMS}",
        "",
    ])
    return "\n".join(lines)


def train(offline: bool = True) -> dict[str, Any]:
    ensure_dirs()
    catalog = load_current(offline=offline)
    trades = load_all_trades()
    metadata_by_id = asset_metadata(catalog, trades)
    histories_by_qb = {num_qbs: load_histories(num_qbs) for num_qbs in (1, 2)}
    latest_dates = [history.dates[-1] for histories in histories_by_qb.values() for history in histories.values() if history.dates]
    observed = max(latest_dates) if latest_dates else datetime.now(timezone.utc).date()
    trained = [
        train_horizon(
            num_qbs=num_qbs,
            horizon=horizon,
            histories=histories_by_qb[num_qbs],
            metadata_by_id=metadata_by_id,
            observed=observed,
        )
        for num_qbs in (1, 2)
        for horizon in HORIZONS
    ]
    audit = source_audit(catalog, histories_by_qb, metadata_by_id)
    report = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "dataAsOf": observed.isoformat(),
        "source": {
            "name": "FantasyCalc daily dynasty value history",
            "methodology": FAQ,
            "terms": TERMS,
            "attribution": "FantasyCalc",
            "predictionBoundary": "Same-source tracked-asset market return; not fantasy points, profit certainty, or manager acceptance.",
        },
        "sourceAudit": audit,
        "models": [item.health for item in trained],
        "assets": build_asset_artifact(
            catalog=catalog,
            histories_by_qb=histories_by_qb,
            metadata_by_id=metadata_by_id,
            trained=trained,
            observed=observed,
        ),
    }
    write_json(PROCESSED / "health.json", report)
    audit_report = {key: value for key, value in report.items() if key != "assets"}
    audit_report["assetForecastCount"] = len(report["assets"])
    write_json(REPORT_JSON, audit_report)
    write_compact_json(PUBLIC_JSON, report)
    REPORT_MD.write_text(report_markdown(report))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("train",))
    parser.add_argument("--offline", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = train(offline=args.offline)
    print(json.dumps({
        "dataAsOf": report["dataAsOf"],
        "datasetId": report["sourceAudit"]["datasetId"],
        "models": [
            {
                "format": item["format"],
                "horizon": item["horizonDays"],
                "status": item["status"],
                "rows": item["rows"],
                "testRows": item["testRows"],
                "maeLift": item["maeImprovement"],
            }
            for item in report["models"]
        ],
    }, indent=2))


if __name__ == "__main__":
    main()

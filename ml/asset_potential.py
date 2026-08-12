#!/usr/bin/env python3
"""Audit and test long-horizon forward FantasyCalc market value.

This is a bounded, offline experiment for 180- and 365-day returns. It reuses
the existing asset-return identity and label contract, but keeps its stronger
baseline/challenger comparison separate so an experiment cannot disturb the
promoted 30-day artifact. No output from this module is browser-consumable and
no horizon is promoted while the historical failure population is incomplete.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

try:
    from ml.asset_returns import (
        asset_metadata,
        build_examples_for_format,
        chronological_split,
        metrics,
        cross_section_rank,
    )
    from ml.trade_models import (
        FAQ,
        TERMS,
        HISTORIES,
        load_all_trades,
        load_current,
        load_histories,
        utc_now,
    )
except ImportError:  # Direct ``python ml/asset_potential.py`` execution.
    from asset_returns import (  # type: ignore[no-redef]
        build_examples_for_format,
        chronological_split,
        metrics,
        cross_section_rank,
        asset_metadata,
    )
    from trade_models import (  # type: ignore[no-redef]
        FAQ,
        TERMS,
        HISTORIES,
        load_all_trades,
        load_current,
        load_histories,
        utc_now,
    )


ROOT = Path(__file__).resolve().parents[1]
NFLVERSE = ROOT / "data" / "raw" / "nflverse"
REPORT_JSON = ROOT / "ml" / "reports" / "asset-potential-health.json"
REPORT_MD = ROOT / "ml" / "reports" / "asset-potential-health.md"
LEDGER_MD = ROOT / "ml" / "reports" / "asset-potential-complexity-ledger.md"
HORIZONS = (180, 365)

PATH_FEATURES = [
    "log_value", "market_percentile", "position_percentile",
    "is_qb", "is_rb", "is_wr", "is_te", "is_pick",
    "return_7d", "return_30d", "volatility_30d", "max_drawdown_30d",
    "pick_years_away",
]
LIFECYCLE_FEATURES = [
    *PATH_FEATURES,
    "age", "age_missing", "experience", "experience_missing", "is_rookie",
    "draft_round", "draft_pick", "draft_missing",
    "phase_preseason", "phase_regular", "phase_postseason",
]
FUNDAMENTAL_FEATURES = [
    *LIFECYCLE_FEATURES,
    "prior_ppg", "prior_games", "prior_availability",
    "prior_opportunities_pg", "fundamentals_missing",
]
FEATURE_FAMILIES = {
    "spot-and-path": PATH_FEATURES,
    "lifecycle-and-capital": LIFECYCLE_FEATURES,
    "football-fundamentals": FUNDAMENTAL_FEATURES,
}


def completed_season_available_at(anchor: date) -> int:
    """March is the conservative availability boundary for prior NFL season data."""
    return anchor.year - 1 if anchor.month >= 3 else anchor.year - 2


def _number(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def _identifier(value: Any) -> str:
    compact = str(value or "").strip()
    return compact[:-2] if compact.endswith(".0") and compact[:-2].isdigit() else compact


def _read_csv(path: Path, usecols: list[str] | None = None) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, usecols=usecols, low_memory=False)


def load_football_fundamentals() -> tuple[dict[tuple[str, int], dict[str, float]], dict[str, str], dict[str, Any]]:
    """Load season-complete production and an observed Sleeper-to-GSIS join."""
    sleeper_to_gsis: dict[str, str] = {}
    roster_rows = 0
    for path in sorted(NFLVERSE.glob("roster_weekly_*.csv")):
        frame = _read_csv(path, ["sleeper_id", "gsis_id"])
        if frame.empty:
            continue
        frame = frame.dropna(subset=["sleeper_id", "gsis_id"])
        roster_rows += len(frame)
        for row in frame.itertuples(index=False):
            sleeper_to_gsis[_identifier(row.sleeper_id)] = _identifier(row.gsis_id)

    summaries: dict[tuple[str, int], dict[str, float]] = {}
    source_rows = 0
    seasons: list[int] = []
    columns = [
        "player_id", "position", "season", "week", "season_type",
        "attempts", "carries", "targets", "fantasy_points_ppr",
    ]
    for path in sorted(NFLVERSE.glob("player_stats_*.csv")):
        frame = _read_csv(path, columns)
        if frame.empty:
            continue
        frame = frame[(frame["season_type"] == "REG") & frame["position"].isin(["QB", "RB", "WR", "TE"])].copy()
        if frame.empty:
            continue
        frame[["attempts", "carries", "targets", "fantasy_points_ppr"]] = frame[[
            "attempts", "carries", "targets", "fantasy_points_ppr",
        ]].fillna(0)
        source_rows += len(frame)
        seasons.extend(int(value) for value in frame["season"].unique())
        for (player_id, season), group in frame.groupby(["player_id", "season"], sort=False):
            games = int(group["week"].nunique())
            position = str(group["position"].mode().iat[0])
            attempts = float(group["attempts"].sum())
            carries = float(group["carries"].sum())
            targets = float(group["targets"].sum())
            opportunities = attempts + carries if position == "QB" else carries + targets
            summaries[(_identifier(player_id), int(season))] = {
                "prior_ppg": float(group["fantasy_points_ppr"].sum()) / games if games else 0.0,
                "prior_games": float(games),
                "prior_availability": min(1.0, games / 18),
                "prior_opportunities_pg": opportunities / games if games else 0.0,
            }
    audit = {
        "provider": "nflverse",
        "rosterRows": roster_rows,
        "sleeperToGsisPlayers": len(sleeper_to_gsis),
        "productionRows": source_rows,
        "seasons": sorted(set(seasons)),
        "availabilityBoundary": "Only season-complete production is eligible; season Y becomes available to anchors on March 1 of Y+1.",
    }
    return summaries, sleeper_to_gsis, audit


def _draft_fields(metadata: dict[str, Any], anchor: date) -> dict[str, float]:
    draft = metadata.get("maybeDraftInfo") if isinstance(metadata.get("maybeDraftInfo"), dict) else {}
    draft_year = int(_number(draft.get("year"), 0))
    draft_round = _number(draft.get("round"), 0)
    draft_pick = _number(draft.get("pick"), 0)
    draft_capital_known = bool(draft_year and (draft_year < anchor.year or (draft_year == anchor.year and anchor.month >= 5)))
    experience = max(0, anchor.year - draft_year) if draft_year else 0
    return {
        "experience": float(experience),
        "experience_missing": float(not draft_year),
        "is_rookie": float(bool(draft_year and anchor.year == draft_year)),
        "draft_round": draft_round if draft_capital_known else 0.0,
        "draft_pick": draft_pick if draft_capital_known else 0.0,
        "draft_missing": float(not draft_capital_known),
    }


def augment_point_in_time_features(
    frame: pd.DataFrame,
    metadata_by_id: dict[int, dict[str, Any]],
    fundamentals: dict[tuple[str, int], dict[str, float]],
    sleeper_to_gsis: dict[str, str],
) -> pd.DataFrame:
    """Add only features reproducible from each row's prediction anchor."""
    if frame.empty:
        return frame.copy()
    rows: list[dict[str, Any]] = []
    for raw in frame.to_dict("records"):
        anchor = date.fromisoformat(str(raw["date"]))
        metadata = metadata_by_id.get(int(raw["asset_id"]), {})
        phase = "regular" if 9 <= anchor.month <= 12 else "postseason" if anchor.month <= 2 else "preseason"
        sleeper_id = _identifier(metadata.get("sleeperId"))
        gsis_id = sleeper_to_gsis.get(sleeper_id, "")
        prior_season = completed_season_available_at(anchor)
        production = fundamentals.get((gsis_id, prior_season))
        rows.append({
            **raw,
            **_draft_fields(metadata, anchor),
            "phase_preseason": float(phase == "preseason"),
            "phase_regular": float(phase == "regular"),
            "phase_postseason": float(phase == "postseason"),
            "prior_ppg": production["prior_ppg"] if production else 0.0,
            "prior_games": production["prior_games"] if production else 0.0,
            "prior_availability": production["prior_availability"] if production else 0.0,
            "prior_opportunities_pg": production["prior_opportunities_pg"] if production else 0.0,
            "fundamentals_missing": float(production is None),
            "fundamentals_season": prior_season,
        })
    return pd.DataFrame(rows)


def _raw_history_path(asset_id: int, num_qbs: int, history_root: Path = HISTORIES) -> Path | None:
    primary = history_root / f"{num_qbs}qb" / f"{asset_id}.json"
    if primary.exists():
        return primary
    legacy = history_root / f"{asset_id}.json"
    return legacy if num_qbs == 2 and legacy.exists() else None


def audit_failure_population(
    catalog: list[dict[str, Any]],
    metadata_by_id: dict[int, dict[str, Any]],
    history_root: Path = HISTORIES,
) -> dict[str, Any]:
    """Measure what the provider tape can and cannot say about disappearances."""
    current_ids = {
        int(item["player"]["id"])
        for item in catalog
        if isinstance(item, dict) and isinstance(item.get("player"), dict) and item["player"].get("id") is not None
    }
    rows = []
    for num_qbs in (1, 2):
        positive_series = outside_series = terminal_zero = outside_terminal_zero = 0
        for asset_id in metadata_by_id:
            path = _raw_history_path(asset_id, num_qbs, history_root)
            if not path:
                continue
            try:
                payload = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            points = payload if isinstance(payload, list) else []
            values = [_number(point.get("value"), 0) for point in points if isinstance(point, dict)]
            positive_indexes = [index for index, value in enumerate(values) if value > 0]
            if not positive_indexes:
                continue
            positive_series += 1
            outside = asset_id not in current_ids
            outside_series += int(outside)
            has_terminal_zero = any(value <= 0 for value in values[positive_indexes[-1] + 1:])
            terminal_zero += int(has_terminal_zero)
            outside_terminal_zero += int(outside and has_terminal_zero)
        rows.append({
            "format": f"{num_qbs}qb",
            "positiveHistorySeries": positive_series,
            "outsideCurrentCatalogSeries": outside_series,
            "seriesWithZeroAfterPositiveValue": terminal_zero,
            "outsideCatalogSeriesWithZeroAfterPositiveValue": outside_terminal_zero,
        })
    return {
        "currentCatalogAssets": len(current_ids),
        "metadataPopulationAssets": len(metadata_by_id),
        "formats": rows,
        "versionedHistoricalCatalogAvailable": False,
        "observedTerminalZerosEligibleAsLabels": False,
        "disappearanceMeaning": "A zero after a positive provider value is observable, but the source does not document it as retirement, delisting, or career failure.",
        "populationBoundary": "Current FantasyCalc catalog plus assets recovered from the locally cached completed-trade tape.",
        "promotionBlocked": True,
        "blockReason": "No versioned full historical catalog exists, and the reusable log-return label contract excludes terminal zero outcomes. Historical failures and delistings therefore cannot be represented completely.",
    }


def _fit(frame: pd.DataFrame, features: list[str], kind: str) -> Any:
    if kind == "ridge":
        model: Any = Pipeline([("scale", StandardScaler()), ("ridge", Ridge(alpha=10.0))])
    else:
        model = HistGradientBoostingRegressor(
            loss="absolute_error", learning_rate=0.05, max_iter=160,
            max_leaf_nodes=15, min_samples_leaf=30, l2_regularization=1.0,
            random_state=11,
        )
    model.fit(frame[features].to_numpy(float), frame["target_log_return"].to_numpy(float))
    return model


def _predict(model: Any, frame: pd.DataFrame, features: list[str]) -> np.ndarray:
    if frame.empty:
        return np.array([])
    return np.expm1(np.clip(model.predict(frame[features].to_numpy(float)), math.log(0.02), math.log(7.0)))


def _value_boundaries(train: pd.DataFrame) -> list[float]:
    return [float(train["log_value"].quantile(value)) for value in (0.2, 0.4, 0.6, 0.8)] if len(train) else []


def _bands(frame: pd.DataFrame, boundaries: list[float]) -> pd.Series:
    return frame["log_value"].map(lambda value: int(np.searchsorted(boundaries, float(value), side="right")))


def _cohort_prediction(train: pd.DataFrame, target: pd.DataFrame, lifecycle: bool) -> np.ndarray:
    if train.empty or target.empty:
        return np.zeros(len(target))
    boundaries = _value_boundaries(train)
    reference = train.copy()
    reference["value_band"] = _bands(reference, boundaries)
    target_work = target.copy()
    target_work["value_band"] = _bands(target_work, boundaries)
    keys = ["position", "value_band", "is_rookie"] if lifecycle else ["value_band"]
    grouped = reference.groupby(keys)["target_return"].median().to_dict()
    fallback = float(reference["target_return"].median())
    result = []
    for row in target_work.itertuples():
        key: Any = (row.position, row.value_band, row.is_rookie) if lifecycle else row.value_band
        result.append(_number(grouped.get(key), fallback))
    return np.array(result)


def simple_baselines(train: pd.DataFrame, target: pd.DataFrame) -> dict[str, np.ndarray]:
    return {
        "zero-return": np.zeros(len(target)),
        "market-rank-cohort": _cohort_prediction(train, target, False),
        "lifecycle-cohort": _cohort_prediction(train, target, True),
        "30-day-continuation": np.clip(target["return_30d"].to_numpy(float), -0.90, 3.0),
        "30-day-reversion": np.clip(-0.5 * target["return_30d"].to_numpy(float), -0.90, 3.0),
    }


def _selection_split(frame: pd.DataFrame, horizon: int) -> tuple[pd.DataFrame, pd.DataFrame, str | None]:
    dates = sorted(frame["date"].unique()) if len(frame) else []
    if len(dates) < 8:
        return frame.iloc[0:0], frame.iloc[0:0], None
    start = str(dates[max(1, math.floor(len(dates) * 0.80))])
    fit = frame[frame["label_date"] < start].copy()
    selection = frame[frame["date"] >= start].copy()
    if len(fit) < 300 or len(selection) < 100:
        return frame.iloc[0:0], frame.iloc[0:0], None
    return fit, selection, start


def _slice_regressions(test: pd.DataFrame, actual: np.ndarray, model: np.ndarray, baseline: np.ndarray) -> dict[str, Any]:
    working = test[["position", "market_percentile", "is_rookie"]].copy()
    working["actual"] = actual
    working["model"] = model
    working["baseline"] = baseline
    working["valueTier"] = pd.cut(working["market_percentile"], [0, .33, .67, 1.01], labels=["lower", "middle", "upper"])
    slices = []
    for dimension in ("position", "valueTier", "is_rookie"):
        for key, group in working.groupby(dimension, observed=True):
            if len(group) < 30:
                continue
            baseline_mae = float(np.mean(np.abs(group["actual"] - group["baseline"])))
            model_mae = float(np.mean(np.abs(group["actual"] - group["model"])))
            regression = (model_mae - baseline_mae) / baseline_mae if baseline_mae else 0.0
            slices.append({"dimension": dimension, "value": str(key), "rows": len(group), "regression": regression})
    worst = max((item["regression"] for item in slices), default=0.0)
    return {"worstRegression": worst, "slices": slices}


def _period_stability(test: pd.DataFrame, actual: np.ndarray, model: np.ndarray, baseline: np.ndarray) -> dict[str, Any]:
    working = test[["date"]].copy()
    working["period"] = working["date"].str[:7]
    working["actual"] = actual
    working["model"] = model
    working["baseline"] = baseline
    periods = []
    for period, group in working.groupby("period"):
        baseline_mae = float(np.mean(np.abs(group["actual"] - group["baseline"])))
        model_mae = float(np.mean(np.abs(group["actual"] - group["model"])))
        improvement = (baseline_mae - model_mae) / baseline_mae if baseline_mae else 0.0
        periods.append({"period": period, "rows": len(group), "maeImprovement": improvement})
    win_rate = sum(item["maeImprovement"] > 0 for item in periods) / len(periods) if periods else 0.0
    return {"periods": periods, "positivePeriodRate": win_rate}


def evaluate_experiment(
    frame: pd.DataFrame,
    horizon: int,
    format_name: str,
    population_audit: dict[str, Any],
) -> dict[str, Any]:
    train, test, split = chronological_split(frame, horizon)
    fit, selection, selection_start = _selection_split(train, horizon)
    train_span = (
        (date.fromisoformat(str(train["date"].max())) - date.fromisoformat(str(train["date"].min()))).days
        if len(train) else 0
    )
    result: dict[str, Any] = {
        "format": format_name,
        "horizonDays": horizon,
        "target": "same-source FantasyCalc log market return",
        "status": "needs-data",
        "enabled": False,
        "rows": len(frame),
        "assets": int(frame["asset_id"].nunique()) if len(frame) else 0,
        "anchorDates": int(frame["date"].nunique()) if len(frame) else 0,
        "trainingRows": len(train),
        "testRows": len(test),
        "trainSpanDays": train_span,
        "split": split,
        "selectionStart": selection_start,
        "featureAvailability": {
            "fundamentalsCoverage": float(1 - frame["fundamentals_missing"].mean()) if len(frame) else 0.0,
        },
        "selectedBaseline": None,
        "selectedChallenger": None,
        "selection": [],
        "baselineMetrics": None,
        "challengerMetrics": None,
        "maeImprovement": 0.0,
        "crossSectionRankCorrelation": 0.0,
        "interval": {"targetCoverage": 0.80, "heldoutCoverage": 0.0, "meanWidth": 0.0},
        "sliceAudit": {"worstRegression": 0.0, "slices": []},
        "stability": {"periods": [], "positivePeriodRate": 0.0},
        "gates": [],
    }
    if fit.empty or selection.empty or test.empty:
        result["gates"] = [
            {"id": "population", "passed": not population_audit["promotionBlocked"], "actual": 0, "requirement": "versioned complete historical catalog"},
            {"id": "rows", "passed": len(frame) >= 2_000, "actual": len(frame), "requirement": ">= 2,000"},
            {"id": "assets", "passed": frame["asset_id"].nunique() >= 200 if len(frame) else False, "actual": int(frame["asset_id"].nunique()) if len(frame) else 0, "requirement": ">= 200"},
            {"id": "holdout", "passed": len(test) >= 300, "actual": len(test), "requirement": ">= 300"},
            {"id": "trainSpan", "passed": train_span >= horizon, "actual": train_span, "requirement": f">= {horizon} days"},
            {"id": "selectionWindow", "passed": False, "actual": len(selection), "requirement": ">= 100 pre-holdout rows with label embargo"},
        ]
        return result

    selection_actual = selection["target_return"].to_numpy(float)
    baseline_rows = []
    for name, prediction in simple_baselines(fit, selection).items():
        baseline_rows.append({"name": name, "metrics": metrics(selection_actual, prediction)})
    selected_baseline = min(baseline_rows, key=lambda item: (item["metrics"]["mae"], item["name"]))["name"]
    challenger_rows = []
    for family, features in FEATURE_FAMILIES.items():
        for kind in ("ridge", "hist-gradient"):
            model = _fit(fit, features, kind)
            prediction = _predict(model, selection, features)
            challenger_rows.append({"family": family, "kind": kind, "metrics": metrics(selection_actual, prediction)})
    selected = min(challenger_rows, key=lambda item: (item["metrics"]["mae"], item["family"], item["kind"]))
    features = FEATURE_FAMILIES[selected["family"]]
    baseline_prediction = simple_baselines(train, test)[selected_baseline]
    actual = test["target_return"].to_numpy(float)
    model = _fit(train, features, selected["kind"])
    prediction = _predict(model, test, features)
    baseline_metrics = metrics(actual, baseline_prediction)
    challenger_metrics = metrics(actual, prediction)
    improvement = (baseline_metrics["mae"] - challenger_metrics["mae"]) / baseline_metrics["mae"] if baseline_metrics["mae"] else 0.0

    calibration_model = _fit(fit, features, selected["kind"])
    calibration_prediction = _predict(calibration_model, selection, features)
    residuals = selection_actual - calibration_prediction
    lower_residual = float(np.quantile(residuals, .10))
    upper_residual = float(np.quantile(residuals, .90))
    lower = prediction + lower_residual
    upper = prediction + upper_residual
    interval_coverage = float(np.mean((actual >= lower) & (actual <= upper)))
    interval_width = float(np.mean(upper - lower))
    slices = _slice_regressions(test, actual, prediction, baseline_prediction)
    stability = _period_stability(test, actual, prediction, baseline_prediction)
    gates = [
        {"id": "population", "passed": not population_audit["promotionBlocked"], "actual": 0, "requirement": "versioned complete historical catalog"},
        {"id": "rows", "passed": len(frame) >= 2_000, "actual": len(frame), "requirement": ">= 2,000"},
        {"id": "assets", "passed": frame["asset_id"].nunique() >= 200, "actual": int(frame["asset_id"].nunique()), "requirement": ">= 200"},
        {"id": "holdout", "passed": len(test) >= 300, "actual": len(test), "requirement": ">= 300"},
        {"id": "trainSpan", "passed": train_span >= horizon, "actual": train_span, "requirement": f">= {horizon} days"},
        {"id": "mae", "passed": improvement >= .02, "actual": improvement, "requirement": ">= 2% over selected pre-holdout baseline"},
        {"id": "rank", "passed": cross_section_rank(test, prediction) >= .05, "actual": cross_section_rank(test, prediction), "requirement": ">= 0.05"},
        {"id": "interval", "passed": .70 <= interval_coverage <= .90, "actual": interval_coverage, "requirement": "70%-90%"},
        {"id": "slices", "passed": slices["worstRegression"] <= .05, "actual": slices["worstRegression"], "requirement": "<= 5% worst material-slice MAE regression"},
        {"id": "stability", "passed": stability["positivePeriodRate"] >= .60, "actual": stability["positivePeriodRate"], "requirement": ">= 60% positive holdout periods"},
    ]
    validated = all(item["passed"] for item in gates)
    data_ready = all(item["passed"] for item in gates[1:5])
    result.update({
        "status": "validated" if validated else "shadow" if data_ready else "needs-data",
        "enabled": validated,
        "selectedBaseline": selected_baseline,
        "selectedChallenger": {"family": selected["family"], "kind": selected["kind"], "features": features},
        "selection": {"baselines": baseline_rows, "challengers": challenger_rows},
        "baselineMetrics": baseline_metrics,
        "challengerMetrics": challenger_metrics,
        "maeImprovement": improvement,
        "crossSectionRankCorrelation": cross_section_rank(test, prediction),
        "interval": {"targetCoverage": .80, "heldoutCoverage": interval_coverage, "meanWidth": interval_width},
        "sliceAudit": slices,
        "stability": stability,
        "gates": gates,
    })
    return result


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Asset potential experiment",
        "",
        f"Generated: `{report['generatedAt']}`",
        "",
        "This is an offline 180/365-day same-source return experiment. It cannot change current value, target order, packages, or trade recommendations.",
        "",
        "## Population audit",
        "",
        report["populationAudit"]["blockReason"],
        "",
    ]
    for row in report["populationAudit"]["formats"]:
        lines.append(
            f"- {row['format']}: {row['positiveHistorySeries']} positive series; "
            f"{row['outsideCurrentCatalogSeries']} outside the current catalog; "
            f"{row['outsideCatalogSeriesWithZeroAfterPositiveValue']} outside-catalog series with a later zero."
        )
    lines.extend(["", "## Experiments", ""])
    for experiment in report["experiments"]:
        failed = ", ".join(gate["id"] for gate in experiment["gates"] if not gate["passed"])
        lines.append(
            f"- {experiment['format']} {experiment['horizonDays']}d: **{experiment['status']}**; "
            f"{experiment['rows']} labeled rows / {experiment['trainingRows']} eligible training / "
            f"{experiment['testRows']} holdout; fundamentals coverage "
            f"{experiment['featureAvailability']['fundamentalsCoverage']:.1%}; "
            f"failed gates: {failed or 'none'}."
        )
    lines.extend([
        "",
        "## Decision",
        "",
        report["decision"]["reason"],
        "",
        f"Sources: {FAQ}, {TERMS}",
        "",
    ])
    return "\n".join(lines)


def render_ledger() -> str:
    return """# Asset potential complexity ledger

| Concern | Evidence | Class | Decision and exit trigger |
| --- | --- | --- | --- |
| Horizon-specific same-source return | Current-price and production evidence cannot answer hold-period repricing | Essential | Keep explicit 180/365 targets and independent gates |
| Historical FantasyCalc identity/value behavior | Provider format and catalog history are external constraints | Imported | Isolate in cached offline adapters and retain provenance |
| Complete failures and delistings | No versioned full historical catalog is currently available | Unknown | Block promotion; revisit only when a defensible population source exists |
| Long-horizon challenger beside the promoted 30-day pipeline | Reversible experiment needed without destabilizing live evidence | Transitional | Delete if it cannot beat the frozen baseline or merge only after a horizon promotes |
| A second online inference service or database | No runtime need exists | Accidental | Do not build |
| A universal potential score | No validated target or common unit exists | Accidental | Do not build; keep price, production, return, and risk separate |
"""


def run(offline: bool = True) -> dict[str, Any]:
    catalog = load_current(offline=offline)
    trades = load_all_trades()
    metadata_by_id = asset_metadata(catalog, trades)
    fundamentals, sleeper_to_gsis, football_audit = load_football_fundamentals()
    population = audit_failure_population(catalog, metadata_by_id)
    experiments = []
    for num_qbs in (1, 2):
        histories = load_histories(num_qbs)
        for horizon in HORIZONS:
            base = build_examples_for_format(num_qbs, histories, metadata_by_id, horizon)
            frame = augment_point_in_time_features(base, metadata_by_id, fundamentals, sleeper_to_gsis)
            experiments.append(evaluate_experiment(frame, horizon, f"{num_qbs}qb", population))
    report = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "source": {
            "market": "FantasyCalc daily dynasty value history",
            "football": "nflverse season-complete player stats",
            "target": "same-source log market return",
            "methodology": FAQ,
            "terms": TERMS,
        },
        "footballAudit": football_audit,
        "populationAudit": population,
        "experiments": experiments,
        "decision": {
            "anyEnabled": any(item["enabled"] for item in experiments),
            "browserArtifactWritten": False,
            "reason": (
                "At least one horizon passed every gate; a separate reviewed change is still required before browser export."
                if any(item["enabled"] for item in experiments)
                else "No long-horizon estimate may influence the application. The site must display unavailable evidence at unpromoted horizons."
            ),
        },
    }
    REPORT_JSON.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    REPORT_MD.write_text(render_markdown(report))
    LEDGER_MD.write_text(render_ledger())
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("audit",))
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    report = run(offline=args.offline)
    print(json.dumps({
        "anyEnabled": report["decision"]["anyEnabled"],
        "experiments": [
            {"format": row["format"], "horizon": row["horizonDays"], "status": row["status"]}
            for row in report["experiments"]
        ],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Backtested rookie production model used by the private draft evidence board.

The model predicts a prospect's position-relative rookie-season PPR percentile.
It does not predict a guaranteed fantasy outcome, a trade price, or a synthetic
player grade. Sleeper selection is evaluated on the exact decision rule used in
the current board: the eight highest predictions after rookie market rank 24.
"""

from __future__ import annotations

import math
import os
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")

from sklearn.ensemble import RandomForestRegressor

try:
    from ml.rookie_data import ATHLETIC_FEATURES, COLLEGE_FEATURES
except ModuleNotFoundError:  # Direct execution through ml/rookie_pipeline.py.
    from rookie_data import ATHLETIC_FEATURES, COLLEGE_FEATURES


POSITIONS = ("QB", "RB", "WR", "TE")
LATE_ROOKIE_RANK = 24
SLEEPER_BASKET_SIZE = 8
SENSITIVITY_BASKET_SIZES = (6, 8, 10, 12)
MIN_ROLLING_TRAIN_ROWS = 350
ENSEMBLE_SEEDS = (11, 23, 37, 53, 71)

MARKET_PRODUCTION_FEATURES = [
    "initial_market_percentile",
    "rookie_market_percentile",
    "anchor_market_present",
    *[f"pos_{position}" for position in POSITIONS],
]
CAPITAL_PRODUCTION_FEATURES = [
    *MARKET_PRODUCTION_FEATURES,
    "log_draft_pick",
    "drafted",
    "age",
    "height",
    "weight",
    "capital_market_gap",
]
PRODUCTION_FEATURES = [
    *CAPITAL_PRODUCTION_FEATURES,
    *COLLEGE_FEATURES,
    *ATHLETIC_FEATURES,
]


@dataclass(frozen=True)
class ProductionFold:
    rookie_year: int
    training_rows: int
    class_rows: int
    late_candidates: int
    model_basket_mean_percentile: float
    market_basket_mean_percentile: float
    draft_basket_mean_percentile: float
    capital_gap_basket_mean_percentile: float
    strongest_simple_baseline: str
    strongest_simple_baseline_mean_percentile: float
    lift_over_strongest_simple_baseline: float
    learned_capital_model_basket_mean_percentile: float
    lift_over_learned_capital_model: float
    model_basket: list[str]


@dataclass(frozen=True)
class ProductionBacktest:
    training_target: str
    target_meaning: str
    folds: list[ProductionFold]
    fold_count: int
    fold_wins: int
    exact_one_sided_sign_p_value: float | None
    mean_model_basket_percentile: float | None
    mean_strongest_simple_baseline_percentile: float | None
    mean_lift: float | None
    minimum_class_lift: float | None
    oof_rows: int
    model_mae: float | None
    market_only_model_mae: float | None
    capital_only_model_mae: float | None
    model_spearman: float | None
    market_only_model_spearman: float | None
    capital_only_model_spearman: float | None
    mean_lift_over_learned_capital_model: float | None
    learned_capital_model_class_wins: int
    residual_band_80: float | None
    basket_sensitivity: list[dict[str, Any]]
    sensitivity_passed: bool
    passed: bool


def _forest(seed: int) -> RandomForestRegressor:
    # Fixed before the current class is scored. Multiple deterministic seeds
    # reduce cutoff instability without hand-adjusting any player.
    return RandomForestRegressor(
        n_estimators=300,
        min_samples_leaf=6,
        max_features=0.5,
        random_state=seed,
        n_jobs=1,
    )


def fit_ensemble(
    frame: pd.DataFrame,
    features: list[str],
    target: str,
) -> list[RandomForestRegressor]:
    models = []
    for seed in ENSEMBLE_SEEDS:
        model = _forest(seed)
        model.fit(frame[features], frame[target])
        models.append(model)
    return models


def predict_ensemble(
    models: list[RandomForestRegressor],
    frame: pd.DataFrame,
    features: list[str],
) -> tuple[np.ndarray, np.ndarray]:
    predictions = np.vstack([model.predict(frame[features]) for model in models])
    return predictions.mean(axis=0), predictions.std(axis=0)


def sleeper_basket(
    frame: pd.DataFrame,
    prediction: np.ndarray,
    *,
    size: int = SLEEPER_BASKET_SIZE,
) -> pd.DataFrame:
    mask = frame["rookie_market_rank"].to_numpy() > LATE_ROOKIE_RANK
    candidates = frame.loc[mask].copy()
    candidates["prediction"] = prediction[mask]
    return candidates.sort_values(
        ["prediction", "rookie_market_rank", "name"],
        ascending=[False, True, True],
    ).head(size)


def simple_baseline_baskets(
    frame: pd.DataFrame,
    *,
    size: int = SLEEPER_BASKET_SIZE,
) -> dict[str, pd.DataFrame]:
    candidates = frame[frame["rookie_market_rank"] > LATE_ROOKIE_RANK].copy()
    return {
        "market": candidates.sort_values(
            ["rookie_market_rank", "draft_pick", "name"],
            ascending=[True, True, True],
        ).head(size),
        "draft": candidates.sort_values(
            ["draft_pick", "rookie_market_rank", "name"],
            ascending=[True, True, True],
        ).head(size),
        "capitalGap": candidates.sort_values(
            ["capital_market_gap", "draft_pick", "name"],
            ascending=[False, True, True],
        ).head(size),
    }


def exact_one_sided_sign_p_value(wins: int, trials: int) -> float | None:
    if trials <= 0:
        return None
    return sum(math.comb(trials, count) for count in range(wins, trials + 1)) / (2**trials)


def _mae(actual: np.ndarray, predicted: np.ndarray) -> float:
    return float(np.mean(np.abs(actual - predicted))) if len(actual) else math.nan


def _spearman(actual: np.ndarray, predicted: np.ndarray) -> float:
    if len(actual) < 3:
        return math.nan
    statistic = spearmanr(actual, predicted).statistic
    return float(statistic) if statistic is not None else math.nan


def backtest_production_model(frame: pd.DataFrame) -> ProductionBacktest:
    target = "rookie_production_percentile"
    usable = frame[np.isfinite(frame[target])].copy()
    years = sorted(int(year) for year in usable["rookie_year"].unique())
    folds: list[ProductionFold] = []
    oof_actual: list[float] = []
    oof_model: list[float] = []
    oof_market: list[float] = []
    oof_capital: list[float] = []
    sensitivity_lifts: dict[int, dict[str, list[float]]] = {
        size: {"market": [], "draft": []}
        for size in SENSITIVITY_BASKET_SIZES
    }

    for rookie_year in years:
        train = usable[usable["rookie_year"] < rookie_year].copy()
        test = usable[usable["rookie_year"] == rookie_year].copy()
        if len(train) < MIN_ROLLING_TRAIN_ROWS or test.empty:
            continue
        production_models = fit_ensemble(train, PRODUCTION_FEATURES, target)
        market_models = fit_ensemble(train, MARKET_PRODUCTION_FEATURES, target)
        capital_models = fit_ensemble(train, CAPITAL_PRODUCTION_FEATURES, target)
        production_prediction, _ = predict_ensemble(
            production_models, test, PRODUCTION_FEATURES
        )
        market_prediction, _ = predict_ensemble(
            market_models, test, MARKET_PRODUCTION_FEATURES
        )
        capital_prediction, _ = predict_ensemble(
            capital_models, test, CAPITAL_PRODUCTION_FEATURES
        )
        oof_actual.extend(test[target].to_numpy(dtype=float))
        oof_model.extend(production_prediction)
        oof_market.extend(market_prediction)
        oof_capital.extend(capital_prediction)

        model_basket = sleeper_basket(test, production_prediction)
        learned_capital_basket = sleeper_basket(test, capital_prediction)
        baselines = simple_baseline_baskets(test)
        baseline_means = {
            name: float(basket[target].mean())
            for name, basket in baselines.items()
        }
        strongest_name, strongest_mean = max(
            baseline_means.items(), key=lambda item: (item[1], item[0])
        )
        model_mean = float(model_basket[target].mean())
        learned_capital_mean = float(learned_capital_basket[target].mean())
        folds.append(ProductionFold(
            rookie_year=rookie_year,
            training_rows=len(train),
            class_rows=len(test),
            late_candidates=int((test["rookie_market_rank"] > LATE_ROOKIE_RANK).sum()),
            model_basket_mean_percentile=model_mean,
            market_basket_mean_percentile=baseline_means["market"],
            draft_basket_mean_percentile=baseline_means["draft"],
            capital_gap_basket_mean_percentile=baseline_means["capitalGap"],
            strongest_simple_baseline=strongest_name,
            strongest_simple_baseline_mean_percentile=strongest_mean,
            lift_over_strongest_simple_baseline=model_mean - strongest_mean,
            learned_capital_model_basket_mean_percentile=learned_capital_mean,
            lift_over_learned_capital_model=model_mean - learned_capital_mean,
            model_basket=[str(name) for name in model_basket["name"]],
        ))
        for size in SENSITIVITY_BASKET_SIZES:
            candidate_basket = sleeper_basket(test, production_prediction, size=size)
            candidate_mean = float(candidate_basket[target].mean())
            size_baselines = simple_baseline_baskets(test, size=size)
            for baseline_name in ("market", "draft"):
                baseline_mean = float(size_baselines[baseline_name][target].mean())
                sensitivity_lifts[size][baseline_name].append(candidate_mean - baseline_mean)

    actual = np.asarray(oof_actual, dtype=float)
    model_prediction = np.asarray(oof_model, dtype=float)
    market_prediction = np.asarray(oof_market, dtype=float)
    capital_prediction = np.asarray(oof_capital, dtype=float)
    lifts = [fold.lift_over_strongest_simple_baseline for fold in folds]
    capital_lifts = [fold.lift_over_learned_capital_model for fold in folds]
    wins = sum(lift > 0 for lift in lifts)
    p_value = exact_one_sided_sign_p_value(wins, len(folds))
    residual_band = (
        float(np.quantile(np.abs(actual - model_prediction), 0.80)) if len(actual) else math.nan
    )
    basket_sensitivity = []
    for size in SENSITIVITY_BASKET_SIZES:
        market_lifts = sensitivity_lifts[size]["market"]
        draft_lifts = sensitivity_lifts[size]["draft"]
        market_wins = sum(value > 0 for value in market_lifts)
        draft_wins = sum(value > 0 for value in draft_lifts)
        basket_sensitivity.append({
            "basketSize": size,
            "folds": len(market_lifts),
            "marketMeanLift": float(np.mean(market_lifts)) if market_lifts else None,
            "marketClassWins": market_wins,
            "draftMeanLift": float(np.mean(draft_lifts)) if draft_lifts else None,
            "draftClassWins": draft_wins,
            "passed": bool(
                len(market_lifts) >= 5
                and float(np.mean(market_lifts)) > 0
                and float(np.mean(draft_lifts)) > 0
                and market_wins >= 3
                and draft_wins >= 3
            ),
        })
    sensitivity_passed = bool(
        len(basket_sensitivity) == len(SENSITIVITY_BASKET_SIZES)
        and all(item["passed"] for item in basket_sensitivity)
    )
    passed = bool(
        len(folds) >= 5
        and wins == len(folds)
        and p_value is not None
        and p_value <= 0.05
        and min(lifts, default=-math.inf) > 0
        and sensitivity_passed
    )
    return ProductionBacktest(
        training_target=target,
        target_meaning="position-relative rookie regular-season PPR percentile",
        folds=folds,
        fold_count=len(folds),
        fold_wins=wins,
        exact_one_sided_sign_p_value=p_value,
        mean_model_basket_percentile=float(np.mean([
            fold.model_basket_mean_percentile for fold in folds
        ])) if folds else None,
        mean_strongest_simple_baseline_percentile=float(np.mean([
            fold.strongest_simple_baseline_mean_percentile for fold in folds
        ])) if folds else None,
        mean_lift=float(np.mean(lifts)) if lifts else None,
        minimum_class_lift=float(min(lifts)) if lifts else None,
        oof_rows=len(actual),
        model_mae=_mae(actual, model_prediction) if len(actual) else None,
        market_only_model_mae=_mae(actual, market_prediction) if len(actual) else None,
        capital_only_model_mae=_mae(actual, capital_prediction) if len(actual) else None,
        model_spearman=_spearman(actual, model_prediction) if len(actual) else None,
        market_only_model_spearman=_spearman(actual, market_prediction) if len(actual) else None,
        capital_only_model_spearman=_spearman(actual, capital_prediction) if len(actual) else None,
        mean_lift_over_learned_capital_model=float(np.mean(capital_lifts)) if capital_lifts else None,
        learned_capital_model_class_wins=sum(value > 0 for value in capital_lifts),
        residual_band_80=residual_band if math.isfinite(residual_band) else None,
        basket_sensitivity=basket_sensitivity,
        sensitivity_passed=sensitivity_passed,
        passed=passed,
    )


def fit_production_artifact(frame: pd.DataFrame) -> dict[str, Any]:
    target = "rookie_production_percentile"
    usable = frame[np.isfinite(frame[target])].copy()
    production_models = fit_ensemble(usable, PRODUCTION_FEATURES, target)
    market_models = fit_ensemble(usable, MARKET_PRODUCTION_FEATURES, target)
    importance = np.vstack([model.feature_importances_ for model in production_models]).mean(axis=0)
    feature_importance = [
        {"feature": feature, "importance": float(value)}
        for feature, value in sorted(
            zip(PRODUCTION_FEATURES, importance),
            key=lambda item: (-item[1], item[0]),
        )
    ]
    return {
        "target": target,
        "features": PRODUCTION_FEATURES,
        "marketFeatures": MARKET_PRODUCTION_FEATURES,
        "seeds": list(ENSEMBLE_SEEDS),
        "productionModels": production_models,
        "marketModels": market_models,
        "featureImportance": feature_importance,
    }


def predict_current_production(
    current: pd.DataFrame,
    artifact: dict[str, Any],
    residual_band_80: float | None,
) -> list[dict[str, Any]]:
    production, disagreement = predict_ensemble(
        artifact["productionModels"], current, artifact["features"]
    )
    market, _ = predict_ensemble(
        artifact["marketModels"], current, artifact["marketFeatures"]
    )
    board = current.copy()
    board["production_prediction"] = np.clip(production, 0, 1)
    board["market_expected_production"] = np.clip(market, 0, 1)
    board["evidence_delta"] = board["production_prediction"] - board["market_expected_production"]
    board["model_disagreement"] = disagreement
    eligible = board["rookie_market_rank"] > LATE_ROOKIE_RANK
    selected = set(
        board.loc[eligible]
        .sort_values(
            ["production_prediction", "rookie_market_rank", "name"],
            ascending=[False, True, True],
        )
        .head(SLEEPER_BASKET_SIZE)
        .index
    )
    board = board.sort_values(
        ["production_prediction", "rookie_market_rank", "name"],
        ascending=[False, True, True],
    )
    result = []
    for draft_rank, (index, row) in enumerate(board.iterrows(), start=1):
        estimate = float(row["production_prediction"])
        band = residual_band_80 if residual_band_80 is not None else math.nan
        result.append({
            "fpId": str(row["fp_id"]),
            "sleeperId": str(row.get("sleeper_id") or "") or None,
            "name": str(row["name"]),
            "position": str(row["position"]),
            "team": str(row.get("nfl_team") or ""),
            "college": str(row.get("college") or ""),
            "draftBoardRank": draft_rank,
            "rookieMarketRank": int(row["rookie_market_rank"]),
            "lateCandidate": bool(row["rookie_market_rank"] > LATE_ROOKIE_RANK),
            "inValidatedSleeperBasket": index in selected,
            "expectedRookieProductionPercentile": estimate,
            "marketOnlyExpectedProductionPercentile": float(row["market_expected_production"]),
            "evidenceAdjustment": float(row["evidence_delta"]),
            "modelDisagreement": float(row["model_disagreement"]),
            "historicalResidualBand80": {
                "lower": max(0.0, estimate - band) if math.isfinite(band) else None,
                "upper": min(1.0, estimate + band) if math.isfinite(band) else None,
                "meaning": "empirical rolling-backtest error band, not a probability guarantee",
            },
            "evidence": {
                "nflDraftOverall": None if float(row["drafted"]) == 0 else int(row["draft_pick"]),
                "collegeSeasonsObserved": int(row.get("college_seasons_observed") or 0),
                "finalCollegeScrimmageShare": _optional_float(row.get("college_final_scrimmage_yards_share")),
                "maxCollegeScrimmageShare": _optional_float(row.get("college_max_scrimmage_yards_share")),
                "finalCollegeTargetShare": _optional_float(row.get("college_final_target_share")),
                "forty": _optional_float(row.get("combine_forty")),
                "collegeDataPresent": bool(row.get("college_data_present")),
                "combineDataPresent": bool(row.get("combine_data_present")),
            },
        })
    return result


def _optional_float(value: Any) -> float | None:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def production_backtest_dict(backtest: ProductionBacktest) -> dict[str, Any]:
    return asdict(backtest)

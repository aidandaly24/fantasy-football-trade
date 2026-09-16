"""Chronological, position-specific feature auditions; never live promotion."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from ml.inseason_features import feature_sets

KINDS = ("ridge-10", "ridge-100", "hist-gradient")


def fit(train: pd.DataFrame, columns: list[str], target: str, kind: str):
    if kind.startswith("ridge-"):
        model = make_pipeline(SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True),
                              StandardScaler(), Ridge(alpha=float(kind.split("-")[1])))
    else:
        model = HistGradientBoostingRegressor(max_iter=100, max_leaf_nodes=7,
                                              min_samples_leaf=40, l2_regularization=10,
                                              learning_rate=.06, early_stopping=False, random_state=17)
    model.fit(train[columns].to_numpy(float), train[target].to_numpy(float))
    return model


def predict(model, rows: pd.DataFrame, columns: list[str]) -> np.ndarray:
    return model.predict(rows[columns].to_numpy(float))


def mae(actual: np.ndarray, prediction: np.ndarray) -> float:
    return float(np.abs(actual - prediction).mean())


def metrics(rows: pd.DataFrame, actual: np.ndarray, prediction: np.ndarray) -> dict:
    errors = actual - prediction
    ranks = []
    for indices in rows.reset_index(drop=True).groupby(["season", "week"]).indices.values():
        if len(indices) >= 5 and np.std(actual[indices]) > 0 and np.std(prediction[indices]) > 0:
            ranks.append(pd.Series(actual[indices]).corr(pd.Series(prediction[indices]), method="spearman"))
    return {"mae": mae(actual, prediction), "rmse": float(np.sqrt(np.mean(errors ** 2))),
            "weeklyRankCorrelation": float(np.mean(ranks)) if ranks else None}


def paired_interval(rows: pd.DataFrame, actual: np.ndarray, baseline: np.ndarray,
                    challenger: np.ndarray, draws: int = 400) -> dict:
    """Resample player-season blocks so overlapping weekly labels stay together."""
    errors = pd.DataFrame({"cluster": rows.season.astype(str).to_numpy() + ":" + rows.player_id.astype(str).to_numpy(),
                           "delta": np.abs(actual - baseline) - np.abs(actual - challenger)})
    blocks = errors.groupby("cluster").delta.agg(["sum", "count"])
    rng = np.random.default_rng(1701)
    indices = rng.integers(0, len(blocks), (draws, len(blocks)))
    means = blocks["sum"].to_numpy()[indices].sum(axis=1) / blocks["count"].to_numpy()[indices].sum(axis=1)
    return {"meanMaeGain": float(errors.delta.mean()), "lower90": float(np.quantile(means, .05)),
            "upper90": float(np.quantile(means, .95)), "blocks": len(blocks),
            "method": "paired player-season block bootstrap; 400 seeded draws; league-wide week shocks not independently modeled"}


def split(frame: pd.DataFrame, horizon: int, validation_season: int, test_season: int):
    if validation_season >= test_season:
        raise ValueError("Validation season must precede holdout")
    rows = frame[frame[f"target_{horizon}"].notna()].copy()
    # Labels end in the same season. Reassert this instead of relying only on
    # anchor ordering; future four-week labels can never cross the split.
    last_week = np.where(rows.season <= 2020, 17, 18)
    if (rows[f"label_end_{horizon}"] > last_week).any():
        raise ValueError("A future label crosses the season boundary")
    return (rows[rows.season < validation_season], rows[rows.season.eq(validation_season)],
            rows[rows.season.eq(test_season)])


def evaluate(frame: pd.DataFrame, position: str, horizon: int, cohort: str,
             validation_season: int, test_season: int, kinds: tuple = KINDS) -> tuple[dict, pd.DataFrame]:
    rows = frame[frame.position.eq(position)].copy()
    if cohort == "ftn-era":
        rows = rows[rows.season.ge(2022)]
    train, validation, test = split(rows, horizon, validation_season, test_season)
    result = {"position": position, "horizonWeeks": horizon, "cohort": cohort,
              "trainSeasons": sorted(int(s) for s in train.season.unique()),
              "validationSeason": validation_season, "testSeason": test_season,
              "trainRows": len(train), "validationRows": len(validation), "testRows": len(test),
              "status": "needs-data", "enabled": False}
    if len(train) < 100 or len(validation) < 25 or len(test) < 25:
        return result, pd.DataFrame()
    target = f"target_{horizon}"
    y_val, y_test = validation[target].to_numpy(), test[target].to_numpy()
    families = feature_sets(rows, position, horizon)
    if cohort == "core":
        families = {k: v for k, v in families.items() if "ftn" not in k}
    if position not in ("WR", "TE"):
        families.pop("opportunity+ngs-without-separation", None)
    baselines = ["ppg_last", "ppg_3", "ppg_season"]
    baseline_val = {name: mae(y_val, validation[name].to_numpy()) for name in baselines}
    simple = min(baseline_val, key=baseline_val.get)
    fitted, selection = {}, {}
    for family, columns in families.items():
        if family != "opportunity":
            added = list(set(columns) - set(families["opportunity"]))
            required_sources = [prefix for prefix in ("ngs", "ftn") if prefix in family]
            if not added or any(not train[[c for c in added if c.startswith(prefix + "_")]].notna().any().any()
                                for prefix in required_sources):
                continue
        candidates = []
        for kind in kinds:
            model = fit(train, columns, target, kind)
            val_prediction = predict(model, validation, columns)
            candidates.append((mae(y_val, val_prediction), kind, val_prediction))
        error, kind, val_prediction = min(candidates, key=lambda c: c[0])
        selection[family] = {"kind": kind, "validationMae": error,
                             "candidates": [{"kind": k, "mae": e} for e, k, _ in candidates]}
        # Fixed before opening test. Refit preprocessing and model on past data.
        model = fit(pd.concat([train, validation]), columns, target, kind)
        fitted[family] = {"prediction": predict(model, test, columns),
                          "intervalRadius": float(np.quantile(np.abs(y_val - val_prediction), .8)),
                          "features": columns}
    reference = "opportunity" if selection["opportunity"]["validationMae"] <= baseline_val[simple] else simple
    baseline = fitted[reference]["prediction"] if reference in fitted else test[reference].to_numpy()
    eligible_advanced = [name for name in fitted if name != "opportunity" and "without-separation" not in name]
    selected = min(eligible_advanced, key=lambda name: selection[name]["validationMae"]) if eligible_advanced else None
    outputs, predictions = {}, []
    for family, entry in fitted.items():
        pred = entry["prediction"]
        stats = metrics(test, y_test, pred)
        stats["liftVsReference"] = (mae(y_test, baseline) - stats["mae"]) / mae(y_test, baseline) if mae(y_test, baseline) else 0.
        stats["pairedGain"] = paired_interval(test, y_test, baseline, pred)
        stats["intervalCoverage80"] = float((np.abs(y_test - pred) <= entry["intervalRadius"]).mean())
        stats["intervalRadius"] = entry["intervalRadius"]
        slices = {}
        for name, mask in {"early-season": test.week.le(4), "low-volume": test.low_volume,
                           "established-volume": ~test.low_volume}.items():
            use = mask.to_numpy()
            slices[name] = {"rows": int(use.sum()), "mae": mae(y_test[use], pred[use]) if use.any() else None,
                            "referenceMae": mae(y_test[use], baseline[use]) if use.any() else None}
        outputs[family] = {**selection[family], "features": entry["features"], "test": stats, "slices": slices,
                           "featureCoverage": {c: float(test[c].notna().mean()) for c in entry["features"]}}
        prediction_rows = test[["season", "week", "player_id", "position", target]].copy()
        prediction_rows["prediction"], prediction_rows["reference"], prediction_rows["family"] = pred, baseline, family
        prediction_rows["horizon"], prediction_rows["cohort"] = horizon, cohort
        predictions.append(prediction_rows)
    winner = outputs.get(selected)
    gates = []
    if winner:
        gates = [
            {"id": "sample", "passed": len(train) >= 500 and len(test) >= 100 and test.player_id.nunique() >= 20,
             "requirement": "500 training rows; 100 test rows; 20 held-out players"},
            {"id": "incremental-lift", "passed": winner["test"]["liftVsReference"] >= .02,
             "requirement": "At least 2% MAE improvement over validation-selected reference"},
            {"id": "paired-uncertainty", "passed": winner["test"]["pairedGain"]["lower90"] > 0,
             "requirement": "Positive lower bound of paired block 90% MAE gain interval"},
            {"id": "subgroups", "passed": all(s["rows"] >= 20 and s["mae"] <= s["referenceMae"] * 1.05
                                               for s in winner["slices"].values()),
             "requirement": "20 rows per early/low/established slice; no >5% MAE regression"},
            {"id": "interval-calibration", "passed": .7 <= winner["test"]["intervalCoverage80"] <= .9,
             "requirement": "80% validation-residual interval covers 70%-90% of test outcomes"},
        ]
    ablation = None
    if "opportunity+ngs" in fitted and "opportunity+ngs-without-separation" in fitted:
        ablation = paired_interval(test, y_test, fitted["opportunity+ngs-without-separation"]["prediction"],
                                  fitted["opportunity+ngs"]["prediction"])
    result.update({"status": "shadow", "reference": reference, "simpleBaselineSelection": baseline_val,
                   "simpleBaselineTest": {n: metrics(test, y_test, test[n].to_numpy()) for n in baselines},
                   "referenceTest": metrics(test, y_test, baseline), "selectedAdvanced": selected,
                   "families": outputs, "separationAblation": ablation, "researchGates": gates,
                   "researchGatesPassed": bool(gates) and all(g["passed"] for g in gates)})
    return result, pd.concat(predictions, ignore_index=True) if predictions else pd.DataFrame()

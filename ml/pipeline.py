#!/usr/bin/env python3
"""Collect, train, evaluate, and export RosterLab player projections."""

from __future__ import annotations

import argparse
import json
import math
import pickle
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
NFLVERSE = RAW / "nflverse"
TRADYR = RAW / "tradyr"
TRADYR_FULL = TRADYR / "full"
SLEEPER_STATS = RAW / "sleeper" / "stats"
ARTIFACTS = ROOT / "ml" / "artifacts"
REPORTS = ROOT / "ml" / "reports"
PUBLIC_DATA = ROOT / "public" / "data"

NFLVERSE_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "player_stats/player_stats_{season}.csv"
)
TRADYR_BASE = "https://api.tradyr.app/v1"
SLEEPER_STATS_BASE = "https://api.sleeper.com/stats/nfl/player"
DEFAULT_SEASONS = tuple(range(2018, 2025))
POSITIONS = ("QB", "RB", "WR", "TE")
SOURCE_WEEKS = {season: 17 if season <= 2020 else 18 for season in range(1999, 2035)}
GATE_IMPROVEMENT = 0.01

NUMERIC_FEATURES = [
    "prior_ppg",
    "late4_ppg",
    "late8_ppg",
    "weekly_std",
    "active_weeks",
    "pass_attempts_pg",
    "pass_yards_pg",
    "pass_tds_pg",
    "carries_pg",
    "rush_yards_pg",
    "rush_tds_pg",
    "targets_pg",
    "receptions_pg",
    "rec_yards_pg",
    "rec_tds_pg",
    "touches_pg",
    "total_tds_pg",
]
FEATURES = NUMERIC_FEATURES + [f"pos_{position}" for position in POSITIONS]


@dataclass(frozen=True)
class Metrics:
    mae: float
    rmse: float
    rank_correlation: float


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_dirs() -> None:
    for path in (NFLVERSE, TRADYR_FULL, SLEEPER_STATS, ARTIFACTS, REPORTS, PUBLIC_DATA):
        path.mkdir(parents=True, exist_ok=True)


def request_bytes(url: str, attempts: int = 3) -> bytes:
    headers = {
        "Accept": "application/json,text/csv;q=0.9,*/*;q=0.8",
        "User-Agent": "RosterLab/1.0 (private fantasy model research)",
    }
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < attempts - 1:
                delay = max(5, int(error.headers.get("Retry-After", "15")))
                time.sleep(delay)
                continue
            if error.code >= 500 and attempt < attempts - 1:
                time.sleep(2 ** attempt)
                continue
            raise
        except (TimeoutError, urllib.error.URLError):
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Unable to fetch {url}")


def fetch_json(url: str) -> dict[str, Any]:
    return json.loads(request_bytes(url))


def download(url: str, path: Path, refresh: bool) -> None:
    if path.exists() and not refresh:
        return
    data = request_bytes(url)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(data)
    temporary.replace(path)


def collect_nflverse(seasons: tuple[int, ...], refresh: bool) -> None:
    print(f"Collecting nflverse seasons {seasons[0]}-{seasons[-1]}")
    for season in seasons:
        path = NFLVERSE / f"player_stats_{season}.csv"
        download(NFLVERSE_URL.format(season=season), path, refresh)
        print(f"  {season}: {path.stat().st_size / 1_000_000:.1f} MB")


def tradyr_players(limit: int, refresh: bool) -> list[dict[str, Any]]:
    path = TRADYR / "players.json"
    cached = json.loads(path.read_text()) if path.exists() else None
    if refresh or not cached or len(cached.get("data", [])) < limit:
        params = urllib.parse.urlencode(
            {"format": "dynasty", "numQbs": 2, "tep": "true", "limit": min(1000, limit)}
        )
        payload = fetch_json(f"{TRADYR_BASE}/players?{params}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, separators=(",", ":")))
        cached = payload
    return cached["data"][:limit]


def collect_tradyr(limit: int, refresh: bool) -> None:
    players = tradyr_players(limit, refresh)
    print(f"Collecting current Sleeper season totals for {len(players)} Tradyr assets")
    pending: list[tuple[dict[str, Any], Path]] = []
    for player in players:
        sleeper_id = player.get("sleeperId")
        if not sleeper_id:
            continue
        path = SLEEPER_STATS / f"{sleeper_id}.json"
        if path.exists() and not refresh:
            continue
        pending.append((player, path))
    if not pending:
        print("  current player cache already fresh")
        return

    def fetch_player(player: dict[str, Any]) -> dict[str, Any]:
        params = urllib.parse.urlencode(
            {"season_type": "regular", "season": 2025, "grouping": "season"}
        )
        return fetch_json(f"{SLEEPER_STATS_BASE}/{player['sleeperId']}?{params}")

    completed = len(players) - len(pending)
    failures: list[str] = []
    batch_size = 40
    for offset in range(0, len(pending), batch_size):
        batch = pending[offset : offset + batch_size]
        started = time.monotonic()
        with ThreadPoolExecutor(max_workers=min(20, len(batch))) as executor:
            futures = {executor.submit(fetch_player, player): path for player, path in batch}
            for future in as_completed(futures):
                path = futures[future]
                try:
                    path.write_text(json.dumps(future.result(), separators=(",", ":")))
                    completed += 1
                except Exception as error:  # A single upstream record must not abort the snapshot.
                    failures.append(f"{path.stem}: {type(error).__name__}")
        print(f"  {completed}/{len(players)} current players cached")
        if offset + batch_size < len(pending):
            time.sleep(max(0.0, 3 - (time.monotonic() - started)))
    if failures:
        print(f"  skipped {len(failures)} unavailable records: {', '.join(failures[:5])}")


def safe_number(value: Any) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else 0.0
    except (TypeError, ValueError):
        return 0.0


def feature_row(
    *,
    position: str,
    weeks: int,
    weekly_points: dict[int, float],
    active_weeks: float,
    totals: dict[str, float],
) -> dict[str, float]:
    points = np.array([weekly_points.get(week, 0.0) for week in range(1, weeks + 1)], dtype=float)
    prior_ppg = float(points.sum() / weeks)
    row = {
        "prior_ppg": prior_ppg,
        "late4_ppg": float(points[-4:].mean()),
        "late8_ppg": float(points[-8:].mean()),
        "weekly_std": float(points.std()),
        "active_weeks": float(active_weeks),
        "pass_attempts_pg": totals.get("attempts", 0.0) / weeks,
        "pass_yards_pg": totals.get("passing_yards", 0.0) / weeks,
        "pass_tds_pg": totals.get("passing_tds", 0.0) / weeks,
        "carries_pg": totals.get("carries", 0.0) / weeks,
        "rush_yards_pg": totals.get("rushing_yards", 0.0) / weeks,
        "rush_tds_pg": totals.get("rushing_tds", 0.0) / weeks,
        "targets_pg": totals.get("targets", 0.0) / weeks,
        "receptions_pg": totals.get("receptions", 0.0) / weeks,
        "rec_yards_pg": totals.get("receiving_yards", 0.0) / weeks,
        "rec_tds_pg": totals.get("receiving_tds", 0.0) / weeks,
    }
    row["touches_pg"] = row["carries_pg"] + row["receptions_pg"]
    row["total_tds_pg"] = row["pass_tds_pg"] + row["rush_tds_pg"] + row["rec_tds_pg"]
    row.update({f"pos_{candidate}": 1.0 if position == candidate else 0.0 for candidate in POSITIONS})
    return row


def historical_summaries(seasons: tuple[int, ...]) -> pd.DataFrame:
    summaries: list[dict[str, Any]] = []
    sum_columns = [
        "attempts",
        "passing_yards",
        "passing_tds",
        "carries",
        "rushing_yards",
        "rushing_tds",
        "targets",
        "receptions",
        "receiving_yards",
        "receiving_tds",
    ]
    use_columns = [
        "player_id",
        "player_display_name",
        "position",
        "season",
        "week",
        "season_type",
        "fantasy_points_ppr",
        *sum_columns,
    ]
    for season in seasons:
        frame = pd.read_csv(NFLVERSE / f"player_stats_{season}.csv", usecols=use_columns)
        frame = frame[(frame["season_type"] == "REG") & frame["position"].isin(POSITIONS)].copy()
        frame[sum_columns + ["fantasy_points_ppr"]] = frame[sum_columns + ["fantasy_points_ppr"]].fillna(0)
        weeks = SOURCE_WEEKS[season]
        for player_id, group in frame.groupby("player_id", sort=False):
            position = str(group["position"].mode().iat[0])
            weekly = group.groupby("week")["fantasy_points_ppr"].sum().to_dict()
            totals = {column: float(group[column].sum()) for column in sum_columns}
            row = feature_row(
                position=position,
                weeks=weeks,
                weekly_points={int(key): float(value) for key, value in weekly.items()},
                active_weeks=float(group["week"].nunique()),
                totals=totals,
            )
            summaries.append(
                {
                    "player_id": player_id,
                    "name": str(group["player_display_name"].iloc[-1]),
                    "position": position,
                    "season": season,
                    **row,
                }
            )
    return pd.DataFrame(summaries)


def training_rows(summaries: pd.DataFrame) -> pd.DataFrame:
    target = summaries[["player_id", "season", "prior_ppg"]].rename(
        columns={"season": "target_season", "prior_ppg": "target_ppg"}
    )
    rows = summaries.copy()
    rows["target_season"] = rows["season"] + 1
    rows = rows.merge(target, how="left", on=["player_id", "target_season"])
    rows["target_ppg"] = rows["target_ppg"].fillna(0.0)
    return rows[rows["season"] < summaries["season"].max()].copy()


def score(y_true: np.ndarray, y_pred: np.ndarray) -> Metrics:
    errors = y_true - y_pred
    true_rank = pd.Series(y_true).rank(method="average")
    pred_rank = pd.Series(y_pred).rank(method="average")
    correlation = float(true_rank.corr(pred_rank))
    return Metrics(
        mae=float(np.mean(np.abs(errors))),
        rmse=float(np.sqrt(np.mean(errors ** 2))),
        rank_correlation=0.0 if math.isnan(correlation) else correlation,
    )


def evaluation_slices(
    frame: pd.DataFrame,
    y_true: np.ndarray,
    prediction: np.ndarray,
    baseline: np.ndarray,
) -> dict[str, Any]:
    slices: dict[str, np.ndarray] = {
        "all": np.ones(len(frame), dtype=bool),
        "priorPpgAtLeast6": baseline >= 6,
        "priorPpgAtLeast10": baseline >= 10,
    }
    slices.update({position: frame["position"].to_numpy() == position for position in POSITIONS})
    return {
        name: {
            "rows": int(mask.sum()),
            "model": rounded_metrics(score(y_true[mask], prediction[mask])),
            "baseline": rounded_metrics(score(y_true[mask], baseline[mask])),
        }
        for name, mask in slices.items()
        if mask.any()
    }


def rounded_metrics(metrics: Metrics) -> dict[str, float]:
    return {key: round(value, 4) for key, value in asdict(metrics).items()}


def model_configs() -> list[dict[str, Any]]:
    return [
        {"learning_rate": 0.04, "max_iter": 220, "max_leaf_nodes": 7, "min_samples_leaf": 24, "l2_regularization": 1.0},
        {"learning_rate": 0.05, "max_iter": 220, "max_leaf_nodes": 11, "min_samples_leaf": 30, "l2_regularization": 2.0},
        {"learning_rate": 0.04, "max_iter": 260, "max_leaf_nodes": 15, "min_samples_leaf": 38, "l2_regularization": 4.0},
    ]


def fit_model(config: dict[str, Any], loss: str = "absolute_error", quantile: float | None = None):
    return HistGradientBoostingRegressor(
        **config,
        loss=loss,
        quantile=quantile,
        random_state=42,
        early_stopping=False,
    )


def select_model(train: pd.DataFrame, validation: pd.DataFrame) -> tuple[dict[str, Any], float, dict[str, Any]]:
    x_train = train[FEATURES].to_numpy(dtype=float)
    y_train = train["target_ppg"].to_numpy(dtype=float)
    x_validation = validation[FEATURES].to_numpy(dtype=float)
    y_validation = validation["target_ppg"].to_numpy(dtype=float)
    baseline = validation["prior_ppg"].to_numpy(dtype=float)
    best: dict[str, Any] | None = None
    for config in model_configs():
        model = fit_model(config).fit(x_train, y_train)
        raw = np.clip(model.predict(x_validation), 0, 35)
        for blend in (0.25, 0.5, 0.75, 1.0):
            prediction = np.clip(raw * blend + baseline * (1 - blend), 0, 35)
            metrics = score(y_validation, prediction)
            candidate = {"config": config, "blend": blend, "metrics": metrics, "model": model}
            if best is None or metrics.mae < best["metrics"].mae:
                best = candidate
    assert best is not None
    return best["config"], best["blend"], {
        "selected": rounded_metrics(best["metrics"]),
        "baseline": rounded_metrics(score(y_validation, baseline)),
    }


def current_feature_rows(players: list[dict[str, Any]]) -> tuple[pd.DataFrame, dict[str, dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    metadata: dict[str, dict[str, Any]] = {}
    aliases = {
        "attempts": "pass_att",
        "passing_yards": "pass_yd",
        "passing_tds": "pass_td",
        "carries": "rush_att",
        "rushing_yards": "rush_yd",
        "rushing_tds": "rush_td",
        "targets": "rec_tgt",
        "receptions": "rec",
        "receiving_yards": "rec_yd",
        "receiving_tds": "rec_td",
    }
    for player in players:
        sleeper_id = player.get("sleeperId")
        if not sleeper_id:
            continue
        stats_path = SLEEPER_STATS / f"{sleeper_id}.json"
        full_path = TRADYR_FULL / f"{player['slug']}.json"
        if stats_path.exists():
            record = json.loads(stats_path.read_text()) or {}
            season_totals = record.get("stats") or {}
            stats = {
                "season": record.get("season") or 2025,
                "seasonTotals": season_totals,
                "weeklyStats": [],
                "gamesPlayed": season_totals.get("gp"),
            }
        elif full_path.exists():
            record = json.loads(full_path.read_text()).get("data", {})
            stats = record.get("stats") or {}
        else:
            continue
        position = player.get("position")
        if not sleeper_id or not stats or position not in POSITIONS:
            continue
        season = int(stats.get("season") or 2025)
        weeks = SOURCE_WEEKS.get(season, 18)
        season_totals = stats.get("seasonTotals") or {}
        weekly_points = {
            int(item["week"]): safe_number(item.get("pts"))
            for item in (stats.get("weeklyStats") or [])
            if item.get("week")
        }
        if not weekly_points:
            prior_ppg = safe_number(season_totals.get("pts_ppr")) / weeks
            weekly_points = {week: prior_ppg for week in range(1, weeks + 1)}
        totals = {historical: safe_number(season_totals.get(current)) for historical, current in aliases.items()}
        features = feature_row(
            position=str(position),
            weeks=weeks,
            weekly_points=weekly_points,
            active_weeks=safe_number(season_totals.get("gp") or stats.get("gamesPlayed")),
            totals=totals,
        )
        rows.append({"sleeper_id": str(sleeper_id), **features})
        metadata[str(sleeper_id)] = {
            "name": player.get("name"),
            "position": position,
            "sourceSeason": season,
            "gamesObserved": int(safe_number(season_totals.get("gp") or stats.get("gamesPlayed"))),
        }
    return pd.DataFrame(rows), metadata


def train_and_export(limit: int) -> dict[str, Any]:
    seasons = DEFAULT_SEASONS
    summaries = historical_summaries(seasons)
    rows = training_rows(summaries)
    train = rows[rows["season"] <= 2021]
    validation = rows[rows["season"] == 2022]
    test = rows[rows["season"] == 2023]
    if min(len(train), len(validation), len(test)) == 0:
        raise RuntimeError("Time-based train, validation, or test split is empty")

    config, blend, validation_report = select_model(train, validation)
    fit_rows = pd.concat([train, validation], ignore_index=True)
    selected_model = fit_model(config).fit(
        fit_rows[FEATURES].to_numpy(dtype=float), fit_rows["target_ppg"].to_numpy(dtype=float)
    )
    test_raw = np.clip(selected_model.predict(test[FEATURES].to_numpy(dtype=float)), 0, 35)
    test_baseline = test["prior_ppg"].to_numpy(dtype=float)
    test_prediction = np.clip(test_raw * blend + test_baseline * (1 - blend), 0, 35)
    test_target = test["target_ppg"].to_numpy(dtype=float)
    test_model_metrics = score(test_target, test_prediction)
    test_baseline_metrics = score(test_target, test_baseline)
    improvement = (
        (test_baseline_metrics.mae - test_model_metrics.mae) / test_baseline_metrics.mae
        if test_baseline_metrics.mae
        else 0.0
    )
    enabled = improvement >= GATE_IMPROVEMENT

    final_rows = rows[rows["season"] <= 2023]
    x_final = final_rows[FEATURES].to_numpy(dtype=float)
    y_final = final_rows["target_ppg"].to_numpy(dtype=float)
    final_model = fit_model(config).fit(x_final, y_final)
    lower_model = fit_model(config, loss="quantile", quantile=0.2).fit(x_final, y_final)
    upper_model = fit_model(config, loss="quantile", quantile=0.8).fit(x_final, y_final)

    importance = permutation_importance(
        selected_model,
        test[FEATURES].to_numpy(dtype=float),
        test_target,
        scoring="neg_mean_absolute_error",
        n_repeats=4,
        random_state=42,
    )
    feature_importance = sorted(
        [
            {"feature": feature, "importance": round(max(0.0, float(value)), 5)}
            for feature, value in zip(FEATURES, importance.importances_mean, strict=True)
        ],
        key=lambda item: item["importance"],
        reverse=True,
    )[:8]

    players = tradyr_players(limit, refresh=False)
    current, metadata = current_feature_rows(players)
    projections: dict[str, Any] = {}
    if not current.empty:
        x_current = current[FEATURES].to_numpy(dtype=float)
        baseline = current["prior_ppg"].to_numpy(dtype=float)
        raw_expected = np.clip(final_model.predict(x_current), 0, 35)
        raw_floor = np.clip(lower_model.predict(x_current), 0, 35)
        raw_ceiling = np.clip(upper_model.predict(x_current), 0, 35)
        expected = np.clip(raw_expected * blend + baseline * (1 - blend), 0, 35)
        floor = np.minimum(expected, np.clip(raw_floor * blend + baseline * 0.65 * (1 - blend), 0, 35))
        ceiling = np.maximum(expected, np.clip(raw_ceiling * blend + baseline * 1.2 * (1 - blend), 0, 35))
        for index, sleeper_id in enumerate(current["sleeper_id"].astype(str)):
            info = metadata[sleeper_id]
            interval = float(ceiling[index] - floor[index])
            history_factor = min(1.0, info["gamesObserved"] / 14)
            width_factor = max(0.0, 1 - interval / max(8.0, expected[index] + 4))
            confidence = max(0.4, min(0.92, 0.46 + history_factor * 0.25 + width_factor * 0.18))
            projections[sleeper_id] = {
                **info,
                "expectedPpg": round(float(expected[index]), 1),
                "floorPpg": round(float(floor[index]), 1),
                "ceilingPpg": round(float(ceiling[index]), 1),
                "confidence": round(confidence, 2),
            }

    generated_at = utc_now()
    report = {
        "generatedAt": generated_at,
        "model": "season-transition-hgb-v1",
        "target": "next-season PPR points per NFL team game",
        "gate": {
            "enabled": enabled,
            "requiredMaeImprovement": GATE_IMPROVEMENT,
            "observedMaeImprovement": round(improvement, 4),
        },
        "data": {
            "seasons": list(seasons),
            "trainingRows": int(len(train)),
            "validationRows": int(len(validation)),
            "testRows": int(len(test)),
            "currentPlayers": len(projections),
        },
        "selection": {"parameters": config, "baselineBlend": round(1 - blend, 2)},
        "validation": validation_report,
        "test": {
            "model": rounded_metrics(test_model_metrics),
            "baseline": rounded_metrics(test_baseline_metrics),
            "slices": evaluation_slices(test, test_target, test_prediction, test_baseline),
        },
        "predictionInterval": {"lowerQuantile": 0.2, "upperQuantile": 0.8},
        "featureImportance": feature_importance,
        "sources": [
            "https://github.com/nflverse/nflverse-data/releases/tag/player_stats",
            "https://api.tradyr.app/docs",
            "https://docs.sleeper.com/",
        ],
    }
    projection_bundle = {
        "generatedAt": generated_at,
        "model": report["model"],
        "enabled": enabled,
        "testMaeImprovement": round(improvement, 4),
        "coverage": len(projections),
        "projections": projections if enabled else {},
    }

    (REPORTS / "latest.json").write_text(json.dumps(report, indent=2) + "\n")
    (PUBLIC_DATA / "player-projections.json").write_text(json.dumps(projection_bundle, separators=(",", ":")) + "\n")
    with (ARTIFACTS / "production_model.pkl").open("wb") as file:
        pickle.dump(
            {
                "model": final_model,
                "lower": lower_model,
                "upper": upper_model,
                "features": FEATURES,
                "blend": blend,
                "report": report,
            },
            file,
        )

    print(
        f"Held-out MAE: model={test_model_metrics.mae:.3f}, "
        f"baseline={test_baseline_metrics.mae:.3f}, improvement={improvement:.1%}"
    )
    print(f"Gate: {'ENABLED' if enabled else 'DISABLED'}; current projections={len(projections)}")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("collect", "train", "refresh"))
    parser.add_argument("--limit", type=int, default=240, help="Current Tradyr players to snapshot")
    parser.add_argument("--refresh", action="store_true", help="Replace cached source downloads")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_dirs()
    if args.command in ("collect", "refresh"):
        collect_nflverse(DEFAULT_SEASONS, args.refresh)
        collect_tradyr(max(25, min(500, args.limit)), args.refresh)
    if args.command in ("train", "refresh"):
        train_and_export(max(25, min(500, args.limit)))


if __name__ == "__main__":
    main()

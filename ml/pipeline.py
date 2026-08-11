#!/usr/bin/env python3
"""Collect, train, evaluate, and export RosterLab player projections."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pickle
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
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
SNAPSHOT_META = RAW / "snapshot.json"

NFLVERSE_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "player_stats/player_stats_{season}.csv"
)
NFLVERSE_PLAYERS_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"
NFLVERSE_PLAYERS = NFLVERSE / "players.csv"
WEEKLY_ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.csv"
EVENT_SEASONS = (2022, 2023, 2024)
TRADYR_BASE = "https://api.tradyr.app/v1"
SLEEPER_STATS_BASE = "https://api.sleeper.com/stats/nfl/player"
DEFAULT_SEASONS = tuple(range(2018, 2025))
POSITIONS = ("QB", "RB", "WR", "TE")
SOURCE_WEEKS = {season: 17 if season <= 2020 else 18 for season in range(1999, 2035)}
GATE_MAE_IMPROVEMENT = 0.05
GATE_RANK_TOLERANCE = -0.01
GATE_POSITION_REGRESSION = 0.02
INTERVAL_TARGET_COVERAGE = 0.60
INTERVAL_COVERAGE_RANGE = (0.52, 0.72)
CONTEXT_MAE_IMPROVEMENT = 0.03
CONTEXT_POSITION_REGRESSION = 0.02
CONTEXT_POSITIONS_REQUIRED = 3

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
POSITION_FEATURES = [f"pos_{position}" for position in POSITIONS]
BASE_FEATURES = NUMERIC_FEATURES + POSITION_FEATURES
CONTEXT_FEATURES = [
    "age",
    "years_experience",
    "draft_round",
    "draft_pick",
    "drafted",
    "games_played_share",
    "pass_attempt_share",
    "carry_share",
    "target_share",
    "team_opportunities_pg",
]
FEATURES = BASE_FEATURES + CONTEXT_FEATURES

EVENT_BASE_FEATURES = [
    "prior4_ppg",
    "prior2_ppg",
    "prior_week_ppg",
    "prior4_games",
    "recent_trend",
    *POSITION_FEATURES,
]
EVENT_FEATURES = [
    *EVENT_BASE_FEATURES,
    "current_active",
    "availability_up",
    "availability_down",
    "team_change",
    "roster_exit",
    "inactive_streak",
]
ACTIVE_ROSTER_STATUSES = {"ACT"}
EXIT_ROSTER_STATUSES = {"CUT", "RET"}
EVENT_MAE_IMPROVEMENT = 0.05
EVENT_FULL_MAE_TOLERANCE = 0.01
EVENT_MIN_TEST_ROWS = 100


@dataclass(frozen=True)
class Metrics:
    mae: float
    rmse: float
    rank_correlation: float


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_source_season(now: datetime | None = None) -> int:
    current = now or datetime.now(timezone.utc)
    return current.year if current.month >= 9 else current.year - 1


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
    download(NFLVERSE_PLAYERS_URL, NFLVERSE_PLAYERS, refresh)
    print(f"  players: {NFLVERSE_PLAYERS.stat().st_size / 1_000_000:.1f} MB")
    for season in EVENT_SEASONS:
        path = NFLVERSE / f"roster_weekly_{season}.csv"
        download(WEEKLY_ROSTER_URL.format(season=season), path, refresh)
        print(f"  weekly roster {season}: {path.stat().st_size / 1_000_000:.1f} MB")


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


def collect_tradyr(limit: int, refresh: bool, source_season: int) -> None:
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
        SNAPSHOT_META.write_text(json.dumps({
            "collectedAt": utc_now(),
            "sourceSeason": source_season,
            "requestedPlayers": len(players),
            "cachedPlayers": len(players),
            "failures": 0,
        }, indent=2) + "\n")
        return

    def fetch_player(player: dict[str, Any]) -> dict[str, Any]:
        params = urllib.parse.urlencode(
            {"season_type": "regular", "season": source_season, "grouping": "season"}
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
    SNAPSHOT_META.write_text(json.dumps({
        "collectedAt": utc_now(),
        "sourceSeason": source_season,
        "requestedPlayers": len(players),
        "cachedPlayers": completed,
        "failures": len(failures),
    }, indent=2) + "\n")


def snapshot_freshness() -> dict[str, Any]:
    if SNAPSHOT_META.exists():
        snapshot = json.loads(SNAPSHOT_META.read_text())
        data_as_of = str(snapshot.get("collectedAt") or utc_now())
        source_season = int(snapshot.get("sourceSeason") or default_source_season())
    else:
        mtimes = [path.stat().st_mtime for path in SLEEPER_STATS.glob("*.json")]
        modified = datetime.fromtimestamp(max(mtimes), timezone.utc) if mtimes else datetime.now(timezone.utc)
        data_as_of = modified.isoformat().replace("+00:00", "Z")
        source_season = default_source_season()
    parsed = datetime.fromisoformat(data_as_of.replace("Z", "+00:00"))
    stale_after = parsed + timedelta(days=8)
    return {
        "dataAsOf": data_as_of,
        "sourceSeason": source_season,
        "staleAfter": stale_after.isoformat().replace("+00:00", "Z"),
        "stale": datetime.now(timezone.utc) > stale_after,
    }


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
    context: dict[str, float] | None = None,
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
    supplied_context = context or {}
    row.update({feature: safe_number(supplied_context.get(feature)) for feature in CONTEXT_FEATURES})
    row["games_played_share"] = active_weeks / weeks if weeks else 0.0
    return row


def normalized_name(value: Any) -> str:
    return "".join(character for character in str(value or "").lower() if character.isalnum())


def player_metadata() -> tuple[dict[str, dict[str, Any]], dict[tuple[str, str], dict[str, Any]]]:
    if not NFLVERSE_PLAYERS.exists():
        return {}, {}
    columns = [
        "gsis_id",
        "display_name",
        "position",
        "birth_date",
        "rookie_season",
        "draft_year",
        "draft_round",
        "draft_pick",
        "latest_team",
    ]
    frame = pd.read_csv(NFLVERSE_PLAYERS, usecols=columns, low_memory=False)
    by_id: dict[str, dict[str, Any]] = {}
    by_name: dict[tuple[str, str], dict[str, Any]] = {}
    for record in frame.to_dict(orient="records"):
        if pd.notna(record.get("gsis_id")):
            by_id[str(record["gsis_id"])] = record
        key = (normalized_name(record.get("display_name")), str(record.get("position") or ""))
        if key[0]:
            by_name[key] = record
    return by_id, by_name


def biographical_context(record: dict[str, Any] | None, season: int, age: Any = None) -> dict[str, float]:
    record = record or {}
    birth_date = pd.to_datetime(record.get("birth_date"), errors="coerce")
    parsed_age = safe_number(age)
    if not parsed_age and not pd.isna(birth_date):
        parsed_age = season + 0.7 - float(birth_date.year)
    rookie_season = safe_number(record.get("rookie_season") or record.get("draft_year"))
    draft_round = safe_number(record.get("draft_round"))
    draft_pick = safe_number(record.get("draft_pick"))
    drafted = 1.0 if draft_round or draft_pick else 0.0
    return {
        "age": parsed_age,
        "years_experience": max(0.0, season - rookie_season) if rookie_season else 0.0,
        "draft_round": draft_round if drafted else 8.0,
        "draft_pick": draft_pick if drafted else 300.0,
        "drafted": drafted,
    }


def historical_summaries(seasons: tuple[int, ...]) -> pd.DataFrame:
    summaries: list[dict[str, Any]] = []
    players_by_id, _ = player_metadata()
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
        "recent_team",
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
        team_totals = frame.groupby("recent_team")[["attempts", "carries", "targets"]].sum()
        for player_id, group in frame.groupby("player_id", sort=False):
            position = str(group["position"].mode().iat[0])
            team = str(group["recent_team"].mode().iat[0]) if group["recent_team"].notna().any() else ""
            weekly = group.groupby("week")["fantasy_points_ppr"].sum().to_dict()
            totals = {column: float(group[column].sum()) for column in sum_columns}
            team_row = team_totals.loc[team] if team in team_totals.index else pd.Series(dtype=float)
            team_attempts = safe_number(team_row.get("attempts"))
            team_carries = safe_number(team_row.get("carries"))
            team_targets = safe_number(team_row.get("targets"))
            context = {
                **biographical_context(players_by_id.get(str(player_id)), season),
                "pass_attempt_share": totals["attempts"] / team_attempts if team_attempts else 0.0,
                "carry_share": totals["carries"] / team_carries if team_carries else 0.0,
                "target_share": totals["targets"] / team_targets if team_targets else 0.0,
                "team_opportunities_pg": (team_carries + team_targets) / weeks,
            }
            row = feature_row(
                position=position,
                weeks=weeks,
                weekly_points={int(key): float(value) for key, value in weekly.items()},
                active_weeks=float(group["week"].nunique()),
                totals=totals,
                context=context,
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


def simple_baselines(reference: pd.DataFrame, frame: pd.DataFrame) -> dict[str, np.ndarray]:
    position_means = reference.groupby("position")["target_ppg"].mean().to_dict()
    overall_mean = float(reference["target_ppg"].mean())
    prior = frame["prior_ppg"].to_numpy(dtype=float)
    positional = frame["position"].map(position_means).fillna(overall_mean).to_numpy(dtype=float)
    return {
        "repeatPrior": prior,
        "positionMean": positional,
        "shrinkToPosition": prior * 0.75 + positional * 0.25,
    }


def interval_metrics(y_true: np.ndarray, lower: np.ndarray, upper: np.ndarray) -> dict[str, float]:
    low = np.minimum(lower, upper)
    high = np.maximum(lower, upper)
    return {
        "coverage": float(np.mean((y_true >= low) & (y_true <= high))),
        "mean_width": float(np.mean(high - low)),
    }


def interval_scale(
    y_true: np.ndarray,
    point: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    target: float = INTERVAL_TARGET_COVERAGE,
) -> float:
    low_width = np.maximum(0.1, point - np.minimum(lower, point))
    high_width = np.maximum(0.1, np.maximum(upper, point) - point)
    lo, hi = 0.1, 8.0
    for _ in range(40):
        middle = (lo + hi) / 2
        coverage = np.mean(
            (y_true >= np.clip(point - low_width * middle, 0, 35))
            & (y_true <= np.clip(point + high_width * middle, 0, 35))
        )
        if coverage < target:
            lo = middle
        else:
            hi = middle
    return float((lo + hi) / 2)


def interval_scales(
    frame: pd.DataFrame,
    y_true: np.ndarray,
    point: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
) -> dict[str, float]:
    scales = {
        "all": interval_scale(y_true, point, lower, upper),
    }
    positions = frame["position"].to_numpy()
    for position in POSITIONS:
        mask = positions == position
        scales[position] = interval_scale(
            y_true[mask], point[mask], lower[mask], upper[mask]
        ) if mask.sum() >= 20 else scales["all"]
    return scales


def apply_interval_scales(
    frame: pd.DataFrame,
    point: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    scales: dict[str, float],
) -> tuple[np.ndarray, np.ndarray]:
    positions = frame["position"].to_numpy()
    scale = np.array([scales.get(str(position), scales["all"]) for position in positions])
    low_width = np.maximum(0.1, point - np.minimum(lower, point))
    high_width = np.maximum(0.1, np.maximum(upper, point) - point)
    return (
        np.clip(point - low_width * scale, 0, 35),
        np.clip(point + high_width * scale, 0, 35),
    )


def evaluation_slices(
    frame: pd.DataFrame,
    y_true: np.ndarray,
    prediction: np.ndarray,
    baseline: np.ndarray,
) -> dict[str, Any]:
    slices: dict[str, np.ndarray] = {
        "all": np.ones(len(frame), dtype=bool),
        "priorPpgUnder3": baseline < 3,
        "priorPpg3to6": (baseline >= 3) & (baseline < 6),
        "priorPpg6to10": (baseline >= 6) & (baseline < 10),
        "priorPpgAtLeast10": baseline >= 10,
        "gamesObserved1to8": frame["active_weeks"].to_numpy(dtype=float) <= 8,
        "gamesObserved9to13": (frame["active_weeks"].to_numpy(dtype=float) >= 9)
        & (frame["active_weeks"].to_numpy(dtype=float) <= 13),
        "gamesObserved14plus": frame["active_weeks"].to_numpy(dtype=float) >= 14,
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


def select_model(
    train: pd.DataFrame,
    validation: pd.DataFrame,
    features: list[str] = FEATURES,
) -> tuple[dict[str, Any], float, dict[str, Any]]:
    x_train = train[features].to_numpy(dtype=float)
    y_train = train["target_ppg"].to_numpy(dtype=float)
    x_validation = validation[features].to_numpy(dtype=float)
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
    _, players_by_name = player_metadata()
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
                "season": record.get("season") or default_source_season(),
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
        season = int(stats.get("season") or default_source_season())
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
        nflverse_player = players_by_name.get((normalized_name(player.get("name")), str(position)))
        context = biographical_context(nflverse_player, season, player.get("age"))
        features = feature_row(
            position=str(position),
            weeks=weeks,
            weekly_points=weekly_points,
            active_weeks=safe_number(season_totals.get("gp") or stats.get("gamesPlayed")),
            totals=totals,
            context=context,
        )
        rows.append({
            "sleeper_id": str(sleeper_id),
            "position": str(position),
            "team": str(player.get("team") or "FA"),
            **features,
        })
        metadata[str(sleeper_id)] = {
            "name": player.get("name"),
            "position": position,
            "sourceSeason": season,
            "gamesObserved": int(safe_number(season_totals.get("gp") or stats.get("gamesPlayed"))),
            "receptionsPerTeamWeek": round(float(features["receptions_pg"]), 3),
        }
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame, metadata
    team_totals = frame.groupby("team")[["pass_attempts_pg", "carries_pg", "targets_pg"]].sum()
    for index, row in frame.iterrows():
        totals = team_totals.loc[row["team"]]
        frame.at[index, "pass_attempt_share"] = row["pass_attempts_pg"] / totals["pass_attempts_pg"] if totals["pass_attempts_pg"] else 0.0
        frame.at[index, "carry_share"] = row["carries_pg"] / totals["carries_pg"] if totals["carries_pg"] else 0.0
        frame.at[index, "target_share"] = row["targets_pg"] / totals["targets_pg"] if totals["targets_pg"] else 0.0
        frame.at[index, "team_opportunities_pg"] = totals["carries_pg"] + totals["targets_pg"]
    return frame, metadata


def projection_drivers(row: pd.Series, info: dict[str, Any]) -> list[str]:
    drivers: list[str] = []
    position = str(info.get("position"))
    if info.get("gamesObserved", 0) < 10:
        drivers.append("limited recent availability")
    if position == "QB" and row.get("pass_attempt_share", 0) >= 0.7:
        drivers.append("starter-level passing workload")
    if position == "RB" and row.get("carry_share", 0) >= 0.35:
        drivers.append("high backfield carry share")
    if position in ("WR", "TE") and row.get("target_share", 0) >= 0.2:
        drivers.append("high team target share")
    age = row.get("age", 0)
    age_limit = {"QB": 33, "RB": 26, "WR": 29, "TE": 30}.get(position, 30)
    if age and age >= age_limit:
        drivers.append("age-curve downside")
    if row.get("drafted", 0) and row.get("draft_round", 8) <= 2 and row.get("years_experience", 9) <= 2:
        drivers.append("early-round development profile")
    if not drivers:
        drivers.append("prior production and usage stability")
    return drivers[:3]


def in_season_training_rows(seasons: tuple[int, ...]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    players_by_id, _ = player_metadata()
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
        "recent_team",
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
        season_weeks = SOURCE_WEEKS[season]
        for cutoff in (4, 8, 12):
            observed = frame[frame["week"] <= cutoff]
            remaining = (
                frame[frame["week"] > cutoff]
                .groupby("player_id")["fantasy_points_ppr"]
                .sum()
                .div(season_weeks - cutoff)
                .to_dict()
            )
            team_totals = observed.groupby("recent_team")[["attempts", "carries", "targets"]].sum()
            for player_id, group in observed.groupby("player_id", sort=False):
                position = str(group["position"].mode().iat[0])
                team = str(group["recent_team"].mode().iat[0]) if group["recent_team"].notna().any() else ""
                weekly = group.groupby("week")["fantasy_points_ppr"].sum().to_dict()
                totals = {column: float(group[column].sum()) for column in sum_columns}
                team_row = team_totals.loc[team] if team in team_totals.index else pd.Series(dtype=float)
                team_attempts = safe_number(team_row.get("attempts"))
                team_carries = safe_number(team_row.get("carries"))
                team_targets = safe_number(team_row.get("targets"))
                context = {
                    **biographical_context(players_by_id.get(str(player_id)), season),
                    "pass_attempt_share": totals["attempts"] / team_attempts if team_attempts else 0.0,
                    "carry_share": totals["carries"] / team_carries if team_carries else 0.0,
                    "target_share": totals["targets"] / team_targets if team_targets else 0.0,
                    "team_opportunities_pg": (team_carries + team_targets) / cutoff,
                }
                features = feature_row(
                    position=position,
                    weeks=cutoff,
                    weekly_points={int(key): float(value) for key, value in weekly.items()},
                    active_weeks=float(group["week"].nunique()),
                    totals=totals,
                    context=context,
                )
                rows.append({
                    "player_id": player_id,
                    "name": str(group["player_display_name"].iloc[-1]),
                    "position": position,
                    "season": season,
                    "cutoff": cutoff,
                    "target_ppg": safe_number(remaining.get(player_id)),
                    **features,
                })
    return pd.DataFrame(rows)


def position_blends(rows: pd.DataFrame, config: dict[str, Any]) -> dict[str, float]:
    validation_parts: list[pd.DataFrame] = []
    raw_parts: list[np.ndarray] = []
    for season in (2020, 2021, 2022, 2023):
        historical = rows[rows["season"] < season]
        held_out = rows[rows["season"] == season]
        if historical.empty or held_out.empty:
            continue
        model = fit_model(config).fit(
            historical[FEATURES].to_numpy(dtype=float), historical["target_ppg"].to_numpy(dtype=float)
        )
        validation_parts.append(held_out)
        raw_parts.append(np.clip(model.predict(held_out[FEATURES].to_numpy(dtype=float)), 0, 35))
    validation = pd.concat(validation_parts, ignore_index=True)
    raw = np.concatenate(raw_parts)
    prior = validation["prior_ppg"].to_numpy(dtype=float)
    target = validation["target_ppg"].to_numpy(dtype=float)
    positions = validation["position"].to_numpy()
    blends: dict[str, float] = {}
    for position in POSITIONS:
        mask = positions == position
        blends[position] = min(
            (0.25, 0.5, 0.75, 1.0),
            key=lambda blend: score(
                target[mask], np.clip(raw[mask] * blend + prior[mask] * (1 - blend), 0, 35)
            ).mae,
        )
    return blends


def apply_position_blends(
    frame: pd.DataFrame,
    raw: np.ndarray,
    baseline: np.ndarray,
    blends: dict[str, float],
) -> np.ndarray:
    weights = np.array([blends.get(str(position), 1.0) for position in frame["position"]])
    return np.clip(raw * weights + baseline * (1 - weights), 0, 35)


def train_in_season_model(seasons: tuple[int, ...]) -> tuple[Any, dict[str, float], dict[str, Any]]:
    rows = in_season_training_rows(seasons)
    train = rows[rows["season"] <= 2022]
    validation = rows[rows["season"] == 2023]
    test = rows[rows["season"] == 2024]
    config, _, validation_report = select_model(train, validation, FEATURES)
    blends = position_blends(rows[rows["season"] <= 2023], config)
    fit_rows = pd.concat([train, validation], ignore_index=True)
    model = fit_model(config).fit(
        fit_rows[FEATURES].to_numpy(dtype=float), fit_rows["target_ppg"].to_numpy(dtype=float)
    )
    test_target = test["target_ppg"].to_numpy(dtype=float)
    baseline = test["prior_ppg"].to_numpy(dtype=float)
    prediction = apply_position_blends(
        test,
        np.clip(model.predict(test[FEATURES].to_numpy(dtype=float)), 0, 35),
        baseline,
        blends,
    )
    model_metrics = score(test_target, prediction)
    baseline_metrics = score(test_target, baseline)
    improvement = (
        (baseline_metrics.mae - model_metrics.mae) / baseline_metrics.mae
        if baseline_metrics.mae else 0.0
    )
    rank_delta = model_metrics.rank_correlation - baseline_metrics.rank_correlation
    slices = evaluation_slices(test, test_target, prediction, baseline)
    position_regressions = {
        position: (
            (slices[position]["model"]["mae"] - slices[position]["baseline"]["mae"])
            / slices[position]["baseline"]["mae"]
        )
        for position in POSITIONS
    }
    checks = [
        {
            "id": "rosMae",
            "label": "Rest-of-season MAE lift",
            "passed": improvement >= GATE_MAE_IMPROVEMENT,
            "actual": round(improvement, 4),
            "requirement": f">= {GATE_MAE_IMPROVEMENT:.0%} versus season-to-date PPG",
        },
        {
            "id": "rosRank",
            "label": "Rest-of-season rank guardrail",
            "passed": rank_delta >= GATE_RANK_TOLERANCE,
            "actual": round(rank_delta, 4),
            "requirement": f">= {GATE_RANK_TOLERANCE:+.2f} versus baseline",
        },
        {
            "id": "rosPositions",
            "label": "Rest-of-season position guardrail",
            "passed": max(position_regressions.values()) <= GATE_POSITION_REGRESSION,
            "actual": round(max(position_regressions.values()), 4),
            "requirement": f"no position worse by more than {GATE_POSITION_REGRESSION:.0%}",
        },
    ]
    final_model = fit_model(config).fit(
        rows[FEATURES].to_numpy(dtype=float), rows["target_ppg"].to_numpy(dtype=float)
    )
    report = {
        "enabled": all(check["passed"] for check in checks),
        "target": "remaining-season PPR points per NFL team game",
        "trainingRows": int(len(train)),
        "validationRows": int(len(validation)),
        "testRows": int(len(test)),
        "model": rounded_metrics(model_metrics),
        "baseline": rounded_metrics(baseline_metrics),
        "maeImprovement": round(improvement, 4),
        "rankCorrelationDelta": round(rank_delta, 4),
        "checks": checks,
        "validation": validation_report,
        "slices": slices,
        "parameters": config,
        "baselineBlendByPosition": {
            position: round(1 - blend, 2) for position, blend in blends.items()
        },
    }
    return final_model, blends, report


def normalized_roster_status(value: Any) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "UNK"
    return str(value).strip().upper() or "UNK"


def roster_event_flags(
    previous_status: Any,
    current_status: Any,
    previous_team: Any,
    current_team: Any,
    inactive_streak: int,
) -> dict[str, float]:
    previous = normalized_roster_status(previous_status)
    current = normalized_roster_status(current_status)
    previous_active = previous in ACTIVE_ROSTER_STATUSES
    current_active = current in ACTIVE_ROSTER_STATUSES
    prior_team = "" if previous_team is None else str(previous_team)
    team = "" if current_team is None else str(current_team)
    return {
        "current_active": float(current_active),
        "availability_up": float(not previous_active and current_active and previous != "UNK"),
        "availability_down": float(previous_active and not current_active),
        "team_change": float(bool(prior_team and team and prior_team != team)),
        "roster_exit": float(current in EXIT_ROSTER_STATUSES),
        "inactive_streak": float(max(0, inactive_streak)),
    }


def event_training_rows(seasons: tuple[int, ...] = EVENT_SEASONS) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for season in seasons:
        roster_path = NFLVERSE / f"roster_weekly_{season}.csv"
        stats_path = NFLVERSE / f"player_stats_{season}.csv"
        if not roster_path.exists() or not stats_path.exists():
            raise FileNotFoundError(
                f"Missing event source for {season}; run `npm run ml:collect` first"
            )
        roster = pd.read_csv(
            roster_path,
            usecols=["team", "position", "status", "full_name", "gsis_id", "week", "game_type"],
            low_memory=False,
        )
        roster = roster[
            (roster["game_type"] == "REG")
            & roster["position"].isin(POSITIONS)
            & roster["gsis_id"].notna()
        ].copy()
        roster["week"] = pd.to_numeric(roster["week"], errors="coerce").fillna(0).astype(int)
        roster = roster[(roster["week"] >= 1) & (roster["week"] <= 18)]
        roster["status"] = roster["status"].map(normalized_roster_status)
        roster = roster.sort_values(["gsis_id", "week", "team"]).drop_duplicates(
            ["gsis_id", "week"], keep="last"
        )

        stats = pd.read_csv(
            stats_path,
            usecols=[
                "player_id",
                "week",
                "season_type",
                "fantasy_points_ppr",
            ],
            low_memory=False,
        )
        stats = stats[(stats["season_type"] == "REG") & stats["player_id"].notna()].copy()
        stats["week"] = pd.to_numeric(stats["week"], errors="coerce").fillna(0).astype(int)
        stats["fantasy_points_ppr"] = pd.to_numeric(
            stats["fantasy_points_ppr"], errors="coerce"
        ).fillna(0.0)
        weekly = stats.groupby(["player_id", "week"])["fantasy_points_ppr"].sum()
        appearances = set(weekly.index)

        for player_id, group in roster.groupby("gsis_id", sort=False):
            ordered = group.sort_values("week")
            prior_row: pd.Series | None = None
            inactive_streak = 0
            for _, current in ordered.iterrows():
                week = int(current["week"])
                status = normalized_roster_status(current["status"])
                inactive_streak = 0 if status in ACTIVE_ROSTER_STATUSES else inactive_streak + 1
                immediate_prior = prior_row if prior_row is not None and int(prior_row["week"]) == week - 1 else None
                previous_status = immediate_prior["status"] if immediate_prior is not None else "UNK"
                previous_team = immediate_prior["team"] if immediate_prior is not None else None
                flags = roster_event_flags(
                    previous_status,
                    status,
                    previous_team,
                    current["team"],
                    inactive_streak,
                )
                prior_row = current
                if week < 4 or week > 14:
                    continue
                prior_points = [
                    float(weekly.get((player_id, prior_week), 0.0))
                    for prior_week in range(week - 3, week + 1)
                ]
                future_points = [
                    float(weekly.get((player_id, future_week), 0.0))
                    for future_week in range(week + 1, week + 5)
                ]
                if not any(prior_points) and not any(future_points):
                    continue
                position = str(current["position"])
                prior4_ppg = float(np.mean(prior_points))
                prior2_ppg = float(np.mean(prior_points[-2:]))
                event_cohort = bool(
                    not flags["current_active"]
                    or flags["availability_up"]
                    or flags["availability_down"]
                    or flags["team_change"]
                    or flags["roster_exit"]
                )
                rows.append({
                    "player_id": str(player_id),
                    "name": str(current["full_name"]),
                    "position": position,
                    "season": season,
                    "week": week,
                    "target_ppg": float(np.mean(future_points)),
                    "prior_ppg": prior4_ppg,
                    "prior4_ppg": prior4_ppg,
                    "prior2_ppg": prior2_ppg,
                    "prior_week_ppg": prior_points[-1],
                    "prior4_games": float(sum((player_id, value) in appearances for value in range(week - 3, week + 1))),
                    "recent_trend": prior2_ppg - prior4_ppg,
                    "event_cohort": event_cohort,
                    **{f"pos_{candidate}": float(position == candidate) for candidate in POSITIONS},
                    **flags,
                })
    return pd.DataFrame(rows)


def bootstrap_mae_improvement(
    truth: np.ndarray,
    candidate: np.ndarray,
    baseline: np.ndarray,
    samples: int = 400,
) -> dict[str, float]:
    if not len(truth):
        return {"lower": 0.0, "median": 0.0, "upper": 0.0}
    rng = np.random.default_rng(42)
    lifts: list[float] = []
    for _ in range(samples):
        indices = rng.integers(0, len(truth), size=len(truth))
        baseline_mae = float(np.mean(np.abs(truth[indices] - baseline[indices])))
        candidate_mae = float(np.mean(np.abs(truth[indices] - candidate[indices])))
        lifts.append((baseline_mae - candidate_mae) / baseline_mae if baseline_mae else 0.0)
    lower, median, upper = np.quantile(lifts, [0.025, 0.5, 0.975])
    return {"lower": round(float(lower), 4), "median": round(float(median), 4), "upper": round(float(upper), 4)}


def train_event_model() -> tuple[Any, dict[str, Any]]:
    rows = event_training_rows()
    train = rows[rows["season"] == 2022]
    validation = rows[rows["season"] == 2023]
    test = rows[rows["season"] == 2024]
    if min(len(train), len(validation), len(test)) == 0:
        raise RuntimeError("Event train, validation, or test split is empty")

    base_config, base_blend, base_validation = select_model(
        train, validation, EVENT_BASE_FEATURES
    )
    event_config, event_blend, event_validation = select_model(
        train, validation, EVENT_FEATURES
    )
    fit_rows = pd.concat([train, validation], ignore_index=True)
    base_model = fit_model(base_config).fit(
        fit_rows[EVENT_BASE_FEATURES].to_numpy(dtype=float),
        fit_rows["target_ppg"].to_numpy(dtype=float),
    )
    event_model = fit_model(event_config).fit(
        fit_rows[EVENT_FEATURES].to_numpy(dtype=float),
        fit_rows["target_ppg"].to_numpy(dtype=float),
    )
    baseline = test["prior4_ppg"].to_numpy(dtype=float)
    truth = test["target_ppg"].to_numpy(dtype=float)
    base_prediction = np.clip(
        base_model.predict(test[EVENT_BASE_FEATURES].to_numpy(dtype=float)) * base_blend
        + baseline * (1 - base_blend),
        0,
        35,
    )
    event_prediction = np.clip(
        event_model.predict(test[EVENT_FEATURES].to_numpy(dtype=float)) * event_blend
        + baseline * (1 - event_blend),
        0,
        35,
    )
    event_mask = test["event_cohort"].to_numpy(dtype=bool)
    event_truth = truth[event_mask]
    event_candidate = event_prediction[event_mask]
    event_base = base_prediction[event_mask]
    candidate_metrics = score(event_truth, event_candidate)
    base_metrics = score(event_truth, event_base)
    all_candidate_metrics = score(truth, event_prediction)
    all_base_metrics = score(truth, base_prediction)
    mae_improvement = (
        (base_metrics.mae - candidate_metrics.mae) / base_metrics.mae
        if base_metrics.mae else 0.0
    )
    full_mae_regression = (
        (all_candidate_metrics.mae - all_base_metrics.mae) / all_base_metrics.mae
        if all_base_metrics.mae else 0.0
    )
    rank_delta = candidate_metrics.rank_correlation - base_metrics.rank_correlation
    position_changes: dict[str, float] = {}
    for position in POSITIONS:
        mask = event_mask & (test["position"].to_numpy() == position)
        if mask.sum() < 20:
            continue
        position_base = score(truth[mask], base_prediction[mask]).mae
        position_candidate = score(truth[mask], event_prediction[mask]).mae
        position_changes[position] = (
            (position_base - position_candidate) / position_base if position_base else 0.0
        )
    worst_position = min(position_changes.values()) if position_changes else -1.0
    checks = [
        {
            "id": "eventRows",
            "label": "Held-out event sample",
            "passed": int(event_mask.sum()) >= EVENT_MIN_TEST_ROWS,
            "actual": int(event_mask.sum()),
            "requirement": f">= {EVENT_MIN_TEST_ROWS} player-week events",
        },
        {
            "id": "eventMae",
            "label": "Event-cohort MAE lift",
            "passed": mae_improvement >= EVENT_MAE_IMPROVEMENT,
            "actual": round(mae_improvement, 4),
            "requirement": f">= {EVENT_MAE_IMPROVEMENT:.0%} versus the status-blind model",
        },
        {
            "id": "eventRank",
            "label": "Event-cohort rank guardrail",
            "passed": rank_delta >= GATE_RANK_TOLERANCE,
            "actual": round(rank_delta, 4),
            "requirement": f">= {GATE_RANK_TOLERANCE:+.2f} versus the status-blind model",
        },
        {
            "id": "eventOverall",
            "label": "All-player MAE guardrail",
            "passed": full_mae_regression <= EVENT_FULL_MAE_TOLERANCE,
            "actual": round(full_mae_regression, 4),
            "requirement": f"no more than {EVENT_FULL_MAE_TOLERANCE:.0%} worse",
        },
        {
            "id": "eventPositions",
            "label": "Event position guardrail",
            "passed": worst_position >= -GATE_POSITION_REGRESSION,
            "actual": round(worst_position, 4),
            "requirement": f"no position worse by more than {GATE_POSITION_REGRESSION:.0%}",
        },
    ]

    signal_definitions = [
        ("availability_up", "Activated", "up"),
        ("availability_down", "Moved off active roster", "down"),
        ("team_change", "Changed teams", "watch"),
        ("roster_exit", "Cut or retired", "down"),
        ("current_inactive", "Currently inactive", "down"),
    ]
    signals: list[dict[str, Any]] = []
    for key, label, direction in signal_definitions:
        mask = (test["current_active"].to_numpy(dtype=float) == 0) if key == "current_inactive" else (test[key].to_numpy(dtype=float) == 1)
        sample_size = int(mask.sum())
        if not sample_size:
            continue
        model_delta = float(np.mean(event_prediction[mask] - base_prediction[mask]))
        actual_delta = float(np.mean(truth[mask] - base_prediction[mask]))
        observed_change = float(np.mean(truth[mask] - baseline[mask]))
        signals.append({
            "id": key,
            "label": label,
            "direction": direction,
            "sampleSize": sample_size,
            "modelPpgDelta": round(model_delta, 2),
            "actualResidualPpg": round(actual_delta, 2),
            "observedPpgChange": round(observed_change, 2),
            "confidence": "high" if sample_size >= 200 else "medium" if sample_size >= 75 else "low",
        })

    final_model = fit_model(event_config).fit(
        rows[EVENT_FEATURES].to_numpy(dtype=float), rows["target_ppg"].to_numpy(dtype=float)
    )
    report = {
        "generatedAt": utc_now(),
        "enabled": all(check["passed"] for check in checks),
        "target": "PPR points per NFL team week over the next four weeks",
        "trainingSeason": 2022,
        "validationSeason": 2023,
        "testSeason": 2024,
        "trainingRows": int(len(train)),
        "validationRows": int(len(validation)),
        "testRows": int(len(test)),
        "eventTestRows": int(event_mask.sum()),
        "eventModel": rounded_metrics(candidate_metrics),
        "statusBlindModel": rounded_metrics(base_metrics),
        "allPlayers": {
            "eventModel": rounded_metrics(all_candidate_metrics),
            "statusBlindModel": rounded_metrics(all_base_metrics),
        },
        "maeImprovement": round(mae_improvement, 4),
        "maeImprovementInterval": bootstrap_mae_improvement(
            event_truth, event_candidate, event_base
        ),
        "rankCorrelationDelta": round(rank_delta, 4),
        "positionChanges": {key: round(value, 4) for key, value in position_changes.items()},
        "checks": checks,
        "signals": signals,
        "features": EVENT_FEATURES,
        "parameters": event_config,
        "baselineBlend": round(1 - event_blend, 2),
        "validation": {
            "eventModel": event_validation,
            "statusBlindModel": base_validation,
        },
        "source": WEEKLY_ROSTER_URL.format(season="{season}"),
    }
    return final_model, report


def current_in_season_features(current: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    if current.empty:
        return current.copy(), 0
    week = max(1, min(17, int(current["active_weeks"].max())))
    adjusted = current.copy()
    rate_features = [
        "prior_ppg",
        "late4_ppg",
        "late8_ppg",
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
        "team_opportunities_pg",
    ]
    factor = SOURCE_WEEKS.get(default_source_season(), 18) / week
    adjusted[rate_features] = adjusted[rate_features] * factor
    adjusted["games_played_share"] = adjusted["active_weeks"] / week
    return adjusted, week


def train_and_export(limit: int) -> dict[str, Any]:
    seasons = DEFAULT_SEASONS
    summaries = historical_summaries(seasons)
    rows = training_rows(summaries)
    train = rows[rows["season"] <= 2021]
    validation = rows[rows["season"] == 2022]
    test = rows[rows["season"] == 2023]
    if min(len(train), len(validation), len(test)) == 0:
        raise RuntimeError("Time-based train, validation, or test split is empty")

    context_config, context_blend, context_validation_report = select_model(
        train, validation, FEATURES
    )
    base_config, base_blend, base_validation_report = select_model(
        train, validation, BASE_FEATURES
    )
    validation_target = validation["target_ppg"].to_numpy(dtype=float)
    validation_baselines = simple_baselines(train, validation)
    baseline_name = min(
        validation_baselines,
        key=lambda name: score(validation_target, validation_baselines[name]).mae,
    )
    fit_rows = pd.concat([train, validation], ignore_index=True)
    context_model = fit_model(context_config).fit(
        fit_rows[FEATURES].to_numpy(dtype=float), fit_rows["target_ppg"].to_numpy(dtype=float)
    )
    base_model = fit_model(base_config).fit(
        fit_rows[BASE_FEATURES].to_numpy(dtype=float), fit_rows["target_ppg"].to_numpy(dtype=float)
    )
    test_baselines = simple_baselines(fit_rows, test)
    test_baseline = test_baselines[baseline_name]
    test_prior = test["prior_ppg"].to_numpy(dtype=float)
    test_target = test["target_ppg"].to_numpy(dtype=float)
    context_prediction = np.clip(
        context_model.predict(test[FEATURES].to_numpy(dtype=float)) * context_blend
        + test_prior * (1 - context_blend),
        0,
        35,
    )
    base_prediction = np.clip(
        base_model.predict(test[BASE_FEATURES].to_numpy(dtype=float)) * base_blend
        + test_prior * (1 - base_blend),
        0,
        35,
    )
    context_metrics = score(test_target, context_prediction)
    base_model_metrics = score(test_target, base_prediction)
    context_improvement = (
        (base_model_metrics.mae - context_metrics.mae) / base_model_metrics.mae
        if base_model_metrics.mae else 0.0
    )
    context_position_changes: dict[str, float] = {}
    for position in POSITIONS:
        mask = test["position"].to_numpy() == position
        base_position_mae = score(test_target[mask], base_prediction[mask]).mae
        context_position_mae = score(test_target[mask], context_prediction[mask]).mae
        context_position_changes[position] = (
            (base_position_mae - context_position_mae) / base_position_mae
            if base_position_mae else 0.0
        )
    context_gate = {
        "mae": context_improvement >= CONTEXT_MAE_IMPROVEMENT,
        "positionsImproved": sum(value > 0 for value in context_position_changes.values())
        >= CONTEXT_POSITIONS_REQUIRED,
        "positionRegression": min(context_position_changes.values())
        >= -CONTEXT_POSITION_REGRESSION,
    }
    context_enabled = all(context_gate.values())
    if context_enabled:
        config, blend, validation_report = context_config, context_blend, context_validation_report
        production_features = FEATURES
        selected_model = context_model
        test_prediction = context_prediction
        model_version = "season-transition-hgb-v1.2"
    else:
        config, blend, validation_report = base_config, base_blend, base_validation_report
        production_features = BASE_FEATURES
        selected_model = base_model
        test_prediction = base_prediction
        model_version = "season-transition-hgb-v1.1"
    test_model_metrics = score(test_target, test_prediction)
    test_baseline_metrics = score(test_target, test_baseline)
    improvement = (
        (test_baseline_metrics.mae - test_model_metrics.mae) / test_baseline_metrics.mae
        if test_baseline_metrics.mae
        else 0.0
    )
    rank_delta = test_model_metrics.rank_correlation - test_baseline_metrics.rank_correlation

    calibration_point_model = fit_model(config).fit(
        train[production_features].to_numpy(dtype=float), train["target_ppg"].to_numpy(dtype=float)
    )
    calibration_lower_model = fit_model(config, loss="quantile", quantile=0.2).fit(
        train[production_features].to_numpy(dtype=float), train["target_ppg"].to_numpy(dtype=float)
    )
    calibration_upper_model = fit_model(config, loss="quantile", quantile=0.8).fit(
        train[production_features].to_numpy(dtype=float), train["target_ppg"].to_numpy(dtype=float)
    )
    x_validation = validation[production_features].to_numpy(dtype=float)
    validation_prior = validation["prior_ppg"].to_numpy(dtype=float)
    validation_point = np.clip(
        calibration_point_model.predict(x_validation) * blend + validation_prior * (1 - blend),
        0,
        35,
    )
    validation_lower = np.clip(calibration_lower_model.predict(x_validation), 0, 35)
    validation_upper = np.clip(calibration_upper_model.predict(x_validation), 0, 35)
    scales = interval_scales(
        validation,
        validation_target,
        validation_point,
        validation_lower,
        validation_upper,
    )

    test_lower_model = fit_model(config, loss="quantile", quantile=0.2).fit(
        fit_rows[production_features].to_numpy(dtype=float), fit_rows["target_ppg"].to_numpy(dtype=float)
    )
    test_upper_model = fit_model(config, loss="quantile", quantile=0.8).fit(
        fit_rows[production_features].to_numpy(dtype=float), fit_rows["target_ppg"].to_numpy(dtype=float)
    )
    x_test = test[production_features].to_numpy(dtype=float)
    test_lower, test_upper = apply_interval_scales(
        test,
        test_prediction,
        np.clip(test_lower_model.predict(x_test), 0, 35),
        np.clip(test_upper_model.predict(x_test), 0, 35),
        scales,
    )
    test_interval_metrics = interval_metrics(test_target, test_lower, test_upper)
    interval_by_position = {}
    for position in POSITIONS:
        mask = test["position"].to_numpy() == position
        interval_by_position[position] = {
            "rows": int(mask.sum()),
            **{
                key: round(value, 4)
                for key, value in interval_metrics(
                    test_target[mask], test_lower[mask], test_upper[mask]
                ).items()
            },
        }

    test_slices = evaluation_slices(test, test_target, test_prediction, test_baseline)
    position_regressions = {
        position: (
            (test_slices[position]["model"]["mae"] - test_slices[position]["baseline"]["mae"])
            / test_slices[position]["baseline"]["mae"]
        )
        for position in POSITIONS
    }
    gate_checks = {
        "mae": improvement >= GATE_MAE_IMPROVEMENT,
        "rank": rank_delta >= GATE_RANK_TOLERANCE,
        "positions": max(position_regressions.values()) <= GATE_POSITION_REGRESSION,
        "interval": INTERVAL_COVERAGE_RANGE[0]
        <= test_interval_metrics["coverage"]
        <= INTERVAL_COVERAGE_RANGE[1],
    }
    enabled = all(gate_checks.values())

    final_rows = rows[rows["season"] <= 2023]
    x_final = final_rows[production_features].to_numpy(dtype=float)
    y_final = final_rows["target_ppg"].to_numpy(dtype=float)
    final_model = fit_model(config).fit(x_final, y_final)
    lower_model = fit_model(config, loss="quantile", quantile=0.2).fit(x_final, y_final)
    upper_model = fit_model(config, loss="quantile", quantile=0.8).fit(x_final, y_final)

    importance = permutation_importance(
        selected_model,
        test[production_features].to_numpy(dtype=float),
        test_target,
        scoring="neg_mean_absolute_error",
        n_repeats=4,
        random_state=42,
    )
    feature_importance = sorted(
        [
            {"feature": feature, "importance": round(max(0.0, float(value)), 5)}
            for feature, value in zip(production_features, importance.importances_mean, strict=True)
        ],
        key=lambda item: item["importance"],
        reverse=True,
    )[:8]

    freshness = snapshot_freshness()
    in_season_model, in_season_blends, in_season_report = train_in_season_model(seasons)
    event_model, event_report = train_event_model()
    players = tradyr_players(limit, refresh=False)
    current, metadata = current_feature_rows(players)
    projections: dict[str, Any] = {}
    current_ros, current_week = current_in_season_features(current)
    current_month = datetime.now(timezone.utc).month
    use_rest_of_season = (
        in_season_report["enabled"]
        and current_month in (1, 9, 10, 11, 12)
        and current_week >= 4
        and current_week < 18
    )
    rest_of_season = np.array([])
    if use_rest_of_season and not current_ros.empty:
        ros_prior = current_ros["prior_ppg"].to_numpy(dtype=float)
        rest_of_season = apply_position_blends(
            current_ros,
            np.clip(in_season_model.predict(current_ros[FEATURES].to_numpy(dtype=float)), 0, 35),
            ros_prior,
            in_season_blends,
        )
    if not current.empty:
        x_current = current[production_features].to_numpy(dtype=float)
        baseline = current["prior_ppg"].to_numpy(dtype=float)
        raw_expected = np.clip(final_model.predict(x_current), 0, 35)
        raw_floor = np.clip(lower_model.predict(x_current), 0, 35)
        raw_ceiling = np.clip(upper_model.predict(x_current), 0, 35)
        expected = np.clip(raw_expected * blend + baseline * (1 - blend), 0, 35)
        floor, ceiling = apply_interval_scales(
            current,
            expected,
            raw_floor,
            raw_ceiling,
            scales,
        )
        for index, sleeper_id in enumerate(current["sleeper_id"].astype(str)):
            info = metadata[sleeper_id]
            interval = float(ceiling[index] - floor[index])
            history_factor = min(1.0, info["gamesObserved"] / 14)
            width_factor = max(0.0, 1 - interval / max(8.0, expected[index] + 4))
            confidence = max(0.4, min(0.92, 0.46 + history_factor * 0.25 + width_factor * 0.18))
            projections[sleeper_id] = {
                **info,
                "productionModel": model_version,
                "expectedPpg": round(float(expected[index]), 1),
                "floorPpg": round(float(floor[index]), 1),
                "ceilingPpg": round(float(ceiling[index]), 1),
                "confidence": round(confidence, 2),
                "drivers": projection_drivers(current.iloc[index], info),
            }
            if use_rest_of_season:
                projections[sleeper_id]["restOfSeasonPpg"] = round(float(rest_of_season[index]), 1)
                projections[sleeper_id]["restOfSeasonWeek"] = current_week

    generated_at = utc_now()
    prediction_digest = hashlib.sha256(
        json.dumps(projections, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    previous_health = (
        json.loads((PUBLIC_DATA / "model-health.json").read_text())
        if (PUBLIC_DATA / "model-health.json").exists()
        else {}
    )
    repeatable = previous_health.get("predictionDigest") == prediction_digest
    baseline_report = [
        {
            "id": name,
            "selected": name == baseline_name,
            "validation": rounded_metrics(score(validation_target, validation_baselines[name])),
            "test": rounded_metrics(score(test_target, test_baselines[name])),
        }
        for name in validation_baselines
    ]
    gate_details = [
        {
            "id": "mae",
            "label": "Held-out MAE lift",
            "passed": gate_checks["mae"],
            "actual": round(improvement, 4),
            "requirement": f">= {GATE_MAE_IMPROVEMENT:.0%} versus the best simple baseline",
        },
        {
            "id": "rank",
            "label": "Rank correlation guardrail",
            "passed": gate_checks["rank"],
            "actual": round(rank_delta, 4),
            "requirement": f">= {GATE_RANK_TOLERANCE:+.2f} versus baseline",
        },
        {
            "id": "positions",
            "label": "Position regression guardrail",
            "passed": gate_checks["positions"],
            "actual": round(max(position_regressions.values()), 4),
            "requirement": f"no position worse by more than {GATE_POSITION_REGRESSION:.0%}",
        },
        {
            "id": "interval",
            "label": "Prediction interval calibration",
            "passed": gate_checks["interval"],
            "actual": round(test_interval_metrics["coverage"], 4),
            "requirement": (
                f"{INTERVAL_COVERAGE_RANGE[0]:.0%}-{INTERVAL_COVERAGE_RANGE[1]:.0%} "
                "coverage for the nominal 20-80 range"
            ),
        },
    ]
    context_gate_details = [
        {
            "id": "contextMae",
            "label": "V1.2 incremental MAE lift",
            "passed": context_gate["mae"],
            "actual": round(context_improvement, 4),
            "requirement": f">= {CONTEXT_MAE_IMPROVEMENT:.0%} versus V1.1",
        },
        {
            "id": "contextPositions",
            "label": "Positions improved",
            "passed": context_gate["positionsImproved"],
            "actual": sum(value > 0 for value in context_position_changes.values()),
            "requirement": f">= {CONTEXT_POSITIONS_REQUIRED} of 4 positions",
        },
        {
            "id": "contextRegression",
            "label": "Worst position regression",
            "passed": context_gate["positionRegression"],
            "actual": round(min(context_position_changes.values()), 4),
            "requirement": f">= -{CONTEXT_POSITION_REGRESSION:.0%}",
        },
    ]
    refresh_gate_details = [
        {
            "id": "snapshotFreshness",
            "label": "Current data freshness",
            "passed": not freshness["stale"],
            "actual": 0 if not freshness["stale"] else 1,
            "requirement": "snapshot is no more than 8 days old",
        },
        {
            "id": "projectionCoverage",
            "label": "Current projection coverage",
            "passed": len(projections) >= 200,
            "actual": len(projections),
            "requirement": ">= 200 current players",
        },
        {
            "id": "deterministicRefresh",
            "label": "Repeatable refresh artifact",
            "passed": repeatable,
            "actual": 1 if repeatable else 0,
            "requirement": "two consecutive runs produce identical projections",
        },
    ]
    refresh_enabled = all(check["passed"] for check in refresh_gate_details)
    v13_gate_details = [*refresh_gate_details, *in_season_report["checks"]]
    v13_enabled = refresh_enabled and in_season_report["enabled"]
    report = {
        "generatedAt": generated_at,
        "model": model_version,
        "target": "next-season PPR points per NFL team game",
        "gate": {
            "enabled": enabled,
            "requiredMaeImprovement": GATE_MAE_IMPROVEMENT,
            "observedMaeImprovement": round(improvement, 4),
            "checks": gate_details,
        },
        "contextCandidate": {
            "enabled": context_enabled,
            "model": rounded_metrics(context_metrics),
            "v11": rounded_metrics(base_model_metrics),
            "maeImprovement": round(context_improvement, 4),
            "positionChanges": {
                key: round(value, 4) for key, value in context_position_changes.items()
            },
            "checks": context_gate_details,
        },
        "refreshPipeline": {
            "enabled": refresh_enabled,
            "predictionDigest": prediction_digest,
            "checks": refresh_gate_details,
            **freshness,
        },
        "inSeasonModel": in_season_report,
        "eventModel": event_report,
        "data": {
            "seasons": list(seasons),
            "trainingRows": int(len(train)),
            "validationRows": int(len(validation)),
            "testRows": int(len(test)),
            "currentPlayers": len(projections),
            **freshness,
        },
        "selection": {
            "parameters": config,
            "baselineBlend": round(1 - blend, 2),
            "bestSimpleBaseline": baseline_name,
            "features": production_features,
        },
        "validation": {**validation_report, "baselines": baseline_report},
        "test": {
            "model": rounded_metrics(test_model_metrics),
            "baseline": rounded_metrics(test_baseline_metrics),
            "baselineName": baseline_name,
            "baselines": baseline_report,
            "rankCorrelationDelta": round(rank_delta, 4),
            "slices": test_slices,
        },
        "predictionInterval": {
            "lowerQuantile": 0.2,
            "upperQuantile": 0.8,
            "targetCoverage": INTERVAL_TARGET_COVERAGE,
            "test": {
                key: round(value, 4) for key, value in test_interval_metrics.items()
            },
            "byPosition": interval_by_position,
            "calibrationScales": {key: round(value, 4) for key, value in scales.items()},
        },
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
        **freshness,
        "outlook": "rest-of-season" if use_rest_of_season else "next-season",
        "restOfSeasonWeek": current_week if use_rest_of_season else None,
        "projections": projections if enabled else {},
    }

    model_health = {
        "generatedAt": generated_at,
        "model": report["model"],
        "enabled": enabled,
        "testSeason": 2024,
        "target": report["target"],
        "currentPlayers": len(projections),
        "freshness": freshness,
        "metrics": {
            "model": rounded_metrics(test_model_metrics),
            "baselineName": baseline_name,
            "baseline": rounded_metrics(test_baseline_metrics),
            "maeImprovement": round(improvement, 4),
            "rankCorrelationDelta": round(rank_delta, 4),
        },
        "gates": gate_details,
        "phaseGates": {
            "v1.1": {"enabled": enabled, "checks": gate_details},
            "v1.2": {"enabled": context_enabled, "checks": context_gate_details},
            "v1.3": {"enabled": v13_enabled, "checks": v13_gate_details},
            "v2.1": {"enabled": event_report["enabled"], "checks": event_report["checks"]},
        },
        "predictionDigest": prediction_digest,
        "baselines": baseline_report,
        "interval": report["predictionInterval"],
        "slices": [
            {
                "id": name,
                "rows": values["rows"],
                "model": values["model"],
                "baseline": values["baseline"],
                "maeImprovement": round(
                    (values["baseline"]["mae"] - values["model"]["mae"])
                    / values["baseline"]["mae"],
                    4,
                ) if values["baseline"]["mae"] else 0.0,
            }
            for name, values in test_slices.items()
        ],
        "featureImportance": feature_importance,
    }

    (REPORTS / "latest.json").write_text(json.dumps(report, indent=2) + "\n")
    (PUBLIC_DATA / "player-projections.json").write_text(json.dumps(projection_bundle, separators=(",", ":")) + "\n")
    (PUBLIC_DATA / "model-health.json").write_text(json.dumps(model_health, separators=(",", ":")) + "\n")
    (PUBLIC_DATA / "event-model-health.json").write_text(
        json.dumps(event_report, separators=(",", ":")) + "\n"
    )
    with (ARTIFACTS / "production_model.pkl").open("wb") as file:
        pickle.dump(
            {
                "model": final_model,
                "lower": lower_model,
                "upper": upper_model,
                "in_season": in_season_model,
                "in_season_blends": in_season_blends,
                "event_model": event_model,
                "event_features": EVENT_FEATURES,
                "features": production_features,
                "blend": blend,
                "interval_scales": scales,
                "report": report,
            },
            file,
        )

    print(
        f"Held-out MAE: model={test_model_metrics.mae:.3f}, "
        f"{baseline_name}={test_baseline_metrics.mae:.3f}, improvement={improvement:.1%}"
    )
    print(f"Gate: {'ENABLED' if enabled else 'DISABLED'}; current projections={len(projections)}")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("collect", "train", "refresh"))
    parser.add_argument("--limit", type=int, default=240, help="Current Tradyr players to snapshot")
    parser.add_argument("--refresh", action="store_true", help="Replace cached source downloads")
    parser.add_argument("--season", type=int, default=default_source_season(), help="NFL season for current inputs")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_dirs()
    if args.command in ("collect", "refresh"):
        collect_nflverse(DEFAULT_SEASONS, args.refresh)
        collect_tradyr(max(25, min(500, args.limit)), args.refresh, args.season)
    if args.command in ("train", "refresh"):
        train_and_export(max(25, min(500, args.limit)))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Point-in-time-safe public data adapters for the rookie research model.

The adapters deliberately stop at raw collection and transparent aggregation.
They do not assign player grades or hand-tune player values. Raw files and
derived joins remain gitignored; the model report exposes source hashes,
coverage, and join methods.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd


CFB_FIRST_SEASON = 2014
CFB_LAST_COMPLETE_SEASON = 2025
NFL_FIRST_ROOKIE_SEASON = 2019
NFL_LAST_COMPLETE_SEASON = 2025

CFB_PARQUET_URL = (
    "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/"
    "player_stats/parquet/player_stats_{season}.parquet"
)
NFL_PLAYER_STATS_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/stats_player/"
    "stats_player_reg_{season}.parquet"
)
NFL_COMBINE_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/combine/combine.parquet"
)

COLLEGE_FEATURES = [
    "college_data_present",
    "college_seasons_observed",
    "college_career_games",
    "college_final_games",
    "college_final_scrimmage_yards_per_game",
    "college_final_target_share",
    "college_final_receiving_yards_share",
    "college_final_rushing_yards_share",
    "college_final_scrimmage_yards_share",
    "college_max_target_share",
    "college_max_scrimmage_yards_share",
    "college_final_yards_per_target",
    "college_final_yards_per_carry",
    "college_final_pass_yards_per_attempt",
    "college_final_pass_yards_share",
    "college_final_pass_yards_per_game",
]

ATHLETIC_FEATURES = [
    "combine_data_present",
    "combine_forty",
    "combine_vertical",
    "combine_broad_jump",
    "combine_cone",
    "combine_shuttle",
    "combine_speed_score",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_file(url: str, path: Path, *, refresh: bool, offline: bool) -> dict[str, Any]:
    """Download one immutable research input and return its local evidence."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not refresh:
        return {
            "url": url,
            "path": str(path),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
            "status": "cached",
        }
    if offline:
        raise FileNotFoundError(f"Offline rookie build is missing {path}")

    request = urllib.request.Request(url, headers={"User-Agent": "RosterLab-private-research/1.0"})
    temporary = path.with_suffix(path.suffix + ".partial")
    try:
        with urllib.request.urlopen(request, timeout=90) as response, temporary.open("wb") as target:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                target.write(chunk)
        os.replace(temporary, path)
    except (OSError, urllib.error.URLError):
        temporary.unlink(missing_ok=True)
        raise
    return {
        "url": url,
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "status": "downloaded",
    }


def collect_public_rookie_sources(
    raw_root: Path,
    *,
    refresh: bool,
    offline: bool,
    cfb_seasons: Iterable[int] = range(CFB_FIRST_SEASON, CFB_LAST_COMPLETE_SEASON + 1),
    nfl_seasons: Iterable[int] = range(NFL_FIRST_ROOKIE_SEASON, NFL_LAST_COMPLETE_SEASON + 1),
) -> dict[str, Any]:
    """Collect the bounded college, combine, and NFL outcome datasets."""
    cfb_entries = []
    for season in cfb_seasons:
        cfb_entries.append(download_file(
            CFB_PARQUET_URL.format(season=season),
            raw_root / "cfbfastR" / f"player_stats_{season}.parquet",
            refresh=refresh,
            offline=offline,
        ))
    nfl_entries = []
    for season in nfl_seasons:
        nfl_entries.append(download_file(
            NFL_PLAYER_STATS_URL.format(season=season),
            raw_root / "nflverse" / f"stats_player_reg_{season}.parquet",
            refresh=refresh,
            offline=offline,
        ))
    combine = download_file(
        NFL_COMBINE_URL,
        raw_root / "nflverse" / "combine.parquet",
        refresh=refresh,
        offline=offline,
    )
    manifest = {
        "retrievedAt": utc_now(),
        "college": {
            "provider": "sportsdataverse cfbfastR-data",
            "license": "repository license and upstream ESPN terms apply",
            "files": cfb_entries,
        },
        "nflOutcomes": {
            "provider": "nflverse player stats",
            "license": "CC-BY-4.0",
            "files": nfl_entries,
        },
        "combine": {
            "provider": "nflverse combine data sourced from Pro Football Reference",
            "license": "CC-BY-4.0",
            "files": [combine],
        },
    }
    manifest_path = raw_root / "public-source-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def _numeric_id(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").astype("Int64").astype("string")


def _role_events(
    frame: pd.DataFrame,
    *,
    id_column: str,
    name_column: str,
    value_columns: dict[str, str | float],
    use_opponent_as_team: bool = False,
) -> pd.DataFrame:
    mask = frame[id_column].notna()
    if not mask.any():
        return pd.DataFrame()
    source = frame.loc[mask]
    result = pd.DataFrame({
        "season": source["season"].astype(int),
        "game_id": source["game_id"].astype(str),
        "observed_team": source["opponent" if use_opponent_as_team else "team"].astype(str),
        "player_id": _numeric_id(source[id_column]),
        "player_name": source[name_column].astype(str),
    })
    for output, input_value in value_columns.items():
        if isinstance(input_value, str):
            result[output] = pd.to_numeric(source[input_value], errors="coerce").fillna(0).to_numpy()
        else:
            result[output] = float(input_value)
    return result


def aggregate_college_season(frame: pd.DataFrame) -> pd.DataFrame:
    """Aggregate cfbfastR play participants into transparent player seasons."""
    stat_columns = [
        "receptions", "receiving_yards", "targets", "carries", "rushing_yards",
        "completions", "incompletions", "interceptions_thrown", "passing_yards",
        "touchdowns",
    ]
    events = [
        _role_events(
            frame,
            id_column="reception_player_id",
            name_column="reception_player",
            value_columns={"receptions": 1.0, "receiving_yards": "reception_yds"},
        ),
        _role_events(
            frame,
            id_column="target_player_id",
            name_column="target_player",
            value_columns={"targets": "target_stat"},
        ),
        _role_events(
            frame,
            id_column="rush_player_id",
            name_column="rush_player",
            value_columns={"carries": 1.0, "rushing_yards": "rush_yds"},
        ),
        _role_events(
            frame,
            id_column="completion_player_id",
            name_column="completion_player",
            value_columns={"completions": 1.0, "passing_yards": "completion_yds"},
        ),
        _role_events(
            frame,
            id_column="incompletion_player_id",
            name_column="incompletion_player",
            value_columns={"incompletions": "incompletion_stat"},
        ),
        _role_events(
            frame,
            id_column="interception_thrown_player_id",
            name_column="interception_thrown_player",
            value_columns={"interceptions_thrown": "interception_thrown_stat"},
            use_opponent_as_team=True,
        ),
        _role_events(
            frame,
            id_column="touchdown_player_id",
            name_column="touchdown_player",
            value_columns={"touchdowns": "touchdown_stat"},
        ),
    ]
    events = [event for event in events if not event.empty]
    if not events:
        return pd.DataFrame()
    combined = pd.concat(events, ignore_index=True)
    for column in stat_columns:
        if column not in combined:
            combined[column] = 0.0
        combined[column] = pd.to_numeric(combined[column], errors="coerce").fillna(0.0)

    # A handful of change-of-possession/lateral rows carry the opponent in the
    # play-level team field. The modal offensive team for the player-season is
    # more stable and does not require a player-specific alias table.
    team_counts = (
        combined.groupby(["season", "player_id", "observed_team"], dropna=False)
        .size()
        .rename("event_count")
        .reset_index()
        .sort_values(
            ["season", "player_id", "event_count", "observed_team"],
            ascending=[True, True, False, True],
        )
    )
    primary_team = team_counts.drop_duplicates(["season", "player_id"])[
        ["season", "player_id", "observed_team"]
    ].rename(columns={"observed_team": "team"})

    names = (
        combined.groupby(["season", "player_id", "player_name"], dropna=False)
        .size()
        .rename("event_count")
        .reset_index()
        .sort_values(
            ["season", "player_id", "event_count", "player_name"],
            ascending=[True, True, False, True],
        )
        .drop_duplicates(["season", "player_id"])[["season", "player_id", "player_name"]]
    )
    totals = combined.groupby(["season", "player_id"], dropna=False)[stat_columns].sum().reset_index()
    games = (
        combined.groupby(["season", "player_id"], dropna=False)["game_id"]
        .nunique()
        .rename("games")
        .reset_index()
    )
    players = totals.merge(games, on=["season", "player_id"]).merge(
        primary_team, on=["season", "player_id"]
    ).merge(names, on=["season", "player_id"])
    players["pass_attempts"] = (
        players["completions"] + players["incompletions"] + players["interceptions_thrown"]
    )
    players["scrimmage_yards"] = players["receiving_yards"] + players["rushing_yards"]

    team_sums = players.groupby(["season", "team"])[
        ["targets", "receiving_yards", "carries", "rushing_yards", "scrimmage_yards", "passing_yards"]
    ].transform("sum")
    for stat in ("targets", "receiving_yards", "rushing_yards", "scrimmage_yards", "passing_yards"):
        denominator = team_sums[stat].replace(0, np.nan)
        players[f"{stat}_share"] = players[stat] / denominator

    games_denom = players["games"].replace(0, np.nan)
    players["scrimmage_yards_per_game"] = players["scrimmage_yards"] / games_denom
    players["passing_yards_per_game"] = players["passing_yards"] / games_denom
    players["yards_per_target"] = players["receiving_yards"] / players["targets"].replace(0, np.nan)
    players["yards_per_carry"] = players["rushing_yards"] / players["carries"].replace(0, np.nan)
    players["pass_yards_per_attempt"] = players["passing_yards"] / players["pass_attempts"].replace(0, np.nan)
    return players.sort_values(["season", "team", "player_name"]).reset_index(drop=True)


def build_college_player_seasons(raw_root: Path, processed_root: Path) -> pd.DataFrame:
    selected_columns = [
        "game_id", "season", "team", "opponent",
        "reception_player_id", "reception_player", "reception_yds",
        "completion_player_id", "completion_player", "completion_yds",
        "rush_player_id", "rush_player", "rush_yds",
        "interception_thrown_player_id", "interception_thrown_player", "interception_thrown_stat",
        "touchdown_player_id", "touchdown_player", "touchdown_stat",
        "incompletion_player_id", "incompletion_player", "incompletion_stat",
        "target_player_id", "target_player", "target_stat",
    ]
    seasons = []
    for path in sorted((raw_root / "cfbfastR").glob("player_stats_*.parquet")):
        frame = pd.read_parquet(path, columns=selected_columns)
        seasons.append(aggregate_college_season(frame))
    if not seasons:
        raise FileNotFoundError("No cfbfastR player-stat files were collected")
    result = pd.concat(seasons, ignore_index=True)
    processed_root.mkdir(parents=True, exist_ok=True)
    result.to_csv(processed_root / "college-player-seasons.csv", index=False)
    return result


def _finite_or_nan(value: Any) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else math.nan
    except (TypeError, ValueError):
        return math.nan


def build_college_features(universe: pd.DataFrame, player_seasons: pd.DataFrame) -> pd.DataFrame:
    """Join pre-draft college production using the stable ESPN athlete ID."""
    by_espn = {
        identifier: group.sort_values("season")
        for identifier, group in player_seasons.groupby(player_seasons["player_id"].astype(str))
    }
    rows: list[dict[str, Any]] = []
    for _, player in universe.iterrows():
        identifier = str(player.get("espn_id") or "").replace("NA", "")
        draft_year = int(float(player["draft_year"])) if pd.notna(player.get("draft_year")) else 0
        career = by_espn.get(identifier, pd.DataFrame())
        if not career.empty:
            career = career[(career["season"] <= draft_year - 1) & (career["season"] >= draft_year - 6)]
        present = not career.empty
        final = career.iloc[-1] if present else None
        rows.append({
            "fp_id": str(player.get("fp_id") or ""),
            "normalized_name": str(player.get("normalized_name") or ""),
            "draft_year": draft_year,
            "college_join_method": "espn_id" if present else "unmatched",
            "college_data_present": float(present),
            "college_seasons_observed": float(career["season"].nunique()) if present else 0.0,
            "college_career_games": float(career["games"].sum()) if present else 0.0,
            "college_final_games": _finite_or_nan(final["games"]) if present else math.nan,
            "college_final_scrimmage_yards_per_game": _finite_or_nan(final["scrimmage_yards_per_game"]) if present else math.nan,
            "college_final_target_share": _finite_or_nan(final["targets_share"]) if present else math.nan,
            "college_final_receiving_yards_share": _finite_or_nan(final["receiving_yards_share"]) if present else math.nan,
            "college_final_rushing_yards_share": _finite_or_nan(final["rushing_yards_share"]) if present else math.nan,
            "college_final_scrimmage_yards_share": _finite_or_nan(final["scrimmage_yards_share"]) if present else math.nan,
            "college_max_target_share": _finite_or_nan(career["targets_share"].max()) if present else math.nan,
            "college_max_scrimmage_yards_share": _finite_or_nan(career["scrimmage_yards_share"].max()) if present else math.nan,
            "college_final_yards_per_target": _finite_or_nan(final["yards_per_target"]) if present else math.nan,
            "college_final_yards_per_carry": _finite_or_nan(final["yards_per_carry"]) if present else math.nan,
            "college_final_pass_yards_per_attempt": _finite_or_nan(final["pass_yards_per_attempt"]) if present else math.nan,
            "college_final_pass_yards_share": _finite_or_nan(final["passing_yards_share"]) if present else math.nan,
            "college_final_pass_yards_per_game": _finite_or_nan(final["passing_yards_per_game"]) if present else math.nan,
        })
    return pd.DataFrame(rows)


def _normalize_identifier(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def build_combine_features(universe: pd.DataFrame, combine: pd.DataFrame) -> pd.DataFrame:
    combine = combine.copy()
    combine["cfb_key"] = combine["cfb_id"].map(_normalize_identifier)
    combine["pfr_key"] = combine["pfr_id"].map(_normalize_identifier)
    combine["name_key"] = combine["player_name"].map(_normalize_identifier)
    by_cfb = {str(row.cfb_key): row for _, row in combine.iterrows() if str(row.cfb_key)}
    by_pfr = {str(row.pfr_key): row for _, row in combine.iterrows() if str(row.pfr_key)}
    by_name_year = {
        (str(row.name_key), int(row.season)): row
        for _, row in combine.iterrows()
        if str(row.name_key) and pd.notna(row.season)
    }
    rows = []
    for _, player in universe.iterrows():
        cfb_key = _normalize_identifier(player.get("cfbref_id"))
        pfr_key = _normalize_identifier(player.get("pfr_id"))
        name_key = _normalize_identifier(player.get("name"))
        draft_year = int(float(player["draft_year"])) if pd.notna(player.get("draft_year")) else 0
        match = by_cfb.get(cfb_key) if cfb_key else None
        method = "cfbref_id" if match is not None else None
        if match is None and pfr_key:
            match = by_pfr.get(pfr_key)
            method = "pfr_id" if match is not None else None
        if match is None:
            match = by_name_year.get((name_key, draft_year))
            method = "name_and_year" if match is not None else None
        present = match is not None
        forty = _finite_or_nan(match.get("forty")) if present else math.nan
        weight = _finite_or_nan(match.get("wt")) if present else math.nan
        speed_score = weight * 200 / (forty ** 4) if math.isfinite(forty) and forty > 0 and math.isfinite(weight) else math.nan
        rows.append({
            "fp_id": str(player.get("fp_id") or ""),
            "normalized_name": str(player.get("normalized_name") or ""),
            "draft_year": draft_year,
            "combine_join_method": method or "unmatched",
            "combine_data_present": float(present),
            "combine_forty": forty,
            "combine_vertical": _finite_or_nan(match.get("vertical")) if present else math.nan,
            "combine_broad_jump": _finite_or_nan(match.get("broad_jump")) if present else math.nan,
            "combine_cone": _finite_or_nan(match.get("cone")) if present else math.nan,
            "combine_shuttle": _finite_or_nan(match.get("shuttle")) if present else math.nan,
            "combine_speed_score": speed_score,
        })
    return pd.DataFrame(rows)


def load_nfl_rookie_outcomes(raw_root: Path, universe: pd.DataFrame) -> pd.DataFrame:
    frames = []
    columns = [
        "player_id", "player_display_name", "position", "season", "games",
        "fantasy_points_ppr",
    ]
    for path in sorted((raw_root / "nflverse").glob("stats_player_reg_*.parquet")):
        frames.append(pd.read_parquet(path, columns=columns))
    if not frames:
        raise FileNotFoundError("No nflverse player outcome files were collected")
    stats = pd.concat(frames, ignore_index=True)
    by_player_season = {
        (str(row.player_id), int(row.season)): row
        for _, row in stats.iterrows()
        if pd.notna(row.player_id) and pd.notna(row.season)
    }
    rows = []
    for _, player in universe.iterrows():
        gsis_id = str(player.get("gsis_id") or "").replace("NA", "")
        draft_year = int(float(player["draft_year"])) if pd.notna(player.get("draft_year")) else 0
        outcome = by_player_season.get((gsis_id, draft_year))
        games = _finite_or_nan(outcome.get("games")) if outcome is not None else 0.0
        ppr = _finite_or_nan(outcome.get("fantasy_points_ppr")) if outcome is not None else 0.0
        games = games if math.isfinite(games) else 0.0
        ppr = ppr if math.isfinite(ppr) else 0.0
        rows.append({
            "fp_id": str(player.get("fp_id") or ""),
            "normalized_name": str(player.get("normalized_name") or ""),
            "draft_year": draft_year,
            "nfl_outcome_join_method": "gsis_id" if outcome is not None else "zero_no_stat_row",
            "rookie_nfl_stat_row": float(outcome is not None),
            "rookie_games": games,
            "rookie_ppr": ppr,
            "rookie_ppg": ppr / games if games > 0 else 0.0,
        })
    result = pd.DataFrame(rows)
    eligible = result[result["draft_year"].between(NFL_FIRST_ROOKIE_SEASON, NFL_LAST_COMPLETE_SEASON)].copy()
    identity = universe[["fp_id", "normalized_name", "draft_year", "position"]].copy()
    identity["draft_year"] = pd.to_numeric(identity["draft_year"], errors="coerce").fillna(0).astype(int)
    eligible = eligible.merge(identity, on=["fp_id", "normalized_name", "draft_year"], how="left")
    eligible["rookie_production_percentile"] = eligible.groupby(
        ["draft_year", "position"], dropna=False
    )["rookie_ppr"].rank(method="average", pct=True)
    return eligible.drop(columns=["position"])


def add_external_features(
    frame: pd.DataFrame,
    college_features: pd.DataFrame,
    combine_features: pd.DataFrame,
    outcomes: pd.DataFrame | None = None,
) -> pd.DataFrame:
    keys = ["fp_id", "normalized_name", "draft_year"]
    result = frame.copy()
    result["draft_year"] = pd.to_numeric(result["rookie_year"], errors="coerce").fillna(0).astype(int)
    result = result.merge(college_features, on=keys, how="left")
    result = result.merge(combine_features, on=keys, how="left")
    if outcomes is not None:
        result = result.merge(outcomes, on=keys, how="left")
    result = result.drop(columns=["draft_year"])
    for feature in COLLEGE_FEATURES + ATHLETIC_FEATURES:
        if feature not in result:
            result[feature] = math.nan
    return result

#!/usr/bin/env python3
"""Point-in-time tape construction for future rookie-class research.

V6.4 intentionally stops at source collection, transparent feature building,
and outcome-independent coverage reporting. It does not train a class model or
produce a future-pick value. Historical roster membership defines the candidate
population so players who never reach the NFL remain in the tape.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

try:
    from ml.rookie_data import build_college_player_seasons, download_file
except ModuleNotFoundError:  # Direct execution through ml/future_rookie_pipeline.py.
    from rookie_data import build_college_player_seasons, download_file


POSITIONS = ("QB", "RB", "WR", "TE")
FIRST_ROSTER_SEASON = 2018
LAST_ARCHIVED_ROSTER_SEASON = 2025
FIRST_COLLEGE_STATS_SEASON = 2014
LAST_COLLEGE_STATS_SEASON = 2025

# These revisions are deliberately pinned. Refreshing the evidence source is an
# explicit code/review decision instead of silently rebuilding history from a
# moving default branch.
CFBFASTR_DATA_REF = "935eed66a08c95822992fd182495848ac4303f96"
DYNASTYPROCESS_DATA_REF = "1d5766b788a6b059fbdcc7a8a8d4eb8cf1a0876c"

CFB_ROSTER_URL = (
    "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/"
    f"{CFBFASTR_DATA_REF}/rosters/csv/cfb_rosters_{{season}}.csv"
)
CFB_PLAYER_STATS_URL = (
    "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/"
    f"{CFBFASTR_DATA_REF}/player_stats/parquet/player_stats_{{season}}.parquet"
)
PLAYER_IDS_URL = (
    "https://raw.githubusercontent.com/dynastyprocess/data/"
    f"{DYNASTYPROCESS_DATA_REF}/files/db_playerids.csv"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def collect_future_rookie_sources(
    raw_root: Path,
    *,
    refresh: bool,
    offline: bool,
    roster_seasons: Iterable[int] = range(
        FIRST_ROSTER_SEASON, LAST_ARCHIVED_ROSTER_SEASON + 1
    ),
    college_seasons: Iterable[int] = range(
        FIRST_COLLEGE_STATS_SEASON, LAST_COLLEGE_STATS_SEASON + 1
    ),
) -> dict[str, Any]:
    """Collect pinned roster, prior-production, and identity evidence."""
    roster_entries = []
    for season in roster_seasons:
        entry = download_file(
            CFB_ROSTER_URL.format(season=season),
            raw_root / "cfbfastR" / "rosters" / f"cfb_rosters_{season}.csv",
            refresh=refresh,
            offline=offline,
        )
        entry.update({
            "effectiveSeason": season,
            "sourceRef": CFBFASTR_DATA_REF,
            "sourceMeaning": "retrospective season-roster record; not an untouched August archive",
        })
        roster_entries.append(entry)

    college_entries = []
    for season in college_seasons:
        entry = download_file(
            CFB_PLAYER_STATS_URL.format(season=season),
            raw_root / "cfbfastR" / "player_stats" / f"player_stats_{season}.parquet",
            refresh=refresh,
            offline=offline,
        )
        entry.update({
            "effectiveSeason": season,
            "sourceRef": CFBFASTR_DATA_REF,
            "sourceMeaning": "season play-participant data",
        })
        college_entries.append(entry)

    identity = download_file(
        PLAYER_IDS_URL,
        raw_root / "dynastyprocess" / "db_playerids.csv",
        refresh=refresh,
        offline=offline,
    )
    identity.update({
        "sourceRef": DYNASTYPROCESS_DATA_REF,
        "sourceMeaning": "retrospective identity and NFL-entry outcome map",
    })

    manifest = {
        "schemaVersion": 1,
        "retrievedAt": utc_now(),
        "rosters": {
            "provider": "sportsdataverse cfbfastR-data",
            "license": "repository license and upstream CollegeFootballData/ESPN terms apply",
            "sourceRef": CFBFASTR_DATA_REF,
            "files": roster_entries,
        },
        "collegeProduction": {
            "provider": "sportsdataverse cfbfastR-data",
            "license": "repository license and upstream ESPN terms apply",
            "sourceRef": CFBFASTR_DATA_REF,
            "files": college_entries,
        },
        "nflIdentityOutcomes": {
            "provider": "DynastyProcess open-data repository",
            "license": "GPL-3.0 repository license; upstream source terms apply",
            "sourceRef": DYNASTYPROCESS_DATA_REF,
            "files": [identity],
        },
    }
    raw_root.mkdir(parents=True, exist_ok=True)
    (raw_root / "source-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    return manifest


def normalize_identifier(value: Any) -> str:
    text = str(value or "").strip()
    if text in {"", "NA", "nan", "None"}:
        return ""
    if text.endswith(".0") and text[:-2].isdigit():
        return text[:-2]
    return text


def safe_float(value: Any) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else math.nan
    except (TypeError, ValueError):
        return math.nan


def load_roster_file(path: Path, season: int) -> pd.DataFrame:
    """Normalize one provider roster into a deterministic candidate universe."""
    frame = pd.read_csv(path, dtype=str, keep_default_na=False)
    required = {"athlete_id", "first_name", "last_name", "team", "year", "position"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Roster {path} is missing columns: {', '.join(missing)}")

    frame = frame.copy()
    frame["athlete_id"] = frame["athlete_id"].map(normalize_identifier)
    frame["position"] = frame["position"].str.upper().str.strip()
    frame = frame[
        frame["athlete_id"].ne("") & frame["position"].isin(POSITIONS)
    ].copy()
    frame["roster_season"] = int(season)
    frame["target_draft_year"] = int(season + 1)
    frame["snapshot_date"] = f"{season}-08-10"
    frame["observed_at"] = f"{season}-08-10T00:00:00Z"
    frame["feature_cutoff_season"] = int(season - 1)
    frame["player_name"] = (
        frame["first_name"].str.strip() + " " + frame["last_name"].str.strip()
    ).str.strip()
    frame["roster_year"] = pd.to_numeric(
        frame["year"].replace({"": np.nan, "NA": np.nan}), errors="coerce"
    )
    frame["roster_year_known"] = frame["roster_year"].notna()
    # A redshirt sophomore can be three years removed from high school. Year 2
    # must therefore remain eligible; unknown years stay in rather than being
    # converted into confident exclusions.
    frame["plausibly_eligible"] = frame["roster_year"].ge(2) | frame["roster_year"].isna()
    empty_numeric = pd.Series(np.nan, index=frame.index)
    frame["height"] = pd.to_numeric(
        frame.get("height", empty_numeric).replace({"": np.nan, "NA": np.nan}),
        errors="coerce",
    )
    frame["weight"] = pd.to_numeric(
        frame.get("weight", empty_numeric).replace({"": np.nan, "NA": np.nan}),
        errors="coerce",
    )
    recruit_ids = frame.get("recruit_ids", pd.Series("", index=frame.index)).astype(str)
    frame["recruiting_data_present"] = ~recruit_ids.isin({"", "NA", "nan"})

    team_counts = frame.groupby("athlete_id")["team"].nunique().rename("roster_team_count")
    # Provider files occasionally contain a transfer twice. Preserve one stable
    # player row, mark the ambiguity, and choose a deterministic representative.
    frame = frame.sort_values(["athlete_id", "team", "player_name"]).drop_duplicates(
        "athlete_id", keep="first"
    )
    frame = frame.merge(team_counts, on="athlete_id", how="left")
    frame["roster_identity_ambiguous"] = frame["roster_team_count"].gt(1)

    columns = [
        "athlete_id", "player_name", "position", "team", "roster_season",
        "target_draft_year", "snapshot_date", "observed_at", "feature_cutoff_season",
        "roster_year", "roster_year_known", "plausibly_eligible", "height",
        "weight", "recruiting_data_present", "roster_team_count",
        "roster_identity_ambiguous",
    ]
    return frame[columns].sort_values(["athlete_id", "position"]).reset_index(drop=True)


def load_rosters(raw_root: Path) -> pd.DataFrame:
    frames = []
    roster_root = raw_root / "cfbfastR" / "rosters"
    for path in sorted(roster_root.glob("cfb_rosters_*.csv")):
        season = int(path.stem.rsplit("_", 1)[-1])
        frames.append(load_roster_file(path, season))
    if not frames:
        raise FileNotFoundError(f"No historical roster files found under {roster_root}")
    return pd.concat(frames, ignore_index=True)


def build_college_seasons(raw_root: Path, processed_root: Path) -> pd.DataFrame:
    """Reuse the existing transparent college play-participant aggregation."""
    adapter_root = raw_root / "college-adapter"
    source_root = raw_root / "cfbfastR" / "player_stats"
    target_root = adapter_root / "cfbfastR"
    target_root.mkdir(parents=True, exist_ok=True)

    # build_college_player_seasons expects the established cfbfastR directory
    # shape. Hard links avoid duplicating the downloaded evidence; fall back to
    # symlinks only when the filesystem cannot create a link.
    for target in target_root.glob("player_stats_*.parquet"):
        target.unlink()
    for source in sorted(source_root.glob("player_stats_*.parquet")):
        target = target_root / source.name
        try:
            target.hardlink_to(source)
        except OSError:
            target.symlink_to(source)
    return build_college_player_seasons(adapter_root, processed_root)


def load_identity_outcomes(path: Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Load retrospective NFL identities while surfacing provider ID collisions."""
    frame = pd.read_csv(path, dtype=str, keep_default_na=False)
    required = {"espn_id", "name", "position", "draft_year", "draft_ovr"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Identity file {path} is missing columns: {', '.join(missing)}")

    frame = frame[frame["position"].isin(POSITIONS)].copy()
    frame["athlete_id"] = frame["espn_id"].map(normalize_identifier)
    frame["draft_year"] = pd.to_numeric(
        frame["draft_year"].replace({"": np.nan, "NA": np.nan}), errors="coerce"
    )
    frame["draft_overall"] = pd.to_numeric(
        frame["draft_ovr"].replace({"": np.nan, "NA": np.nan}), errors="coerce"
    )
    frame = frame[frame["athlete_id"].ne("") & frame["draft_year"].ge(2019)].copy()
    collision_counts = frame.groupby("athlete_id").size()
    collisions = sorted(collision_counts[collision_counts.gt(1)].index)
    if collisions:
        frame = frame[~frame["athlete_id"].isin(collisions)].copy()
    frame = frame.sort_values(
        ["athlete_id", "draft_year", "draft_overall", "name"],
        na_position="last",
    ).drop_duplicates("athlete_id", keep="first")
    audit = {
        "rows": int(len(frame)),
        "stableEspnIds": int(frame["athlete_id"].nunique()),
        "excludedCollisionIds": collisions,
    }
    return frame[
        ["athlete_id", "name", "position", "draft_year", "draft_overall"]
    ], audit


def _finite(value: Any) -> float | None:
    parsed = safe_float(value)
    return parsed if math.isfinite(parsed) else None


def _college_features(history: pd.DataFrame, cutoff: int) -> dict[str, Any]:
    if history.empty or "season" not in history:
        return {
            "prior_college_data_present": False,
            "prior_seasons_observed": 0,
            "prior_career_games": 0.0,
            "prior_career_scrimmage_yards": 0.0,
            "prior_latest_season": None,
            "prior_latest_games": None,
            "prior_latest_scrimmage_yards_per_game": None,
            "prior_latest_target_share": None,
            "prior_latest_receiving_yards_share": None,
            "prior_latest_rushing_yards_share": None,
            "prior_latest_scrimmage_yards_share": None,
            "prior_latest_yards_per_target": None,
            "prior_latest_yards_per_carry": None,
            "prior_latest_pass_yards_per_attempt": None,
            "prior_max_target_share": None,
            "prior_max_scrimmage_yards_share": None,
            "prior_scrimmage_share_delta": None,
            "feature_max_season": None,
        }

    history = history[history["season"].le(cutoff)].sort_values("season")
    if history.empty:
        return _college_features(pd.DataFrame(), cutoff)

    latest = history.iloc[-1]
    previous = history.iloc[-2] if len(history) >= 2 else None
    latest_share = _finite(latest.get("scrimmage_yards_share"))
    previous_share = _finite(previous.get("scrimmage_yards_share")) if previous is not None else None
    return {
        "prior_college_data_present": True,
        "prior_seasons_observed": int(history["season"].nunique()),
        "prior_career_games": float(pd.to_numeric(history["games"], errors="coerce").fillna(0).sum()),
        "prior_career_scrimmage_yards": float(
            pd.to_numeric(history["scrimmage_yards"], errors="coerce").fillna(0).sum()
        ),
        "prior_latest_season": int(latest["season"]),
        "prior_latest_games": _finite(latest.get("games")),
        "prior_latest_scrimmage_yards_per_game": _finite(
            latest.get("scrimmage_yards_per_game")
        ),
        "prior_latest_target_share": _finite(latest.get("targets_share")),
        "prior_latest_receiving_yards_share": _finite(
            latest.get("receiving_yards_share")
        ),
        "prior_latest_rushing_yards_share": _finite(latest.get("rushing_yards_share")),
        "prior_latest_scrimmage_yards_share": latest_share,
        "prior_latest_yards_per_target": _finite(latest.get("yards_per_target")),
        "prior_latest_yards_per_carry": _finite(latest.get("yards_per_carry")),
        "prior_latest_pass_yards_per_attempt": _finite(
            latest.get("pass_yards_per_attempt")
        ),
        "prior_max_target_share": _finite(
            pd.to_numeric(history["targets_share"], errors="coerce").max()
        ),
        "prior_max_scrimmage_yards_share": _finite(
            pd.to_numeric(history["scrimmage_yards_share"], errors="coerce").max()
        ),
        "prior_scrimmage_share_delta": (
            latest_share - previous_share
            if latest_share is not None and previous_share is not None
            else None
        ),
        "feature_max_season": int(history["season"].max()),
    }


def build_same_horizon_tape(
    rosters: pd.DataFrame,
    college_seasons: pd.DataFrame,
    identities: pd.DataFrame,
) -> pd.DataFrame:
    """Build candidate rows with features known before the final college season."""
    college_seasons = college_seasons.copy()
    college_seasons["player_id"] = college_seasons["player_id"].map(normalize_identifier)
    histories = {
        athlete_id: group.copy()
        for athlete_id, group in college_seasons.groupby("player_id", sort=False)
    }
    identity_map = {
        str(row.athlete_id): row for _, row in identities.iterrows()
    }

    rows: list[dict[str, Any]] = []
    for _, candidate in rosters.sort_values(
        ["target_draft_year", "athlete_id", "position"]
    ).iterrows():
        athlete_id = str(candidate["athlete_id"])
        cutoff = int(candidate["feature_cutoff_season"])
        target_draft_year = int(candidate["target_draft_year"])
        features = _college_features(histories.get(athlete_id, pd.DataFrame()), cutoff)
        identity = identity_map.get(athlete_id)
        eventual_draft_year = (
            int(identity["draft_year"])
            if identity is not None and pd.notna(identity["draft_year"])
            else None
        )
        entered_target = eventual_draft_year == target_draft_year
        draft_overall = (
            int(identity["draft_overall"])
            if identity is not None and pd.notna(identity["draft_overall"])
            else None
        )
        row = candidate.to_dict()
        row.update(features)
        row.update({
            "identity_outcome_present": identity is not None,
            "eventual_nfl_name": str(identity["name"]) if identity is not None else None,
            "eventual_nfl_position": str(identity["position"]) if identity is not None else None,
            "eventual_nfl_draft_year": eventual_draft_year,
            "entered_target_nfl_class": entered_target,
            "drafted_in_target_class": bool(entered_target and draft_overall is not None),
            "target_class_draft_overall": draft_overall if entered_target else None,
            "outcome_observed_after_snapshot": True,
        })
        rows.append(row)

    result = pd.DataFrame(rows)
    if result.empty:
        raise ValueError("Future rookie tape has no candidate rows")
    feature_max = pd.to_numeric(result["feature_max_season"], errors="coerce")
    feature_cutoff = pd.to_numeric(result["feature_cutoff_season"], errors="coerce")
    leaked = result[feature_max.notna() & feature_max.gt(feature_cutoff)]
    if not leaked.empty:
        raise AssertionError("Same-horizon tape contains post-cutoff college features")
    return result.sort_values(
        ["target_draft_year", "athlete_id", "position"]
    ).reset_index(drop=True)


def manifest_is_complete(manifest: dict[str, Any]) -> bool:
    groups = ("rosters", "collegeProduction", "nflIdentityOutcomes")
    expected_seasons = {
        "rosters": set(range(FIRST_ROSTER_SEASON, LAST_ARCHIVED_ROSTER_SEASON + 1)),
        "collegeProduction": set(
            range(FIRST_COLLEGE_STATS_SEASON, LAST_COLLEGE_STATS_SEASON + 1)
        ),
    }
    for group in groups:
        source = manifest.get(group, {})
        source_ref = str(source.get("sourceRef", ""))
        if not re.fullmatch(r"[0-9a-f]{40}", source_ref) or not source.get("files"):
            return False
        for item in source["files"]:
            url = str(item.get("url", ""))
            digest = str(item.get("sha256", ""))
            if (
                item.get("sourceRef") != source_ref
                or source_ref not in url
                or not re.fullmatch(r"[0-9a-f]{64}", digest)
            ):
                return False
        if group in expected_seasons:
            actual_seasons = {
                int(item["effectiveSeason"])
                for item in source["files"]
                if item.get("effectiveSeason") is not None
            }
            if actual_seasons != expected_seasons[group]:
                return False
        elif len(source["files"]) != 1:
            return False
    return True

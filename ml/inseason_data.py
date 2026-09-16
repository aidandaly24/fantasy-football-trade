"""Public, cached evidence for the in-season audition; no application writes.

Sources are immutable content-addressed downloads. An index pins the selected
vintage; offline runs verify its SHA-256. Historical rows are reconstructed
event-time observations, NOT proof of what an analyst knew before kickoff.
"""
from __future__ import annotations

import hashlib
import io
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

RELEASE = "https://github.com/nflverse/nflverse-data/releases/download"
POSITIONS = ("QB", "RB", "WR", "TE")
KEY = ["season", "week", "player_id"]
# Weekly stats backfill the Raiders' current abbreviation into older seasons;
# schedules preserve OAK. Canonicalize the join key, not the historical game ID.
TEAM_ALIASES = {"OAK": "LV"}
BASE_STATS = ["attempts", "passing_yards", "passing_tds", "passing_interceptions",
              "carries", "rushing_yards", "rushing_tds", "receptions", "targets",
              "receiving_yards", "receiving_tds", "rushing_fumbles_lost",
              "receiving_fumbles_lost", "sack_fumbles_lost", "receiving_air_yards",
              "passing_2pt_conversions", "rushing_2pt_conversions", "receiving_2pt_conversions"]
NGS_FIELDS = {
    "receiving": {"avg_separation": "targets", "avg_cushion": "targets",
                  "avg_intended_air_yards": "targets", "avg_yac_above_expectation": "receptions"},
    "rushing": {"rush_yards_over_expected_per_att": "rush_attempts",
                "rush_pct_over_expected": "rush_attempts",
                "percent_attempts_gte_eight_defenders": "rush_attempts"},
    "passing": {"completion_percentage_above_expectation": "attempts",
                "avg_time_to_throw": "attempts", "aggressiveness": "attempts",
                "avg_intended_air_yards": "attempts"},
}
FTN_FIELDS = ("is_catchable_ball", "is_contested_ball", "is_created_reception",
              "is_drop", "is_screen_pass", "is_play_action", "is_motion",
              "is_interception_worthy", "is_qb_fault_sack")
FTN_PLAYER_FIELDS = {"receiver_player_id": FTN_FIELDS[:7],
                     "passer_player_id": ("is_catchable_ball", "is_play_action", "is_motion",
                                          "is_interception_worthy", "is_qb_fault_sack"),
                     "rusher_player_id": ("is_motion",)}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


class Sources:
    def __init__(self, root: Path, offline: bool = False, refresh: bool = False):
        if offline and refresh:
            raise ValueError("--offline and --refresh-sources are mutually exclusive")
        self.root, self.offline, self.refresh = root, offline, refresh
        self.manifest: list[dict] = []

    def csv(self, name: str, url: str, columns: set[str] | None = None) -> pd.DataFrame:
        index = self.root / f"{name}.json"
        if index.exists() and not self.refresh:
            meta = json.loads(index.read_text())
            if meta["url"] != url:
                raise ValueError(f"Source URL changed for {name}; refresh explicitly")
            content = (self.root / meta["file"]).read_bytes()
            if digest(content) != meta["sha256"]:
                raise ValueError(f"Cached source hash mismatch: {name}")
        else:
            if self.offline:
                raise FileNotFoundError(f"Uncached source: {name}")
            print(f"Downloading {name}...", flush=True)
            request = urllib.request.Request(url, headers={"User-Agent": "RosterLab-research/1.0"})
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(request, timeout=90) as response:
                        content = response.read()
                        modified = response.headers.get("Last-Modified")
                    break
                except (urllib.error.URLError, TimeoutError):
                    if attempt == 2:
                        raise
                    time.sleep(attempt + 1)
            hashed = digest(content)
            file = f"objects/{hashed}.{'csv.gz' if url.endswith('.gz') else 'csv'}"
            path = self.root / file
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            meta = {"name": name, "url": url, "file": file, "sha256": hashed,
                    "retrievedAt": now(), "lastModified": modified, "bytes": len(content),
                    "vintage": "retrospective-download"}
            write_json(index, meta)
        frame = pd.read_csv(io.BytesIO(content), compression="gzip" if url.endswith(".gz") else None,
                            usecols=(lambda col: col in columns) if columns else None, low_memory=False)
        self.manifest.append({**meta, "rows": len(frame), "columns": list(frame.columns)})
        return frame


def unique(frame: pd.DataFrame, key: list[str], label: str) -> None:
    if frame[key].isna().any().any() or frame.duplicated(key).any():
        raise ValueError(f"Missing or duplicate {label} identity: {key}")


def require(frame: pd.DataFrame, columns: list[str], label: str) -> None:
    missing = set(columns) - set(frame)
    if missing:
        raise ValueError(f"{label} missing columns: {sorted(missing)}")


def normalize_stats(frame: pd.DataFrame) -> pd.DataFrame:
    require(frame, KEY + ["game_id", "team", "position", "season_type", *BASE_STATS], "player stats")
    frame = frame[frame.season_type == "REG"].copy()
    frame["team"] = frame.team.replace(TEAM_ALIASES)
    for field in BASE_STATS:
        frame[field] = pd.to_numeric(frame[field], errors="raise").fillna(0)
    # nflverse includes anonymous team-defense rows with zero offensive stats.
    # They are not players; an unidentified offensive observation must fail.
    anonymous = frame.player_id.isna()
    if (anonymous & (frame[BASE_STATS].ne(0).any(axis=1) | frame.position.isin(POSITIONS))).any():
        raise ValueError("Missing weekly player identity on an offensive observation")
    frame = frame[~anonymous].copy()
    unique(frame, KEY, "weekly player")
    # An explicit scoring recipe avoids treating one provider's PPR label as
    # exact custom-league scoring. PPR/TEP and pass TD/INT rates are CLI inputs.
    frame["fumbles_lost"] = frame[["rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost"]].sum(axis=1)
    totals = frame.groupby(["season", "week", "team"])[["attempts", "carries", "targets", "receiving_air_yards"]].sum()
    frame = frame[frame.position.isin(POSITIONS)].copy()
    for field in totals:
        frame = frame.merge(totals[[field]].rename(columns={field: f"team_{field}"}),
                            on=["season", "week", "team"], validate="many_to_one")
    return frame


def score(frame: pd.DataFrame, scoring: dict[str, float]) -> pd.Series:
    points = (frame.passing_yards * .04 + frame.passing_tds * scoring["passTd"]
              + frame.passing_interceptions * scoring["passInt"]
              + (frame.rushing_yards + frame.receiving_yards) * .1
              + (frame.rushing_tds + frame.receiving_tds) * 6
              + frame.receptions * scoring["ppr"] - frame.fumbles_lost * 2
              + (frame.passing_2pt_conversions + frame.rushing_2pt_conversions + frame.receiving_2pt_conversions) * 2)
    return points + frame.receptions * frame.position.eq("TE") * scoring["tep"]


def normalize_schedule(frame: pd.DataFrame) -> pd.DataFrame:
    require(frame, ["season", "week", "game_id", "game_type", "gameday", "home_team", "away_team", "home_score", "away_score"], "schedule")
    frame = frame[frame.game_type.eq("REG")].copy()
    frame["completed"] = frame.home_score.notna() & frame.away_score.notna()
    unique(frame, ["game_id"], "schedule")
    frame["game_date"] = pd.to_datetime(frame.gameday)
    home = frame[["season", "week", "game_id", "game_date", "completed", "home_team"]].rename(columns={"home_team": "team"})
    away = frame[["season", "week", "game_id", "game_date", "completed", "away_team"]].rename(columns={"away_team": "team"})
    schedule = pd.concat([home, away], ignore_index=True)
    schedule["team"] = schedule.team.replace(TEAM_ALIASES)
    unique(schedule, ["season", "week", "team"], "team game")
    return schedule


def normalize_ngs(frame: pd.DataFrame, kind: str) -> pd.DataFrame:
    fields = NGS_FIELDS[kind]
    require(frame, ["season", "week", "season_type", "player_gsis_id", *fields, *set(fields.values())], f"NGS {kind}")
    frame = frame[(frame.season_type == "REG") & (frame.week > 0)].rename(columns={"player_gsis_id": "player_id"}).copy()
    frame = frame[frame.player_id.notna()]
    unique(frame, KEY, f"NGS {kind}")
    out = frame[KEY].copy()
    for field, denominator in fields.items():
        stem = f"ngs_{kind}_{field}"
        out[stem] = pd.to_numeric(frame[field], errors="coerce")
        out[f"{stem}_n"] = pd.to_numeric(frame[denominator], errors="coerce").where(out[stem].notna())
    return out


def aggregate_ftn(chart: pd.DataFrame, pbp: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """One-to-one play joins; unknown read and missing booleans stay missing.

    First-read *target share* is share of known first-read throws, not share of
    all called first-read routes. The latter is unavailable in the public tape.
    """
    require(chart, ["nflverse_game_id", "nflverse_play_id", "read_thrown", *FTN_FIELDS], "FTN")
    require(pbp, ["game_id", "play_id", "season", "week", "season_type", "posteam", "play_type", "sack", *FTN_PLAYER_FIELDS], "PBP")
    chart = chart.rename(columns={"nflverse_game_id": "game_id", "nflverse_play_id": "play_id"})
    unique(chart, ["game_id", "play_id"], "FTN play")
    unique(pbp, ["game_id", "play_id"], "PBP play")
    joined = pbp[pbp.season_type.eq("REG") & pbp.play_type.notna() & pbp.play_type.ne("no_play")].merge(
        chart[["game_id", "play_id", "read_thrown", *FTN_FIELDS]], on=["game_id", "play_id"],
        how="left", validate="one_to_one", indicator=True)
    matched = joined._merge.eq("both")
    for field in FTN_FIELDS:
        joined[field] = joined[field].astype(str).str.lower().map({"true": 1., "false": 0., "1": 1., "0": 0.})
    # FTN uses 1/2/... for known read order and 0 for no applicable read.
    read = pd.to_numeric(joined.read_thrown, errors="coerce")
    joined["first_read"] = read.eq(1).astype(float).where(read.ge(1))
    pieces = []
    audit = {"plays": len(joined), "matchedPlays": int(matched.sum()),
             "playJoinCoverage": float(matched.mean()), "chartedGames": int(chart.game_id.nunique()),
             "knownReadThrows": int(joined.first_read.notna().sum()),
             "unmatchedChartPlays": int(len(chart.merge(pbp[["game_id", "play_id"]], how="left", indicator=True).query('_merge == "left_only"')))}
    for identity, fields in FTN_PLAYER_FIELDS.items():
        role = identity.split("_")[0]
        plays = joined[joined[identity].notna()].copy()
        plays["player_id"] = plays[identity]
        group = plays.groupby(KEY)
        out = group.size().rename(f"ftn_{role}_eligible_plays").to_frame()
        out[f"ftn_{role}_matched_plays"] = group._merge.agg(lambda x: x.eq("both").sum())
        for field in (*fields, *(("first_read",) if role == "receiver" else ())):
            stem = f"ftn_{role}_{field}"
            applicable = plays.copy()
            if role == "passer" and field in ("is_catchable_ball", "is_interception_worthy"):
                applicable[field] = applicable[field].where(applicable.sack.eq(0))
            elif field == "is_qb_fault_sack":
                applicable[field] = applicable[field].where(applicable.sack.eq(1))
            field_group = applicable.groupby(KEY)[field]
            out[stem] = field_group.sum(min_count=1)
            out[f"{stem}_n"] = field_group.count().replace(0, np.nan)
        if role == "receiver":
            team_first = plays.groupby(["season", "week", "posteam"]).first_read.sum(min_count=1)
            plays = plays.merge(team_first.rename("team_first"), on=["season", "week", "posteam"], validate="many_to_one")
            out["ftn_receiver_first_read_share_n"] = plays.groupby(KEY).team_first.first().replace(0, np.nan)
            out["ftn_receiver_first_read_share"] = out["ftn_receiver_first_read"]
        pieces.append(out)
    return pd.concat(pieces, axis=1).reset_index(), audit


def collect(sources: Sources, seasons: list[int], current_season: int | None) -> dict:
    all_seasons = sorted(set(seasons + ([current_season] if current_season else [])))
    stats, ftn, audits, errors = [], [], {}, []
    schedule = normalize_schedule(sources.csv("schedule", "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"))
    for season in all_seasons:
        raw = sources.csv(f"stats-{season}", f"{RELEASE}/stats_player/stats_player_week_{season}.csv")
        stats.append(normalize_stats(raw))
    ngs = []
    for kind in NGS_FIELDS:
        try:
            ngs.append(normalize_ngs(sources.csv(f"ngs-{kind}", f"{RELEASE}/nextgen_stats/ngs_{kind}.csv.gz"), kind).set_index(KEY))
        except (FileNotFoundError, urllib.error.URLError, ValueError) as error:
            errors.append({"source": f"NGS {kind}", "error": str(error)})
    pbp_columns = {"game_id", "play_id", "season", "week", "season_type", "posteam", "play_type", "sack", *FTN_PLAYER_FIELDS}
    for season in [s for s in all_seasons if s >= 2022]:
        try:
            chart = sources.csv(f"ftn-{season}", f"{RELEASE}/ftn_charting/ftn_charting_{season}.csv")
            pbp = sources.csv(f"pbp-{season}", f"{RELEASE}/pbp/play_by_play_{season}.csv.gz", pbp_columns)
            rows, audits[str(season)] = aggregate_ftn(chart, pbp)
            ftn.append(rows)
        except (FileNotFoundError, urllib.error.URLError, ValueError) as error:
            errors.append({"source": f"FTN/PBP {season}", "error": str(error)})
    return {"stats": pd.concat(stats, ignore_index=True), "schedule": schedule,
            "ngs": pd.concat(ngs, axis=1).reset_index() if ngs else pd.DataFrame(columns=KEY),
            "ftn": pd.concat(ftn, ignore_index=True) if ftn else pd.DataFrame(columns=KEY),
            "ftnAudit": audits, "sourceErrors": errors}

"""Build end-of-week features and future calendar-week realized point labels.

Only players already observed with an offensive opportunity enter the universe.
They remain in it after disappearance. Byes and no-stat weeks score zero only
inside a season whose completed-game coverage was verified. Future observations
may form labels but never feature values or candidate eligibility.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ml.inseason_data import BASE_STATS, KEY, POSITIONS, score, unique

ROLLING_STATS = ["attempts", "carries", "targets", "receptions", "receiving_air_yards",
                 "team_attempts", "team_carries", "team_targets", "team_receiving_air_yards"]
BASE_FEATURES = ["ppg_last", "ppg_3", "ppg_season", "points_std_3", "weeks_seen",
                 "week", "weeks_since_opportunity", "opportunity_games_3", "points_trend",
                 *[f"{col}_3" for col in ROLLING_STATS],
                 "target_share_3", "carry_share_3", "air_share_3"]


def ratio(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return numerator / denominator.where(denominator > 0)


def build_panel(data: dict, seasons: list[int], scoring: dict,
                current_season: int | None = None) -> tuple[pd.DataFrame, dict]:
    stats = data["stats"].copy()
    schedule = data["schedule"]
    stats["points"] = score(stats, scoring)
    stats["opportunities"] = stats.attempts + stats.carries + stats.targets
    frames, season_audit = [], []
    for season in sorted(set(seasons + ([current_season] if current_season else []))):
        raw = stats[stats.season.eq(season)].sort_values("week")
        games = schedule[schedule.season.eq(season)]
        expected_last = 17 if season <= 2020 else 18
        observed_last = int(raw.week.max()) if len(raw) else 0
        expected_ids = set(games.loc[games.week.le(observed_last) & games.completed, "game_id"])
        missing_ids = expected_ids - set(raw.game_id)
        extra_ids = set(raw.game_id) - expected_ids
        team_keys = set(zip(games.week, games.team))
        missing_teams = sorted(set(zip(raw.week, raw.team)) - team_keys)
        if missing_teams:
            raise ValueError(f"Unmatched schedule team/week identities in {season}: {missing_teams}")
        complete = not missing_ids and not extra_ids and observed_last == expected_last
        season_audit.append({"season": season, "lastWeek": observed_last,
                             "completeSeason": complete, "missingGames": sorted(missing_ids),
                             "unexpectedGames": sorted(extra_ids)})
        if season in seasons and not complete:
            raise ValueError(f"Incomplete historical season {season}: {season_audit[-1]}")
        # Current evidence does not silently include a partial week.
        complete_weeks = {week for week in raw.week.unique()
                          if set(games.loc[games.week.eq(week), "game_id"]) == set(raw.loc[raw.week.eq(week), "game_id"])}
        last = observed_last if season in seasons else max(complete_weeks, default=0)
        raw = raw[raw.week.le(last)]
        team_totals = raw.groupby(["week", "team"])[[c for c in ROLLING_STATS if c.startswith("team_")]].first()
        team_weeks = {team: set(group.week) for team, group in games.groupby("team")}
        for player_id, history in raw.groupby("player_id", sort=True):
            eligible = history[history.opportunities.gt(0)]
            if eligible.empty:
                continue
            first = int(eligible.week.min())
            grid = pd.DataFrame({"week": np.arange(first, last + 1)})
            grid = grid.merge(history, on="week", how="left", validate="one_to_one")
            grid["season"], grid["player_id"] = season, player_id
            # ffill only: later team/name/position never reaches earlier rows.
            for field in ["team", "position", "player_display_name"]:
                grid[field] = grid[field].ffill()
            for col in [*BASE_STATS, "fumbles_lost", "points", "opportunities", *[c for c in ROLLING_STATS if c.startswith("team_")]]:
                grid[col] = grid[col].fillna(0)
            # Team opportunity denominators must remain populated when a player
            # misses a game; zeroing them would inflate role after an absence.
            grid = grid.drop(columns=list(team_totals.columns)).merge(team_totals, on=["week", "team"], how="left", validate="many_to_one")
            grid[list(team_totals.columns)] = grid[list(team_totals.columns)].fillna(0)
            grid["ppg_last"] = grid.points
            grid["ppg_3"] = grid.points.rolling(3, min_periods=1).mean()
            grid["ppg_season"] = grid.points.expanding().mean()
            grid["points_std_3"] = grid.points.rolling(3, min_periods=2).std()
            grid["weeks_seen"] = np.arange(1, len(grid) + 1)
            last_touch = grid.week.where(grid.opportunities.gt(0)).ffill()
            grid["weeks_since_opportunity"] = grid.week - last_touch
            grid["opportunity_games_3"] = grid.opportunities.gt(0).rolling(3, min_periods=1).sum()
            grid["points_trend"] = grid.ppg_last - grid.ppg_3
            for col in ROLLING_STATS:
                grid[f"{col}_3"] = grid[col].rolling(3, min_periods=1).sum()
            for prefix, col in [("target", "targets"), ("carry", "carries"), ("air", "receiving_air_yards")]:
                grid[f"{prefix}_share_3"] = ratio(grid[f"{col}_3"], grid[f"team_{col}_3"])
            # These labels use exact future week indices, never next appearance.
            for horizon in (1, 4):
                future = pd.concat([grid.points.shift(-step) for step in range(1, horizon + 1)], axis=1)
                grid[f"target_{horizon}"] = future.mean(axis=1).where(future.notna().sum(axis=1).eq(horizon))
                grid[f"label_end_{horizon}"] = grid.week + horizon
                grid[f"scheduled_games_{horizon}"] = [sum(w in team_weeks.get(team, set()) for w in range(int(week) + 1, int(week) + horizon + 1))
                                                          for week, team in zip(grid.week, grid.team)]
            frames.append(grid)
    if not frames:
        raise ValueError("No eligible historical players")
    panel = pd.concat(frames, ignore_index=True)
    unique(panel, KEY, "panel")
    for source in ("ngs", "ftn"):
        panel = panel.merge(data[source], on=KEY, how="left", validate="one_to_one")
    panel = panel.sort_values(["season", "player_id", "week"]).reset_index(drop=True)
    groups = [panel.season, panel.player_id]
    # Sample-weighted NGS means; FTN is already count numerator / opportunity
    # denominator. Missing observations contribute neither sample nor zero rate.
    for col in [c for c in panel if c.startswith(("ngs_", "ftn_")) and f"{c}_n" in panel]:
        sample = panel[f"{col}_n"].where(panel[col].notna())
        numerator = panel[col] * sample if col.startswith("ngs_") else panel[col]
        recent_n = sample.groupby(groups).transform(lambda x: x.rolling(3, min_periods=1).sum())
        recent_sum = numerator.groupby(groups).transform(lambda x: x.rolling(3, min_periods=1).sum())
        panel[f"{col}_3"] = ratio(recent_sum, recent_n)
        panel[f"{col}_samples_3"] = recent_n
    # Coverage itself is visible to the model, preventing thresholds from being
    # silently interpreted as below-average performance.
    for role in ("receiver", "passer", "rusher"):
        num, den = f"ftn_{role}_matched_plays", f"ftn_{role}_eligible_plays"
        if num in panel:
            panel[f"ftn_{role}_coverage_3"] = ratio(
                panel[num].groupby(groups).transform(lambda x: x.rolling(3, min_periods=1).sum()),
                panel[den].groupby(groups).transform(lambda x: x.rolling(3, min_periods=1).sum()))
    # Low-volume membership is determined at the anchor, never from future points.
    panel["low_volume"] = ((panel.position.eq("QB") & panel.attempts_3.lt(45))
                            | (~panel.position.eq("QB") & (panel.targets_3 + panel.carries_3).lt(15)))
    return panel, {"seasonCoverage": season_audit, "rows": len(panel),
                   "players": int(panel.player_id.nunique()),
                   "retainedNoOpportunityWeeks": int(panel.opportunities.eq(0).sum()),
                   "population": "Players observed with an offensive opportunity by each anchor; retained through season end. Never-observed players are uncovered.",
                   "target": "Mean realized points per next 1 or 4 NFL calendar weeks, including byes and missed games as zero; not conditional start/sit points."}


def feature_sets(panel: pd.DataFrame, position: str, horizon: int) -> dict[str, list[str]]:
    base = BASE_FEATURES + [f"scheduled_games_{horizon}"]
    kind = {"QB": "passing", "RB": "rushing", "WR": "receiving", "TE": "receiving"}[position]
    ngs = [c for c in panel if c.startswith(f"ngs_{kind}_") and c.endswith("_3")]
    role = {"QB": "passer", "RB": "rusher", "WR": "receiver", "TE": "receiver"}[position]
    roles = (role, "receiver") if position == "RB" else (role,)
    ftn = [c for c in panel if any(c.startswith(f"ftn_{r}_") for r in roles) and c.endswith("_3")]
    return {"opportunity": base, "opportunity+ngs": base + ngs,
            "opportunity+ftn": base + ftn, "opportunity+ngs+ftn": base + ngs + ftn,
            "opportunity+ngs-without-separation": base + [c for c in ngs if "avg_separation" not in c]}

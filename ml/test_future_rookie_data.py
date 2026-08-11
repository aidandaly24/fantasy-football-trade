import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from ml.future_rookie_data import (
    FIRST_COLLEGE_STATS_SEASON,
    FIRST_ROSTER_SEASON,
    LAST_ARCHIVED_ROSTER_SEASON,
    LAST_COLLEGE_STATS_SEASON,
    build_same_horizon_tape,
    collect_future_rookie_sources,
    load_roster_file,
    manifest_is_complete,
)


def college_row(player_id: str, season: int, yards: float) -> dict[str, object]:
    return {
        "player_id": player_id,
        "season": season,
        "games": 10,
        "scrimmage_yards": yards,
        "scrimmage_yards_per_game": yards / 10,
        "targets_share": 0.2,
        "receiving_yards_share": 0.2,
        "rushing_yards_share": 0.0,
        "scrimmage_yards_share": 0.2,
        "yards_per_target": 8.0,
        "yards_per_carry": 4.0,
        "pass_yards_per_attempt": 7.0,
    }


class FutureRookieDataTests(unittest.TestCase):
    def test_roster_keeps_unknown_year_and_marks_transfer_ambiguity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "roster.csv"
            pd.DataFrame([
                {
                    "athlete_id": "1", "first_name": "Transfer", "last_name": "One",
                    "team": "Alpha", "year": "", "position": "WR",
                },
                {
                    "athlete_id": "1", "first_name": "Transfer", "last_name": "One",
                    "team": "Beta", "year": "", "position": "WR",
                },
                {
                    "athlete_id": "2", "first_name": "Young", "last_name": "Back",
                    "team": "Alpha", "year": "1", "position": "RB",
                },
                {
                    "athlete_id": "3", "first_name": "Defensive", "last_name": "Player",
                    "team": "Alpha", "year": "4", "position": "LB",
                },
            ]).to_csv(path, index=False)

            result = load_roster_file(path, 2024).set_index("athlete_id")

            self.assertEqual(list(result.index), ["1", "2"])
            self.assertTrue(result.loc["1", "plausibly_eligible"])
            self.assertTrue(result.loc["1", "roster_identity_ambiguous"])
            self.assertEqual(result.loc["1", "roster_team_count"], 2)
            self.assertFalse(result.loc["2", "plausibly_eligible"])
            self.assertEqual(result.loc["1", "observed_at"], "2024-08-10T00:00:00Z")

    def test_tape_excludes_final_season_and_keeps_non_entrant(self) -> None:
        rosters = pd.DataFrame([
            {
                "athlete_id": "1", "player_name": "Early Entrant", "position": "WR",
                "team": "Alpha", "roster_season": 2024, "target_draft_year": 2025,
                "snapshot_date": "2024-08-10", "feature_cutoff_season": 2023,
                "roster_year": 3, "roster_year_known": True, "plausibly_eligible": True,
                "height": 72, "weight": 200, "recruiting_data_present": False,
                "roster_team_count": 1, "roster_identity_ambiguous": False,
            },
            {
                "athlete_id": "2", "player_name": "Stayed In School", "position": "RB",
                "team": "Beta", "roster_season": 2024, "target_draft_year": 2025,
                "snapshot_date": "2024-08-10", "feature_cutoff_season": 2023,
                "roster_year": 3, "roster_year_known": True, "plausibly_eligible": True,
                "height": 70, "weight": 210, "recruiting_data_present": False,
                "roster_team_count": 1, "roster_identity_ambiguous": False,
            },
        ])
        seasons = pd.DataFrame([
            college_row("1", 2023, 500),
            college_row("1", 2024, 9999),
            college_row("2", 2023, 800),
        ])
        identities = pd.DataFrame([{
            "athlete_id": "1", "name": "Early Entrant", "position": "WR",
            "draft_year": 2025, "draft_overall": 12,
        }])

        result = build_same_horizon_tape(rosters, seasons, identities).set_index("athlete_id")

        self.assertEqual(result.loc["1", "feature_max_season"], 2023)
        self.assertEqual(result.loc["1", "prior_career_scrimmage_yards"], 500)
        self.assertTrue(result.loc["1", "entered_target_nfl_class"])
        self.assertFalse(result.loc["2", "entered_target_nfl_class"])
        self.assertEqual(len(result), 2)

    def test_missing_college_history_is_explicit(self) -> None:
        roster = pd.DataFrame([{
            "athlete_id": "9", "player_name": "Unknown", "position": "TE",
            "team": "Gamma", "roster_season": 2024, "target_draft_year": 2025,
            "snapshot_date": "2024-08-10", "feature_cutoff_season": 2023,
            "roster_year": None, "roster_year_known": False, "plausibly_eligible": True,
            "height": None, "weight": None, "recruiting_data_present": False,
            "roster_team_count": 1, "roster_identity_ambiguous": False,
        }])
        seasons = pd.DataFrame([college_row("1", 2023, 500)])
        identities = pd.DataFrame(columns=[
            "athlete_id", "name", "position", "draft_year", "draft_overall",
        ])

        result = build_same_horizon_tape(roster, seasons, identities).iloc[0]

        self.assertFalse(result["prior_college_data_present"])
        self.assertEqual(result["prior_seasons_observed"], 0)

    def test_manifest_requires_hash_url_and_pinned_ref(self) -> None:
        source_ref = "a" * 40
        def item(name: str, season: int | None = None) -> dict[str, object]:
            return {
                "url": f"https://example.test/{source_ref}/{name}",
                "sha256": "b" * 64,
                "sourceRef": source_ref,
                "effectiveSeason": season,
            }
        manifest = {
            "rosters": {
                "sourceRef": source_ref,
                "files": [
                    item(f"roster-{season}", season)
                    for season in range(FIRST_ROSTER_SEASON, LAST_ARCHIVED_ROSTER_SEASON + 1)
                ],
            },
            "collegeProduction": {
                "sourceRef": source_ref,
                "files": [
                    item(f"stats-{season}", season)
                    for season in range(FIRST_COLLEGE_STATS_SEASON, LAST_COLLEGE_STATS_SEASON + 1)
                ],
            },
            "nflIdentityOutcomes": {
                "sourceRef": source_ref,
                "files": [item("identities")],
            },
        }
        self.assertTrue(manifest_is_complete(manifest))
        manifest["rosters"]["files"][0].pop("sha256")
        self.assertFalse(manifest_is_complete(manifest))

    def test_offline_collection_fails_if_pinned_cache_is_incomplete(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                collect_future_rookie_sources(
                    Path(directory), refresh=False, offline=True,
                    roster_seasons=[2025], college_seasons=[2025],
                )


if __name__ == "__main__":
    unittest.main()

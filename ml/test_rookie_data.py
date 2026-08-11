import tempfile
import unittest
from pathlib import Path

import pandas as pd

from ml.rookie_data import (
    aggregate_college_season,
    build_college_features,
    build_combine_features,
    download_file,
)


class RookieDataTests(unittest.TestCase):
    def test_college_aggregation_builds_real_team_shares(self) -> None:
        frame = pd.DataFrame([
            {
                "game_id": 1, "season": 2024, "team": "Alpha", "opponent": "Beta",
                "reception_player_id": 10, "reception_player": "One Wide", "reception_yds": 20,
                "target_player_id": 10, "target_player": "One Wide", "target_stat": 1,
                "rush_player_id": None, "rush_player": None, "rush_yds": None,
                "completion_player_id": 30, "completion_player": "Passer", "completion_yds": 20,
                "incompletion_player_id": None, "incompletion_player": None, "incompletion_stat": None,
                "interception_thrown_player_id": None, "interception_thrown_player": None,
                "interception_thrown_stat": None, "touchdown_player_id": 10,
                "touchdown_player": "One Wide", "touchdown_stat": 1,
            },
            {
                "game_id": 1, "season": 2024, "team": "Alpha", "opponent": "Beta",
                "reception_player_id": 20, "reception_player": "Two Wide", "reception_yds": 30,
                "target_player_id": 20, "target_player": "Two Wide", "target_stat": 1,
                "rush_player_id": None, "rush_player": None, "rush_yds": None,
                "completion_player_id": 30, "completion_player": "Passer", "completion_yds": 30,
                "incompletion_player_id": None, "incompletion_player": None, "incompletion_stat": None,
                "interception_thrown_player_id": None, "interception_thrown_player": None,
                "interception_thrown_stat": None, "touchdown_player_id": None,
                "touchdown_player": None, "touchdown_stat": None,
            },
        ])

        result = aggregate_college_season(frame).set_index("player_id")

        self.assertAlmostEqual(result.loc["10", "receiving_yards_share"], 0.4)
        self.assertAlmostEqual(result.loc["20", "targets_share"], 0.5)
        self.assertEqual(result.loc["30", "pass_attempts"], 2)
        self.assertEqual(result.loc["10", "touchdowns"], 1)

    def test_college_features_use_stable_espn_id_and_only_pre_draft_seasons(self) -> None:
        universe = pd.DataFrame([{
            "fp_id": "100", "normalized_name": "prospect", "espn_id": "77", "draft_year": 2025,
        }])
        seasons = pd.DataFrame([
            {
                "player_id": "77", "season": 2023, "games": 10, "scrimmage_yards_per_game": 50,
                "targets_share": 0.20, "receiving_yards_share": 0.25, "rushing_yards_share": 0.0,
                "scrimmage_yards_share": 0.25, "yards_per_target": 8, "yards_per_carry": None,
                "pass_yards_per_attempt": None, "passing_yards_share": 0.0,
                "passing_yards_per_game": 0,
            },
            {
                "player_id": "77", "season": 2024, "games": 12, "scrimmage_yards_per_game": 80,
                "targets_share": 0.30, "receiving_yards_share": 0.35, "rushing_yards_share": 0.0,
                "scrimmage_yards_share": 0.35, "yards_per_target": 10, "yards_per_carry": None,
                "pass_yards_per_attempt": None, "passing_yards_share": 0.0,
                "passing_yards_per_game": 0,
            },
            {
                "player_id": "77", "season": 2025, "games": 1, "scrimmage_yards_per_game": 999,
                "targets_share": 1.0, "receiving_yards_share": 1.0, "rushing_yards_share": 0.0,
                "scrimmage_yards_share": 1.0, "yards_per_target": 99, "yards_per_carry": None,
                "pass_yards_per_attempt": None, "passing_yards_share": 0.0,
                "passing_yards_per_game": 0,
            },
        ])

        result = build_college_features(universe, seasons).iloc[0]

        self.assertEqual(result["college_join_method"], "espn_id")
        self.assertEqual(result["college_seasons_observed"], 2)
        self.assertEqual(result["college_final_scrimmage_yards_per_game"], 80)
        self.assertEqual(result["college_max_target_share"], 0.30)

    def test_combine_join_prefers_stable_cfbref_id(self) -> None:
        universe = pd.DataFrame([{
            "fp_id": "100", "normalized_name": "nick", "name": "Nickname Player",
            "cfbref_id": "legal-name-1", "pfr_id": "", "draft_year": 2025,
        }])
        combine = pd.DataFrame([{
            "cfb_id": "legal-name-1", "pfr_id": "NameLe00", "player_name": "Legal Name",
            "season": 2025, "forty": 4.50, "wt": 210, "vertical": 35,
            "broad_jump": 120, "cone": 7.0, "shuttle": 4.2,
        }])

        result = build_combine_features(universe, combine).iloc[0]

        self.assertEqual(result["combine_join_method"], "cfbref_id")
        self.assertAlmostEqual(result["combine_forty"], 4.5)
        self.assertGreater(result["combine_speed_score"], 100)

    def test_offline_collection_fails_loudly_when_file_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                download_file(
                    "https://example.invalid/data.parquet",
                    Path(directory) / "missing.parquet",
                    refresh=False,
                    offline=True,
                )


if __name__ == "__main__":
    unittest.main()

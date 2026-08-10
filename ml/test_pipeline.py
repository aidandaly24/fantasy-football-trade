import unittest

import pandas as pd

from ml.pipeline import feature_row, training_rows


class PipelineTests(unittest.TestCase):
    def test_feature_row_counts_missed_team_weeks(self) -> None:
        row = feature_row(
            position="RB",
            weeks=4,
            weekly_points={1: 12.0, 2: 8.0},
            active_weeks=2,
            totals={"carries": 20.0, "receptions": 4.0},
        )

        self.assertEqual(row["prior_ppg"], 5.0)
        self.assertEqual(row["touches_pg"], 6.0)
        self.assertEqual(row["pos_RB"], 1.0)
        self.assertEqual(row["pos_QB"], 0.0)

    def test_training_rows_treats_disappearing_player_as_zero(self) -> None:
        summaries = pd.DataFrame(
            [
                {"player_id": "a", "season": 2023, "prior_ppg": 10.0},
                {"player_id": "b", "season": 2023, "prior_ppg": 7.0},
                {"player_id": "a", "season": 2024, "prior_ppg": 8.0},
            ]
        )

        rows = training_rows(summaries).set_index("player_id")

        self.assertEqual(rows.loc["a", "target_ppg"], 8.0)
        self.assertEqual(rows.loc["b", "target_ppg"], 0.0)


if __name__ == "__main__":
    unittest.main()

import unittest

import pandas as pd
import numpy as np

from ml.pipeline import (
    apply_interval_scales,
    bootstrap_mae_improvement,
    feature_row,
    interval_metrics,
    interval_scales,
    roster_event_flags,
    simple_baselines,
    training_rows,
)


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

    def test_simple_baselines_are_fit_from_reference_only(self) -> None:
        reference = pd.DataFrame(
            [
                {"position": "QB", "target_ppg": 10.0},
                {"position": "QB", "target_ppg": 14.0},
                {"position": "RB", "target_ppg": 6.0},
            ]
        )
        frame = pd.DataFrame(
            [
                {"position": "QB", "prior_ppg": 20.0},
                {"position": "RB", "prior_ppg": 8.0},
            ]
        )

        baselines = simple_baselines(reference, frame)

        np.testing.assert_allclose(baselines["repeatPrior"], [20.0, 8.0])
        np.testing.assert_allclose(baselines["positionMean"], [12.0, 6.0])
        np.testing.assert_allclose(baselines["shrinkToPosition"], [18.0, 7.5])

    def test_interval_calibration_targets_coverage_without_test_labels(self) -> None:
        frame = pd.DataFrame({"position": ["QB"] * 10})
        point = np.full(10, 5.0)
        lower = np.full(10, 4.5)
        upper = np.full(10, 5.5)
        truth = np.arange(10, dtype=float)

        scales = interval_scales(frame, truth, point, lower, upper)
        calibrated_lower, calibrated_upper = apply_interval_scales(
            frame, point, lower, upper, scales
        )
        metrics = interval_metrics(truth, calibrated_lower, calibrated_upper)

        self.assertGreaterEqual(metrics["coverage"], 0.6)
        self.assertLess(metrics["coverage"], 0.8)

    def test_roster_event_flags_capture_direction_without_unknown_activation(self) -> None:
        down = roster_event_flags("ACT", "RES", "MIN", "MIN", 1)
        up = roster_event_flags("RES", "ACT", "MIN", "MIN", 0)
        unknown = roster_event_flags("UNK", "ACT", None, "MIN", 0)

        self.assertEqual(down["availability_down"], 1.0)
        self.assertEqual(up["availability_up"], 1.0)
        self.assertEqual(unknown["availability_up"], 0.0)

    def test_bootstrap_event_lift_is_deterministic_and_directional(self) -> None:
        truth = np.array([1.0, 2.0, 3.0, 4.0])
        candidate = truth.copy()
        baseline = np.zeros(4)

        first = bootstrap_mae_improvement(truth, candidate, baseline, samples=50)
        second = bootstrap_mae_improvement(truth, candidate, baseline, samples=50)

        self.assertEqual(first, second)
        self.assertGreater(first["lower"], 0.0)


if __name__ == "__main__":
    unittest.main()

import unittest

import numpy as np
import pandas as pd

from ml.rookie_model import (
    PRODUCTION_FEATURES,
    evaluate_pick_slots,
    exact_one_sided_sign_p_value,
    pick_slot_label,
    simple_baseline_baskets,
    sleeper_basket,
)


class RookieModelTests(unittest.TestCase):
    def test_sleeper_basket_uses_the_declared_post_rank_24_rule(self) -> None:
        frame = pd.DataFrame({
            "name": [f"Player {index}" for index in range(1, 34)],
            "rookie_market_rank": list(range(1, 34)),
            "draft_pick": list(range(33, 0, -1)),
            "capital_market_gap": np.linspace(-1, 1, 33),
        })
        prediction = np.arange(33, dtype=float)[::-1]

        result = sleeper_basket(frame, prediction, size=3)

        self.assertEqual(result["rookie_market_rank"].tolist(), [25, 26, 27])
        self.assertTrue((result["rookie_market_rank"] > 24).all())

    def test_backtest_baseline_is_conservative_oracle_of_simple_rules(self) -> None:
        frame = pd.DataFrame({
            "name": [f"Player {index}" for index in range(25, 30)],
            "rookie_market_rank": [25, 26, 27, 28, 29],
            "draft_pick": [200, 150, 100, 50, 1],
            "capital_market_gap": [0.0, 0.1, 0.2, 0.3, 0.4],
        })

        baskets = simple_baseline_baskets(frame, size=2)

        self.assertEqual(baskets["market"]["rookie_market_rank"].tolist(), [25, 26])
        self.assertEqual(baskets["draft"]["draft_pick"].tolist(), [1, 50])
        self.assertEqual(baskets["capitalGap"]["capital_market_gap"].tolist(), [0.4, 0.3])

    def test_five_straight_fold_wins_clear_exact_one_sided_sign_gate(self) -> None:
        self.assertEqual(exact_one_sided_sign_p_value(5, 5), 0.03125)
        self.assertGreater(exact_one_sided_sign_p_value(4, 5), 0.05)

    def test_pick_slot_labels_use_twelve_team_rounds(self) -> None:
        self.assertEqual(pick_slot_label(8), "1.08")
        self.assertEqual(pick_slot_label(12), "1.12")
        self.assertEqual(pick_slot_label(16), "2.04")
        self.assertEqual(pick_slot_label(24), "2.12")

    def test_pick_slot_evaluation_separates_availability_and_selection_rules(self) -> None:
        frame = pd.DataFrame({
            "name": ["A", "B", "C", "D"],
            "position": ["QB", "RB", "WR", "TE"],
            "rookie_market_rank": [1, 2, 3, 4],
            "draft_pick": [40, 30, 20, 10],
            "drafted": [1.0, 1.0, 1.0, 1.0],
            "rookie_production_percentile": [0.1, 0.3, 0.9, 0.2],
        })

        results = evaluate_pick_slots(
            frame,
            full_prediction=np.array([0.9, 0.3, 0.1, 0.8]),
            capital_prediction=np.array([0.1, 0.4, 0.8, 0.2]),
        )
        market_slot_three = next(
            item for item in results
            if item["availabilityRule"] == "marketOrder" and item["slot"] == 3
        )
        draft_slot_three = next(
            item for item in results
            if item["availabilityRule"] == "nflDraftOrder" and item["slot"] == 3
        )

        self.assertEqual(
            market_slot_three["selections"]["learnedMarketPlusCapital"]["player"],
            "C",
        )
        self.assertEqual(
            market_slot_three["selections"]["fullModel"]["player"],
            "D",
        )
        self.assertAlmostEqual(
            market_slot_three["selections"]["fullModel"]["selectionRegret"],
            0.7,
        )
        self.assertEqual(
            draft_slot_three["selections"]["marketOrder"]["player"],
            "A",
        )

    def test_production_features_exclude_every_nfl_outcome_column(self) -> None:
        forbidden = {
            "rookie_games",
            "rookie_ppr",
            "rookie_ppg",
            "rookie_production_percentile",
            "rookie_nfl_stat_row",
        }

        self.assertTrue(forbidden.isdisjoint(PRODUCTION_FEATURES))


if __name__ == "__main__":
    unittest.main()

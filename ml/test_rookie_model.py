import unittest

import numpy as np
import pandas as pd

from ml.rookie_model import (
    PRODUCTION_FEATURES,
    exact_one_sided_sign_p_value,
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

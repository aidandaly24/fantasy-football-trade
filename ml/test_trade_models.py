import unittest
from datetime import date, timedelta

import pandas as pd

from ml.trade_models import (
    EXCHANGE_FEATURES,
    History,
    add_outcome_labels,
    normalize_exchange_trade,
    train_exchange,
    train_outcome,
)


def history(value: float, start: date = date(2025, 1, 1), days: int = 500, daily_return: float = 0) -> History:
    return History([
        {"date": (start + timedelta(days=offset)).isoformat(), "value": value * (1 + daily_return * offset)}
        for offset in range(days)
    ])


def trade() -> dict:
    return {
        "id": "trade-1",
        "leagueId": "league-1",
        "date": "2025-02-01T12:00:00Z",
        "side1": [{"id": 1, "name": "Elite", "position": "WR", "maybeBirthday": "2002-01-01"}],
        "side2": [
            {"id": 2, "name": "Player", "position": "RB", "maybeBirthday": "2000-01-01"},
            {"id": 3, "name": "2027 1st", "position": "PICK"},
        ],
        "numTeams": 12,
        "numQbs": 2,
        "ppr": 1,
        "tePremium": 0.75,
        "numStarters": 10,
        "rosterSize": 28,
    }


class TradeModelTests(unittest.TestCase):
    def test_normalizes_real_one_for_two_premium(self) -> None:
        histories = {1: history(100), 2: history(65), 3: history(50)}
        row = normalize_exchange_trade(trade(), histories, [float(value) for value in range(1, 121)])
        self.assertIsNotNone(row)
        assert row is not None
        self.assertAlmostEqual(row["paid_premium"], 0.15)
        self.assertEqual(row["package_size"], 2)
        self.assertEqual(row["pick_count"], 1)
        self.assertAlmostEqual(row["depth_ratio"], 2.8)

    def test_outcome_label_compares_returns_not_raw_points(self) -> None:
        histories = {
            1: history(100, daily_return=0.001),
            2: history(65, daily_return=0.0002),
            3: history(50, daily_return=0),
        }
        row = normalize_exchange_trade(trade(), histories, [float(value) for value in range(1, 121)])
        assert row is not None
        add_outcome_labels([row], {1: histories, 2: histories})
        self.assertIsNotNone(row["outcome_90d"])
        self.assertGreater(row["outcome_90d"], 0)

    def test_small_exchange_tape_cannot_enable(self) -> None:
        row = {feature: 1.0 for feature in EXCHANGE_FEATURES}
        rows = [{**row, "date": f"2025-01-{index + 1:02d}", "trade_id": str(index), "league_id": str(index), "paid_premium": 0.1, "format_complete": 1, "historical_format_exact": 0, "age_complete": 1} for index in range(10)]
        report = train_exchange(pd.DataFrame(rows))
        self.assertFalse(report["enabled"])
        self.assertEqual(report["status"], "collecting")

    def test_outcome_keeps_structure_and_premium_challengers_separate(self) -> None:
        row = {feature: 1.0 for feature in EXCHANGE_FEATURES}
        rows = []
        for index in range(40):
            rows.append({
                **row,
                "date": (date(2025, 1, 1) + timedelta(days=index)).isoformat(),
                "trade_id": str(index),
                "league_id": str(index),
                "paid_premium": index / 100,
                "outcome_90d": index / 200,
            })
        report = train_outcome(pd.DataFrame(rows), 90)
        self.assertIn("structureOnly", report)
        self.assertIn("premiumAware", report)
        self.assertFalse(report["enabled"])


if __name__ == "__main__":
    unittest.main()

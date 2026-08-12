import unittest
from datetime import date, timedelta

import pandas as pd

from ml.asset_returns import (
    FEATURES,
    build_examples_for_format,
    chronological_split,
    max_drawdown,
    percent_return,
    source_audit,
    train_horizon,
)
from ml.trade_models import History


def synthetic_history(start_value: float, daily_return: float, days: int = 430) -> History:
    start = date(2025, 6, 1)
    return History([
        {"date": (start + timedelta(days=offset)).isoformat(), "value": start_value * (1 + daily_return) ** offset}
        for offset in range(days)
    ])


class AssetReturnTests(unittest.TestCase):
    def test_real_return_and_drawdown_are_not_grades(self) -> None:
        self.assertAlmostEqual(percent_return(100, 125), 0.25)
        self.assertAlmostEqual(max_drawdown([100, 120, 90, 110]), -0.25)

    def test_chronological_split_embargoes_training_labels(self) -> None:
        rows = []
        for offset in range(100):
            observed = date(2025, 1, 1) + timedelta(days=offset)
            rows.append({
                "date": observed.isoformat(),
                "label_date": (observed + timedelta(days=30)).isoformat(),
                "asset_id": offset,
                "position": "WR",
                "target_return": 0.1,
                "target_log_return": 0.095,
                **{feature: 1.0 for feature in FEATURES},
            })
        train, test, split = chronological_split(pd.DataFrame(rows), 30)
        self.assertTrue(len(train) > 0)
        self.assertTrue(len(test) > 0)
        self.assertTrue((train["label_date"] < split["testStart"]).all())
        self.assertTrue((test["date"] >= split["testStart"]).all())

    def test_small_synthetic_tape_remains_shadow_or_needs_data(self) -> None:
        histories = {
            asset_id: synthetic_history(300 + asset_id * 10, 0.0002 + (asset_id % 3) * 0.0001)
            for asset_id in range(1, 31)
        }
        metadata = {
            asset_id: {
                "id": asset_id,
                "name": f"Player {asset_id}",
                "position": ("QB", "RB", "WR", "TE")[asset_id % 4],
                "maybeBirthday": "2000-01-01",
            }
            for asset_id in histories
        }
        result = train_horizon(
            num_qbs=2,
            horizon=30,
            histories=histories,
            metadata_by_id=metadata,
            observed=date(2026, 8, 4),
        )
        self.assertFalse(result.health["enabled"])
        self.assertIn(result.health["status"], {"needs-data", "shadow"})
        self.assertIn("maeImprovement", result.health)

    def test_source_audit_exposes_trade_observed_population_boundary(self) -> None:
        history = synthetic_history(100, 0)
        catalog = [{"player": {"id": 1, "name": "Current", "position": "WR"}}]
        audit = source_audit(catalog, {1: {1: history, 2: history}, 2: {1: history, 2: history}}, {
            1: {"id": 1, "name": "Current", "position": "WR"},
            2: {"id": 2, "name": "Observed only", "position": "RB"},
        })
        self.assertEqual(audit["currentCatalogAssets"], 1)
        self.assertEqual(audit["tradeObservedAssetsOutsideCurrentCatalog"], 1)
        self.assertIn("not complete", audit["survivorWarning"])

    def test_example_builder_uses_only_later_same_asset_value(self) -> None:
        histories = {asset_id: synthetic_history(100 + asset_id, 0.0001) for asset_id in range(1, 61)}
        metadata = {
            asset_id: {"id": asset_id, "name": f"Player {asset_id}", "position": "WR", "maybeBirthday": "2001-01-01"}
            for asset_id in histories
        }
        frame = build_examples_for_format(2, histories, metadata, 30)
        self.assertFalse(frame.empty)
        self.assertTrue((pd.to_datetime(frame["label_date"]) > pd.to_datetime(frame["date"])).all())
        self.assertTrue(frame["target_return"].notna().all())


if __name__ == "__main__":
    unittest.main()

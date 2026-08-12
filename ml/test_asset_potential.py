import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

import pandas as pd

from ml.asset_potential import (
    PATH_FEATURES,
    FUNDAMENTAL_FEATURES,
    _draft_fields,
    audit_failure_population,
    augment_point_in_time_features,
    completed_season_available_at,
    evaluate_experiment,
)


class AssetPotentialTests(unittest.TestCase):
    def test_completed_season_uses_conservative_march_boundary(self) -> None:
        self.assertEqual(completed_season_available_at(date(2026, 2, 15)), 2024)
        self.assertEqual(completed_season_available_at(date(2026, 3, 1)), 2025)

    def test_point_in_time_fundamentals_do_not_cross_anchor(self) -> None:
        row = {
            "asset_id": 1, "date": "2026-02-15", "label_date": "2026-08-14",
            "position": "WR", "target_return": .1, "target_log_return": .095,
            **{feature: 0.0 for feature in PATH_FEATURES},
            "age": 24.0, "age_missing": 0.0,
        }
        metadata = {1: {"sleeperId": "s1", "maybeDraftInfo": {"year": 2024, "round": 2, "pick": 40}}}
        fundamentals = {
            ("g1", 2024): {"prior_ppg": 10., "prior_games": 17., "prior_availability": .94, "prior_opportunities_pg": 7.},
            ("g1", 2025): {"prior_ppg": 30., "prior_games": 18., "prior_availability": 1., "prior_opportunities_pg": 15.},
        }
        result = augment_point_in_time_features(pd.DataFrame([row]), metadata, fundamentals, {"s1": "g1"})
        self.assertEqual(result.iloc[0]["fundamentals_season"], 2024)
        self.assertEqual(result.iloc[0]["prior_ppg"], 10)
        self.assertTrue(set(FUNDAMENTAL_FEATURES).issubset(result.columns))

    def test_draft_capital_is_unavailable_before_the_draft_has_completed(self) -> None:
        metadata = {"maybeDraftInfo": {"year": 2026, "round": 1, "pick": 12}}
        pre_draft = _draft_fields(metadata, date(2026, 4, 1))
        post_draft = _draft_fields(metadata, date(2026, 5, 1))
        self.assertEqual(pre_draft["draft_missing"], 1)
        self.assertEqual(pre_draft["draft_pick"], 0)
        self.assertEqual(post_draft["draft_missing"], 0)
        self.assertEqual(post_draft["draft_pick"], 12)

    def test_population_audit_distinguishes_observed_zero_from_complete_failure_tape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for num_qbs in (1, 2):
                (root / f"{num_qbs}qb").mkdir()
                (root / f"{num_qbs}qb" / "1.json").write_text(json.dumps([
                    {"date": "01/01/2025", "value": 100}, {"date": "01/02/2025", "value": 90},
                ]))
                (root / f"{num_qbs}qb" / "2.json").write_text(json.dumps([
                    {"date": "01/01/2025", "value": 100}, {"date": "01/02/2025", "value": 0},
                ]))
            catalog = [{"player": {"id": 1, "name": "Current", "position": "WR"}}]
            audit = audit_failure_population(catalog, {1: {}, 2: {}}, root)
        self.assertEqual(audit["formats"][0]["outsideCurrentCatalogSeries"], 1)
        self.assertEqual(audit["formats"][0]["outsideCatalogSeriesWithZeroAfterPositiveValue"], 1)
        self.assertTrue(audit["promotionBlocked"])
        self.assertFalse(audit["observedTerminalZerosEligibleAsLabels"])

    def test_small_or_incomplete_tape_cannot_enable_long_horizon(self) -> None:
        rows = []
        for offset in range(10):
            rows.append({
                "asset_id": offset, "date": f"2025-01-{offset + 1:02d}", "label_date": "2025-07-15",
                "position": "WR", "target_return": .1, "target_log_return": .095,
                "market_percentile": .5, "is_rookie": 0., "fundamentals_missing": 1.,
                **{feature: 0.0 for feature in FUNDAMENTAL_FEATURES if feature not in {"market_percentile", "is_rookie", "fundamentals_missing"}},
            })
        result = evaluate_experiment(pd.DataFrame(rows), 180, "2qb", {"promotionBlocked": True})
        self.assertFalse(result["enabled"])
        self.assertEqual(result["status"], "needs-data")


if __name__ == "__main__":
    unittest.main()

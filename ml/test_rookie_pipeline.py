import json
import unittest
from datetime import date

import pandas as pd

from ml.rookie_pipeline import (
    CommitPoint,
    REPORT_JSON,
    ROOKIE_BOARD_JSON,
    build_browser_rookie_bundle,
    build_class_rows,
    normalize_market_snapshot,
    parse_commit_log,
    select_commit,
)


class RookiePipelineTests(unittest.TestCase):
    def test_private_browser_artifact_matches_and_sanitizes_the_report(self) -> None:
        report = json.loads(REPORT_JSON.read_text())
        expected = build_browser_rookie_bundle(report)
        artifact = json.loads(ROOKIE_BOARD_JSON.read_text())

        self.assertEqual(artifact, expected)
        self.assertEqual(
            [player["sleeperId"] for player in artifact["board"]],
            [player["sleeperId"] for player in report["currentDraftBoard"]],
        )
        self.assertEqual(len({player["id"] for player in artifact["board"]}), len(artifact["board"]))
        self.assertEqual(
            [player["sleeperId"] for player in artifact["board"] if player["inValidatedSleeperBasket"]],
            [player["sleeperId"] for player in report["currentDraftBoard"] if player["inValidatedSleeperBasket"]],
        )
        serialized = json.dumps(artifact)
        for forbidden in (
            "currentShadowBoard",
            "marketReturnModels",
            "rawSourceRows",
            "productionFeatureImportance",
            "sources",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_parses_old_and_new_market_schemas_into_the_same_contract(self) -> None:
        old = "\ufeffmergename,pos,age,dyno2QBECR,draft_year\nAlpha Back,RB,21.2,40.5,2019\nBeta Wide,WR,22.0,90.0,2019\n"
        new = '"player","pos","age","ecr_2qb","draft_year","fp_id"\n"Alpha Back","RB",21.2,40.5,2019,"10"\n"Beta Wide","WR",22.0,90.0,2019,"11"\n'
        point = CommitPoint(date(2019, 8, 9), "abc")

        old_frame = normalize_market_snapshot(old, point)
        new_frame = normalize_market_snapshot(new, point)

        self.assertEqual(list(old_frame["name"]), list(new_frame["name"]))
        self.assertEqual(list(old_frame["market_percentile"]), [1.0, 0.0])
        self.assertEqual(list(new_frame["market_percentile"]), [1.0, 0.0])

    def test_commit_selection_never_uses_future_data_for_features(self) -> None:
        points = parse_commit_log(
            "2024-08-16|later\n2024-08-09|prior\n2024-08-02|older\n"
        )

        selected = select_commit(points, date(2024, 8, 10), "prior")

        self.assertIsNotNone(selected)
        self.assertEqual(selected.commit, "prior")
        self.assertLessEqual(selected.observed_at, date(2024, 8, 10))

    def test_unranked_rookies_remain_in_tape_at_source_floor(self) -> None:
        anchor_point = CommitPoint(date(2024, 8, 9), "anchor")
        outcome_point = CommitPoint(date(2025, 2, 6), "outcome")
        anchor = normalize_market_snapshot(
            'player,pos,age,ecr_2qb,draft_year,fp_id\nRanked Rookie,RB,21,50,2024,1\n',
            anchor_point,
        )
        outcome = normalize_market_snapshot(
            'player,pos,age,ecr_2qb,draft_year,fp_id\nUnranked Rookie,WR,22,80,2024,2\n',
            outcome_point,
        )
        universe = pd.DataFrame([
            {
                "fp_id": "1", "normalized_name": "rankedrookie", "name": "Ranked Rookie",
                "position": "RB", "team": "A", "college": "X", "sleeper_id": "101",
                "draft_year": 2024, "draft_round": 2, "draft_ovr": 40, "drafted": 1.0,
                "model_draft_pick": 40, "birthdate": "2003-01-01", "height": 70, "weight": 210,
            },
            {
                "fp_id": "2", "normalized_name": "unrankedrookie", "name": "Unranked Rookie",
                "position": "WR", "team": "B", "college": "Y", "sleeper_id": "102",
                "draft_year": 2024, "draft_round": 7, "draft_ovr": 230, "drafted": 1.0,
                "model_draft_pick": 230, "birthdate": "2002-01-01", "height": 72, "weight": 195,
            },
        ])

        rows, coverage = build_class_rows(
            rookie_year=2024,
            anchor_point=anchor_point,
            anchor=anchor,
            prior30=None,
            prior90=None,
            outcomes={180: (outcome_point, outcome), 365: None},
            universe=universe,
        )
        by_name = {row["name"]: row for row in rows}

        self.assertEqual(len(rows), 2)
        self.assertEqual(coverage["tapeCoverageRate"], 1.0)
        self.assertEqual(coverage["marketPricedRookies"], 1)
        self.assertEqual(by_name["Unranked Rookie"]["anchor_market_present"], 0.0)
        self.assertEqual(by_name["Unranked Rookie"]["initial_market_percentile"], 0.0)
        self.assertGreater(by_name["Unranked Rookie"]["percentile_change_180"], 0.0)
        self.assertTrue(by_name["Ranked Rookie"]["outcome_missing_180"])

    def test_snapshot_tolerance_rejects_distant_observations(self) -> None:
        points = [CommitPoint(date(2024, 1, 1), "old")]

        self.assertIsNone(select_commit(points, date(2024, 3, 1), "nearest", tolerance_days=21))


if __name__ == "__main__":
    unittest.main()

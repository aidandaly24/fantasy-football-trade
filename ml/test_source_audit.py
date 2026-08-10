import unittest

from ml.source_audit import (
    build_report,
    count_return_labels,
    fantasycalc_report,
    normalize_history_date,
    select_stratified_players,
    summarize_history,
)


class SourceAuditTests(unittest.TestCase):
    def test_normalizes_provider_dates_without_accepting_impossible_values(self) -> None:
        self.assertEqual(normalize_history_date("230310"), "2023-03-10")
        self.assertEqual(normalize_history_date("07/01/2025"), "2025-07-01")
        self.assertEqual(normalize_history_date("2026-08-10T12:30:00Z"), "2026-08-10")
        self.assertIsNone(normalize_history_date("260229"))

    def test_selects_deterministic_position_and_value_sample(self) -> None:
        players = [
            {
                "slug": f"{position.lower()}-{index}",
                "name": f"{position} {index}",
                "position": position,
                "composite": 1000 - index,
            }
            for position in ("QB", "RB", "WR", "TE")
            for index in range(100)
        ]
        first = select_stratified_players(players, 50)
        second = select_stratified_players(reversed(players), 50)

        self.assertEqual([row["slug"] for row in first], [row["slug"] for row in second])
        self.assertEqual(sum(row["position"] == "QB" for row in first), 10)
        self.assertEqual(sum(row["position"] == "RB" for row in first), 14)
        self.assertEqual(sum(row["position"] == "WR" for row in first), 16)
        self.assertEqual(sum(row["position"] == "TE" for row in first), 10)
        qb_values = [row["composite"] for row in first if row["position"] == "QB"]
        self.assertLess(min(qb_values), 920)
        self.assertGreater(max(qb_values), 990)

    def test_history_summary_deduplicates_and_builds_time_separated_labels(self) -> None:
        history = [
            {"date": "230101", "value": 100, "raw": 1000},
            {"date": "230130", "value": 110, "raw": 1100},
            {"date": "230130", "value": 111, "raw": 1110},
            {"date": "230301", "value": 120, "raw": 1200},
            {"date": "bad", "value": 130},
        ]
        summary = summarize_history(history, current_value=120)

        self.assertEqual(summary["observationCount"], 3)
        self.assertEqual(summary["duplicateDateCount"], 1)
        self.assertEqual(summary["invalidPointCount"], 1)
        self.assertEqual(summary["labels"]["30d"], 2)
        self.assertAlmostEqual(summary["currentScaleGap"], 0)

    def test_return_labels_do_not_count_dense_overlapping_anchors(self) -> None:
        dates = [f"2026-01-{day:02d}" for day in range(1, 32)]
        self.assertEqual(count_return_labels(dates, 7, 0, 7), 4)
        self.assertEqual(count_return_labels(["260101", "260108", "260115"], 7, 0, 7), 2)

    def test_training_stays_blocked_when_any_source_has_unresolved_gates(self) -> None:
        def source(provider: str, passed: bool) -> dict:
            return {
                "provider": provider,
                "pilotReady": passed,
                "trainingReady": passed,
                "gates": [
                    {"id": "gate", "label": "gate", "passed": passed, "actual": passed, "requirement": "pass"}
                ],
            }

        report = build_report(
            source("market-comparison", False),
            source("market", True),
            source("events", True),
            source("news", False),
            "now",
        )

        self.assertFalse(report["decision"]["trainingReady"])
        self.assertFalse(report["decision"]["liveRecommendationsEnabled"])
        self.assertEqual(report["decision"]["blockers"][0]["source"], "news")
        self.assertEqual(report["decision"]["candidateWarnings"][0]["source"], "market-comparison")

    def test_fantasycalc_report_keeps_format_and_survivor_gates_real(self) -> None:
        dates = [
            {"observedAt": f"2025-07-{day:02d}", "value": 100 + day, "rawValue": None}
            for day in range(1, 29)
        ]
        results = []
        rows = []
        for index in range(50):
            history = [
                {"date": point["observedAt"], "value": point["value"]}
                for point in dates
            ]
            summary = summarize_history(history, current_value=128)
            result = {
                "status": "complete",
                "provenanceComplete": True,
                **{key: value for key, value in summary.items() if key != "observations"},
            }
            results.append(result)
            rows.extend({"asset_id": str(index), "observed_at": point["observedAt"]} for point in dates)
        catalog = {
            "rawAssetCount": 474,
            "data": [{"sleeperId": str(index)} for index in range(398)],
        }
        snapshots = [{"position": "PICK"} for _ in range(76)]

        report = fantasycalc_report(catalog, results, rows, snapshots)

        self.assertEqual(report["metrics"]["catalogPicks"], 76)
        self.assertTrue(next(gate for gate in report["gates"] if gate["id"] == "identity")["passed"])
        self.assertFalse(next(gate for gate in report["gates"] if gate["id"] == "historicalFormat")["passed"])
        self.assertFalse(report["trainingReady"])


if __name__ == "__main__":
    unittest.main()

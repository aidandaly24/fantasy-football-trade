import unittest
import hashlib
import json
import tempfile
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from ml.trade_models import (
    EXCHANGE_FEATURES,
    History,
    add_outcome_labels,
    audit_trade_availability,
    build_training_manifest,
    import_training_tape,
    load_all_trades,
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


def training_tape(trades: list[dict]) -> dict:
    canonical = json.dumps(trades, ensure_ascii=False, separators=(",", ":"))
    return {
        "schemaVersion": 1,
        "datasetId": f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}",
        "source": "FantasyCalc completed trades",
        "exportedAt": "2026-08-12T03:30:00Z",
        "totalTrades": len(trades),
        "uniqueLeagues": len({item["leagueId"] for item in trades}),
        "firstTradeAt": trades[0]["date"],
        "latestTradeAt": trades[-1]["date"],
        "trades": trades,
    }


class TradeModelTests(unittest.TestCase):
    def test_imports_content_addressed_hosted_tape_and_deduplicates_local_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            imports = root / "imports"
            trades_dir = root / "trades"
            local_trade = {**trade(), "numTeams": 10}
            hosted_trade = trade()
            source = root / "download.json"
            source.write_text(json.dumps(training_tape([hosted_trade])))
            (trades_dir / "2026-08-12").mkdir(parents=True)
            (trades_dir / "2026-08-12" / "1.json").write_text(json.dumps([local_trade]))
            with patch("ml.trade_models.IMPORTS", imports), patch("ml.trade_models.TRADES", trades_dir):
                result = import_training_tape(source)
                loaded = load_all_trades()
            self.assertEqual(result["datasetId"], training_tape([hosted_trade])["datasetId"])
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0]["numTeams"], 12)

    def test_rejects_tape_when_rows_do_not_match_dataset_id(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "bad.json"
            payload = training_tape([trade()])
            payload["trades"][0]["numTeams"] = 8
            source.write_text(json.dumps(payload))
            with patch("ml.trade_models.IMPORTS", root / "imports"):
                with self.assertRaisesRegex(ValueError, "datasetId"):
                    import_training_tape(source)

    def test_manifest_records_import_and_point_in_time_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            imports = Path(temporary)
            payload = training_tape([trade()])
            (imports / "tape.json").write_text(json.dumps(payload))
            histories = {1: {}, 2: {1: history(100), 2: history(65), 3: history(50)}}
            with patch("ml.trade_models.IMPORTS", imports):
                manifest = build_training_manifest([trade()], histories)
            self.assertEqual(manifest["datasetId"], payload["datasetId"])
            self.assertEqual(manifest["importedTrades"], 1)
            self.assertEqual(manifest["pointInTimeValuedTrades"], 1)
            self.assertEqual(manifest["pointInTimeCoverage"], 1)
            self.assertEqual(manifest["importedPointInTimeValuedTrades"], 1)
            self.assertEqual(manifest["importedPointInTimeCoverage"], 1)

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
        self.assertEqual(report["status"], "needs-data")

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

    def test_trade_availability_audit_does_not_invent_pagination(self) -> None:
        response = [{"id": f"trade-{index}", "date": f"2026-08-{index + 1:02d}"} for index in range(3)]
        catalog = [{"value": 100, "player": {"id": 1, "name": "Anchor", "position": "QB"}}]
        with tempfile.TemporaryDirectory() as temporary:
            report_path = Path(temporary) / "audit.json"
            markdown_path = Path(temporary) / "audit.md"
            with (
                patch("ml.trade_models.load_current", return_value=catalog),
                patch("ml.trade_models.select_anchors", return_value=catalog),
                patch("ml.trade_models.fetch_json", side_effect=[response, response, response]),
                patch("ml.trade_models.load_all_trades", return_value=[]),
                patch("ml.trade_models.ensure_dirs"),
                patch("ml.trade_models.TRADES", Path(temporary) / "trades"),
                patch("ml.trade_models.TRADE_AVAILABILITY_JSON", report_path),
                patch("ml.trade_models.TRADE_AVAILABILITY_MD", markdown_path),
            ):
                report = audit_trade_availability()
        self.assertTrue(report["page2Identical"])
        self.assertTrue(report["offset100Identical"])
        self.assertFalse(report["paginationProven"])
        self.assertFalse(report["olderBackfillProven"])


if __name__ == "__main__":
    unittest.main()

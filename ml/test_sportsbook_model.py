import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

from ml.sportsbook_model import build_report, evaluate_anchor, flatten_record, load_tape


def record(season: int, lead_hours: int = 72) -> dict:
    kickoff = datetime(season, 9, 10, 17, tzinfo=timezone.utc)
    return {
        "season": season,
        "week": 1,
        "observedAt": (kickoff - timedelta(hours=lead_hours)).isoformat(),
        "kickoffAt": kickoff.isoformat(),
        "playerId": f"p-{season}",
        "position": "WR",
        "actualPpr": 15.0,
        "baselinePpg": 13.0,
        "gameTotal": 48.5,
        "teamSpread": -2.5,
        "impliedTeamTotal": 25.5,
        "markets": {"player_reception_yds": {"line": 68.5, "overProbability": .51}},
    }


class SportsbookModelTests(unittest.TestCase):
    def test_future_or_at_kickoff_observation_is_rejected(self) -> None:
        value = record(2025)
        value["observedAt"] = value["kickoffAt"]
        self.assertIsNone(flatten_record(value))

    def test_private_jsonl_loader_reports_rejected_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "tape.jsonl"
            invalid = record(2025)
            invalid["actualPpr"] = None
            path.write_text(json.dumps(record(2024)) + "\n" + json.dumps(invalid) + "\n")
            frame, audit = load_tape(path)
        self.assertEqual(len(frame), 1)
        self.assertEqual(audit, {"rawRows": 2, "eligibleRows": 1, "rejectedRows": 1})

    def test_one_season_cannot_train_a_challenger(self) -> None:
        frame = pd.DataFrame([flatten_record(record(2025))])
        result = evaluate_anchor(frame, "early-week")
        self.assertEqual(result["status"], "needs-data")
        self.assertFalse(result["enabled"])

    def test_empty_tape_stays_zero_weight(self) -> None:
        report = build_report(pd.DataFrame(), {"rawRows": 0, "eligibleRows": 0, "rejectedRows": 0})
        self.assertEqual(report["status"], "needs-data")
        self.assertFalse(report["enabled"])
        self.assertEqual(report["rows"], 0)


if __name__ == "__main__":
    unittest.main()

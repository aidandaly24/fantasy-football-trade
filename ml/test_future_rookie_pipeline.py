import unittest

import pandas as pd

from ml.future_rookie_data import (
    FIRST_COLLEGE_STATS_SEASON,
    FIRST_ROSTER_SEASON,
    LAST_ARCHIVED_ROSTER_SEASON,
    LAST_COLLEGE_STATS_SEASON,
)
from ml.future_rookie_pipeline import build_report, render_markdown


def synthetic_evidence() -> tuple[pd.DataFrame, pd.DataFrame, dict[str, object]]:
    tape_rows = []
    identity_rows = []
    positions = ("QB", "RB", "WR", "TE")
    for year in range(2020, 2026):
        for index, position in enumerate(positions):
            athlete_id = f"{year}-{index}"
            tape_rows.append({
                "athlete_id": athlete_id,
                "player_name": f"Player {athlete_id}",
                "position": position,
                "team": "Test",
                "target_draft_year": year,
                "feature_cutoff_season": year - 2,
                "feature_max_season": year - 2,
                "plausibly_eligible": True,
                "roster_year_known": True,
                "recruiting_data_present": False,
                "roster_identity_ambiguous": False,
                "prior_college_data_present": True,
                "prior_career_scrimmage_yards": 1000 - index,
                "entered_target_nfl_class": index == 0,
                "drafted_in_target_class": index == 0,
                "target_class_draft_overall": 10 if index == 0 else None,
            })
            if index == 0:
                identity_rows.append({
                    "athlete_id": athlete_id,
                    "name": f"Player {athlete_id}",
                    "position": position,
                    "draft_year": year,
                    "draft_overall": 10,
                })
    source_ref = "a" * 40
    def item(name: str, season: int | None = None) -> dict[str, object]:
        return {
            "path": f"/ignored/{name}",
            "url": f"https://example.test/{source_ref}/{name}",
            "sha256": "b" * 64,
            "sourceRef": source_ref,
            "effectiveSeason": season,
        }
    common = {"provider": "test", "license": "test", "sourceRef": source_ref}
    manifest = {
        "rosters": {
            **common,
            "files": [
                item(f"roster-{season}", season)
                for season in range(FIRST_ROSTER_SEASON, LAST_ARCHIVED_ROSTER_SEASON + 1)
            ],
        },
        "collegeProduction": {
            **common,
            "files": [
                item(f"stats-{season}", season)
                for season in range(FIRST_COLLEGE_STATS_SEASON, LAST_COLLEGE_STATS_SEASON + 1)
            ],
        },
        "nflIdentityOutcomes": {
            **common,
            "files": [item("identities")],
        },
    }
    return pd.DataFrame(tape_rows), pd.DataFrame(identity_rows), manifest


class FutureRookiePipelineTests(unittest.TestCase):
    def test_report_passes_tape_gates_but_does_not_enable_training(self) -> None:
        tape, identities, manifest = synthetic_evidence()

        report = build_report(
            tape, identities, {"rows": len(identities), "excludedCollisionIds": []},
            manifest, generated_at="2026-08-11T00:00:00Z",
        )

        self.assertTrue(report["decision"]["phasePassed"])
        self.assertFalse(report["decision"]["trainingEnabled"])
        self.assertFalse(report["decision"]["downstreamEnabled"])
        self.assertEqual(report["currentClass"]["status"], "blocked")
        self.assertEqual(len(report["tape"]["classes"]), 6)

    def test_report_is_deterministic_with_fixed_timestamp(self) -> None:
        tape, identities, manifest = synthetic_evidence()
        args = (
            tape, identities, {"rows": len(identities), "excludedCollisionIds": []}, manifest,
        )

        first = build_report(*args, generated_at="2026-08-11T00:00:00Z")
        second = build_report(*args, generated_at="2026-08-11T00:00:00Z")

        self.assertEqual(first, second)
        self.assertEqual(render_markdown(first), render_markdown(second))

    def test_identity_recovery_gate_fails_when_known_entrant_is_missing(self) -> None:
        tape, identities, manifest = synthetic_evidence()
        identities = pd.concat([
            identities,
            pd.DataFrame([{
                "athlete_id": "not-on-roster", "name": "Missing", "position": "WR",
                "draft_year": 2024, "draft_overall": 50,
            }]),
        ], ignore_index=True)

        report = build_report(
            tape, identities, {"rows": len(identities), "excludedCollisionIds": []},
            manifest, generated_at="2026-08-11T00:00:00Z",
        )

        self.assertFalse(report["decision"]["phasePassed"])
        gate = next(item for item in report["gates"] if item["id"] == "identity-recovery")
        self.assertFalse(gate["passed"])


if __name__ == "__main__":
    unittest.main()

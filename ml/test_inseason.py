import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from ml.inseason_data import (BASE_STATS, FTN_FIELDS, KEY, NGS_FIELDS, Sources, aggregate_ftn,
                             digest, normalize_ngs, normalize_schedule, normalize_stats, score)
from ml.inseason_features import BASE_FEATURES, build_panel, feature_sets
from ml.inseason_model import evaluate, paired_interval, split
from ml.inseason_pipeline import clean, parser

SCORING = {"ppr": 1., "tep": .5, "passTd": 4., "passInt": -1.}


def fixture(season=2025):
    rows, schedule = [], []
    for week in range(1, 19):
        game = f"{season}_{week:02d}_A_B"
        # Player a disappears after week 2; q maintains complete game evidence.
        for player in (["a", "q"] if week <= 2 else ["q"]):
            row = {field: 0. for field in BASE_STATS}
            row.update(season=season, week=week, player_id=player, position="WR" if player == "a" else "QB",
                       player_display_name=player, team="A", game_id=game, season_type="REG",
                       targets=5 if player == "a" else 0, receptions=3 if player == "a" else 0,
                       receiving_yards=30 if player == "a" else 0, attempts=25 if player == "q" else 0)
            rows.append(row)
        schedule.append({"season": season, "week": week, "game_id": game, "game_type": "REG",
                         "gameday": f"{season}-09-01", "home_team": "A", "away_team": "B",
                         "home_score": 14, "away_score": 7})
    return {"stats": normalize_stats(pd.DataFrame(rows)), "schedule": normalize_schedule(pd.DataFrame(schedule)),
            "ngs": pd.DataFrame(columns=KEY), "ftn": pd.DataFrame(columns=KEY)}


class InseasonEvidenceTests(unittest.TestCase):
    def test_missing_appearances_remain_zero_and_four_week_label_uses_calendar(self):
        panel, audit = build_panel(fixture(), [2025], SCORING)
        a = panel[panel.player_id.eq("a")].set_index("week")
        self.assertEqual(a.loc[1, "target_4"], 1.5)  # 6 then 0, 0, 0
        self.assertEqual(a.loc[2, "target_1"], 0)
        self.assertEqual(a.loc[5, "ppg_3"], 0)
        self.assertTrue(pd.isna(a.loc[15, "target_4"]))
        self.assertEqual(a.loc[18, "weeks_since_opportunity"], 16)
        self.assertEqual(a.loc[3, "team_attempts_3"], 75)
        self.assertEqual(a.loc[3, "target_share_3"], 1.)
        self.assertTrue(pd.isna(a.loc[5, "target_share_3"]))  # no team targets, not 0/0
        self.assertEqual(audit["retainedNoOpportunityWeeks"], 16)

    def test_future_mutations_do_not_change_earlier_features_or_universe(self):
        data = fixture()
        before, _ = build_panel(data, [2025], SCORING)
        data["stats"].loc[data["stats"].week.gt(8), "passing_yards"] = 9999
        extra = data["stats"][data["stats"].week.eq(12)].iloc[0].copy()
        extra["player_id"] = "future-debut"
        data["stats"] = pd.concat([data["stats"], pd.DataFrame([extra.to_dict()])], ignore_index=True)
        after, _ = build_panel(data, [2025], SCORING)
        cols = KEY + BASE_FEATURES + ["scheduled_games_1", "scheduled_games_4"]
        pd.testing.assert_frame_equal(before[before.week.le(8)][cols].reset_index(drop=True),
                                      after[after.week.le(8)][cols].reset_index(drop=True), check_dtype=False)
        self.assertFalse(after.loc[after.week.lt(12), "player_id"].eq("future-debut").any())

    def test_incomplete_historical_game_is_error_not_fake_zero(self):
        data = fixture()
        data["stats"] = data["stats"][data["stats"].week.ne(10)]
        with self.assertRaisesRegex(ValueError, "Incomplete historical"):
            build_panel(data, [2025], SCORING)

    def test_current_partial_week_is_excluded_but_future_schedule_retained(self):
        data = fixture(2026)
        data["stats"] = data["stats"][data["stats"].week.le(1)]
        extra = data["schedule"].iloc[[0]].copy()
        extra["game_id"], extra["team"], extra["completed"] = "2026_01_C_D", "C", False
        data["schedule"] = pd.concat([data["schedule"], extra], ignore_index=True)
        with self.assertRaisesRegex(ValueError, "No eligible"):
            build_panel(data, [], SCORING, 2026)

    def test_exact_offensive_scoring_includes_tep_interceptions_and_two_point(self):
        rows = fixture()["stats"].iloc[:2].copy()
        rows.loc[rows.player_id.eq("a"), "position"] = "TE"
        rows["passing_2pt_conversions"] = 1
        rows["passing_interceptions"] = 1
        points = score(rows, SCORING).to_list()
        self.assertEqual(points, [8.5, 1.])

    def test_team_opportunity_denominators_include_fullbacks(self):
        raw = fixture()["stats"].drop(columns=[c for c in fixture()["stats"] if c.startswith("team_")])
        fullback = raw.iloc[0].to_dict()
        fullback.update(player_id="fb", position="FB", targets=2, carries=2)
        stats = normalize_stats(pd.concat([raw, pd.DataFrame([fullback])], ignore_index=True))
        self.assertNotIn("fb", stats.player_id.to_list())
        receiver = stats[stats.player_id.eq("a") & stats.week.eq(1)].iloc[0]
        self.assertEqual(receiver.team_targets, 7)

    def test_anonymous_defense_rows_are_not_players_but_unidentified_offense_fails(self):
        raw = fixture()["stats"].drop(columns=[c for c in fixture()["stats"] if c.startswith("team_")])
        anonymous = {**raw.iloc[0].to_dict(), **{field: 0. for field in BASE_STATS},
                     "player_id": None, "position": None}
        rows = pd.concat([raw, pd.DataFrame([anonymous])], ignore_index=True)
        self.assertEqual(len(normalize_stats(rows)), len(raw))
        rows.loc[rows.player_id.isna(), "targets"] = 1
        with self.assertRaisesRegex(ValueError, "offensive observation"):
            normalize_stats(rows)

    def test_bye_and_transfer_do_not_skip_a_future_calendar_week(self):
        data = fixture()
        # Remove the complete week-3 game to model a bye, then transfer the
        # receiver for week 4. Labels follow the player; earlier team stays A.
        data["schedule"] = data["schedule"][data["schedule"].week.ne(3)]
        data["stats"] = data["stats"][data["stats"].week.ne(3)]
        future = data["stats"][data["stats"].player_id.eq("a")].iloc[0].to_dict()
        future.update(week=4, team="B", game_id="2025_04_A_B", targets=5, receptions=5, receiving_yards=50)
        data["stats"] = pd.concat([data["stats"], pd.DataFrame([future])], ignore_index=True)
        panel, _ = build_panel(data, [2025], SCORING)
        player = panel[panel.player_id.eq("a")].set_index("week")
        self.assertEqual(player.loc[2, "target_1"], 0)
        self.assertEqual(player.loc[2, "target_4"], 2.5)
        self.assertEqual(player.loc[2, "team"], "A")
        self.assertEqual(player.loc[4, "team"], "B")
        self.assertEqual(player.loc[2, "scheduled_games_1"], 0)

    def test_schedule_identity_mismatch_is_not_silently_a_bye(self):
        data = fixture()
        data["stats"].loc[0, "team"] = "UNMAPPED"
        with self.assertRaisesRegex(ValueError, "Unmatched schedule"):
            build_panel(data, [2025], SCORING)

    def test_historical_raiders_alias_matches_without_rewriting_game_identity(self):
        schedule = normalize_schedule(pd.DataFrame([{
            "season": 2018, "week": 1, "game_id": "2018_01_LA_OAK", "game_type": "REG",
            "gameday": "2018-09-10", "home_team": "OAK", "away_team": "LA",
            "home_score": 13, "away_score": 33,
        }]))
        self.assertEqual(set(schedule.team), {"LV", "LA"})
        self.assertEqual(set(schedule.game_id), {"2018_01_LA_OAK"})

    def test_ngs_summary_rows_rejected_and_rates_weighted_by_correct_samples(self):
        fields = NGS_FIELDS["receiving"]
        rows = []
        for week, targets, sep, yac, receptions in [(0, 100, 99, 99, 100), (1, 1, 1, 2, 1), (2, 9, 3, 4, 3)]:
            rows.append({"season": 2025, "week": week, "season_type": "REG", "player_gsis_id": "a",
                         **{f: 1. for f in fields}, "targets": targets, "receptions": receptions,
                         "avg_separation": sep, "avg_yac_above_expectation": yac})
        data = fixture()
        data["ngs"] = normalize_ngs(pd.DataFrame(rows), "receiving")
        self.assertNotIn(0, data["ngs"].week.to_list())
        panel, _ = build_panel(data, [2025], SCORING)
        row = panel[panel.player_id.eq("a") & panel.week.eq(2)].iloc[0]
        self.assertAlmostEqual(row.ngs_receiving_avg_separation_3, 2.8)
        self.assertAlmostEqual(row.ngs_receiving_avg_yac_above_expectation_3, 3.5)
        late = panel[panel.player_id.eq("a") & panel.week.eq(10)].iloc[0]
        self.assertTrue(pd.isna(late.ngs_receiving_avg_separation_3))
        self.assertNotIn("target_4", feature_sets(panel, "WR", 4)["opportunity+ngs"])

    def test_ftn_identity_unknown_read_and_unmatched_plays(self):
        plays, chart = [], []
        for play_id, read in [(1, "1"), (2, "0"), (3, "2"), (4, None)]:
            plays.append({"game_id": "g", "play_id": play_id, "season": 2025, "week": 1,
                          "season_type": "REG", "play_type": "pass", "sack": 0, "posteam": "A",
                          "receiver_player_id": "a" if play_id < 3 else "b",
                          "passer_player_id": "q", "rusher_player_id": None})
            if read is not None:
                chart.append({"nflverse_game_id": "g", "nflverse_play_id": play_id,
                              "read_thrown": read, **{field: True for field in FTN_FIELDS}})
        rows, audit = aggregate_ftn(pd.DataFrame(chart), pd.DataFrame(plays))
        a = rows[rows.player_id.eq("a")].iloc[0]
        b = rows[rows.player_id.eq("b")].iloc[0]
        self.assertEqual(a.ftn_receiver_first_read_n, 1)  # read 0 is unknown
        self.assertEqual(a.ftn_receiver_first_read_share_n, 1)
        self.assertEqual(b.ftn_receiver_is_drop_n, 1)  # uncharted play not false
        self.assertEqual(audit["playJoinCoverage"], .75)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            aggregate_ftn(pd.concat([pd.DataFrame(chart)] * 2), pd.DataFrame(plays))

    def test_offline_verifies_hash_and_fails_without_cached_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = Sources(root, offline=True)
            with self.assertRaises(FileNotFoundError):
                source.csv("x", "https://example.com/x.csv")
            content = b"season,week\n2025,1\n"
            (root / "x.csv").write_bytes(content)
            (root / "x.json").write_text(json.dumps({"url": "https://example.com/x.csv", "file": "x.csv", "sha256": digest(content)}))
            self.assertEqual(len(source.csv("x", "https://example.com/x.csv")), 1)
            (root / "x.csv").write_bytes(content + b"2025,2\n")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                source.csv("x", "https://example.com/x.csv")

    def test_four_week_split_rejects_labels_crossing_year(self):
        frame = pd.DataFrame({"season": [2023, 2024, 2025], "target_4": [1., 2., 3.], "label_end_4": [18, 19, 18]})
        with self.assertRaisesRegex(ValueError, "crosses"):
            split(frame, 4, 2024, 2025)

    def test_paired_blocks_preserve_player_season_and_positive_sign(self):
        frame = pd.DataFrame({"season": [2025] * 4, "player_id": ["a", "a", "b", "b"]})
        interval = paired_interval(frame, np.zeros(4), np.ones(4) * 2, np.ones(4))
        self.assertEqual(interval["blocks"], 2)
        self.assertEqual(interval["lower90"], 1.)

    def test_backtest_stays_shadow_and_missing_data_cannot_enable(self):
        parts = []
        for season in (2022, 2023, 2024, 2025):
            panel, _ = build_panel(fixture(season), [season], SCORING)
            parts.append(panel)
        frame = pd.concat(parts)
        # Duplicate distinct player identities to exercise a real model fit.
        frame = pd.concat([frame.assign(player_id=frame.player_id + str(i)) for i in range(5)])
        result, predictions = evaluate(frame, "WR", 1, "core", 2024, 2025, kinds=("ridge-10",))
        self.assertFalse(result["enabled"])
        self.assertEqual(result["status"], "shadow")
        self.assertIsNone(result["selectedAdvanced"])
        self.assertEqual(set(predictions.season), {2025})
        self.assertEqual(set(result["trainSeasons"]), {2022, 2023})
        self.assertEqual(clean({"unknown": np.nan}), {"unknown": None})
        self.assertEqual(parser().parse_args([]).pass_int, -1.)
        frame["ngs_receiving_avg_separation_3"] = 2.
        result, _ = evaluate(frame, "WR", 1, "ftn-era", 2024, 2025, kinds=("ridge-10",))
        self.assertIn("opportunity+ngs", result["families"])
        self.assertNotIn("opportunity+ftn", result["families"])
        self.assertNotIn("opportunity+ngs+ftn", result["families"])


if __name__ == "__main__":
    unittest.main()

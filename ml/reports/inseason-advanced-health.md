# In-season advanced-data audition

Generated: 2026-09-16T02:10:50.521848+00:00
Dataset: `sha256:6b690cb84e7a438bcb882dc7fe9d043f6067cbe78e2d315702d1b94ef337f135`

Status: **shadow; enabled: false**.

This report compares historical forecasting experiments. It does not change player values, trade grades, waiver ordering or lineup advice.

Scoring recipe: `{"passInt": -1.0, "passTd": 4.0, "ppr": 1.0, "tep": 0.5}`. Two-point conversions are included; kicking, defense, special-team returns and custom bonuses are outside this recipe.

## Design and evidence boundaries

- Historical features are reconstructed from revised end-of-game data. Original pre-kickoff publication vintages are unavailable.
- Timestamped historical weekly expert projections and dynasty market baselines have not been joined; incremental advantage over those sources is untested.
- True all-route participation, untargeted separation, press/man/zone route wins and ESPN Open Score are unavailable in this tape.
- Outcomes are realized offensive points per NFL calendar week including byes and absences, not conditional weekly starter forecasts or dynasty market returns.
- Never-observed players and preseason injury status are uncovered. Current-season rollout and prospective calibration require a separate review.

Features end at the anchor week. Targets are the mean of the following one or four NFL calendar weeks. Missing appearances and byes remain zero once full-season game coverage is verified. Players enter only after their first observed offensive opportunity and remain after disappearance.

Hyperparameters, baseline and advanced family are selected in the validation season before evaluating the final season. Every family uses the same rows within its cohort. FTN-era experiments use 2022 onward; compare their lift to their own reference, not to the larger core cohort.

## Held-out results

| Cohort | Position | Weeks | Test rows | Reference | Advanced selected on validation | Reference MAE | Advanced MAE | Lift | Research gates |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| core | QB | 1 | 1082 | opportunity | opportunity+ngs | 4.676 | 4.722 | -1.0% | fail |
| core | QB | 4 | 855 | opportunity | opportunity+ngs | 3.992 | 3.994 | -0.1% | fail |
| core | RB | 1 | 1994 | opportunity | opportunity+ngs | 3.697 | 3.705 | -0.2% | fail |
| core | RB | 4 | 1578 | opportunity | opportunity+ngs | 2.849 | 2.840 | 0.3% | fail |
| core | WR | 1 | 3156 | opportunity | opportunity+ngs | 3.709 | 3.711 | -0.1% | fail |
| core | WR | 4 | 2506 | opportunity | opportunity+ngs | 2.722 | 2.724 | -0.1% | fail |
| core | TE | 1 | 1739 | opportunity | opportunity+ngs | 3.478 | 3.485 | -0.2% | fail |
| core | TE | 4 | 1374 | opportunity | opportunity+ngs | 2.594 | 2.603 | -0.3% | fail |
| ftn-era | QB | 1 | 1082 | opportunity | opportunity+ftn | 4.674 | 4.742 | -1.5% | fail |
| ftn-era | QB | 4 | 855 | opportunity | opportunity+ftn | 3.962 | 3.951 | 0.3% | fail |
| ftn-era | RB | 1 | 1994 | opportunity | opportunity+ngs | 3.694 | 3.699 | -0.1% | fail |
| ftn-era | RB | 4 | 1578 | opportunity | opportunity+ngs | 2.811 | 2.851 | -1.4% | fail |
| ftn-era | WR | 1 | 3156 | opportunity | opportunity+ngs+ftn | 3.696 | 3.722 | -0.7% | fail |
| ftn-era | WR | 4 | 2506 | opportunity | opportunity+ftn | 2.768 | 2.776 | -0.3% | fail |
| ftn-era | TE | 1 | 1739 | opportunity | opportunity+ftn | 3.491 | 3.501 | -0.3% | fail |
| ftn-era | TE | 4 | 1374 | opportunity | opportunity+ftn | 2.658 | 2.650 | 0.3% | fail |

MAE is fantasy points per calendar week. Positive lift is lower error. A research gate pass does not clear the source-vintage, benchmark or deployment blockers.

## Does separation add information?

Difference in MAE between NGS without separation and NGS with separation, using identical rows. Positive is improvement; 90% paired player-season block interval is descriptive, without multiple-comparison adjustment. aDOT and cushion remain in both families; this does not identify intrinsic route skill.

| Cohort | Position | Weeks | MAE gain | 90% interval |
|---|---|---:|---:|---|
| core | WR | 1 | 0.001 | -0.001 to 0.003 |
| core | WR | 4 | 0.000 | -0.003 to 0.004 |
| core | TE | 1 | 0.000 | -0.006 to 0.006 |
| core | TE | 4 | -0.006 | -0.012 to -0.000 |
| ftn-era | WR | 1 | -0.005 | -0.010 to -0.001 |
| ftn-era | WR | 4 | -0.005 | -0.011 to 0.001 |
| ftn-era | TE | 1 | -0.008 | -0.020 to 0.002 |
| ftn-era | TE | 4 | -0.009 | -0.017 to -0.001 |

## Coverage

Player-week panel rows (historical plus current evidence): 67,228. Retained no-opportunity weeks: 25,713.

NGS has volume qualification thresholds. Missing advanced stats stay missing, with sample counts and coverage indicators. Recent means are opportunity-weighted; no same-season summary rows (week 0) enter features.

FTN first-read target share measures a player's share of known first-read throws, not his share of all designed first reads. Unknown read order is excluded. FTN game/play identity joins and known-read counts are in the JSON report.

| Current evidence | Value |
|---|---|
| season | 2026 |
| week | 1 |
| observedPlayers | 310 |
| playersWithNgs | 139 |
| playersWithFtn | 291 |
| use | descriptive evidence only; no current model forecasts exported |

Source errors: none.

## Unavailable capabilities

| Capability | Status / next requirement |
|---|---|
| All-route participation and target/yard rates per route | Needs a permitted all-route source; snaps cannot substitute |
| Context-adjusted route winning / ESPN Open Score | No current and historical permitted input joined |
| Expected fantasy points | No play-opportunity xFP model trained; EPA is not expected fantasy points |
| Forward dynasty return | Separate target, labels and exact-horizon validation required |
| Weekly expert / price benchmark | Needs dated historical observations before a claim of advantage |

## Reproduce

`npm run ml:inseason` collects and evaluates; `npm run ml:inseason:offline` verifies pinned hashes and reruns. `--refresh-sources` explicitly selects new immutable input versions. The JSON records URLs, hashes, retrieval times, training features, selection metrics, test slices, runtime and code hashes.

## Sources and attribution

- [NFL Next Gen Stats via nflverse](https://nflreadr.nflverse.com/reference/load_nextgen_stats.html)
- [nflverse player statistics](https://github.com/nflverse/nflverse-data/releases/tag/stats_player)
- [FTN Data via nflverse](https://nflreadr.nflverse.com/reference/load_ftn_charting.html): CC BY-SA 4.0. FTN-derived aggregates in this report are provided under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), with transformations (identity joins, player-week aggregation, rolling features and model evaluation) described above.

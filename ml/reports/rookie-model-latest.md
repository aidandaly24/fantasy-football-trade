# Rookie sleeper model

Generated: `2026-08-10T23:49:58.602604Z`

## Decision: SHADOW ONLY

The pipeline is implemented through V6.2, but it is deliberately blocked from live trade and draft recommendations. Its historical target is FantasyPros expert-consensus percentile movement, not completed-trade pricing.

| Phase | Status | Evidence |
|---|---:|---|
| v6.0 Historical rookie tape | Passed | 5/5 gates |
| v6.1 Sleeper return model | Blocked | 0/3 gates |
| v6.2 Structured market-reaction updater | Blocked | 1/4 gates |

## Tape

- 1191 point-in-time rookie examples across 7 classes.
- 645 examples had a real anchor price and were eligible for return-model training.
- Overall identity coverage: 100.0%.
- Round-five-or-later and undrafted coverage: 100.0%.
- Explicit source prices exist for 54.2% of the universe; unranked players are retained at the source floor instead of dropped.

## Out-of-time evaluation

| Horizon | Train | Holdout | Baseline MAE | Base MAE | Updated MAE | Base gate | Updater gate |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 180d | 457 | 188 | 0.1605 | 0.1469 | 0.1430 | False | False |
| 365d | 457 | 188 | 0.1246 | 0.1322 | 0.1164 | False | False |

## Current shadow board

These are audit predictions, not draft recommendations.

| Shadow rank | Player | Pos | Rookie market rank | 365d median percentile change |
|---:|---|:---:|---:|---:|
| 1 | Mike Washington Jr. | RB | 32 | +0.062 |
| 2 | Cyrus Allen | WR | 43 | +0.059 |
| 3 | Fernando Mendoza | QB | 4 | +0.058 |
| 4 | Jadarian Price | RB | 6 | +0.057 |
| 5 | Ty Simpson | QB | 11 | +0.054 |
| 6 | Kenyon Sadiq | TE | 8 | +0.049 |
| 7 | Denzel Boston | WR | 12 | +0.035 |
| 8 | Germie Bernard | WR | 17 | +0.033 |
| 9 | Eli Stowers | TE | 9 | +0.029 |
| 10 | Omar Cooper Jr. | WR | 10 | +0.029 |
| 11 | Drew Allar | QB | 34 | +0.025 |
| 12 | Justin Joly | TE | 37 | +0.021 |
| 13 | Carnell Tate | WR | 2 | +0.019 |
| 14 | De'Zhaun Stribling | WR | 15 | +0.019 |
| 15 | Adam Randall | RB | 45 | +0.015 |
| 16 | Jeremiyah Love | RB | 1 | +0.012 |
| 17 | Jordyn Tyson | WR | 3 | +0.011 |
| 18 | KC Concepcion | WR | 7 | +0.007 |
| 19 | Cade Klubnik | QB | 33 | -0.003 |
| 20 | Tanner Koziol | TE | 49 | -0.004 |

## Promotion blockers

- Historical target is expert consensus, not completed-trade market pricing.
- College production and usage are absent because no CollegeFootballData credential is configured.
- Current Sleeper add/drop counts lack historical point-in-time counterparts and therefore do not change forecasts.
- No output may influence trade grades or draft recommendations until out-of-time gates pass on eligible labels.

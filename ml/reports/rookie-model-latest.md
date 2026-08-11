# Rookie sleeper model

Generated: `2026-08-11T22:10:05.210132Z`

## Decision

The rookie-production evidence board passed its rolling sleeper-basket gate. That validation applies only to the top-eight basket after rookie market rank 24, not to any known pick slot. The known-pick evaluation and market-return head remain shadow-only.

| Phase | Status | Evidence |
|---|---:|---|
| v6.0 Historical rookie tape | Passed | 5/5 gates |
| v6.1 Sleeper return model | Blocked | 0/3 gates |
| v6.2 Structured market-reaction updater | Blocked | 1/4 gates |
| v6.3 Backtested rookie production and sleeper basket | Passed | 5/5 gates |

## Tape

- 1191 point-in-time rookie examples across 7 classes.
- 645 examples had a real anchor price and were eligible for return-model training.
- Overall identity coverage: 100.0%.
- Round-five-or-later and undrafted coverage: 100.0%.
- Explicit source prices exist for 54.2% of the universe; unranked players are retained at the source floor instead of dropped.
- College features cover 93.0% of historically priced rookies and 93.6% of the current class.

## Rookie production sleeper backtest

- Exact decision rule: top eight model predictions after rookie market rank 24.
- Rolling class wins: 5/5 against an oracle that chooses the best simple baseline in each class.
- Mean production-percentile lift: +0.020.
- Minimum single-class lift: +0.005.
- Exact one-sided sign-test p-value: 0.03125.
- Full model OOF MAE / Spearman: 0.1545 / 0.670.
- Market-only OOF MAE / Spearman: 0.1666 / 0.610.
- Learned market+capital OOF MAE / Spearman: 0.1517 / 0.659.
- External college/athletic features add +0.009 mean top-eight percentile versus the learned capital model, but win only 2/5 individual classes; treat their incremental lift as mixed.

| Class | Train | Model basket | Strongest simple baseline | Lift | Baseline |
|---:|---:|---:|---:|---:|---|
| 2021 | 374 | 0.702 | 0.666 | +0.036 | market |
| 2022 | 529 | 0.765 | 0.754 | +0.011 | draft |
| 2023 | 704 | 0.763 | 0.725 | +0.038 | draft |
| 2024 | 869 | 0.741 | 0.733 | +0.009 | draft |
| 2025 | 1020 | 0.829 | 0.824 | +0.005 | draft |

### Basket-size sensitivity

| Size | Market lift | Market wins | Draft lift | Draft wins | Status |
|---:|---:|---:|---:|---:|:---:|
| 6 | +0.044 | 3/5 | +0.022 | 3/5 | pass |
| 8 | +0.063 | 5/5 | +0.027 | 5/5 | pass |
| 10 | +0.027 | 3/5 | +0.010 | 3/5 | pass |
| 12 | +0.037 | 4/5 | +0.030 | 4/5 | pass |

## Shadow known-pick evaluation

Slots 1-24 are evaluated in every rolling held-out class. The primary availability assumption removes earlier players in historical rookie market order; NFL draft order and learned market-plus-capital order are sensitivity checks. Selection regret is the remaining hindsight-best production percentile minus the selected player's percentile.

The learned market-plus-capital model is the primary baseline and decision model. The richer full model is not promoted unless its extra college and athletic feature families demonstrate repeatable value for the exact 1.12 decision.

### Special window: 1.08-2.04

| Selection model | Mean outcome | Mean selection regret |
|---|---:|---:|
| fullModel | 0.921 | 0.078 |
| marketOrder | 0.890 | 0.109 |
| nflDraftOrder | 0.885 | 0.114 |
| learnedMarketPlusCapital | 0.905 | 0.093 |

### Every held-out class

| Class | Full regret, slots 1-24 | Capital regret, slots 1-24 | Full regret, 1.08-2.04 | Capital regret, 1.08-2.04 |
|---:|---:|---:|---:|---:|
| 2021 | 0.097 | 0.200 | 0.089 | 0.070 |
| 2022 | 0.142 | 0.168 | 0.097 | 0.115 |
| 2023 | 0.114 | 0.138 | 0.052 | 0.156 |
| 2024 | 0.125 | 0.103 | 0.064 | 0.042 |
| 2025 | 0.119 | 0.111 | 0.087 | 0.084 |

### Exact 1.12 decision by held-out class

| Class | Full selection | Full outcome | Full regret | Capital selection | Capital outcome | Capital regret | Full lift |
|---:|---|---:|---:|---|---:|---:|---:|
| 2021 | Rashod Bateman | 0.926 | 0.074 | Rashod Bateman | 0.926 | 0.074 | +0.000 |
| 2022 | Alec Pierce | 0.913 | 0.087 | George Pickens | 0.957 | 0.043 | -0.043 |
| 2023 | Sam LaPorta | 1.000 | 0.000 | Michael Mayer | 0.846 | 0.154 | +0.154 |
| 2024 | Brian Thomas Jr. | 1.000 | 0.000 | Brian Thomas Jr. | 1.000 | 0.000 | +0.000 |
| 2025 | Matthew Golden | 0.883 | 0.117 | Matthew Golden | 0.883 | 0.117 | +0.000 |

Extra-feature exact-slot gate: **fail**; 1/5 primary-rule class wins, mean lift +0.022, minimum lift -0.043, exact sign p 0.96875.

### 1.12 availability sensitivity

| Availability rule | Selection model | Mean outcome | Mean regret |
|---|---|---:|---:|
| marketOrder | fullModel | 0.945 | 0.055 |
| marketOrder | marketOrder | 0.913 | 0.087 |
| marketOrder | nflDraftOrder | 0.886 | 0.114 |
| marketOrder | learnedMarketPlusCapital | 0.922 | 0.078 |
| nflDraftOrder | fullModel | 0.944 | 0.047 |
| nflDraftOrder | marketOrder | 0.731 | 0.260 |
| nflDraftOrder | nflDraftOrder | 0.680 | 0.311 |
| nflDraftOrder | learnedMarketPlusCapital | 0.930 | 0.061 |
| learnedMarketPlusCapital | fullModel | 0.893 | 0.107 |
| learnedMarketPlusCapital | marketOrder | 0.844 | 0.156 |
| learnedMarketPlusCapital | nflDraftOrder | 0.932 | 0.068 |
| learnedMarketPlusCapital | learnedMarketPlusCapital | 0.811 | 0.189 |

Positional slices for every model, availability rule, and both the full 1-24 range and 1.08-2.04 window are included in the JSON report.

## Shadow market-return evaluation

| Horizon | Train | Holdout | Baseline MAE | Base MAE | Updated MAE | Base gate | Updater gate |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 180d | 457 | 188 | 0.1605 | 0.1469 | 0.1430 | False | False |
| 365d | 457 | 188 | 0.1246 | 0.1322 | 0.1164 | False | False |

## Current validated production board

The percentile is expected position-relative rookie PPR production. The historical band is model error, not a probability guarantee.

| Rank | Player | Pos | Rookie market rank | Expected production percentile | Sleeper basket |
|---:|---|:---:|---:|---:|:---:|
| 1 | Carnell Tate | WR | 2 | 0.951 |  |
| 2 | Jordyn Tyson | WR | 3 | 0.940 |  |
| 3 | Omar Cooper Jr. | WR | 10 | 0.934 |  |
| 4 | KC Concepcion | WR | 7 | 0.933 |  |
| 5 | Makai Lemon | WR | 5 | 0.930 |  |
| 6 | Jeremiyah Love | RB | 1 | 0.929 |  |
| 7 | Denzel Boston | WR | 12 | 0.920 |  |
| 8 | Jadarian Price | RB | 6 | 0.918 |  |
| 9 | Kenyon Sadiq | TE | 8 | 0.915 |  |
| 10 | De'Zhaun Stribling | WR | 15 | 0.904 |  |
| 11 | Eli Stowers | TE | 9 | 0.883 |  |
| 12 | Germie Bernard | WR | 17 | 0.875 |  |
| 13 | Fernando Mendoza | QB | 4 | 0.868 |  |
| 14 | Antonio Williams | WR | 13 | 0.844 |  |
| 15 | Ty Simpson | QB | 11 | 0.822 |  |
| 16 | Malachi Fields | WR | 24 | 0.810 |  |
| 17 | Eli Raridon | TE | 27 | 0.807 | yes |
| 18 | Ja'Kobi Lane | WR | 30 | 0.803 | yes |
| 19 | Mike Washington Jr. | RB | 32 | 0.782 | yes |
| 20 | Justin Joly | TE | 37 | 0.777 | yes |
| 21 | Zachariah Branch | WR | 22 | 0.774 |  |
| 22 | Bryce Lance | WR | 36 | 0.772 | yes |
| 23 | Ted Hurst | WR | 19 | 0.769 |  |
| 24 | Chris Bell | WR | 14 | 0.761 |  |
| 25 | Emmett Johnson | RB | 23 | 0.759 |  |

## Remaining market-return blockers

- The market-return head still uses expert consensus rather than a complete historical completed-trade tape.
- Current Sleeper add/drop counts lack historical point-in-time counterparts and therefore do not change forecasts.
- The 2026 production board has passed retrospective rolling gates but still needs prospective tracking before its lift can be treated as permanent.
- Known-pick availability is simulated; the 1.12 advisory remains separate from live trade values and recommendations.

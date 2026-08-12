# RosterLab

RosterLab is a private dynasty fantasy football research desk for Sleeper leagues. It imports league data, builds league-relative power rankings, resolves current draft-pick ownership, evaluates proposed trades, and inventories the entire league by current market value with covered production and linked news evidence shown separately.

The league ribbon has one-click controls for BC League (`1336087922847289344`) and Emperor Phil (`1312112570039037952`). There is intentionally no free-form league ID input; adding another league requires an explicit code and evidence review.

## Data sources

- [Sleeper's public API](https://docs.sleeper.com/) supplies league settings, managers, rosters, draft order, and traded picks.
- [Tradyr's public API](https://api.tradyr.app/docs) supplies permitted, attributed composite dynasty values derived from KeepTradeCut and FantasyCalc. KeepTradeCut is not scraped.
- Linked NFL reporting and Sleeper add/drop velocity supply advisory catalysts. Reports are deduplicated and classified; private watchlist events are saved only after a confident player match.

## Private trade research

- Manager-direction labels are manual context or a neutral placeholder. Completed-trade flow is displayed factually, but it does not create calibrated contender probabilities or reprice picks.
- The Evidence Board is ordered by current composite market value. Covered production and linked news are displayed separately and do not secretly change its order or prices.
- The current-state dislocation desk scans rostered players through explicit market-source, production-percentile, and owner-pressure lenses. It exposes a supported Pareto frontier without manufacturing one universal edge score.
- The Trade Lab accepts arbitrary multi-asset packages and keeps current value, KTC/FantasyCalc disagreement, pick-slot ranges, covered production scenarios, and declared-horizon facts separate.
- League-wide and selected-target discovery use Pareto frontiers over visible objectives. Selected-target discovery searches the 60 closest one-to-three-asset packages built from up to the roster's 50 highest-priced assets; neither surface emits a grade, profit forecast, or acceptance probability.
- Completed Sleeper trades—not saved recommendations—receive 7/30/90/180-day outcome checkpoints when a legitimate entry snapshot exists.
- V4.7 records a private, full-league market tape when the Evidence desk opens and refreshes seeded leagues automatically from attributed Tradyr data.
- V4.8 converts non-overlapping 30-day outcomes into research-only empirical position and event cohorts, shrinking small samples instead of treating them as established effects.
- V4.9 trains a small time-split ridge model in shadow. It cannot change rankings, prices, or packages; promotion requires enough independent examples, assets, market regimes, held-out MAE lift, and ranking quality.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite.

## Verify

```bash
npm test
npm run ml:test
npm run build
```

## Project documentation

- [Architecture](docs/architecture.md)
- [Code quality](docs/code-quality.md)
- [Data and models](docs/data-and-models.md)
- [Fixed league context](docs/league-context.md)
- [Development and pull-request workflow](docs/development-workflow.md)

All project changes use task-specific branches and GitHub pull requests. Do not
push directly to `main`, and do not merge without explicit approval.

## Ranking and trade quantities

- **Current market** is the direct sum of current player and pick composites.
- **Covered lineup** starts with generic-PPR points per team week from the enabled production model, applies the active league's exact TE reception bonus where observed reception-rate evidence exists, and optimizes the league's actual starting slots.
- **Draft capital** is the direct sum of current provider values for owned picks.

These are direct quantities, not 0–100 ratings. Future picks without a known slot use the provider's neutral middle-tier average with its available early-to-late range; manager labels do not reprice them. Trade package values are literal sums without hidden compression or elite bonuses. A likely-lineup production result is withheld unless every required market-selected starter slot has an enabled projection.

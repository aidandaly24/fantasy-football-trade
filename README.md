# RosterLab

RosterLab is a private dynasty fantasy football research desk for Sleeper leagues. It imports league data, builds league-relative power rankings, resolves current draft-pick ownership, evaluates proposed trades, and inventories the entire league by current market value with covered production and linked news evidence shown separately.

The default league is `1336087922847289344`, but any public Sleeper NFL league ID can be entered in the header.

## Data sources

- [Sleeper's public API](https://docs.sleeper.com/) supplies league settings, managers, rosters, draft order, and traded picks.
- [Tradyr's public API](https://api.tradyr.app/docs) supplies permitted, attributed composite dynasty values derived from KeepTradeCut and FantasyCalc. KeepTradeCut is not scraped.
- Linked NFL reporting and Sleeper add/drop velocity supply advisory catalysts. Reports are deduplicated and classified; private watchlist events are saved only after a confident player match.

## Private trade research

- Manager-direction labels are manual context or a neutral placeholder. Completed-trade flow is displayed factually, but it does not create calibrated contender probabilities or reprice picks.
- The Evidence Board is ordered by current composite market value. Covered production and linked news are displayed separately and do not secretly change its order or prices.
- The package visualizer finds one-to-three-asset packages closest to the target's current composite value. These are comparisons, not staged recommendations, profit forecasts, or acceptance predictions.
- Offer drafts and manually recorded responses are isolated by authenticated user and league because Sleeper does not expose private proposals.
- Completed Sleeper trades—not saved recommendations—receive 7/30/90/180-day outcome checkpoints when a legitimate entry snapshot exists.
- V4.7 records a private, full-league market tape on load and refreshes seeded leagues automatically from attributed Tradyr data.
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
- [Development and pull-request workflow](docs/development-workflow.md)

All project changes use task-specific branches and GitHub pull requests. Do not
push directly to `main`, and do not merge without explicit approval.

## Ranking model

- **Contender** emphasizes the best legal lineup for the league's actual roster slots, then playable depth.
- **Future** emphasizes the most valuable dynasty core and owned rookie picks.
- **Overall** balances lineup, core, depth, and capital.

All displayed roster scores are relative to the imported league, from 0–100. Future picks without a known slot currently use the provider's neutral middle-tier average with its available early-to-late range; manager labels do not reprice them. The trade evaluator discounts extra package pieces and adds a small premium for elite assets; its output is a market check, not a projection or guarantee.

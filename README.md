# RosterLab

RosterLab is a dynasty fantasy football research desk for Sleeper leagues. It imports league data, builds league-relative power rankings, resolves current draft-pick ownership, evaluates proposed trades, and inventories the entire league by current market value with covered production and linked news evidence shown separately. 

Currently this is only setup for my leagues, but I am working to make the site/models useful for all leagues. The league ribbon has one-click controls for BC League (`1336087922847289344`) and Emperor Phil (`1312112570039037952`). There is intentionally no free-form league ID input; adding another league requires an explicit code and evidence review.

## Data sources

- [Sleeper's public API](https://docs.sleeper.com/) supplies league settings, managers, rosters, draft order, and traded picks.
- [Tradyr's public API](https://api.tradyr.app/docs) supplies permitted, attributed composite dynasty values derived from KeepTradeCut and FantasyCalc. KeepTradeCut is not scraped.
- [DynastyProcess data](https://github.com/dynastyprocess/data) supplies the open current-week expert consensus and stable player-ID map used by Lineup Lab; [nflverse data](https://github.com/nflverse/nflverse-data) supplies the NFL schedule.
- Linked NFL reporting and Sleeper add/drop velocity supply advisory catalysts. Reports are deduplicated and classified; private watchlist events are saved only after a confident player match.

## Weekly Lineup Lab

- The two dynasty leagues share one legal-lineup engine but keep their own exact starter slots, PPR/TEP, quarterback, kicker, and defense settings visible.
- Current Sleeper ownership, submitted starters, reserve/taxi state, injury labels, matchup, and schedule are joined on demand to the latest open weekly consensus.
- Weekly expert ranks are converted to generic PPR point estimates by the source. RosterLab adds only the evidence-backed TE reception premium and labels unsupported scoring components provisional.
- Stale weekly ranks are never reused for a new season or week. Missing projections are shown as uncovered, with the enabled preseason model used only as an explicit fallback.

## Trade Research

- Manager-direction labels are manual context or a neutral placeholder. Completed-trade flow is displayed factually, but it does not create calibrated contender probabilities or reprice picks.
- The Evidence Board is ordered by current composite market value. Covered production and linked news are displayed separately and do not secretly change its order or prices.
- The current-state dislocation desk scans rostered players through explicit market-source, production-percentile, and owner-pressure lenses. It exposes a supported Pareto frontier without manufacturing one universal edge score.
- The Trade Lab accepts arbitrary multi-asset packages and keeps current value, KTC/FantasyCalc disagreement, pick-slot ranges, covered production scenarios, and declared-horizon facts separate.
- League-wide and selected-target discovery use Pareto frontiers over visible objectives. Selected-target discovery searches the 60 closest one-to-three-asset packages built from up to the roster's 50 highest-priced assets; neither surface emits a grade, profit forecast, or acceptance probability.
- The two user-owned teams share those evidence engines but not decision policy: Emperor Phil uses a power-climb gate, while BC uses a value-build gate that protects draft liquidity and rejects market/power/pick triple losses.
- Completed Sleeper trades—not saved recommendations—receive 7/30/90/180/365-day outcome checkpoints when a legitimate entry snapshot exists.
- Accepted 1-for-2/3 exchange premiums and 90/180/365-day market outcomes have separate historical models. Raw provider totals remain unchanged; only promoted evidence may enter the user-weighted Trade Lab view.
- Trade Lab has an authenticated historical-tape refresh action that deduplicates FantasyCalc completed trades into D1. It exposes coverage and failures; it does not retrain or promote a model inside the request.
- The authenticated training-tape export gives offline retraining a private, sanitized, content-addressed input. Trade Lab distinguishes collected, historically valued, trained, validated, and currently influencing evidence.
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
- [Historical trade models](docs/trade-models.md)
- [Fixed league context](docs/league-context.md)
- [Development and pull-request workflow](docs/development-workflow.md)

All project changes use task-specific branches and GitHub pull requests. Do not
push directly to `main`; merge only passing, non-conflicting scoped work under
the active user/workspace authorization, then deploy the exact merged revision.

## Ranking and trade quantities

- **Current market** is the direct sum of current player and pick composites.
- **Covered lineup** starts with generic-PPR points per team week from the enabled production model, applies the active league's exact TE reception bonus where observed reception-rate evidence exists, and optimizes the league's actual starting slots.
- **Draft capital** is the direct sum of current provider values for owned picks.

These are direct quantities, not 0–100 ratings. Future picks without a known slot use the provider's neutral middle-tier average with its available early-to-late range; manager labels do not reprice them. Trade package values are literal sums without hidden compression or elite bonuses. A likely-lineup production result is withheld unless every required market-selected starter slot has an enabled projection.

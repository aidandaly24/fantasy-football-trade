# Historical trade models

RosterLab keeps raw market price, accepted exchange premium, and later outcome
as three different quantities. None may overwrite `Asset.value`.

## Source and collection

`ml/trade_models.py` uses FantasyCalc's public completed-trade endpoint and
daily player/pick history endpoint for private research. Responses are cached
under ignored `data/raw/trade_models/`; the collector is throttled, retries
bounded failures, and never publishes a raw trade mirror. The committed health
report links FantasyCalc's methodology and terms.

Anchor players are sampled across positions and the full current value range.
Every completed package is deduplicated by trade ID. Asset history is requested
for every observed package asset and, when `--history-scope universe` is used,
for the current market universe needed to calculate date-specific percentiles.
The history cache and joins are separated into 1QB and superflex series. The
provider does not expose historical PPR, TE-premium, or team-count variants;
an exact-format promotion gate therefore remains failed until that limitation
is validated or a better point-in-time source is added.

Run:

```sh
npm run ml:trade-models
npm run ml:trade-models:offline
```

The browser-safe report is `public/data/trade-model-health.json`; the matching
audit copies are `ml/reports/trade-model-health.json` and
`ml/reports/trade-model-health.md`. Scope and advancement decisions are retained
in `ml/reports/trade-model-complexity-ledger.md`.

## Exchange-premium target

Eligible rows are accepted two-party 1-for-2 or 1-for-3 trades where:

- every asset has a point-in-time value at the trade date;
- the single asset is at or above the 70th market percentile;
- the single asset is worth at least as much as every individual package asset;
- the package-to-elite ratio is inside the declared outlier bounds.

The target is:

```text
paid premium = package market value / elite market value - 1
```

Features cover elite percentile, package size, pick count, elite/package age,
team count, QB format, PPR, TE premium, starter count, roster size, and depth
ratio. The time-ordered ridge model is compared with the training-period median
premium on later trades. Segment medians are descriptive and require at least
10 rows; they are not a substitute for promotion.

Promotion requires at least 400 rows, 80 later held-out rows, 100 source
leagues, 90 days of trade dates, declared format/age coverage, and no held-out
MAE regression. Until every gate passes, the Trade Lab displays the sample and
its status but does not apply the estimate.

## Outcome targets

For each eligible exchange row and horizon 90, 180, or 365 days:

```text
market outcome = elite asset return - package aggregate return
```

Returns are percentage changes from each side's point-in-time entry value. Two
challengers use the same chronological split:

1. structure-only excludes the paid premium;
2. premium-aware adds the observed paid premium.

The premium-aware challenger must improve held-out MAE over structure-only; the
structure-only model must also beat the training-period median outcome. Each
horizon has a separate minimum row and held-out requirement. A shorter horizon
cannot promote a longer horizon.

FantasyCalc's completed-trade rows do not contain full historical rosters or
legal lineups. Market outcome therefore cannot be renamed lineup outcome. The
journal now creates 365-day checkpoints and stores an ingestion-time pre/post
roster context for new completed league trades. Lineup outcome remains
`collecting` until those league-local snapshots produce enough valid labels.

## Trade Lab behavior

The original current-price total remains the visible verdict. A separate
consolidation panel shows:

- the proposed package's raw premium;
- the exchange tape's sample, date span, and promotion state;
- the selected 90/180/365-day outcome challenger;
- explicit user weights for raw market, covered lineup, exchange price, and
  future market outcome.

The default weights preserve the existing raw-market comparison. User weights
are private league preferences. Missing or unpromoted evidence is never treated
as zero and is never silently redistributed; the panel reports weight coverage
and withholds a complete directional interpretation.

Accepted trades cannot identify rejected-offer acceptance probability. These
models must not be used to claim that another manager will accept an offer.

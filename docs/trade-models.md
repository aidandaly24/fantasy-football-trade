# Historical trade models

RosterLab keeps raw market price, accepted exchange premium, and later outcome
as three different quantities. None may overwrite `Asset.value`.

## Source and collection

`ml/trade_models.py` uses FantasyCalc's public completed-trade endpoint and
daily player/pick history endpoint for private research. Responses are cached
under ignored `data/raw/trade_models/`; the collector is throttled, retries
bounded failures, and never publishes a raw trade mirror. The committed health
report links FantasyCalc's methodology and terms.

The hosted Trade Lab has a separate, authenticated **Refresh historical tape**
action because OpenAI Sites did not execute the repository's cron trigger in
the production window we inspected. One click scans 40 position/value-stratified anchors, strips
provider usernames, deduplicates completed trades by provider trade ID, and
upserts the rolling tape into D1. It records the last attempt, last success,
anchor coverage, new rows, and bounded errors. A partial refresh remains visible
and may be safely retried.

Hosted collection and model promotion are deliberately separate. The button
does not train sklearn inside a Worker request and does not rewrite the shipped
health artifact. The Trade Lab shows the D1 tape state alongside the dated
artifact so fresh raw data cannot be mistaken for newly validated evidence.
Offline retraining remains the review point for chronological splits, metrics,
and promotion gates.

The adjacent authenticated **Download training tape** action exports every
sanitized D1 row with a stable SHA-256 dataset ID and `private, no-store`
delivery. The dataset ID depends on the canonical trade rows, not the download
time. That makes the offline input auditable without publishing the raw tape.
An export is still only collected data: until an artifact records the imported
dataset ID and point-in-time coverage, the Trade Lab labels the hosted tape as
not connected to that artifact.

Import a downloaded tape before collection/training with:

```sh
npm run ml:trade-models:import -- /absolute/path/to/rosterlab-trade-tape.json
npm run ml:trade-models:hydrate
```

The importer validates the SHA-256 dataset ID, stores the export under the
ignored raw-data boundary, and deduplicates its trade IDs with local collector
rows. Training records imported/local counts, point-in-time coverage, history
series, source date span, and every input dataset ID in `trainingManifest`.
The hydrate command requests only missing histories for observed trade assets;
the broader `ml:trade-models` command retains the value-stratified anchor and
current-universe research pass.

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
`needs-data` until those league-local snapshots produce enough valid labels.

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

The historical refresh button is available before a package is selected. It is
the supported collection trigger; the UI never claims that an inactive model is
automatically collecting in the background. Models below their declared gates
use the explicit `needs-data` status.

The panel also renders the pipeline as collected, historically valued, trained,
validated, and influencing this trade. The final stage is active only when a
promoted exchange or outcome signal has nonzero weight and a non-null
contribution for the selected package.

Accepted trades cannot identify rejected-offer acceptance probability. These
models must not be used to claim that another manager will accept an offer.

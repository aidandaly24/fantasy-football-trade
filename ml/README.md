# RosterLab production model

This is a deliberately small, offline ML pipeline. It predicts next-season PPR
points per NFL team game from the prior season's production and usage. The web
app only consumes the generated JSON projection file when the model beats a
simple persistence baseline on a later, untouched season.

Data sources:

- nflverse weekly player stats for historical training and time-based testing.
- Sleeper season totals for current inputs plus a Tradyr market snapshot.

The first version does not train on news, trade acceptance, league chat, or a
black-box final trade grade. Those stay outside the model until the production
forecast earns trust.

## Sportsbook projection challenger

Current game totals and player props are a separate shadow evidence lane. The
site fetches them only on demand through its private Worker. Historical model
work reads a private point-in-time JSONL tape and compares the existing weekly
forecast, sportsbook-only features, and their combined challenger at separate
early-week and pregame anchors:

```sh
npm run ml:sportsbook
```

The default input is `data/raw/sportsbook/snapshots.jsonl`. Raw lines remain
ignored; the aggregate health report is retained at
`ml/reports/sportsbook-model-health.json` and copied to
`public/data/sportsbook-model-health.json`. With no historical tape the report
honestly stays `needs-data`, and current lines contribute zero recommendation
weight.

## Historical return source audit

The return model has a separate, offline source audition. It does not feed the
site or the production projection model. The command caches raw provider
responses, normalizes point-in-time market observations from FantasyCalc and a
Tradyr comparator, measures joins to nflverse roster and injury data, and
produces a metadata-only GDELT sample for manual relevance review:

```sh
npm run ml:audit-sources
```

Use `-- --offline` to reproduce the report from cached sources or `--
--refresh` to replace the caches. Raw and normalized research data stay under
gitignored `data/raw` and `data/processed`; the evidence reports are retained
at `ml/reports/historical-source-audit.json` and
`ml/reports/historical-source-audit.md`.

FantasyCalc is used only for this private, noncommercial research workflow.
The collector calls the same JSON endpoints used by its rankings and player
history pages, caches each response at most once per UTC day, retains source
and retrieval metadata, and never publishes a raw-data mirror. Current values
use the 12-team, superflex, full-PPR, TEP+ setting; FantasyCalc defines TEP+ as
0.5-1.0 premium, which contains this league's 0.75. Its historical endpoint
only accepts dynasty and quarterback-count settings, so the audit records that
format limitation instead of pretending the history is exact 0.75 TEP data.

The audit deliberately blocks training while any of these remain unresolved:

- historical coverage and cadence are insufficient;
- delisted players are absent, creating survivor bias;
- FantasyCalc's historical format has not yet been validated for
  source-relative normalization against the league's exact settings;
- player identities do not join reliably to structured football events;
- historical articles lack manually verified entity precision or training
  rights.

## Historical exchange premium and outcome models

The completed-package pipeline is separate from the general source audit. It
collects real FantasyCalc trade packages across a stratified player sample,
joins daily player and pick values, and evaluates accepted 1-for-2/3 exchange
premiums. It then compares structure-only and premium-aware market-outcome
challengers at 90, 180, and 365 days.

```sh
npm run ml:trade-models
npm run ml:trade-models:offline
```

Raw packages and histories remain ignored. The committed health artifacts are
`ml/reports/trade-model-health.json`,
`ml/reports/trade-model-health.md`, and
`public/data/trade-model-health.json`. No result enters the Trade Lab until its
chronological sample, span, coverage, and held-out performance gates all pass.
The provider does not expose complete historical rosters, so market outcome
and lineup outcome remain distinct targets.

## Run

Create the local environment once:

```sh
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r ml/requirements.txt
```

Then collect, train, evaluate, and export current projections:

```sh
npm run ml:refresh -- --limit 240
```

Raw downloads and fitted model binaries are ignored by Git. The small audit
report and browser-safe projection artifact are retained in:

- `ml/reports/latest.json`
- `public/data/player-projections.json`

## Advancement gate

The model is enabled only when its mean absolute error is at least 1% lower
than predicting that every player repeats the prior season's PPR points per
team game. Model selection uses one season, and the gate is measured on a later
season that was not used for fitting or selection.

## Rookie sleeper pipeline (V6.0-V6.3)

The rookie model is separate because incoming rookies have no prior NFL
production for the veteran model above. It reconstructs dated
DynastyProcess/FantasyPros dynasty ECR snapshots from git history, retains
unranked players so busts cannot disappear, and joins public cfbfastR college
play-participant data, nflverse combine testing and nflverse rookie-season PPR
outcomes through stable provider IDs. Raw source files include SHA-256 evidence
in the private cache manifest.

```sh
npm run ml:rookies
```

Use `npm run ml:rookies:offline` to reproduce the build from the private local
cache. Raw snapshots, normalized tape and fitted binaries remain gitignored.
The aggregate audit is retained in:

- `ml/reports/rookie-model-latest.json`
- `ml/reports/rookie-model-latest.md`
- `ml/reports/rookie-known-pick-latest.json` (offline shadow/advisory contract)
- `worker/generated/rookie-board.json` (sanitized private-site contract)

V6.0 builds the historical tape. V6.1 compares a small market-return model with
a no-change error baseline and an NFL-draft-capital sleeper basket on the two
latest held-out rookie classes. V6.2 tests whether pre-anchor 30/90-day market
movement improves that base model. Current FantasyCalc values and Sleeper
add/drop trends are collected as corroborating evidence only; they cannot alter
the forecast until equivalent historical data exists.

V6.3 adds a distinct production target: position-relative rookie regular-season
PPR percentile, including zero-stat players. Its currently validated rule is
limited to the top-eight basket after rookie market rank 24; that result does
not validate any known pick slot. Rolling class tests compare that basket with
an oracle that takes the best of market order, NFL draft order and
capital/market gap in each class. The production board is enabled only if it
wins at least five eligible rolling classes, wins every class, and clears the
declared exact sign-test gate.

The offline known-pick extension evaluates slots 1-24 in every rolling held-out
class and calls out 1.08-2.04. It reports selection regret, positional slices,
and three assumed availability rules. Learned market-plus-capital is the
primary baseline and advisory decision model. The richer college/athletic model
remains a shadow comparison unless it adds repeatable held-out value for the
exact slot, beginning with 1.12. This artifact is not published to the Worker
and cannot change trade values or recommendations.

The production board is evidence for prioritizing film and acquisition-price
checks; it is not a player grade or a promised return. The market-return head
remains hard-blocked from trade grades while its label is expert-consensus
movement rather than a complete historical tape of prices inferred from
completed trades.

## Future rookie-class evidence tape (V6.4)

V6.4 is a separate, tape-first research phase for evaluating prospects one
season before their possible NFL draft. It creates the candidate population
from pinned historical cfbfastR roster files, then joins only college production
available through the prior season. Players who stay in school or never reach
the NFL remain in the tape. Retrospective NFL identity and draft fields are
labels for auditing only and cannot enter the feature columns.

```sh
npm run ml:future-rookies
```

Use `npm run ml:future-rookies:offline` to reproduce the build from the pinned
private cache. The normalized tape and source manifest stay under gitignored
`data/`; the reviewable aggregate audit is retained in:

- `ml/reports/future-rookie-evidence-v6.4.json`
- `ml/reports/future-rookie-evidence-v6.4.md`

This phase must recover at least 85% of known entrants in each completed
2020-2025 class, retain entrants and non-entrants, report position-level
missingness, and contain no production after each class's declared cutoff. A
passing V6.4 report still does not enable training, pick values, trade scoring,
or UI output. Those require a separately reviewed V6.5 experiment. The 2027
current-class build is explicitly blocked until a version-pinned 2026 roster
snapshot is available.

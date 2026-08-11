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

V6.0 builds the historical tape. V6.1 compares a small market-return model with
a no-change error baseline and an NFL-draft-capital sleeper basket on the two
latest held-out rookie classes. V6.2 tests whether pre-anchor 30/90-day market
movement improves that base model. Current FantasyCalc values and Sleeper
add/drop trends are collected as corroborating evidence only; they cannot alter
the forecast until equivalent historical data exists.

V6.3 adds a distinct production target: position-relative rookie regular-season
PPR percentile, including zero-stat players. Its exact sleeper rule selects the
top eight forecasts after rookie market rank 24. Rolling class tests compare
that basket with an oracle that takes the best of market order, NFL draft order
and capital/market gap in each class. The production board is enabled only if it
wins at least five eligible rolling classes, wins every class, and clears the
declared exact sign-test gate.

The production board is evidence for prioritizing film and acquisition-price
checks; it is not a player grade or a promised return. The market-return head
remains hard-blocked from trade grades while its label is expert-consensus
movement rather than a complete historical tape of prices inferred from
completed trades.

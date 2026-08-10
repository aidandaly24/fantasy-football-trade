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

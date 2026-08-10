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

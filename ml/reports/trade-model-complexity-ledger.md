# Historical trade model complexity ledger

## Decision

Use one offline data pipeline with two isolated targets and portable artifacts.
Do not add exchange-premium points to the current provider sum, and do not run
training inside the Worker request path.

## Complexity classification

| Class | Item | Current treatment |
|---|---|---|
| Essential | Point-in-time values for every asset in an accepted package | Required row gate; unresolved rows are excluded |
| Essential | Exchange price and future result are different labels | Separate models, metrics, promotion gates, and UI outputs |
| Essential | Elite percentile, package size, picks, age, league format, and depth | Explicit feature columns and descriptive segments |
| Essential | Time leakage and repeated source leagues | Deduplicated trade IDs and chronological holdout; independent-league gate |
| Imported | FantasyCalc returns accepted trades only | No acceptance-probability claim |
| Imported | History matches QB format but lacks historical PPR/TEP/team-count variants | Exact-format gate remains failed |
| Imported | External trades omit full historical rosters | Lineup outcome remains a league-local target that needs data |
| Transitional | Authenticated manual D1 capture plus ignored local caches and committed browser-safe coefficients | The button preserves the rolling window; offline retraining remains the review boundary |
| Accidental avoided | A second deployed service, queue, or online trainer | Not introduced; current modular monolith remains sufficient |
| Accidental avoided | KTC-style hidden point adjustment | Raw market values are immutable; consolidation evidence is adjacent |

## Waterbed analysis

- Moving model training offline keeps requests simple but makes artifact refresh
  an explicit research operation.
- Replacing an unproven cron with a user-triggered refresh adds one click but
  removes a silent background-failure mode. The collection endpoint, D1 tape,
  and trainer boundary remain replaceable if Sites later supports schedules.
- Letting users choose weights avoids a hidden product opinion but requires the
  UI to expose unavailable weight and partial coverage.
- Strict format and span gates delay a live premium estimate but prevent a
  four-week source slice from masquerading as a durable market law.
- Capturing roster context improves future lineup labels but adds one bounded D1
  table and migration. It is written only for newly completed trades near
  ingestion, not retrospective backfills.

## Advancement gates

### Now

- Real completed-package and history collection.
- 1QB and superflex value histories kept separate.
- Exchange and 90/180/365 outcome challengers trained and audited separately.
- Blocked models visible in Trade Lab and Model audit but unable to affect a
  recommendation.
- Private user weights persisted with missing-weight coverage.
- Authenticated, observable manual refresh of the rolling completed-trade tape;
  no claim that a cron or background collector is running.

### Next

- Accumulate at least 90 days and the declared row/holdout counts.
- Validate whether source-relative normalization is stable across PPR, TEP, and
  team-count segments or obtain an exact historical source.
- Reconsider a scheduled trigger only after Sites exposes observable cron
  execution. It must call the same bounded collector rather than create a
  second collection architecture.

### Later

- Produce league-local lineup outcomes from pre/post roster contexts and
  checkpoint-time legal lineups.
- Consider nonlinear challengers only if the ridge residual audit shows a
  repeatable miss and the simpler model has enough data.
- Promote one horizon at a time; never infer 365-day validity from a 90-day
  result.

## Removal triggers

- Remove the external collector if terms prohibit the workflow or stable IDs
  disappear.
- Remove a feature when its missingness stays above the declared gate or its
  time-split ablation shows no value.
- Remove the roster-context table only through a reviewed migration after the
  lineup target is abandoned or replaced.

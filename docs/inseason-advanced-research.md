# In-season player evidence and forecast research

The acquisition question is whether a player is earning a durable role or
creating value that current fantasy totals conceal. The accepted first stage
is an offline audition of advanced data and a reproducible backtest. Its
consumer is Aidan's private dynasty research workflow. There is one developer,
two forecast horizons (one and four weeks), and no new hosted service.

## Decision and implementation boundary

The pipeline comprises four modules: source/cache contracts, weekly feature
construction, model evaluation, and report orchestration. It reuses the existing
Python dependencies and writes aggregate Markdown/JSON research reports. Raw
provider files, normalized player-week data, and individual predictions remain
in ignored directories. No web route, database migration, or model inference
service is needed for this experiment.

The default scoring recipe matches Phil's offensive coefficients: full PPR,
0.5 extra points per TE reception, four-point passing TDs and minus one per
interception. Standard yardage, lost fumbles and two-point conversions are
included. The CLI accepts alternative PPR/TEP/passing coefficients. Kicking,
defense, special-team returns, arbitrary bonuses and lineup constraints are
outside this research target. A reusable NFL evidence layer owns player facts;
league scoring is applied explicitly when building the target.

The target is realized offensive points per NFL calendar week over the next
one or four weeks. Byes, injury absences and disappearance count as zero. This
is useful for total contribution across a holding period; it is not the same
as a start/sit projection conditional on being active. Target labels never
skip ahead to a player's next appearance. No dynasty return is inferred from
fantasy scoring accuracy.

## Source contracts

| Input | Available evidence | Limitation |
|---|---|---|
| nflverse weekly player statistics, 2018–2025 | Points, attempts, carries, targets, receptions, team opportunity and air-yard shares | No all-route denominator; current player catalog is not used as a historical filter |
| NFL Next Gen Stats via nflverse | Target-event separation, cushion, depth, YAC over expected; RYOE and success above expectation; CPOE, time to throw and tight-window rate | Volume thresholds; separation includes targeted plays only; these metrics retain scheme/QB effects |
| FTN Data via nflverse, 2022 onward | Catchability, contested balls, exceptional receptions, drops, read order, screens, motion, play action, interception-worthy throws, QB-fault sacks | Public charting is a subset; missing plays/reads remain uncovered; first-read target share is not designed first-read route share |
| nflverse play-by-play | Game/play and GSIS identity joins for FTN | Schema and no-play filtering must be audited; missing joins cannot become false negative flags |
| nflverse schedule | Game completeness, calendar weeks and upcoming game counts | Downloaded historical schedules can contain retrospective changes |

NGS recent means are weighted by their actual denominators: targets for
separation/cushion/depth, receptions for YAC, carries for rushing and attempts
for passing. FTN features use observed charted opportunity counts. Unknown read
order is excluded from numeric read rates; known first-read throws define the
team first-read target-share denominator. FTN QB catchability and interception
rates exclude sacks, while QB-fault sack rate is conditional on sacks.

The separate NGS-without-separation challenger retains depth and cushion. Its
paired comparison asks whether separation supplies incremental information;
it does not turn a regression coefficient into a causal estimate of talent.

## Time, population and missingness

Players enter the historical candidate population after their first offensive
opportunity, with only past team/position information carried forward. They
remain in the panel for the rest of the season even if cut or injured. This
prevents current-catalog survivor filtering and next-appearance label bias,
although never-observed players and preseason injury context remain uncovered.

Each requested historical season must contain all completed scheduled games
and reach its final regular-season week. Incomplete seasons raise a visible
error instead of generating fabricated zero outcomes. Current evidence uses
only complete weeks. Duplicate player/week or game/play keys fail validation.
Historical OAK/LV team aliases are reconciled without rewriting game IDs;
unmatched team/week schedule identities fail instead of becoming invented byes.
Missing advanced evidence is NaN with sample/coverage fields; model imputation
is fit on training data only. A missing entire source family is omitted from
the experiment and its error remains in the aggregate report.

Downloads are stored by SHA-256. The cache index records URL, retrieval time,
server modification time and selected object hash. Offline runs verify hashes.
`--refresh-sources` writes a new immutable object and moves the selected index;
old versions remain recoverable. Data IDs incorporate source hashes, scoring,
season range and code hashes. Reports contain runtime package versions.

This is **event-time reconstruction** from today's revised files, not archived
pre-kickoff vintages. The report explicitly blocks live promotion on this
distinction. An end-of-week feature cutoff prevents future-game leakage but
does not erase source revisions or publication lag.

## Evaluation protocol

For each position and each horizon:

1. Core cohort fits 2018–2023, selects in 2024 and tests in 2025. FTN-era cohort
   fits 2022–2023 with the same selection/test seasons. All families use the
   same rows within their cohort, including uncovered and low-volume players.
2. Select the best last-week, trailing-three-week or season-to-date PPG
   baseline in 2024. Compare it with an opportunity model, also selected in
   2024. The stronger validation result becomes the reference.
3. Audition opportunity+NGS, opportunity+FTN and opportunity+both where covered.
   Two ridge penalties and one bounded gradient model are selected on 2024
   only. The advanced family is chosen before inspecting 2025.
4. Refit on the past training/selection years. Report all held-out family
   results; never select a model by its test score. Future labels stay within
   the same season, so the four-week outcomes cannot cross the split.
5. Report MAE, RMSE, weekly rank correlation, early-season/low-volume slices,
   validation-calibrated 80% interval coverage, and paired player-season block
   bootstrap intervals. Blocks preserve overlapping weekly labels. The
   intervals do not account for all common-week shocks or multiple comparisons.
6. Record research gates: at least 500 training rows, 100 test rows and 20
   held-out players; at least 2% incremental MAE lift; positive lower paired
   90% interval; no >5% regression in populated slices; sensible interval
   coverage. These thresholds are declared research policy, not calibrated
   probabilities of profitability.

The report always carries `enabled: false`. Even a research gate pass does not
resolve missing historical weekly projections, market baselines, original
publication vintages or conditional-availability validation. These are
independent requirements before any future live integration.

## Complexity review

| Concern | Owner / lens | Evidence | Class | Purpose | Cost / failure | Simpler alternative | Decision and trigger |
|---|---|---|---|---|---|---|---|
| Position, horizon and scoring differences | Model / user | Accepted distinct decisions | Essential | Correct target and units | Wrong labels make precise but irrelevant forecasts | Four positional experiments, two explicit horizons | Keep; expand only for a named decision |
| Missing players, byes, future leakage | Data / model | Known historical selection failures | Essential | Honest outcome population | Survivorship and next-appearance bias | One player-week grid with invariant tests | Keep; audit every source change |
| NGS thresholds, FTN definitions and IDs | Source adapters | Verified provider schemas | Imported | Interpret measured facts correctly | Missingness and schema drift | Typed column/key validation and manifest | Isolate; fail or report unavailable |
| Offline feature/model audition | Research | Incremental value unknown | Transitional | Resolve which inputs deserve use | Can become a permanently maintained second forecast stack | Small modules and aggregate artifact | Consolidate with production only after reviewed gates pass; otherwise retain research report and retire challenger |
| All-route data / Open Score / historical projections | Research | No permitted current/history input joined | Unknown | Route skill and stronger benchmarks | Access cost, historical-vintage gaps | Explicit unavailable capability | Test a small licensed/public sample before adopting |
| Intrinsic talent score or universal trade score | Product | No single validated target | Accidental | No required outcome currently | Double-counting correlated metrics and opaque decisions | Named metrics and separate predictions | Exclude; no automatic repricing |
| New online service, queue or database | Operations | Personal offline workload | Accidental | None for this stage | Deployment and synchronization cost | Existing Python pipeline | Exclude until a measured runtime requirement |

## Advancement and sunset

Now: run and review the source audit, paired backtests and separation ablations.
Next: if a family passes its research gates, audit timestamped weekly projection
benchmarks and collect prospective snapshots for that exact position/horizon.
Later: add a permitted all-route source only when a bounded historical sample
improves the same benchmarks enough to justify its access and maintenance cost.
Live integration requires a reviewed model/availability contract, current
coverage and exact consumer tests. If richer features fail to add value, retain
them as descriptive evidence and keep the simpler forecast reference.

FTN-derived report aggregates are attributed to **FTN Data via nflverse** under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Provider source
links and transformations are recorded in the generated report. No raw data,
private league portfolio or proprietary tracking feed is published.

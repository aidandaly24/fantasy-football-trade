# Asset potential and forward market value

**Status:** Decision contract and bounded experiment implemented on August 12,
2026. The runtime now supports an exact 30/90/180/365-day holding-period
selection and refuses to substitute a shorter forecast. The new 180/365-day
offline experiment remains `needs-data`; it writes audit reports only and no
browser artifact. No unpromoted estimate may alter market value, trade
recommendations, packages, or target ordering.

## Executive judgment

RosterLab is missing a decision-critical evidence layer. It can answer:

1. what an asset is worth in the market now;
2. how much current-season lineup power the market assigns it; and
3. what covered football production an enabled model expects.

It cannot yet answer the investment question:

> Given today's acquisition price and everything knowable today, what is the
> distribution of this asset's market value at the end of the intended holding
> period?

That omission causes two opposite mistakes. The system can dismiss a young
player because he does not improve today's lineup, or recommend an exciting
prospect without testing whether the acquisition price already reflects his
upside. “Potential” must therefore be represented as a source-specific,
horizon-specific distribution of future market return, with football
production, catalysts, downside, and liquidity shown as separate evidence.

The stock analogy is useful up to a point:

- current market value is the spot price;
- future market return is the price-return distribution;
- production and role are fundamentals;
- draft, depth-chart, and season milestones are catalysts;
- volatility, drawdown, disappearance, and liquidity are risk facts.

RosterLab should not import a stock-pricing formula. Dynasty assets have no
cash flow, their market is thin and platform-specific, careers can end
abruptly, and the available history has survivor bias. The useful product is a
transparent forward-value research card, not a fictional intrinsic value.

## The failure exposed by the Tyson discussion

The prior trade reasoning treated “flex help” and current market value as if
they captured Jordyn Tyson's full value to a dynasty roster. They do not.

At the repository's August 12, 2026 evidence snapshot:

- the rookie-production board places Tyson at an expected **94.0th
  position-relative rookie production percentile**;
- the market-only production baseline is **94.8th percentile**, so the richer
  evidence does not currently show that the market underrates his rookie
  production;
- the enabled 2QB asset-return model estimates only a **30-day** FantasyCalc
  return, approximately **-2.3%**, with a wide tracked-asset interval of about
  **-25.4% to +15.6%**; and
- Tyson's 90-day return model is shadow, while 180- and 365-day models remain
  unpromoted.

The correct conclusion is not “Tyson lacks potential.” It is:

> Tyson has strong modeled football potential and a market that already
> expects a great deal from him. RosterLab does not yet have validated evidence
> for his six- or twelve-month market-value return.

That distinction should have appeared in the trade analysis. A strong
production projection can support a long-term thesis, but it is not proof of a
profitable acquisition at any price.

## Decision boundary

- **Protected outcome:** avoid giving away assets with superior future value,
  and avoid overpaying for exciting players whose upside is already priced in.
- **Observer:** the authenticated user evaluating trades in the two fixed
  supported dynasty leagues.
- **Decision horizon:** the user's declared holding period, initially 30, 90,
  180, or 365 days. Multi-year claims remain blocked until their own evidence
  exists.
- **Current scale:** currently rostered NFL players and explicit draft-pick
  buckets in 1QB or superflex. Current rookies are a named lifecycle slice, not
  a separate universal scoring system.
- **Failure tolerance:** unavailable or shadow output is acceptable. A
  favorable invented projection is not.
- **Required invariants:** `Asset.value` remains the current attributed Tradyr
  composite; FantasyCalc forecasts stay on the FantasyCalc scale; production
  does not become market value; missing evidence stays missing.
- **Explicit exclusions:** manager acceptance probability, autonomous trades,
  hidden grades, news-derived certainty, deterministic sell dates, and a
  universal “potential score.”

## The evidence lanes

Forward value belongs inside the existing **asset-return lane**. It does not
replace or blend the other lanes.

| Lane | Question | Example output |
| --- | --- | --- |
| Current market | What can the asset be exchanged for today? | Current Tradyr composite; separate KTC and FantasyCalc values and ranks |
| Current-season power | How does the same-format redraft market value this player in a legal lineup? | Current power contribution and lineup delta |
| Covered production | What football output is supported by a held-out model? | Expected/floor/ceiling PPG or rookie production percentile |
| Forward market value | How might the same source reprice the asset by a stated date? | Median return and calibrated lower/upper outcomes for 30/90/180/365 days |
| Liquidity and risk | Can the position be exited, and what has its path looked like? | Trade frequency, volatility, drawdown, coverage, and disappearance boundary |
| Counterparty utility | Why might this owner prefer our package? | Current roster need and surplus facts, never acceptance odds |

The UI and recommendation layer may compose these facts into a written thesis.
It must not add them into one unitless grade.

## What the projection should mean

For source `s`, player `i`, prediction anchor `t`, and horizon `h`, the primary
target should be same-source log market return:

```text
y(i,t,h,s) = log(value(i,t+h,s) / value(i,t,s))
```

The artifact should retain the current source value and export, for every
separately promoted horizon:

- median projected return;
- calibrated lower and upper return quantiles;
- corresponding same-source future-value range;
- model and data timestamp;
- historical population and coverage;
- lifecycle, position, age, and current-value slices;
- enabled, shadow, needs-data, or blocked status; and
- the strongest baseline and held-out metrics it had to beat.

Only after probability calibration succeeds may the product add threshold
probabilities such as chance of a 25% gain or 25% loss. A quantile interval is
not itself a probability of success, and the current tracked-asset interval is
not complete career-failure risk.

### Why horizons must remain independent

A trade for a training-camp flip and a trade for a two-year roster cornerstone
are different decisions. Passing a 30-day return gate says nothing about 180
or 365 days. The selected trade horizon must determine which, if any, forward
estimate is eligible.

If the user's horizon has no promoted model, the recommendation should say
`forward market value unavailable at this horizon` and continue with current
market, production, lineup, age, and liquidity evidence. It must not stretch a
30-day estimate across a year.

## Minimum coherent experiment

The first experiment should test one claim:

> Do point-in-time football and lifecycle features improve 180- or 365-day
> market-return forecasts beyond the strongest price, momentum, and cohort
> baselines?

This remains an offline experiment inside the modular monolith. It needs no
new service, queue, scheduled job, database, or browser-side inference.

### Population and labels

Build a versioned historical player-anchor tape containing:

- daily FantasyCalc value and rank at the anchor and target date;
- 1QB and superflex as separate source series;
- every historically eligible player, including assets that later leave the
  current catalog;
- position, age, experience, rookie class, and NFL draft capital known at the
  anchor;
- production and usage only through the anchor;
- market momentum, volatility, drawdown, rank percentile, and liquidity known
  at the anchor; and
- explicit missing, delisted, retired, or unmatched outcomes.

The full historical population is the first gate. Training on today's catalog
would teach the model only about survivors and systematically overstate young
asset upside.

### Challenger feature families

Start with small, auditable families:

1. **Spot and path:** current value/rank percentile, trailing 30/90-day return,
   volatility, drawdown, and trade frequency.
2. **Lifecycle:** position, age, experience, rookie/veteran state, and season
   phase.
3. **Capital:** NFL draft round and overall selection where known.
4. **Football fundamentals:** point-in-time production, workload, and
   availability through the anchor.
5. **Rookie evidence:** only out-of-fold historical rookie-production
   predictions generated as though each class were unknown.

The current 2026 rookie-board predictions cannot be copied backward into
historical rows. Every training feature must be reproducible from the anchor's
information set.

Defer depth-chart labels, contract narratives, injuries, and news until a
dated historical source and an incremental held-out experiment justify them.
Current descriptions or retrospective labels would leak the future.

### Baselines

The challenger must beat the strongest eligible simple baseline, not merely a
weak zero-return guess:

- zero return;
- trailing-return continuation or reversion;
- position, age/experience, current-value, and lifecycle cohort median;
- current market rank alone; and
- for rookies, point-in-time market rank plus NFL draft capital.

The Tyson example is exactly why the rookie market baseline matters. A model
that predicts an excellent player but cannot beat the market's existing
expectation has not discovered an acquisition edge.

### Validation and promotion

Freeze the data manifest, feature contract, baselines, and thresholds before
opening the final holdout. Each source format and horizon promotes separately.

Required gates:

1. point-in-time identity and value coverage, including an explicit treatment
   of assets that disappear;
2. no label or feature crossing the prediction anchor;
3. chronological training, embargo, and untouched later holdout;
4. rolling rookie-class holdouts for any rookie-specific feature or claim;
5. adequate held-out assets, dates, and completed lifecycle cohorts;
6. meaningful MAE improvement over the best simple baseline;
7. positive cross-sectional rank correlation on the later holdout;
8. calibrated return-interval coverage and width;
9. no unacceptable regression by position, lifecycle, or current-value tier;
10. stability against removal of a single class or anchor period; and
11. exact 1QB/superflex eligibility and source provenance.

Candidate numeric thresholds should be frozen only after the source audit
reveals the honest sample size, then evaluated once on the final holdout. The
experiment should not tune gates until an exciting player passes.

## Implemented artifact and application contract

The bounded shadow report is produced by `ml/asset_potential.py`. It reuses the
existing asset-return label, identity, and split contracts instead of creating
a second permanent data system. It remains an offline experiment and does not
force a runtime abstraction before the evidence proves useful.

Outputs:

```text
ml/reports/asset-potential-health.json
ml/reports/asset-potential-health.md
ml/reports/asset-potential-complexity-ledger.md
```

Only after a horizon passes may a reviewed follow-up generate a small
browser-safe artifact such as:

```text
public/data/asset-potential-health.json
```

The typed client continues to consume the existing per-horizon asset-return
artifact with explicit units and status. The experiment does not publish a
second client contract while every new horizon is blocked.

The intended shape remains:

```ts
type ForwardValueHorizon = {
  source: 'fantasycalc'
  format: '1qb' | '2qb'
  horizonDays: 30 | 90 | 180 | 365
  status: 'needs-data' | 'shadow' | 'validated'
  currentSourceValue: number
  medianReturn?: number
  lowerReturn?: number
  upperReturn?: number
  medianFutureSourceValue?: number
  lowerFutureSourceValue?: number
  upperFutureSourceValue?: number
}
```

Do not place a projected FantasyCalc future value into `Asset.value`, compare
it numerically with a Tradyr composite, or make an uncovered asset contribute
zero return.

## Product behavior

### Player research

Every player should eventually have a compact **Outlook** section:

- current market price and relative rank;
- production fundamentals and evidence coverage;
- forward return range at each eligible horizon;
- upside and downside thresholds only when calibrated;
- liquidity, volatility, and drawdown;
- catalysts and bear case as dated advisory evidence; and
- a plain-language interpretation of what the market appears to price in.

For Tyson today, the honest card would say: high rookie-production outlook,
market expectation already similarly high, 30-day return evidence available,
and long-term market-return outlook unavailable.

### Trade analysis

The trade view now compares both sides at the same declared horizon:

1. current Tradyr market difference;
2. current-season lineup-power change;
3. covered production change;
4. source-matched forward return and downside for each covered asset;
5. forward-evidence coverage by current package value;
6. age, liquidity, concentration, and draft-capital change; and
7. opening, target, and walk-away price.

The current implementation supports portfolio P&L only from the exact promoted
horizon's existing expected arithmetic-return head. If that horizon is shadow
or unavailable, P&L is null and coverage is zero; it never falls back to the
promoted 30-day head. More generally, an expected arithmetic-return head may
support portfolio P&L only if it is
separately calibrated, because expectation is additive. Median returns and
individual uncertainty intervals must not be summed and presented as a
calibrated package outlook without a validated dependence model.

No trade should be recommended solely because an incoming player has a high
ceiling. The acquisition price must be compared with the expected repricing,
downside, liquidity, and the next-best use of the outgoing assets.

### Target discovery

After promotion, forward value may become another visible Pareto dimension:

- acquisition cost;
- horizon-matched expected return;
- tracked downside;
- covered production;
- current lineup utility;
- liquidity; and
- age at the declared roster horizon.

It should not become a hidden weighted “potential score.” An empty supported
frontier remains a valid instruction to hold.

## Complexity ledger

| Concern | Lens / owner | Evidence | Class | Purpose and failure mode | Decision and trigger |
| --- | --- | --- | --- | --- | --- |
| Horizon-specific future market return | Product and model | Confirmed gap in the Ward/Tyson decision | Essential | Without it, current price and current lineup utility stand in for investment potential | Model explicitly and promote each horizon separately |
| Current price, production, and future return as separate quantities | Product and system | Confirmed by existing evidence protocol | Essential | Blending them creates circular “upside” and reprices provider truth | Preserve separate types, units, UI cards, and recommendation language |
| Complete historical failures and disappearing assets | Data and model | Current source boundary is incomplete | Essential outcome; imported source constraint | Survivor-only training inflates upside and understates downside | Block long-horizon promotion until source audit defines a defensible population |
| FantasyCalc identities, formats, and value scale | Integration | Existing history source behavior | Imported | Joins and source-scale leakage can produce false returns | Isolate in the offline adapter and retain manifests/hashes |
| A new online inference service | Operations | No current runtime requirement | Accidental | Adds deployment and failure modes without improving the experiment | Do not add; ship reviewed offline artifacts |
| One universal potential score | Product | No validated target or unit | Accidental | Hides price, horizon, risk, and missing coverage | Do not build; use an outlook card and Pareto facts |
| Separate shadow `asset_potential.py` experiment | Evolution | Fastest reversible way to test new features | Transitional | Can duplicate asset-return code if it becomes permanent | Time-box it; consolidate shared label code only after a horizon passes |
| Historical rookie out-of-fold feature tape | Data and model | Needed to test incremental rookie insight | Transitional | Expensive feature work may add nothing beyond market and draft capital | Build only for the bounded challenger; delete if it adds no held-out lift |
| Complete delisting/failure labels | Data | Source availability not yet proven | Unknown | An arbitrary zero or silent omission biases the target | Run the population audit first; block rather than impute if unresolved |
| Multi-year dynasty value forecast | Product and model | No current validated history | Unknown | Long extrapolation can dominate trade advice with false precision | Not until a separate multi-year dataset and holdout pass |

## Implementation outcome

The August 12, 2026 offline run found:

- 485 positive FantasyCalc history series in each format, including 10 assets
  outside the current catalog whose cached series later reaches zero;
- no versioned full historical catalog, so those observed zeros cannot prove
  complete retirement, delisting, or career-failure coverage, and the reusable
  log-return label contract currently excludes terminal zero outcomes;
- 12,539 1QB and 12,527 superflex 180-day labeled rows, but only 414 and 413
  eligible training rows before the later holdout and no valid pre-holdout
  selection window after the 180-day embargo;
- 838 labeled 365-day rows in each format, 421 in the later holdout, and zero
  eligible training rows after the 365-day embargo; and
- season-complete football fundamentals on roughly 54% of the labeled rows.

All four format/horizon experiments therefore remain `needs-data`. No model was
selected, no performance claim was made, and no browser artifact was written.
The application change is the honest decision contract: the user can declare
the holding period, see its exact evidence state, and save that state in the
private decision journal.

## Scope ladder

### Completed — correct the decision contract

- Require trade analysis to state the declared holding period.
- Show current price, production potential, and forward market evidence as
  separate lanes.
- Treat every unpromoted horizon as unavailable.
- Use the Tyson case as a regression example: high production potential is not
  automatically market underpricing.

The Trade Lab, player research card, and saved decision snapshot now retain the
exact selected horizon and show unavailable evidence instead of stretching the
30-day result.

### Completed, blocked — bounded shadow experiment

- Audit the historical asset population and disappearance boundary.
- Build the point-in-time anchor tape.
- Test 180- and 365-day cohort baselines against one small state-aware
  challenger.
- Generate out-of-fold rookie-production features only if the base lifecycle
  challenger establishes a credible evaluation path.

The reproducible audit exists, but the historical population and eligible
pre-holdout training window fail the advancement gate. The experiment stays
offline and blocked until both inputs materially improve.

### Later — promoted-horizon integration

- Export only promoted horizon rows.
- Publish the reviewed horizon artifact to the existing player research and
  Trade Lab surfaces only after promotion.
- Add promoted same-horizon forward facts to target Pareto discovery.
- Record the original outlook in the decision journal and score it at the exact
  checkpoint.

**Advancement gate:** live recommendations can trace every forward claim to an
  enabled artifact, exact horizon, source, format, timestamp, and coverage.

### Not until validated

- a single potential or dynasty-stock score;
- projected future Tradyr value derived from FantasyCalc returns;
- two- or three-year extrapolation from a 30-day model;
- news or depth-chart sentiment embedded without point-in-time history;
- automatic buy/sell commands;
- acceptance probability; or
- summed package confidence intervals without a dependence model.

## Revisit and sunset conditions

- Delete the experimental challenger if it cannot beat the market/cohort
  baseline on the final holdout.
- Keep longer horizons shadow or blocked if failure-population coverage remains
  incomplete.
- Re-evaluate the source adapter if FantasyCalc changes identity, history,
  cadence, or terms.
- Consolidate the asset-return and asset-potential pipelines only after both
  have a promoted consumer; shared infrastructure before that point would be
  premature.
- Revisit probability outputs only after threshold calibration is measured,
  not because the UI would look more stock-like with a percentage.

# Trade evaluation protocol

This is the shared operating contract for humans, agents, and the Trade Lab.
It prevents a real data collection run from being mistaken for a trained or
validated decision signal.

## Evidence lanes

Evaluate every proposed trade through separate lanes:

| Lane | Question | May affect a recommendation when |
| --- | --- | --- |
| Current market | What can each asset be exchanged for now, and how does the same-format redraft market rank a legal lineup? | The attributed dynasty or redraft snapshot is current, format-matched, and shown on its own scale. |
| Covered production | What lineup points are supported by the held-out forecast? | The production model is enabled and required starters are covered. |
| Exchange premium | What premium has the market paid for this package structure? | The exchange model passes all gates and this trade matches its eligible structure. |
| Future outcome | Did similar premium decisions preserve value after 90/180/365 days? | That exact horizon and challenger pass every chronological holdout gate. |
| Asset return | What same-source market return and tracked-asset downside are supported for each asset? | That exact horizon and QB-format model passes every embargoed holdout gate. |
| Counterparty utility | What current roster need, surplus, lineup effect, and completed-trade facts make an offer relevant to the other manager? | Always as an inspectable negotiation read; never as acceptance probability or a change to price. |
| Catalyst timing | Is there a dated current report and matching historical event cohort? | Only after a separate chronological market-event challenger proves incremental held-out lift. Current cohorts are advisory. |
| Rookie opportunity cost | Which current-class prospects might still be available at an exact pick? | Only as an advisory candidate basket under declared availability rules. Production percentile never becomes pick price, and a failed exact-slot gate remains visible. |

Do not combine the lanes into a hidden grade. The user may weight promoted
signals, and uncovered weight must remain visible rather than being silently
redistributed.

The redraft lineup-power index belongs to the current-market lane. It is a
relative consensus proxy, not covered production. It may be shown as a direct
strategy objective and Pareto fact, but it never supplies the Trade Lab's
covered-production weight or bypasses that model's coverage gate.

## Five stages of historical evidence

1. **Collected** — a completed trade is stored in the private hosted tape.
2. **Historically valued** — every required asset has a point-in-time price at
   the trade date and the join is recorded in a dataset manifest.
3. **Trained** — an offline artifact was fit to eligible rows using a
   chronological split.
4. **Validated** — sample, independence, date-span, format, coverage, and
   held-out performance gates all pass.
5. **Influencing this trade** — a validated model is eligible for this package,
   receives nonzero user weight, and contributes a non-null signal.

Failure to advance one stage blocks every later stage. A provisional metric can
be displayed for audit, but it cannot be described as an edge.

## Required recommendation format

For any trade recommendation, report:

- the exact assets and resolved pick slots or pick-value range;
- current market difference and source freshness;
- covered lineup impact, or why it is unavailable;
- historical-model state and whether it contributes to this trade;
- the user's competitive horizon and the asset's likely hold period;
- age/decay, injury, role, liquidity, and exit risks without inventing precise
  probabilities;
- promoted asset-return evidence at its exact horizon, while keeping the
  source's incomplete disappearance/failure boundary visible;
- for negotiation, an ambitious opening offer, a fair target, and a hard
  walk-away price based on declared evidence;
- seller-side roster needs, surplus, current-season effect, and factual trade
  history beside those price anchors, without acceptance odds;
- current rookie candidate baskets and future-class block reasons beside the
  provider pick range, never blended into a pick value;
- dated catalyst evidence and model-gate state, never headline-driven price;
- a saved private decision record containing the exact offer, evidence
  snapshot, thesis, intended hold period, exit condition, and later status.

## Decision workflow

1. Select the exact incoming and outgoing assets in Trade Lab.
2. Read the direct current-price comparison and each promoted evidence lane.
3. Inspect the counterparty's whole-roster needs and blockers. Use the
   ambitious/fair/walk-away ladder as price anchors; do not reinterpret roster
   fit as a predicted acceptance rate.
4. For picks, compare the provider price range with the separate rookie
   opportunity set. A blocked or unresolved class supplies no invented player
   ranking.
5. Read current catalysts only as timing context unless the market-event gate
   is enabled.
6. Before contacting the manager, save the proposal and write the thesis, hold
   period, and exit/failure condition. Update the record when it is offered,
   countered, accepted, rejected, or withdrawn so future evaluation has real
   decision labels rather than reconstructed intent.

RosterLab's saved strategy is a long rebuild unless the user changes it. Older
production assets need an explicit near-term flip thesis and an exit condition;
their present points alone are not sufficient. Young assets and picks are not
automatically good: acquisition price, liquidity, class opportunity cost, and
time to usable value still matter.

## Hosted-to-offline runbook

1. In Trade Lab, **Refresh historical tape** performs the bounded authenticated
   FantasyCalc completed-trade scan and deduplicates sanitized rows into D1.
2. **Download training tape** exports the full sanitized tape with a stable
   SHA-256 dataset ID. It does not train or promote a model.
3. Import the downloaded export, hydrate its asset histories, and retrain:

   ```sh
   npm run ml:trade-models:import -- /absolute/path/to/rosterlab-trade-tape.json
   npm run ml:trade-models:hydrate
   ```

   The importer rejects altered content and deduplicates provider trade IDs
   against the local cache. Hydration fetches only missing asset histories,
   reuses cached series even when they were retrieved on an earlier day, trains
   the chronological challengers, and records exact dataset IDs and
   point-in-time coverage in the generated artifact. Use
   `npm run ml:trade-models` only for the wider 80-anchor/universe collection.
4. Training uses chronological holdouts. Raw price, exchange premium,
   structure-only future outcome, premium-aware future outcome, and lineup
   outcome remain separate comparisons.
5. The browser enables a historical signal only when its existing gates pass.
   No manual weight or UI control may bypass `enabled: false`.

The hosted refresh/export and offline import/manifest bridge are all explicit.
The site still withholds any historical signal whose existing gates fail.

## Claims the data cannot support

Completed trades do not expose rejected offers, private negotiation, manager
intent, or calibrated acceptance probability. Current roster context is not a
historical roster snapshot. A market premium is an observed exchange price, not
proof of profit. A 90-day label cannot stand in for a 180- or 365-day outcome.

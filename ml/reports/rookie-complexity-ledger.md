# Rookie sleeper pipeline complexity ledger

## Boundary

- Outcomes: (1) identify late-cost rookies likely to produce in their first NFL
  season and (2) separately test future dynasty-market movement.
- Observer: one private 12-team superflex, full-PPR, 0.75-TEP rebuild manager.
- Horizon: rookie regular season for production; 180 and 365 days for the
  still-shadow market-return head.
- Team and operations: one user; offline refresh; no new service, queue or live
  inference system.
- Exclusions through V6.3: trade-grade influence, automatic transactions,
  article-text sentiment, historical Sleeper-trend inference, and any
  production-percentile conversion into dynasty or pick value.

## Ledger

| Concern | Lens / owner | Evidence | Class | Required outcome or purpose | Costs and failure modes | Simpler alternative | Decision and trigger |
|---|---|---|---|---|---|---|---|
| Point-in-time rookie prices and outcomes | Product/model | Confirmed: current-only catalogs drop failed players | Essential | Prevent leakage and survivor bias | Wrong snapshot selection makes a convincing but invalid model | Current rankings only | Keep dated anchors and assert every feature timestamp is at or before the anchor |
| Rookies absent from an ECR snapshot | Product/model | Observed across every historical class | Essential | Retain busts and zero-cost prospects | Treating absence as missing deletes failures; treating it as an exact numeric price overstates precision | Drop the rows | Retain them at the source-relative floor for tape coverage, but exclude them from return-model fitting |
| Provider schemas, IDs and git history | Integration | Confirmed schema changes from 2019 to 2026 | Imported | Reproduce comparable snapshots | Schema drift, renamed players and unavailable upstream history | One current CSV | Isolate in the DynastyProcess adapter and normalize FantasyPros IDs first, names second |
| One combined rookie grade | Product/system | Prior hard-coded scores were not trusted | Accidental | None | Hides label quality, uncertainty and phase failures | Separate tape, base model, updater and gates | Delete; export evidence and distributions rather than a synthetic grade |
| DynastyProcess ECR as a temporary historical label | Product/model | Confirmed 332 dated snapshots; not completed-trade pricing | Transitional | Test the pipeline before a full trade-price tape exists | Expert opinion can move differently from actual deal prices | Wait without testing | Keep shadow-only; remove as primary label when a complete completed-trade tape passes coverage tests |
| Historical completed-trade prices for delisted players | Product/model | FantasyCalc current-player histories do not reconstruct the full universe | Unknown | Train the requested profit model on actual market behavior | Unknown coverage and source-format fidelity | Use ECR forever | Continue the bounded source audit; promote only after delisted-player and league-format gates pass |
| College production and usage | Product/model | Confirmed public cfbfastR play-participant seasons 2014-2025; stable ESPN IDs cover 93.0% of historically priced rookies | Essential for V6.3 experiment | Distinguish similar market and draft-capital profiles | Imported schema, missing lower-division players and incorrect team shares | Draft capital and size only | Keep behind the isolated adapter; expose missingness and source hashes; never hand-fill a player's production |
| Athletic testing | Product/model | Confirmed nflverse combine rows and stable CFB/PFR identities | Imported | Add measured speed and explosion without scouting grades | Non-invites and incomplete drills are not failures | Omit athletic data | Keep raw results and explicit missingness; never replace missing drills with a player penalty |
| Rookie NFL production outcome | Product/model | Confirmed nflverse regular-season PPR rows for 2019-2025; no stat row is an observed zero outcome | Essential | Test whether a late-cost basket produces, independent of opinion movement | One season misses slower developmental arcs | Market movement alone | Keep as a separate position-relative target; do not merge it with market return into one grade |
| Cost-aware sleeper decision rule | Product/model | Five eligible rolling classes; exact top-eight rule beat the strongest simple baseline in all five; sizes 6/8/10/12 have positive mean lift and majority class wins versus both market and draft order | Essential | Match the actual draft decision instead of optimizing average error | Cutoff instability and retrospective model selection | MAE only | Lock the five-seed ensemble and rule; require >=5/5 primary class wins, exact one-sided sign p <= 0.05, and adjacent-size sensitivity; track 2026 prospectively |
| Known rookie pick-slot decision | Product/model | Requested 2026 slot begins at 1.12; the passed top-eight post-rank-24 gate answers a different decision | Essential | Evaluate the player selected at each exact slot rather than inherit basket validation | A strong average ranking can still make the wrong marginal choice at 1.12 | Treat the top-eight gate as pick validation | Keep the known-pick evaluation shadow-only; compare slots 1-24 and require repeatable exact-slot lift before promoting extra feature families |
| Player availability before a known pick | Product/model | Historical draft-room selections are not observed in the current tape | Unknown | Define the candidate set remaining at each slot | One assumed order can manufacture apparent selector performance | Report only the full pre-draft board | Use market order as the primary assumption and report NFL draft order and learned market-plus-capital order as sensitivity rules |
| Known-pick advisory artifact | Product/system | One offline consumer needs candidates, uncertainty, provenance, and blockers; the live Worker does not | Transitional | Make the 1.12 output reproducible without changing live recommendations | Contract drift or accidental production use | Read the full research report by hand | Generate a separate shadow artifact inside the existing pipeline; remove or replace it only after a validated production consumer exists |
| News text and camp sentiment | Product/model | Existing headline rules have no historical return validation | Accidental through V6.2 | None yet | Narrative leakage and arbitrary hype weights | Structured market movement and factual status events | Exclude from model; reconsider only after a labeled, rights-safe event tape shows incremental held-out lift |
| Separate online model service | Operations | No independent scale or latency requirement | Accidental | None | Deployment, drift and availability burden | Offline artifact | Do not add before a promoted model needs runtime inference |

## Scope ladder and triggers

- Now / V6.0: retain the complete rookie universe and build dated labels. Passed
  only when history, identity, late-round coverage, class count and leakage gates
  all pass.
- Next / V6.1: shadow model. It advances only if both horizons beat the declared
  baselines on the two latest held-out classes and the label source represents
  completed-trade pricing.
- Next / V6.2: structured updater. It advances only if it improves base-model
  error without reducing sleeper-basket returns in either held-out class.
- V6.3: production evidence board. It advances only when stable-ID college,
  combine and real NFL outcomes pass coverage/leakage gates and the exact
  cost-aware basket beats the strongest simple baseline in every eligible
  rolling class.
- V6.3 known-pick shadow: evaluate slots 1-24 with learned market-plus-capital
  as the primary baseline, special reporting for 1.08-2.04, and a separate 1.12
  advisory artifact. Do not inherit validation from the late-rookie basket.
- Later: prospective 2026 tracking, a two-season developmental target when a
  full additional class matures, and observed historical draft-room
  availability if a complete point-in-time source becomes available.
- Not until the separate market-return promotion: trade-grade influence,
  automated actions, article-text modeling or an online inference service.

The transitional ECR label sunsets when a complete completed-trade tape exists.
V6.3's production outcome does not waive that requirement because production
and trade-market profit are different questions.

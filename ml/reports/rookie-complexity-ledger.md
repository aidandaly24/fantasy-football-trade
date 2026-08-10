# Rookie sleeper pipeline complexity ledger

## Boundary

- Outcome: identify rookies whose future dynasty-market movement may exceed the
  cost implied by their current market rank.
- Observer: one private 12-team superflex, full-PPR, 0.75-TEP rebuild manager.
- Horizon: 180 and 365 days, with current 2026 decisions remaining shadow-only.
- Team and operations: one user; offline refresh; no new service, queue or live
  inference system.
- Exclusions through V6.2: trade grades, automatic draft recommendations,
  article-text sentiment and historical Sleeper-trend inference.

## Ledger

| Concern | Lens / owner | Evidence | Class | Required outcome or purpose | Costs and failure modes | Simpler alternative | Decision and trigger |
|---|---|---|---|---|---|---|---|
| Point-in-time rookie prices and outcomes | Product/model | Confirmed: current-only catalogs drop failed players | Essential | Prevent leakage and survivor bias | Wrong snapshot selection makes a convincing but invalid model | Current rankings only | Keep dated anchors and assert every feature timestamp is at or before the anchor |
| Rookies absent from an ECR snapshot | Product/model | Observed across every historical class | Essential | Retain busts and zero-cost prospects | Treating absence as missing deletes failures; treating it as an exact numeric price overstates precision | Drop the rows | Retain them at the source-relative floor for tape coverage, but exclude them from return-model fitting |
| Provider schemas, IDs and git history | Integration | Confirmed schema changes from 2019 to 2026 | Imported | Reproduce comparable snapshots | Schema drift, renamed players and unavailable upstream history | One current CSV | Isolate in the DynastyProcess adapter and normalize FantasyPros IDs first, names second |
| One combined rookie grade | Product/system | Prior hard-coded scores were not trusted | Accidental | None | Hides label quality, uncertainty and phase failures | Separate tape, base model, updater and gates | Delete; export evidence and distributions rather than a synthetic grade |
| DynastyProcess ECR as a temporary historical label | Product/model | Confirmed 332 dated snapshots; not completed-trade pricing | Transitional | Test the pipeline before a full trade-price tape exists | Expert opinion can move differently from actual deal prices | Wait without testing | Keep shadow-only; remove as primary label when a complete completed-trade tape passes coverage tests |
| Historical completed-trade prices for delisted players | Product/model | FantasyCalc current-player histories do not reconstruct the full universe | Unknown | Train the requested profit model on actual market behavior | Unknown coverage and source-format fidelity | Use ECR forever | Continue the bounded source audit; promote only after delisted-player and league-format gates pass |
| College production and usage | Product/model | CollegeFootballData credential is not configured | Unknown | Distinguish similar draft-capital profiles such as converted positions | Identity joins and point-in-time feature availability | Draft capital and size only | Add behind a separate adapter after credential/access and historical coverage are verified |
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
- Later: CollegeFootballData features and historical availability modeling,
  unlocked by verified access and point-in-time coverage.
- Not until promotion: site recommendations, trade-grade influence, automated
  actions, article-text modeling or an online inference service.

The transitional ECR label sunsets when a complete completed-trade tape exists,
or the approach is abandoned if it cannot beat the simple baselines after the
college-data experiment.

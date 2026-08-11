# Future rookie-class research complexity ledger

## Boundary

- Outcome: determine whether legitimate same-horizon evidence exists for a
  future rookie class before attempting a class-strength forecast.
- Observer and anchor: one private dynasty manager, August immediately before
  a prospect's possible final college season.
- V6.4 output: a reproducible historical candidate tape, provenance manifest,
  and aggregate audit only.
- Excluded: class predictions, future-pick values, owner-slot forecasts, market
  curves, trade scoring, UI, deployment, services, queues, and databases.

## Complexity ledger

| Concern | Lens / owner | Evidence | Class | Required outcome or purpose | Costs and failure modes | Simpler alternative | Decision and trigger |
|---|---|---|---|---|---|---|---|
| Complete historical candidate population | Product/model | Confirmed pinned cfbfastR season rosters for 2018-2025 | Essential | Retain entrants, later entrants, and players who never enter the NFL | Retrospective season membership is not an untouched August roster | Start from eventual NFL rookies | Use the full roster population, publish the archive limitation, and replace only if dated snapshots can be recovered |
| Same-horizon feature cutoff | Product/model | Confirmed play-participant production for 2014-2025 | Essential | Prevent final-season and post-draft leakage | A single off-by-one season can invalidate a convincing experiment | Use career totals through draft day | Set cutoff to target draft year minus two and assert every joined season is at or before it |
| ESPN athlete identity across rosters, production, and outcomes | Integration | Completed classes recover 86.0%-96.4% of known entrants | Imported | Join without name guessing and quantify missing entrants | Provider ID collisions or omissions bias class results | Normalized names | Use stable IDs, exclude and report collisions, gate each completed class at 85% recovery |
| Draft eligibility | Product/model | Roster year exists but cannot fully represent redshirts or age rules | Essential uncertainty | Avoid silently treating every roster player as equally declarable | False inclusions are numerous; false exclusions erase real entrants | Keep only seniors | Preserve every candidate; flag year 2+ or unknown as plausibly eligible; revisit only with a dated eligibility source |
| Prior college production | Product/model | Plausible-candidate coverage varies materially by class and position | Essential input candidate | Measure development before the final season | Missing lower-level players and sparse role events can look like poor performance | Drop unmatched players | Retain explicit missingness and report coverage; never hand-fill production |
| Recruiting pedigree and prospect age | Product/model | Selected roster archive has inadequate recruiting-ID coverage and no validated dated age field | Unknown | Potentially add early signal | Retrospective enrichment can leak later corrections or survivor bias | Omit the families | Exclude from V6.4 features; add only through a pinned dated source with class/position coverage gates |
| Combine, NFL draft capital, final-season production, and post-anchor market data | Product/model | Known only after the declared anchor | Accidental for V6.4 | None | Direct leakage | Add because predictive | Prohibit and assert the feature horizon; these may be outcomes or later-stage evidence only |
| Direct class-level model | Product/model | Only six completed gate classes | Accidental | None | Severe overfit and misleading confidence | Prospect-level outcome distributions | Do not train in V6.4; V6.5 must aggregate prospect distributions with rolling class holdouts |
| Online inference or application integration | System/operations | No validated forecast or runtime requirement | Accidental | None | New security, drift, deployment, and coupling burden | Offline files | Do not add before a separately reviewed model and consumer pass their own gates |

## Scope ladder and triggers

- **Now / V6.4:** pinned historical roster population, prior-only production,
  stable identity labels, explicit missingness, leakage tests, and aggregate
  evidence report. Construction gate passed for 2020-2025; training and
  downstream use remain disabled.
- **Next / V6.5:** compare small prospect-level outcome baselines with rolling
  or leave-one-class-out evaluation. Advance only on repeatable improvement
  over a historical-average decision baseline with measured interval coverage.
- **Later:** independently validate original-owner slot distributions and a
  legitimate dated market/liquidity curve.
- **Not until evidence earns it:** a combined rookie grade, precise distant
  player ranks, live trade recommendations, a new service, or a site tab.

## Waterbed check

V6.4 removes runtime and modeling complexity by keeping the work offline, but
the essential burden moves into provenance, identity recovery, missingness, and
point-in-time audits. Those costs are visible in the manifest and report rather
than hidden in adapters or a confidence score. A future implementation should
not claim simplification by deleting these controls.

# Target discovery and trade research system

**Status:** Design proposal. The repository does not yet implement every signal
or workflow described here.

This document defines the evidence RosterLab should assemble before it calls a
player a trade target. It is a product and modeling contract, not a claim that
every signal below is already implemented.

The objective is to improve the roster's long-term, risk-adjusted market value
while respecting the manager's competitive window. The system must not equate
winning a calculator total with winning a trade, invent acceptance odds, or
represent an uncertain forecast as profit.

## Target record

For every rostered player, the target-discovery pipeline should maintain:

1. Current KTC, FantasyCalc, and attributed Tradyr market position, with source
   provenance and collection time.
2. 30-, 90-, 180-, and 365-day value movement from legitimate historical
   market observations.
3. Production-versus-market divergence, keeping the production forecast and
   market price as separate quantities.
4. Age, expected value decay, liquidity risk, and fit with the user's declared
   three-year competitive window.
5. The player's lineup importance to the current owner and that roster's
   positional surplus or shortage.
6. That manager's preferences inferred only from completed trades, with sample
   size and uncertainty visible.
7. Current news catalysts with dated, linked sources and explicit source
   quality. News may support a thesis; it must not manufacture one.
8. Pick-specific rookie opportunity cost, using the known-slot rookie model
   only where it has passed its validation gates and otherwise showing an
   honest range.
9. The user's pending/pro-forma roster, committed pick ownership, and actually
   available trading inventory.
10. An opening offer, target price, maximum price, intended holding period, and
    exit condition. Prices are decision boundaries, not predictions that an
    opposing manager will accept.

## Target categories

Every surfaced candidate should state which thesis it belongs to:

- **Long-term compounder:** a young, liquid asset with a credible path to
  maintaining or increasing value through the user's competitive window.
- **Catalyst flip:** a temporary market dislocation with a dated catalyst,
  planned holding period, and defined exit. A flip must include downside and
  liquidity risk.
- **Forced or surplus sale:** a useful player whose current owner receives less
  lineup utility from the asset because of roster depth, timeline, or another
  constraint.

A player can satisfy more than one category, but the evidence for each thesis
must remain visible. A cheap declining veteran is not automatically a flip, and
roster surplus does not prove an owner will sell cheaply.

## Decision memo

Before RosterLab recommends sending an offer, it should be able to produce a
short decision memo containing:

- current price and source disagreement;
- historical price path and drawdown;
- production range, coverage, and uncertainty;
- age, role, contract horizon, and decay exposure;
- the owner's lineup utility and roster pressure;
- relevant completed-trade behavior and its sample size;
- rookie opportunity cost for every pick in the package;
- dated catalysts and the bear case;
- expected holding period, liquidity, and exit condition; and
- opening, target, and walk-away packages.

These are distinct evidence layers. Market price is not production. Production
is not future resale value. News is not causation. Completed trades do not
create a calibrated acceptance probability.

## Discovery and negotiation loop

1. Refresh settled and pending/pro-forma league state.
2. Screen each roster for surplus, needs, timeline mismatch, and manager trade
   behavior.
3. Form a target thesis from market, production, horizon, and owner utility.
4. Verify current role and news with dated primary or high-quality sources.
5. Identify what the seller would actually value; do not assume the universal
   market price is that manager's utility function.
6. Build an opening package, target package, and hard walk-away price. Consider
   a three-team structure only when it converts the user's inventory into an
   asset the seller explicitly wants.
7. Record the thesis and intended exit before sending the offer.
8. Measure market and production outcomes after 7, 30, 90, and 180 days without
   rewriting the original evidence snapshot.

## Negotiation constraints

- Do not bid against yourself after a rejection; first learn which asset type
  the seller values.
- Do not add value without receiving value or changing the package structure.
- Do not pay an extra coordination tax merely because a trade has three teams.
- Do not acquire an intermediate asset for a three-team trade until all legs
  can be completed atomically.
- Do not fabricate news, hide relevant facts, or claim certainty the evidence
  does not support.
- Walk away when the requested package is worse than the best available use of
  the same inventory.

## Promotion gates

Automation may rank or recommend from a signal only when its source is
legitimate, its timestamp and provenance are stored, and its historical
evaluation is reproducible. Until then, the UI should expose the raw evidence
or an advisory range rather than a synthetic score, profit number, confidence,
or acceptance probability.

The current rookie model can inform opportunity cost only within its validated
coverage. Exact first-round claims require an appropriate known-pick backtest;
late-round sleeper evidence must not be generalized to pick 1.12.

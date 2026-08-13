# Player research screen

**Status:** Core dossier and navigation implemented on August 13, 2026. Every
rostered player is reachable from the selected team’s full League Facts roster,
and a restorable `league`/`player` query opens the league-scoped dossier. The
screen currently contains ownership, current market, covered production,
exact-horizon asset-return state, owner position depth, watchlist, and Trade Lab
handoff. News, completed player trades, broad package-frontier composition, and
the D1 observed tape remain later work and must not be described as present.

## Executive judgment

RosterLab should add one research screen for every currently rostered NFL
player in either supported league. The first version should organize facts the
application already has: current provider prices, league-adjusted production,
current ownership, manager context, dated news, completed trades, and concrete
trade packages. It should not wait for a return model, and it should not fill
that gap with a synthetic score.

The same player is a different trade decision in each league. Ownership,
lineup utility, tight-end premium, counterpart roster pressure, available
packages, and the user's declared window all depend on the selected league.
Player identity can be shared; the research profile must remain league-scoped.

This is a private decision surface for two leagues, not a public player
database or a general fantasy-content site.

## Decision boundary

- **Protected outcome:** make a player-specific trade thesis inspectable before
  opening or changing an offer.
- **Observer:** the authenticated RosterLab user managing a rebuilding roster
  and evaluating long-term asset value, flips, and opportunity cost.
- **Current scale:** the rostered players in the two IDs declared by
  `SUPPORTED_LEAGUES`.
- **Required invariants:** current value, production, historical market
  movement, news, and manager behavior remain separate evidence layers;
  missing data is visible; every dated claim retains provenance.
- **Failure tolerance:** a section may be unavailable. The page must not invent
  a replacement value, return estimate, acceptance probability, or confidence.
- **Explicit exclusions for the first version:** global free-agent search,
  unrostered college prospects, private Sleeper offers, automated trade
  sending, manager-acceptance predictions, and expected-profit claims.

Rookie prospects remain on the Rookie board until the rookie pipeline and the
NFL player directory share stable identities. Future picks are package
opportunity cost, not player profiles.

## Complexity ledger

| Concern | Evidence | Class | Required outcome or purpose | Cost or failure mode | Decision and trigger |
|---|---|---|---|---|---|
| Player identity plus selected-league context | Confirmed by the two supported leagues and their different formats | Essential | Show the correct owner, utility, and package context | Cross-league leakage would create false trade advice | Keep identity global but key every research profile by league ID and Sleeper player ID |
| Different provider scales, coverage, and timestamps | Confirmed in current value data | Imported | Preserve honest KTC, FantasyCalc, and attributed Tradyr evidence | Normalizing by raw percentage can create fake disagreement | Isolate provider facts and compare relative ranks only where both sources cover the player |
| Player evidence is scattered across League facts, Trade Lab, News, Evidence, and Journal | Confirmed in the current UI | Accidental | Let the user inspect one player without reconstructing the case manually | Duplicate JSX could create inconsistent values | Build one pure research profile and one focused view; existing views link to it |
| Historical tape exists, but the return model remains in shadow | Confirmed by the D1 market tape and current promotion gates | Transitional | Collect real observations without presenting them as forecasts | A temporary shadow field can become a permanent fake feature | Expose observations first; delete or promote shadow outputs only after the stated time-split gate |
| Per-player tape depth and source-specific historical coverage | Not yet measured for both leagues | Unknown | Decide which historical charts and horizons are honest | Sparse anchors could make 30/90/180-day movement misleading | Add a bounded coverage query before promising a horizon; render unavailable when an anchor is absent |

## Existing evidence inventory

The first screen should reuse these current contracts instead of creating a
second data pipeline.

| Evidence | Current source | What the player screen may claim now | Missing or constrained |
|---|---|---|---|
| Identity and current ownership | Sleeper league bundle and built `Team` assets | Name, NFL team, position, roster owner, starter/taxi/reserve status | Only the current settled Sleeper roster is live inventory |
| Current market | `ValueBundle` and `Asset.marketSources` | Attributed Tradyr composite plus separate current KTC and FantasyCalc values, rank, collection time | A source can be absent; raw values from different scales are not directly comparable percentages |
| Production | Validated production artifact and `projectionForLeague` | Expected, floor, ceiling, model label, drivers, and explicit league adjustment when covered | The asset mapper currently drops source season and games-observed provenance; V7.2 should preserve those fields |
| League utility | Current rosters, lineup optimizer, league context, and trade evaluator | Current likely-lineup status, position depth, dedicated slots, and covered lineup delta | Missing projections mean lineup impact is unavailable, not zero |
| Owner context | Current team direction plus manager profile built from completed trades | Manual/neutral direction, recent completed-trade activity, and observed completed-trade sample size | No rejected offers, private messages, or calibrated acceptance probability |
| Current intel | Authenticated intel and alerts routes | Dated linked reports, source, event label, and current watchlist state | News is advisory and cannot set market price or return by itself |
| Completed trades | Authenticated journal | Completed trades containing this Sleeper player ID, with season-aware identities | Accepted trades still in private review are intentionally unavailable |
| Candidate packages | Evidence frontier and Trade Lab draft | Current close/Pareto packages, both sides, market net, and covered lineup deltas | These are comparisons, not recommendations or acceptance forecasts |
| Historical market tape | D1 `market_value_snapshots` | Dated RosterLab composite observations after a private per-player read exists | The current endpoint exposes summary/latest state, not a player series; historical KTC and FantasyCalc series are not stored separately |

## Product contract

### Address and navigation

Use a restorable query address:

```text
?league=<supported-league-id>&player=<sleeper-player-id>
```

The existing application uses local view state and does not need a routing
library for one detail screen. A small URL-state adapter should:

1. validate the league against `SUPPORTED_LEAGUES`;
2. validate that the player exists in the selected league's current roster
   data;
3. open the player view after the league finishes loading;
4. update the address with `history.pushState` when a player is opened;
5. restore the prior screen on browser back/forward; and
6. fall back to League facts with an honest not-found message when the address
   is stale.

Player names should open this screen from League facts, Trade Lab, Evidence,
News, and completed Journal trades. Picks continue to open their existing
rookie or trade context rather than pretending to be players.

### Screen hierarchy

The first viewport should answer “what is this asset, who owns it here, and
what evidence matters to a trade?” in this order:

1. **Identity header:** player, position, NFL team, selected league, current
   owner, roster status, and a compact league-format label.
2. **Current market:** attributed composite, separate provider values and
   relative ranks when valid, current rank, observation timestamp, and explicit
   unavailable states.
3. **Production range:** expected/floor/ceiling PPR points per team week,
   coverage, source season, model version, drivers, and league adjustment.
4. **League and owner fit:** likely-lineup status, owner position depth,
   dedicated slots, the user's covered lineup delta, and observed completed
   manager activity.
5. **Dated intel:** only linked player-matched events, newest first, with source
   and publication time. It remains advisory.
6. **Completed trade tape:** league-season trades involving the player. Empty
   is a valid result.
7. **Package frontier:** concrete current packages from the user's available
   inventory with market, pick, and covered-lineup facts kept separate.
8. **Actions:** add/remove watchlist, open a selected package in Trade Lab, and
   return to the originating screen.

Every evidence card needs a visible source/freshness label. On a phone-sized
viewport the evidence becomes one column, the primary actions remain reachable
without horizontal scrolling, and tables become labeled fact rows rather than
miniature desktop tables.

## Minimum coherent architecture

Keep this inside the existing modular monolith.

### Pure profile builder

Add `src/player-research.ts` with a pure function such as:

```ts
buildPlayerResearchProfile(input): PlayerResearchProfile | null
```

Its input should be the already-loaded league context, teams, values, manager
profiles, journal, intel signals, preferences, and package frontier. It should
resolve exactly one current owner and produce presentation-ready facts with
provenance and explicit missingness. It must not fetch, mutate preferences, or
reimplement valuation math.

Keep player-research types beside this module unless another runtime boundary
actually consumes them. Do not turn `src/types.ts` into a second view model.

### Focused view

Add `src/views/PlayerResearchView.tsx`. The view renders the profile, owns only
presentation state, and delegates mutations to `App` callbacks. A small shared
`PlayerLink` is justified only after at least two existing views use the same
navigation behavior.

`App` should own `selectedPlayerId`, originating view, URL synchronization,
watchlist mutation, and Trade Lab prefill. The player screen should not create
a parallel copy of league data.

### Data-boundary changes

- V7.2 requires no new database table, Worker route, service, queue, or routing
  dependency.
- Preserve projection source season and games-observed fields currently lost
  when `PlayerProjection` becomes an `Asset`.
- Reuse the existing authenticated intel, journal, and preference routes.
- V7.3 adds one authenticated, league-isolated per-player tape read over the
  existing snapshot table. It should not return legacy projection/confidence
  columns as validated output.
- Do not add a source-history schema until a coverage audit proves that storing
  separate provider observations changes a supported decision.

## Delivery plan

### V7.2a — core current player dossier (implemented)

Build the navigable screen entirely from current loaded evidence.

Acceptance criteria:

- Every currently rostered player in both supported leagues is reachable from
  League facts and Evidence.
- A copied league/player address restores the same player after authentication
  and loading.
- Switching leagues either resolves that player's different owner/context or
  reports that the player is not rostered there.
- Current composite, KTC, and FantasyCalc are separately labeled and timestamped.
- Production expected/floor/ceiling, source season, sample coverage, drivers,
  and any league adjustment are shown only when present.
- Owner pressure and manager activity are factual and show sample size.
- Watchlist changes use existing private preferences.
- A concrete package opens the exact two sides in Trade Lab.
- No return, profit, acceptance, hold-period, decay, or certainty score appears.
- A 375-pixel-wide viewport has no horizontal page overflow and all primary
  actions remain usable by touch.

Implementation note: the first shipped slice satisfies roster reachability,
league/player URL restoration, league-scoped current ownership, separately
labeled market sources, production missingness, exact-horizon return
missingness, watchlist mutation, Trade Lab prefill, and phone layout. Manager
trade samples, linked news, completed player trades, and generated package
frontiers were deliberately left for V7.2b because they require loading and
joining additional view-owned evidence. Their absence is visible rather than
filled with a synthetic summary.

Verification: unit-test the pure profile builder, test URL parsing/restoration
and cross-league not-found behavior, test explicit missing states, and run the
production build.

### V7.3 — observed player tape

Expose real time-separated composite observations already collected in D1.

Add an authenticated read such as:

```text
GET /api/player-research?leagueId=<id>&playerId=<sleeper-id>
```

The response should be user- and league-scoped and contain only dated factual
observations needed by this view. It should report observation count, first and
last timestamps, and exact available points. The client may calculate 30-,
90-, 180-, or 365-day movement only when a real observation at or before the
requested anchor exists and the age of that anchor is displayed. It must never
interpolate a favorable history.

Acceptance gate to advance: each displayed horizon has a reproducible anchor,
route tests prove authentication and league isolation, stale/sparse tape has an
explicit unavailable state, and the chart remains a history chart rather than
a forecast.

This version does not require a new table. It displays RosterLab composite tape;
it does not relabel that tape as historical KTC or FantasyCalc.

### V7.4 — risk and holding-period evidence

Add risk facts only after the historical tape audit and return-model evaluation
pass their existing out-of-time gates. Candidate facts include observed
volatility, drawdown, recovery duration, age-at-window, position-age decay, and
market liquidity. Production uncertainty and resale-value uncertainty remain
separate.

The page may suggest a holding-period range only when it follows from a named,
validated catalyst or historical cohort and includes an exit condition and
bear case. It may not present a deterministic “sell in 90 days” rule.

Acceptance gate to advance: adequate time-separated rows by position and age,
a frozen baseline, out-of-time improvement with uncertainty bounds, source
coverage documentation, and a disabled fallback when the gate fails.

### V7.5 — trade decision memo

Compose, do not rescore, the validated evidence into a short memo:

- thesis category: long-term compounder, catalyst flip, or owner-surplus sale;
- current price and source disagreement;
- production range and coverage;
- historical path and risk facts when promoted;
- owner utility and completed-trade sample;
- dated catalyst and bear case;
- rookie opportunity cost for picks in the package; and
- opening, target, and walk-away packages with an intended exit condition.

This memo is a transparent decision record. It must not collapse the layers
into a letter grade, “fleece” score, unvalidated profit, or acceptance odds.

## Scope ladder and advancement gates

### Now

Use V7.2a for real evaluations and answer the riskiest current product question:
does consolidating the already-loaded evidence make player and negotiation
analysis materially faster?

**Gate:** use the screen for at least five real player evaluations across both
leagues and record which facts were still gathered outside RosterLab.

### Next

Ship V7.3 only after checking actual per-player tape depth and bounded query
cost in both leagues.

**Gate:** at least one requested horizon has defensible anchors for a useful
share of rostered players, and sparse players degrade cleanly.

### Later

Promote V7.4 risk/hold evidence and V7.5 decision memos after their data and
evaluation gates pass. Consider unrostered NFL players only if repeated trade
research needs them.

**Gate:** a real evaluation demonstrates added decision value beyond the
current market, production, and owner-context baseline.

### Not until

- a public player database or SEO pages;
- a new router solely for this screen;
- personalized acceptance probability without private offer labels;
- a single player score that mixes market, production, news, and risk;
- automated trade sending or manager outreach; or
- prospect profiles that bypass Rookie board validation.

These features lack present evidence or a reliable data boundary.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Provider scales are mistaken for comparable percentages | Display separate raw facts and compare covered-player relative ranks only |
| The same player leaks ownership or TEP context across leagues | Key profiles and URL state by league and player; add cross-league tests |
| Historical tape looks more complete than it is | Show count, span, anchor date, and explicit unavailable horizons |
| Projection coverage is mistaken for certainty | Show model/source coverage and keep missing lineup impact unavailable |
| The page becomes another oversized dashboard | Use the fixed evidence hierarchy and progressive sections; keep actions tied to a concrete decision |
| Completed trades are read as manager intent | Show sample size and label them observed completions, never rejected-offer evidence |
| Mobile use becomes a shrunk desktop layout | Make the fact-row layout and touch actions part of V7.2 acceptance tests |

## PR slicing

1. **V7.2 profile and navigation:** pure builder, player view, current evidence,
   URL state, watchlist, Trade Lab handoff, mobile layout, and tests.
2. **V7.3 tape read:** authenticated per-player query over existing D1 data,
   factual chart, coverage/anchor states, and isolation tests.
3. **V7.4 risk evidence:** only after the historical audit and return-model gate
   pass; otherwise close the experiment without UI promotion.
4. **V7.5 decision memo:** composition of promoted evidence, with no new hidden
   score.

Each PR remains independently removable. No later version is required for the
current dossier to remain useful.

# Trade edge advantage roadmap

**Status:** V7.8 implemented; later stages are advancement-gated proposals.

RosterLab is trying to improve a rebuilding roster's long-term, risk-adjusted
market value. A favorable calculator result is not itself an edge. A repeatable
trade win must come from at least one observable mechanism:

1. **Acquisition discount:** the other manager values what leaves our roster
   more than the market does, while we receive more current market value.
2. **Repricing:** the incoming asset has supported upside that is not yet fully
   reflected in the price.
3. **Decay avoided:** we move out of an asset with worse age, role, downside, or
   liquidity exposure before the market recognizes the loss.
4. **Liquidity captured:** we exchange fragile or hard-to-package inventory for
   a player or pick that can fund a later trade.
5. **Utility spread:** the other manager gets more lineup or strategic utility
   from the package than it costs our portfolio, allowing both sides to agree
   while we capture more long-term value.

The product must show which mechanism supports a proposal. It must not label a
trade a fleece merely because one composite sum is larger.

## Edge ledger

| Version | Advantage | Action it enables | How value can be captured | Failure guard | Advancement gate |
|---|---|---|---|---|---|
| V7.8 | Selection discipline | Reduce the league to a small actionable trade book | Stops low-value, waiver-cliff, illiquid, or horizon-mismatched targets from consuming inventory and negotiation capital | Named thesis must clear every visible league-relative gate; no weighted score | Implemented and tested; live candidates must remain explainable and materially useful |
| V7.9 | Counterparty utility | Analyze the seller's complete roster and build ambitious, target, and walk-away packages | Offer assets the seller needs more than we do, capturing the difference between their utility and our portfolio cost | No acceptance probability; completed trades are context with sample size, not mind reading | Offline replay must show that owner/roster context changes package ordering for defensible reasons |
| V8.0 | Private decision learning | Save offers, rejections, counters, thesis, price, and exit plan | Creates private labels that public calculators and Sleeper's completed ledger do not contain | Preserve the original snapshot; never rewrite a failed thesis after the outcome | Enough decisions exist to compare proposed versus accepted prices without leakage |
| V8.1 | Catalyst timing | Attach dated news events to a pre-existing target thesis | Buy before a supported rerating or exit before a supported decay event is fully priced | News remains advisory until a chronological event study beats the non-news model | Incremental held-out return or timing lift with calibrated false-positive rate |
| V8.2 | Pick opportunity cost | Compare a pick package with the actual prospect distribution plausibly available there | Exploit broad “bad class” narratives when a pick still preserves valuable options, or avoid overpaying when the slot truly lacks depth | Current-rookie and future-class models remain separate; blocked slots stay ranges | Exact-slot or declared-basket backtest passes under point-in-time availability assumptions |

## V7.8 actionable trade book

V7.8 uses the existing current league state and the promoted 30-day asset-return
artifact. It introduces no collector, background process, database, or new
model. It evaluates one concrete package for every priced opponent target; the
older truncated Pareto list is not its input filter. Thresholds come from the
current league population or the candidate package population and are displayed
in the UI.

The three books are:

- **Long-term compounder:** starter-level current value, age that fits the
  declared horizon relative to meaningful peers at the position, above-median
  covered liquidity, no-worse-than-median tracked drawdown, a verified current
  role, non-negative promoted 30-day package carry, and package downside no
  worse than the full candidate median.
- **Catalyst flip:** a promoted 30-day row, package P&L at least as large as the
  median positive candidate, downside no worse than the candidate median,
  above-median liquidity, a verified role, and no veteran-decay exception. The
  intended holding period is 30–90 days.
- **Liquidity conversion:** a reusable pick or above-median liquid player,
  material inventory value, improved portfolio liquidity or draft capital,
  non-negative current-market net, simpler inventory, and horizon-compatible
  age for a player. A player conversion must also have non-negative promoted
  carry and package downside no worse than the full candidate median; picks do
  not inherit a player-return requirement.

Each surfaced record contains the candidate package, current market net,
promoted return P&L, tracked downside, age at the declared horizon, holding
period, exit condition, and every gate that admitted it. An empty book is a
valid instruction to hold.

## Why this can produce a trade win

V7.8 does not create a seller or prove acceptance. It improves the first and
most expensive decision: where to spend attention. A trade can only become a
repeatable win when the target has enough value and liquidity to matter, the
incoming risk fits the rebuild, and there is a pre-declared reason the asset
should be worth more to us later.

V7.9 then supplies the execution edge. It should inspect the counterparty's
lineup, surplus, shortages, timeline, pick inventory, and completed-trade
preferences. The opening offer can be ambitious because it is built from the
seller's utility, while the walk-away price remains anchored to our portfolio
cost and next-best target. Three-way trades are justified only when a third
roster converts our inventory into something the seller explicitly values.

V8.0 makes those negotiations proprietary data. V8.1 tests whether news
improves timing beyond the existing thesis. V8.2 protects the opportunity cost
of the many 2026 picks and uncertain later classes. These layers stay separate
so a strong headline, a friendly owner label, or an exciting rookie cannot hide
a bad price.

## Complexity decision

| Concern | Classification | Decision |
|---|---|---|
| Separate selection, utility, timing, and outcome evidence | Essential | Keep the lanes explicit because they answer different trade questions |
| Sleeper, Tradyr, and FantasyCalc identity and scale differences | Imported | Keep behind existing adapters and preserve provenance |
| A new background service for V7.8 | Accidental | Do not add one; all required inputs already load with the site |
| V7.8 league-relative actionability policy | Transitional | Keep it inspectable and reversible; reassess after real decision-journal outcomes exist |
| Manager acceptance and long-term return estimates | Unknown | Do not manufacture them; run V7.9 and V8.0 bounded experiments first |

## Scope ladder

- **Now:** use V7.8 to reject unserious trades and identify at most five
  supported targets. Gate: the live book produces understandable candidates or
  an honest hold state.
- **Next:** build V7.9 counterparty utility and package negotiation. Gate:
  complete-roster context changes real package choices without fake acceptance
  confidence.
- **Later:** add the decision journal, then evaluate news and rookie opportunity
  cost independently. Gate: each signal demonstrates incremental chronological
  value before it changes recommendations.
- **Not until validated:** autonomous offers, background negotiation, synthetic
  acceptance odds, hidden blended grades, or guaranteed-profit language.

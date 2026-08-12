# Trade evaluation protocol

This is the shared operating contract for humans, agents, and the Trade Lab.
It prevents a real data collection run from being mistaken for a trained or
validated decision signal.

## Evidence lanes

Evaluate every proposed trade through separate lanes:

| Lane | Question | May affect a recommendation when |
| --- | --- | --- |
| Current market | What can each asset be exchanged for now? | The attributed market snapshot is current and format-matched. |
| Covered production | What lineup points are supported by the held-out forecast? | The production model is enabled and required starters are covered. |
| Exchange premium | What premium has the market paid for this package structure? | The exchange model passes all gates and this trade matches its eligible structure. |
| Future outcome | Did similar premium decisions preserve value after 90/180/365 days? | That exact horizon and challenger pass every chronological holdout gate. |

Do not combine the lanes into a hidden grade. The user may weight promoted
signals, and uncovered weight must remain visible rather than being silently
redistributed.

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
- for negotiation, an ambitious opening offer, a fair target, and a hard
  walk-away price based on declared evidence.

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
3. The offline trainer imports the export, hydrates point-in-time player and
   pick values through the existing cached history collector, and records the
   exact dataset IDs and coverage in the generated artifact.
4. Training uses chronological holdouts. Raw price, exchange premium,
   structure-only future outcome, premium-aware future outcome, and lineup
   outcome remain separate comparisons.
5. The browser enables a historical signal only when its existing gates pass.
   No manual weight or UI control may bypass `enabled: false`.

The first two steps exist in the hosted product. The import/manifest bridge is
the next offline training change; until that lands, the UI must say that the
hosted tape is not connected to the shipped artifact.

## Claims the data cannot support

Completed trades do not expose rejected offers, private negotiation, manager
intent, or calibrated acceptance probability. Current roster context is not a
historical roster snapshot. A market premium is an observed exchange price, not
proof of profit. A 90-day label cannot stand in for a 180- or 365-day outcome.

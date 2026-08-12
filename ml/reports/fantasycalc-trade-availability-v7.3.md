# FantasyCalc completed-trade availability audit (V7.3)

Audited: `2026-08-12T04:43:10.189019Z`

- Probe anchor: **Aaron Rodgers** (`715`)
- Base response: **50 rows**, 2026-08-08 to 2026-08-11
- `page=2` identical: **True**
- `offset=100` identical: **True**
- Local deduplicated tape: **1674 trades** across **30 days**

## Decision

The observed endpoint returned the same capped rows for base, page=2, and offset=100. No older-page contract is proven; keep incremental cached collection for exchange-price research and use the separate daily asset histories for return/risk modeling.

This is a bounded observed-contract audit. It does not claim that an undocumented or future provider route cannot exist.

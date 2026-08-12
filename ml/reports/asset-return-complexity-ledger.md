# Asset return research complexity ledger

## Decision

V7.3–V7.4 stay inside the existing offline-artifact architecture. There is no
new service, queue, cron, database table, or online inference path.

## Complexity classification

| Concern | Class | Decision |
| --- | --- | --- |
| Point-in-time market return | Essential | Train separately from current price and production. |
| 30/90/180/365-day horizons | Essential | Validate and promote each horizon independently. |
| FantasyCalc’s 50-row trade response | Imported | Audit the observed public contract; do not invent pagination. |
| Current plus trade-observed history population | Imported | State the survivor/disappearance boundary; do not call the interval complete failure risk. |
| Chronological embargo and later holdout | Essential | No training label may cross the held-out prediction anchor. |
| Linear and one bounded nonlinear challenger | Transitional | Keep only because calibration selects before the final holdout; remove a challenger if it adds no out-of-time value. |
| Browser-side model inference | Accidental | Do not add it. Export current forecasts from the reviewed offline run. |
| Continuous cloud collection | Accidental today | Daily histories already provide 407 observations; refresh manually when a new reviewed artifact is needed. |

## Advancement gates

An asset-return horizon may influence a trade only when it passes sample,
asset, weekly-anchor, embargoed holdout, training-span, MAE, cross-sectional
rank, and interval-calibration gates in the exact QB format. The source’s
population boundary remains visible even after promotion.

Passing 30 days does not promote 90, 180, or 365 days. A tracked-asset return
interval is not a complete probability of retirement, injury, disappearance,
or manager acceptance.

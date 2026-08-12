# Asset return model health

Generated: `2026-08-12T04:45:20.778809Z`
History dataset: `sha256:fe6d86bc9d4f1d22f385da89d59bf435c3cb52d16be78914b27a23b46279e6d3`

This model forecasts later FantasyCalc market-value return. It does not overwrite current price, predict manager acceptance, or turn a tracked-asset interval into complete failure risk.

## Historical source audit

- 1qb: 485 series, 406-day median span, 1.0-day median gap, 100.0% current-catalog coverage.
- 2qb: 485 series, 406-day median span, 1.0-day median gap, 100.0% current-catalog coverage.

## Chronological horizon models

- 1qb 30d: **validated**, 22070 rows / 2297 embargoed holdout; MAE lift 7.6%; cross-sectional rank 0.182.
- 1qb 90d: **shadow**, 17842 rows / 2240 embargoed holdout; MAE lift -14.5%; cross-sectional rank -0.076.
- 1qb 180d: **needs-data**, 12539 rows / 1330 embargoed holdout; MAE lift -15.7%; cross-sectional rank 0.008.
- 1qb 365d: **needs-data**, 838 rows / 421 embargoed holdout; MAE lift 0.0%; cross-sectional rank 0.000.
- 2qb 30d: **validated**, 22067 rows / 2297 embargoed holdout; MAE lift 7.4%; cross-sectional rank 0.154.
- 2qb 90d: **shadow**, 17832 rows / 2240 embargoed holdout; MAE lift -14.6%; cross-sectional rank -0.100.
- 2qb 180d: **needs-data**, 12527 rows / 1330 embargoed holdout; MAE lift -15.9%; cross-sectional rank -0.019.
- 2qb 365d: **needs-data**, 838 rows / 421 embargoed holdout; MAE lift 0.0%; cross-sectional rank 0.000.

## Population boundary

Current FantasyCalc catalog plus assets observed in the locally collected completed-trade tape.

The source does not provide a versioned full historical catalog. Failure/disappearance risk is therefore not complete and is never folded into a false confidence score.

Sources: https://fantasycalc.com/frequently-asked-questions, https://fantasycalc.com/terms-of-usage

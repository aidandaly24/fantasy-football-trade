# Trade model health

Generated: `2026-08-12T04:16:18.582481Z`

Training dataset: `sha256:49ee4d82f6ec22936aba2bdebbfaaf1705c5a020e8f2aa9cf03e9352a3a54368`
Point-in-time coverage: **1583/1674 trades**

The raw provider total remains unchanged. These models are separate evidence layers.

## Exchange-premium model

- Status: **needs-data**
- Eligible completed trades: **436**
- Unique source leagues: **427**
- Date span: **28 days**
- Median observed premium: **0.16465041832319582**

## Outcome challengers

- 90d: **needs-data**, 0 labels; premium-aware lift vs structure-only 0.0%
- 180d: **needs-data**, 0 labels; premium-aware lift vs structure-only 0.0%
- 365d: **needs-data**, 0 labels; premium-aware lift vs structure-only 0.0%

## Known boundary

FantasyCalc exposes completed packages, format fields, ages and point-in-time market values, but not the full historical rosters needed to measure lineup outcomes. The lineup target still needs league-local snapshots and cannot be substituted with market return.

Sources: https://fantasycalc.com/frequently-asked-questions, https://fantasycalc.com/terms-of-usage

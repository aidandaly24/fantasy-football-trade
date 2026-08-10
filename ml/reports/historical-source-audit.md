# Historical source audit

Generated: `2026-08-10T22:34:36.428270Z`

## Decision: BLOCKED FROM TRAINING

This audit is isolated from live rankings and recommendations.

## Evidence summary

| Source | Role | Pilot ready | Training ready | Key evidence |
|---|---|---:|---:|---|
| FantasyCalc | Primary market labels | True | False | 50/50 players; 17856 observations; 858 30-day labels |
| Tradyr | Market comparator | False | False | 6/50 players; 365 observations |
| nflverse | Structured events | False | False | 52524 roster rows; 14372 detected transitions |
| GDELT | Article discovery pilot | False | False | 140 metadata records; manual precision unresolved |

## Blocking gates

- **fantasycalc / survivorBias**: requires historical universe includes delisted players; observed `current catalog only`.
- **fantasycalc / historicalFormat**: requires TEP/PPR/team-count history or validated source-relative normalization; observed `dynasty + superflex only`.
- **nflverse / rosterIdentity**: requires >= 95%; observed `0.8936170212765957`.
- **nflverse / pointInTime**: requires source publication timestamp; observed `weekly/report granularity`.
- **gdelt / entityPrecision**: requires >= 95%; observed `not reviewed`.
- **gdelt / publicationTime**: requires original publication time validated; observed `GDELT seen date`.
- **gdelt / contentRights**: requires licensed text or structured facts; observed `article URLs and titles only`.

## Next bounded experiment

Validate FantasyCalc source-relative returns against TEP+ daily snapshots and overlapping Tradyr players, reconstruct a delisted-player universe, and manually label the GDELT review sample.

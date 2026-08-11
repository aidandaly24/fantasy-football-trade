# Future rookie evidence tape V6.4

Generated: `2026-08-11T15:54:34.666548Z`

**Phase decision: PASS.** Training enabled: `false`; downstream enabled: `false`.

The historical tape passed its construction gates; model selection remains V6.5 work.

## Gates

| Gate | Status | Detail |
| --- | --- | --- |
| pinned-source-provenance | PASS | Every source file has a pinned revision, URL, and SHA-256 digest. |
| six-completed-classes | PASS | Draft years 2020-2025 are present for later rolling evaluation. |
| same-horizon-no-leakage | PASS | 0 rows use production after their declared cutoff. |
| identity-recovery | PASS | Each completed class recovers at least 85% of known entrants. |
| coverage-slices-reported | PASS | QB, RB, WR, and TE candidate and production coverage is reported per class. |
| non-entrants-retained | PASS | Completed classes retain both entrants and players who did not enter that target class. |

## Historical class coverage

| Draft | Candidates | Plausible | Identity recovery | Prior production | Entrants | Did not enter | Leakage |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2019 | 4957 | 4882 | 77.2% | 45.9% | 152 | 4730 | 0 |
| 2020 | 5685 | 5228 | 95.2% | 44.5% | 157 | 5071 | 0 |
| 2021 | 5235 | 4574 | 86.0% | 45.3% | 98 | 4476 | 0 |
| 2022 | 5701 | 5106 | 88.9% | 49.7% | 120 | 4986 | 0 |
| 2023 | 9415 | 7219 | 94.6% | 39.4% | 141 | 7078 | 0 |
| 2024 | 7068 | 5286 | 90.5% | 60.8% | 134 | 5152 | 0 |
| 2025 | 6693 | 4892 | 96.4% | 61.6% | 162 | 4730 | 0 |
| 2026 | 9032 | 5649 | 97.8% | 63.7% | 131 | 5518 | 0 |

## Point-in-time contract

- Candidate population: All rostered QB/RB/WR/TE players; plausible eligibility is roster year 2+ or unknown.
- Snapshot: August 10 of the season before the target NFL draft year.
- Feature cutoff: College seasons through target draft year minus two only.
- Excluded features: final college season, NFL combine, NFL draft capital, post-snapshot dynasty market values, future NFL production.

## Current class

The 2027 class is **blocked**: No version-pinned 2026 roster snapshot is available in the selected public archive.

## Limitations

- Roster files are retrospective season records, not untouched August snapshots.
- Roster year is an eligibility proxy and cannot resolve every redshirt or age case.
- A missing target-class identity means did not enter that class, not permanent failure.
- Prior production is missing for some candidates and is retained as explicit missingness.
- Recruiting identifiers are audited but not used as a feature because coverage is inadequate.

## Next experiment

V6.5 may compare small same-horizon baselines with rolling class holdouts only after review.

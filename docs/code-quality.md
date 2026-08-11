# Code quality

## Quality standard

RosterLab should make a small number of claims that can be reproduced. A
feature is not complete merely because the UI renders; its source, target,
uncertainty, failure behavior, and decision boundary must be clear.

These rules apply to human and agent-authored changes.

## Non-negotiable product rules

### Use real evidence

- Do not hard-code player recommendations, class strength, projected profit,
  acceptance probability, or confidence to make a feature look complete.
- A constant is acceptable only when it represents a declared domain rule,
  bounded algorithm limit, or tested operational threshold. Name and explain it.
- Preserve source attribution, retrieval time, model version, and missingness.
- Label retrospective backfills as retrospective; never present current prices
  as the price that existed when an old trade happened.

### Keep targets separate

Do not collapse these into a single opaque grade:

- current dynasty market value;
- next-season or rookie-season production;
- projected starting-lineup change;
- news/catalyst evidence;
- future market return;
- manager preference or package fit;
- trade outcome measured later.

A UI may summarize multiple components, but each component's meaning and
validation status must remain inspectable.

### Preserve uncertainty

- Use ranges or distributions when the underlying estimate is uncertain.
- Do not call an empirical residual band a probability interval unless it has
  measured probability coverage.
- Block the answer when a required identity, source, or league rule is unknown.
- Avoid decimal precision unsupported by the data shown to the user.

## TypeScript design

- Keep strict TypeScript enabled.
- Put shared contracts in `src/types.ts` or a focused domain module.
- Prefer pure functions for rankings, trade evaluation, classification,
  package comparison, and normalization.
- Keep I/O in `src/api.ts`, Worker route handlers, and store/adapters.
- Give domain concepts stable IDs. Player names are display fields, not primary
  identity when a provider ID exists.
- Use deterministic ordering with an explicit final ID/name tie-breaker.
- Bound combinatorial searches and external response sizes.
- Do not duplicate a calculation in JSX merely to format it differently.

`src/App.tsx` is the shared league-loading and view-composition surface. Keep
tab-local state and presentation in `src/views/`; only move state upward when
two views genuinely coordinate through it. Shared visual helpers belong in
`src/components/`, not duplicated inside view modules.

## Worker and API quality

- Validate path/query/body inputs at the boundary.
- Return explicit method errors and `Allow` headers.
- Require same-origin checks for writes.
- Require `authenticatedUser` for user-private reads and all persisted user
  data. A new private endpoint must use `privateJson`.
- Treat upstream timeouts, partial coverage, and schema changes as normal
  failure modes. Preserve prior good evidence and report freshness.
- Do not convert request failures to an indistinguishable empty successful
  result when completeness matters.
- Cache only according to the privacy and freshness needs of the data.
- Never log or commit authentication headers, credentials, private messages, or
  raw user identifiers beyond the IDs required by the data model.

Durable journal/research ingestion is the only supported historical transaction
path. It tracks coverage and failures explicitly; new historical features must
use that path rather than adding browser-side history fetches that can mistake a
failed week for an empty ledger.

## D1 and migrations

For schema changes:

1. Update `db/schema.ts`.
2. Generate and inspect the ordered Drizzle migration.
3. Update any defensive runtime schema in the owning `worker/*-store.ts`.
4. Add normalization and persistence tests.
5. Verify old rows and missing fields have an explicit compatibility path.
6. Run the production build and inspect the copied migration bundle.

Do not create a new table when a versioned JSON field or existing bounded table
preserves the same current requirement more clearly. Do not put unrelated
capabilities into one generic event/blob table merely to avoid modeling them.

## Python and model quality

- Every training feature must be available at or before the prediction anchor.
- Retain failed, unranked, injured, and delisted examples when they are part of
  the target population.
- Split by time or class; never use a random split for a temporal claim.
- Declare the target and baseline before promotion evaluation.
- Report every held-out period, sample size, missingness, and failure slice.
- Keep raw downloads and fitted binaries ignored; commit reproducible aggregate
  reports and only browser-safe artifacts.
- Seed stochastic estimators and test deterministic ordering.
- Separate research/shadow outputs from enabled application inputs.
- Do not tune a decision rule on the same held-out classes used to claim final
  performance without documenting the selection effect.

## Tests

Minimum validation depends on the changed surface:

| Change | Required validation |
|---|---|
| Pure TypeScript domain logic | Focused Vitest tests plus `npm test` |
| Worker route/store | Boundary and persistence tests plus `npm test` |
| React view | Domain/component tests where practical, `npm test`, and build |
| Python data/model pipeline | Focused unittest coverage plus `npm run ml:test` |
| D1 schema | Store tests, migration inspection, full build |
| Generated browser artifact | Schema/content test and full build |
| Documentation only | Link/path review and full build when architecture/build files are described |

Run the complete baseline before a normal PR:

```bash
npm test
npm run ml:test
npm run build
```

If a command is irrelevant or unavailable, state why in the PR. Never claim a
test passed without its actual result.

## Pull-request quality gate

Every PR should answer:

1. What user outcome changes?
2. Which source or invariant supports the change?
3. What is explicitly out of scope?
4. Which files and domain boundaries are affected?
5. What could fail or become stale?
6. Which tests and build ran?
7. Does it alter data collection, privacy, a model target, a recommendation, a
   schema, or deployment behavior?
8. What evidence would cause the feature to be removed, blocked, or promoted?

All project changes use feature branches and GitHub pull requests. Never push
directly to `main`; do not merge unless the user explicitly asks.

## Known quality risks

These are existing constraints to improve deliberately, not excuses for broad
unrelated rewrites:

- `src/types.ts` is still a broad shared contract surface; split domains only as
  related changes touch them rather than creating a mass import rewrite.
- Drizzle schema and runtime `CREATE TABLE` statements remain duplicated, though
  the parity test now blocks silent table-level drift.
- Some live public reads occur directly in the browser while durable research
  uses Worker ingestion; callers must understand which path is complete.
- Historical market-return labels are incomplete and remain blocked.
- The production rookie model has retrospective rolling evidence but still
  needs prospective tracking.
- Live intel remains advisory even though its route is identity-gated; signed-in
  access does not make unvalidated reports suitable for automatic repricing.

Address one risk only when it is in the PR's scope and the replacement has a
clear verification path.

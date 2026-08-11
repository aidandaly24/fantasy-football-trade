# Development workflow

## Repository and coordination layout

The Git repository is the nested project directory:

```text
fantasy-football/
├── info-transfer-docs/       task-specific agent handoffs; not uploaded
└── fantasy-football-trade/   this Git repository
    └── docs/                 durable shared documentation
```

Agent handoffs are temporary coordination context. Repository docs describe the
system and its durable engineering rules. Do not copy handoff plans into
`docs/`.

## Local setup

From `fantasy-football-trade/`:

```bash
npm install
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r ml/requirements.txt
npm run dev
```

Use the package manager and lockfile already present. Do not replace the Vite,
React, Cloudflare Worker, or Sites structure in order to introduce a different
starter or framework.

## Branch and pull-request policy

Every change uses a pull request. Direct pushes to `main` are prohibited by
project policy even if GitHub permissions technically allow them.

Start work with:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <type>/<short-task-name>
```

Recommended prefixes are `feature/`, `fix/`, `docs/`, `model/`, and
`refactor/`. Keep one coherent outcome per branch.

Before opening the PR:

```bash
git fetch origin
git status --short
npm test
npm run ml:test
npm run build
```

Bring in current `origin/main` without force-pushing over another agent's work.
Resolve conflicts by preserving both accepted outcomes and rerun validation.
Push the branch and open a PR. Do not merge it unless the user explicitly asks.

Every pull request also runs the repository's `Verify` GitHub Actions workflow.
It installs from the committed lockfile, creates the same `.venv` expected by
the package scripts, runs both test suites, and builds the production bundle.
Once the workflow has passed on `main`, configure branch protection to require
the `verify` job before merge. Local validation remains required so a failing
PR does not use CI as its first feedback loop.

## Concurrent-agent rules

- Read the assigned handoff and this `docs/` folder before editing.
- State the branch and owned files at the start of work.
- Avoid broad formatting or renaming in shared hotspots.
- Treat `src/types.ts`, `src/api.ts`, `src/views/EdgeView.tsx`, `db/schema.ts`,
  `package.json`, and the lockfile as conflict-prone surfaces. `src/App.tsx` and
  `worker/index.ts` are shared orchestration files, so integrations there should
  remain small.
- Prefer adding a focused module and making a small integration patch.
- Never discard an unfamiliar working-tree change. Confirm ownership or work
  around it.
- Do not amend, rebase, reset, force-push, merge, or delete another agent's
  branch without explicit coordination.
- Each PR must list its data/model/privacy effects and what remains out of scope.

For independent simultaneous work, use separate branches and preferably
separate Git worktrees or isolated checkout directories. Multiple agents
editing one physical working tree cannot safely hold different branches at the
same time.

## Validation commands

| Command | Purpose |
|---|---|
| `npm test` | Runs TypeScript domain, Worker-store, and research tests |
| `npm run ml:test` | Runs offline Python pipeline and model tests |
| `npm run build` | Type-checks and builds the client/Worker Sites bundle |
| `npm run ml:refresh` | Refreshes the veteran production pipeline and artifacts |
| `npm run ml:rookies` | Refreshes rookie sources, backtests, and reports |
| `npm run ml:rookies:offline` | Reproduces the rookie report from local caches |
| `npm run ml:future-rookies` | Refreshes the V6.4 same-horizon future-rookie evidence tape |
| `npm run ml:future-rookies:offline` | Reproduces the V6.4 evidence report from pinned local caches |
| `npm run ml:audit-sources` | Refreshes the historical return-source audit |

Run focused tests during development, then the full relevant suite before the
PR. Record exact results in the PR description.

## Generated data and large files

Do not commit:

- `node_modules/`, `.venv/`, `dist/`, or `.wrangler/`;
- raw provider downloads;
- normalized private research tape;
- fitted model binaries;
- credentials, `.dev.vars`, or authentication headers;
- screenshots or raw private league messages unless explicitly approved and
  sanitized.

Commit aggregate reports and browser-safe artifacts only when they are
reproducible and necessary for the application or review. Generated artifacts
must include a model/source version and timestamp.

## Schema workflow

When D1 changes:

1. update `db/schema.ts`;
2. generate a numbered migration with the existing Drizzle configuration;
3. inspect the SQL rather than accepting it blindly;
4. update the owning Worker's defensive runtime schema;
5. add store and compatibility tests;
6. confirm the migration is present under `dist/.openai/drizzle` after build.

Do not edit already-deployed migrations. Add a new ordered migration.

`db/schema-parity.test.ts` is the current convergence guard. It requires every
live defensive runtime table to exist in Drizzle and every Drizzle table to
exist in the ordered migration history. `season_users` and
`edge_opportunity_snapshots` are explicit migration-only legacy tables; their
live identity and unvalidated-projection paths have been replaced or removed.
Removing runtime table creation entirely remains gated on a clean-database and
existing-database Sites migration rehearsal.

## Site validation and deployment

The project is an existing Sites application. Preserve `.openai/hosting.json`,
the D1 binding, Vite configuration, and Worker-compatible ESM build.

A successful build is not a deployment. Feature agents should open a PR and
stop. Publishing, production migrations, and PR merging require explicit user
direction and should happen from accepted code, not an unreviewed feature
branch.

Browser testing is performed only when the task requests it. Use the user's
signed-in browser state when authentication is necessary, and never claim a UI
change is shipped based solely on a local observation.

## Commit and PR content

Use a concise imperative commit subject. The PR should contain:

- outcome and rationale;
- scope and explicit exclusions;
- architecture/data/model/privacy effects;
- tests and build results;
- screenshots only when UI review requires them;
- follow-up work that is deliberately deferred.

Repository docs changed by a behavior change should be updated in the same PR.

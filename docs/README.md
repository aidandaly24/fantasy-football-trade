# RosterLab documentation

This folder contains durable documentation for the codebase. It describes the
system that exists, the invariants new work must preserve, and the workflow for
changing it safely.

## Start here

- [Architecture](architecture.md) — runtime boundaries, data flow, modules,
  persistence, integrations, and deployment shape.
- [Code quality](code-quality.md) — engineering invariants, known risks, test
  expectations, and review standards.
- [Data and models](data-and-models.md) — source provenance, model boundaries,
  leakage controls, promotion gates, and generated artifacts.
- [Development workflow](development-workflow.md) — local setup, branch and PR
  policy, migrations, validation, and agent coordination.

## Documentation boundary

Repository documentation must remain useful across individual tasks and agents.
Task-specific context, implementation handoffs, and agent assignments do not
belong here; they live outside the repository in the parent workspace's
`info-transfer-docs/` folder.

The code and generated evidence reports are the final source of truth. If a
document disagrees with current behavior, update the document in the same pull
request that changes the behavior.

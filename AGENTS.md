# RosterLab agent instructions

These instructions apply to the entire repository.

Before evaluating a trade or changing trade logic, read:

1. `docs/trade-evaluation-protocol.md`
2. `docs/trade-models.md`
3. `docs/data-and-models.md`

Keep these evidence lanes separate: current market price, covered production,
accepted exchange premium, and future market/lineup outcome. Collected data is
not automatically historically valued, trained, validated, or active.

Trade recommendations must state which lanes are active, the evidence date and
coverage, the user's declared competitive horizon, age/decay and liquidity
risks, and an opening/target/walk-away price when negotiation is requested.
Never infer acceptance probability from completed trades. Never let an
unvalidated model alter a trade verdict, package, target list, or displayed
market value.

Use a task-specific branch and pull request. Run the relevant TypeScript,
Python, and production-build checks. Preserve private/authenticated boundaries,
generated-artifact provenance, and existing model promotion gates.

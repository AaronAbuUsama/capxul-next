# @capxul/blueprint-engine

The engine of the blueprint. The blueprint itself is the records in `blueprint/`; this package defines what a record
is, builds the blueprint from them and reports every problem. (It was `packages/book` until 10 November 2026; the
content and the engine no longer share a name.)

```bash
pnpm blueprint        # node packages/blueprint-engine/src/main.ts blueprint/index.ts var/blueprint  → must print 0 problems
pnpm --filter @capxul/blueprint-engine test
```

- `src/records/`: the record types (`defineOperation`, `defineDecision`, …) that `blueprint/` is written with.
- `src/build.ts`: reads every record, links them and collects problems.
- `src/evals.ts`, `status.ts`, `stand.ts`: the evals a record derives, the scoreboard format, where each record stands.
- `src/impact.ts`, `views.ts`, `examples.ts`, `telemetry.ts`, `budgets.ts`: what the portal and the checks read.

Written by: the coordinator, when the blueprint needs a new kind of record or check. Read by: `packages/portal`,
`packages/evals`, `packages/plan`. How it is used end to end: `docs/blueprint.md`.

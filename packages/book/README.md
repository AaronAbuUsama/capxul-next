# @capxul/book

The engine of the blueprint. The blueprint itself is the records (today in `books/`); this package defines what a
record is, builds the blueprint from them and reports every problem. Plan task `m1-rename-blueprint` renames this
package to `blueprint-engine`, so the content and the engine no longer share a name.

```bash
pnpm book        # node packages/book/src/main.ts books/target/index.ts /tmp/target  → must print 0 problems
pnpm --filter @capxul/book test
```

- `src/records/`: the record types (`defineOperation`, `defineDecision`, …) that `books/` is written with.
- `src/build.ts`: reads every record, links them and collects problems.
- `src/evals.ts`, `status.ts`, `stand.ts`: the evals a record derives, the scoreboard format, where each record stands.
- `src/impact.ts`, `views.ts`, `examples.ts`, `telemetry.ts`, `budgets.ts`: what the portal and the checks read.

Written by: the coordinator, when the blueprint needs a new kind of record or check. Read by: `packages/portal`,
`packages/evals`, the scripts in `tools/`. How it is used end to end: `docs/design-book.md`.

# books: the blueprint

The blueprint is the design of Capxul, as typed records. (It was called "the design book" until 10 November 2026;
plan task `m1-rename-blueprint` renames this directory to `blueprint/`, with `frozen/` becoming `blueprint/baseline/`.)
This is content, not a package: the engine in `packages/book` reads it, checks it and builds it (`pnpm book`), and
the portal is generated from the result.

- `target/` is what is being built: one folder per concept, plus `shared/` (decisions, rulings, the cut). Written by
  the coordinator and by lanes, always before the code it describes (`CLAUDE.md`, "The book changes first").
- `frozen/` is the baseline: the old system's 215 operations and their flags. It is the fixed reference for behaviour
  and is **never edited**; `pnpm frozen` proves every one of them is kept or classified.
- `tsconfig.json` typechecks both: `pnpm exec tsc -p books`.

Read by: the engine, `packages/portal`, `packages/evals`, the plan, and every check. How records work:
`docs/design-book.md`.

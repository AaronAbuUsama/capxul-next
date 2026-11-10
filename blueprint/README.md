# blueprint

The blueprint is the design of Capxul, as typed records. This is content, not a package: the engine in
`packages/blueprint-engine` reads it, checks it and builds it (`pnpm blueprint`), and the portal is generated from the
result. Until 10 November 2026 it was called "the design book" or "the book" and lived in `books/target`; records and
documents written before then still use that word (ruling `aaron.blueprint`).

- One folder per concept (`payments/`, `books/`, `contacts/`, …), plus `shared/` (decisions, rulings, the cut) and
  `index.ts`, which lists every record. Written by the coordinator and by lanes, always before the code it describes
  (`CLAUDE.md`, "The blueprint changes first"). `CONVENTIONS.md` has the rules for writing a record.
- `baseline/` is the old system's 215 operations and their flags (it was `books/frozen`). It is the fixed reference
  for behaviour and is **never edited**; `pnpm frozen` proves every one of them is kept or classified.
- `tsconfig.json` typechecks both: `pnpm exec tsc -p blueprint`.

Read by: the engine, `packages/portal`, `packages/evals`, `packages/plan`, and every check. How records work:
`docs/blueprint.md`.

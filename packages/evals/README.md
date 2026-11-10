# @capxul/evals

The runner that turns the book's evals into a score. `src/main.ts` is the composition root: it reads the binding files, the
book and the plan, starts the bound script for the behaviours its checks sit in, and writes `status/runs/<run>/` and, through
`tools/record-status.ts`, `status/status.json`. The modules hold the rules and no I/O.

```bash
pnpm evals -- all | <eval ids> | --journey <id> | --milestone <id>     # run
pnpm evals -- check | gaps | list
```

| Module | What it is |
|---|---|
| `src/modules/bindings` | which checks prove which evals; loading, selecting and the gap lists |
| `src/modules/runs` | a script's `@check` lines, the verdict of each eval, the results file and the evidence |

`docs/design-book.md`, "Evals run", has the rules: strict bindings, near-misses, the script contract, truthful states.

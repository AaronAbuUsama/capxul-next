# @capxul/evals

The runner that turns the blueprint's evals into a score. `src/main.ts` is the composition root: it reads the binding files, the
blueprint and the plan; `src/execute.ts` starts the bound scripts and writes `status/runs/<run>/` and, through
`packages/evals/src/record-status.ts`, `status/status.json`. The modules hold the rules and no I/O.

```bash
pnpm evals -- all | <eval ids> | --journey <id> | --milestone <id>     # run
pnpm evals -- check | gaps | list
```

| Module | What it is |
|---|---|
| `src/modules/bindings` | which checks prove which evals; loading, selecting and the gap lists |
| `src/modules/runs` | a script's `@check` lines, the verdict of each eval, the results file and the evidence |

`docs/blueprint.md`, "Evals run", has the rules: strict bindings, near-misses, the script contract, truthful states.

Each attempt saves `receipt.json` before execution and a same-run `status.json` snapshot. Only a complete receipt supplies
passes. Supply `--environment <json>` for non-skeleton runs; its world must match `--world`. The JSON skeleton is always
`{stack:"skeleton-json",storage:"json",indexer:"inline"}`, never selected-stack evidence. Children receive
`CAPXUL_EVAL_RUN_DIR`; a child may write `screens.json` there as an array of `{screen,path,source,assertion}`. Paths must be
existing run-relative files. `--screens <manifest>` imports an external manifest and its captures instead. For screen value
equality use `assertion:"source-equality"` and keep the source readback in the run too. The engine exports `parseRunReceipt`.

`--json` sends script/recorder logs to stderr and prints one JSON result on stdout:
`{version:1,run,runDir,state,passed,counts:{pass,fail,not_run},exitCode}`. `runDir` is repository-relative and contains
`receipt.json` and `status.json`. `passed` is true (exit 0) only for a complete, nonempty selection with every requested eval
passing; a complete run with unbound `not_run` evals exits 1. Validation failures before a run starts have no run directory
and print their diagnostic to stderr instead. With pnpm, use `pnpm --silent evals -- ... --json` to suppress pnpm's banner.

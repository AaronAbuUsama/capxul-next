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

`--prepare <argv-json-file>` optionally runs preparation inside the attempt, before binding scripts. The file contains a
nonempty JSON string array `[executable, ...literalArguments]`; it is validated before creating the run and executed
directly, with no shell expansion, from the repository root. Keep credentials out of argv. The running receipt and cleared
requested verdicts are saved first. Preparation inherits the caller's environment, including `CAPXUL_ACCEPTANCE_FIXTURE`,
and receives `CAPXUL_EVAL_RUN_DIR`. It may create the previously absent fixture at that inherited path.

The additive receipt field is `prepare:{argv,exitCode:null|number,signal:null|string,log:"prepare.log"}`. Its pending intent
exists before launch; exit/signal and the combined stdout/stderr log are saved before any binding script starts. A nonzero
exit, signal or spawn failure skips all binding scripts and makes the run incomplete. Preparation output is never scored
as check output. `prepare.log` uses the same secret redaction and 400,000-character cap as `run.log`; preparation must not
print credentials created after the runner reads its declared secret files. Existing receipts without `prepare` remain
valid. The `--json` result and `passed` rule are unchanged.

This hook only establishes timing and process completion. Concept checks still verify `journey.json`, the actual public
operations, independent persisted reads/native integrity and correlated events. A paid fixture or successful preparation
does not itself earn a journey/funnel pass.

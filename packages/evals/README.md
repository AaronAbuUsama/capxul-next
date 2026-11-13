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

Each attempt saves `receipt.json` before execution and a same-run `status.json` snapshot. Completed script plans retain
their assertion verdicts even in a finalized incomplete attempt; only a complete receipt can satisfy slice acceptance.
Supply `--environment <json>` for non-skeleton runs; its world must match `--world`. The JSON skeleton is always
`{stack:"skeleton-json",storage:"json",indexer:"inline"}`, never selected-stack evidence. Children receive
`CAPXUL_EVAL_RUN_DIR`; a child may write `screens.json` there, or its own `<module>/screens.json` one directory down, as an
array of `{screen,path,source,assertion}`. The runner collects all of them, so modules never overwrite each other's
captures; a path listed twice fails the run (`system.eval-screen-manifests`). Paths in every in-run manifest must be
existing run-relative files. `--screens <manifest>` imports an external manifest and its captures instead. For screen value
equality use `assertion:"source-equality"` and keep the source readback in the run too. The engine exports `parseRunReceipt`.

`--json` sends script/recorder logs to stderr and prints one JSON result on stdout:
`{version:1,run,runDir,state,passed,counts:{pass,fail,not_run},uncaptured,exitCode}`. `runDir` is repository-relative and contains
`receipt.json` and `status.json`. `passed` is true (exit 0) only for a complete, nonempty selection with every requested eval
passing and a source-equality capture in the receipt for every requested screen `/shows` claim; `uncaptured` lists the
requested `/shows` IDs without one (`system.eval-screen-captures`). Unbound requests make new attempts incomplete; completed assertion failures also exit 1. Validation failures before a run starts have no run directory
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

An asked binding whose script does not support `--world` is recorded, not refused before saving intent. Every requested
contract and planned script remains in the receipt. After receipt-first preparation, skip a whole plan if any requested
binding file for it excludes the world, or if it is the JSON skeleton against a non-skeleton environment. Never run that
script or expand binding worlds. Its exit/signal stay null, with the reason in `run.log` and per-eval evidence. Compatible
plans retain their completed assertions, but the attempt stays incomplete and exits 1; skipped requests are `not_run`.
Invalid argv/environment and a mismatched environment world still fail preflight (`system.eval-unsupported-worlds`).

New script receipts add `evals` (the bound requested IDs) and `completed` (initially false). A plan completes only with all
its requested checks reported, no malformed output or signal, and exit 0, or exit 1 with an explicit failed eval. Crashes,
missing checks and malformed output demote that plan's passes, not another completed plan's passes. Explicit failures and
raw evidence remain. Unexpected harness/evidence errors suppress passes. Complete means every requested eval was bound
and every plan completed, not that assertions passed. Historical receipts keep their existing rules and are never rescored
(`system.eval-reporting`).

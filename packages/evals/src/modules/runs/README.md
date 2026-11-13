# runs

What a script printed, what that says about each bound eval, and the files a run keeps.

```ts
const { lines } = parseCheckLines(output);                       // the @check<TAB>name<TAB>pass|fail<TAB>ms<TAB>detail lines
const scored = scoreEvals(askedEvalIds, bindings, foldChecks(lines));
const results = resultsFile(info, scored.rows, evidencePathOf);  // the file packages/evals/src/record-status.ts merges
```

The rules of truth are in `internal/checks.ts` and nowhere else:

| Case | Verdict |
|---|---|
| asked for, no check bound | `not_run`, never `pass` |
| every bound check ran and passed | `pass` |
| any bound check failed (a repeated check fails if any repeat failed) | `fail`, even if its other checks did not run |
| some bound check did not run and none failed | `not_run`; listed as unfinished, never an old pass |
| not asked for | untouched |

`src/execute.ts` records intent before any child runs, including each script's assigned `evals` and `completed:false`.
A plan completes when every bound requested check was reported without malformed lines or signals, with exit 0 or exit 1
and an explicit failed eval. Completed plans retain their verdicts even if another plan is skipped or interrupted. Other
exits, missing checks and malformed output demote that plan's passes to `not_run`; explicit failures and raw evidence
survive. Unexpected harness/evidence errors suppress passes. Whole-run completion requires every request bound and every
plan completed; success requires every requested eval pass. Slice acceptance still requires one fresh complete selected-stack
run, never partial reports unioned together. Requests, exits and same-run claim/observes survive even zero-output runs.

`redact` replaces secret values so evidence can be committed; `cap` cuts a long text in the middle. `types.ts` is the module,
`service.ts` its door. Nothing here reads a file, the clock or the process.

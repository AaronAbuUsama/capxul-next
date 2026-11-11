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
| some bound check did not run and none failed | no row: the eval stays as it was; listed as unfinished |
| not asked for | untouched |

`redact` replaces secret values so evidence can be committed; `cap` cuts a long text in the middle. `types.ts` is the module,
`service.ts` its door. Nothing here reads a file, the clock or the process.

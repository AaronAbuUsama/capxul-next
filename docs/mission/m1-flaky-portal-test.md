# Portal test investigation — m1-flaky-portal-test, round 1

## Evidence and cause

The concrete historical failure is recorded in
`docs/mission/m1-dev-commands-round-2.md`: the real-book portal test printed
75 pass, 1 fail at `assert.ok(expected.waiting.length > 0)` after the portal
check and page counts had passed. That is an invalid assumption about mutable
repository content, not evidence of incorrect generation. Accepting all owner
judgments legitimately makes the list empty; reopening a judgment or adding
an owner need makes it nonempty again.

Commit `c344e3a9ee5337a37d5a9be404490b600c87bc41` already removed that assertion.
This lane retains that correction and adds explicit fixture regression coverage
for an empty queue. It also proves that both omitted expected questions and
spurious questions still fail the checker. No assertion or eval was weakened.

There is no evidence that two agents writing the generated site caused this
failure: `main.test.ts` calls `generate`, which returns an in-memory Map. It does
not call the CLI's disk writer or read `packages/portal/dist`. The regression
interleaves nonempty and empty generations, then checks determinism and the
question lists independently. This is an isolation check, not a claim to have
reproduced simultaneous agents. The brief supplies no failing log; the historical
report above is the identifiable failure available in this checkout.

No blueprint record changed: this is test coverage of the existing Questions
list equality contract, not a change to portal behavior or architecture.

## Runs

- Before changes, `pnpm test`: portal 80 pass, 0 fail; the complete command passed.
- After changes, `pnpm exec tsc -p packages/blueprint-engine && pnpm test`:
  typecheck succeeded; test suites printed 48 + 81 + 3 + 11 + 20 + 40 + 17 + 7
  pass (227 total), 0 fail. Plan, tasks, bindings and layout checks passed.
- `pnpm exec tsc -p blueprint`: succeeded without output.
- `pnpm blueprint`: 2634 records, 5222 evals, 0 problems, 162 gaps.
  The lane's `var/blueprint/findings.json` has an empty problems array.
- `pnpm frozen`: 0 breaches.
- `pnpm contracts:check-blueprint`: 0 undeclared differences (10 allowed).
- `pnpm portal:check`: all nine checks passed; 6534 files.

The task names no eval ids; no scoreboard verdict was written. The task's
reviewer should distinguish this content-dependent failure (already corrected
upstream, now regression-tested) from any different failure for which a log
has not been supplied.

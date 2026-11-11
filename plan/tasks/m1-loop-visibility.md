## What
pnpm loop status, status --json and the run page show each run's refused commands and model failures. A run whose task is done, or that a later run of the same task replaced, is marked superseded and leaves the needs-you list.
## Why
Post-mortem 10 Nov, changes 5 and 6: the coordinator could not see 226 refusals and 100 model failures, and the Runs page listed 13 runs needing Aaron when none did
## Done when
- pnpm loop status shows refused and failed counts per run, and m1-gaps-contracts-11101507 shows 28 refused
- The Runs page lists as needing a person only runs whose task is not done
- pnpm loop:test passes

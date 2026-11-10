## What
Run one ready task alone (m1-gaps-unproduced-errors) with `LOOP_MAX_AGENTS=1 pnpm loop run m1-gaps-unproduced-errors`, with `pnpm loop watch` open beside it, open its conversation with pnpm loop show RUN --json --full, and record the counts.
## Why
Post-mortem 10 Nov, change 3: no batch until one run is measured
## Done when
- Under one refused call in twenty, no model failure, ready in one round
- The counts are in the task's evidence

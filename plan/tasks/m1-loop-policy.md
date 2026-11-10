## What
Change packages/loop/src/modules/agents/internal/policy.ts so a builder may run the repository's pnpm scripts and checks, read-only search (rg, find without -exec or -delete, sed -n), git inside its lane, node on a script inside its lane, and write under its lane's var/. Extract the 226 refused calls of 10 November from var/runs into a test fixture in packages/loop.
## Why
Post-mortem 10 Nov, change 2: one tool call in five (226 of 1,132) was refused by the loop's own policy; it blocks g2, g3 and every loop task
## Done when
- A test replays every refused call of 10 November and each one is allowed or refused with a stated reason
- pnpm loop:test passes

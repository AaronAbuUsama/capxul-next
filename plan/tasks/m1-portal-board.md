## What
The portal's Overview becomes the board, its front door, from real state only (plan/plan.json, the loop host's runs, git): Working now (each running run: its task, its agent, how long), Next (the critical path), Blocked (each blocked task and on what), Needs you (the Questions inbox), Done today (tasks done and merges since midnight UTC, with commits). It is rebuilt with the portal and its live parts (Working now) come from the host the way the Runs link does in packages/portal/assets/site.js, so it cannot go stale. Keep the climb cards below it. Touch packages/portal (site/internal/overview.ts, render/internal/overview.ts, assets/site.js) and its tests.
## Why
Aaron, 11 November: he needs to see what is being worked on.
## Done when
- The built Overview shows the five sections from the plan and the runs, with tests for each, and pnpm portal:check passes

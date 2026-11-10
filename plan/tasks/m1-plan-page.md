## What
The plan as a file the coordinator writes, a CLI to change it, a log of every change, checks against the book, and the Plan page in the portal.
## Why
Aaron asked for one place that shows the goal, the milestones, the tasks, who is on each and the path, so both sides know where the climb stands.
## Done when
- `pnpm plan show` prints the plan and `pnpm plan check` passes.
- The page is generated with the rest of the portal.
## Links
- `plan/plan.json`, `plan/log.jsonl`, `tools/plan.ts`

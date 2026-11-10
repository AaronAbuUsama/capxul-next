## What
Repaired the tool that derives one task per operation from the book. It failed once two concepts were added, and it carried milestones from an older plan. It now takes its milestones from the plan file.
## Why
The per-operation tasks are what the compatibility climb counts. They must come from the same plan, not a second list.
## Done when
- `tools/plan-tasks.ts --check` passes.
## Links
- `tools/plan-tasks.ts`, `docs/mission/tasks.json`

# plan

The coordinator's plan: what is being built, in what order, and who is doing what. See it with `pnpm plan show`, or
on the portal's Plan page.

- `plan.json`: the goal, the milestones, the tasks, the critical path and the notes.
- `log.jsonl`: every change to the plan, one line each, append only.
- `answers.jsonl`: the owner's answers, arriving from the portal; `pnpm plan answers` lists them.
- `outline.md`, `milestones/<id>.md`, `tasks/<id>.md`: the prose for each (What, Why, Done when).

Written only through `pnpm plan …` (never by editing the JSON); only the coordinator writes the path and the notes.
Read by the portal, the loop and `pnpm plan check`. The code is `tools/plan.ts` and `tools/plan/`.

# plan

The plan of the build as data the coordinator writes, the commands that change it, and the checks that keep it honest
against the book (decision `portal.plan-page`). The critical path is **authored, never computed**: this module never sorts
it, infers it or repairs it.

```ts
const applied = apply(plan, { kind: "task.done", id: "m1-plan-page" }, { by, date, at, commit }, facts);
const problems = check(applied.value.plan, facts);
```

| File | What it is |
|---|---|
| `plan/plan.json` | the plan: goal, milestones, tasks, path, notes |
| `plan/log.jsonl` | every change, one line each, append only |
| `tools/plan.ts` | the entry: reads and writes both files, loads the book's facts, prints |

`types.ts` is the module. `service.ts` is its door: `parsePlan`, `apply`, `check`, `show`, `parseArgs`. Nothing here reads
a file, the clock or `process`; `tools/plan.ts` does, and the portal's `main.ts` hands the Plan page the same parsed plan.

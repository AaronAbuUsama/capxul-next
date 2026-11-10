# plan

The plan of the build as data the coordinator writes, the commands that change it, and the checks that keep it honest
against the blueprint (decision `portal.plan-page`). The critical path is **authored, never computed**: this module never sorts
it, infers it or repairs it.

```ts
const applied = apply(plan, { kind: "task.done", id: "m1-plan-page" }, { by, date, at, commit }, facts);
const problems = check(applied.value.plan, facts);
```

| File | What it is |
|---|---|
| `plan/plan.json` | the plan: goal, milestones, tasks, path, notes |
| `plan/log.jsonl` | every change, one line each, append only |
| `packages/plan/src/main.ts` | the entry: reads and writes both files, loads the blueprint's facts, prints |

`types.ts` is the module. `service.ts` is its door: `parsePlan`, `apply`, `check`, `show`, `parseArgs`. Nothing here reads
a file, the clock or `process`; `packages/plan/src/main.ts` does, and the portal's `main.ts` hands the Plan page the same parsed plan.

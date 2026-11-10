# @capxul/plan

The coordinator's plan as code: the CLI that changes `plan/`, the checks that keep it honest against the blueprint,
and the task tree derived from both. The plan's data lives at the top level in `plan/`; this package only reads and
writes it.

```bash
pnpm plan show                 # the goal, milestones, critical path, who is doing what
pnpm plan task done <id> --evidence <ref> --by <name>
pnpm plan check                # the plan agrees with the blueprint and its own files
pnpm tasks                     # regenerate docs/mission/tasks.json; pnpm tasks:check proves it is current
```

- `src/main.ts`: the CLI entry. The only file that reads the arguments, the clock, git and the plan's files.
- `src/modules/plan/`: the plan as a pure module (`types.ts` is the module; `service.ts` its functions; its README
  has the detail). The critical path is authored, never computed.
- `src/files.ts`: reads `plan/outline.md`, `plan/milestones/` and `plan/tasks/`.
- `src/tasks.ts`: derives the task tree from the blueprint and the plan.
- `src/index.ts`: what other packages import (`@capxul/plan`); the portal's Plan page uses it.

Written by: the coordinator. Read by: the portal, the loop (through `pnpm plan`), `pnpm test`.

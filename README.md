# Capxul Next

The rebuild of Capxul Core: the on-chain authority and money layer that plugs into a hosted Frappe as its sign-in,
its signer and its bank feed. Why: [GROUNDING.md](GROUNDING.md). The product is designed as a typed **blueprint** before
it is coded (`blueprint/`; older documents call it "the book"); a **portal** is generated from it; a **plan** says what is being done; a **scoreboard** says what
is proven. An agent **loop** does bounded tasks from the plan, and a coordinator merges them into `integration/build`.

## See where things stand

```bash
pnpm install
pnpm plan show                 # the goal, the milestones, the critical path, who is doing what
pnpm portal && pnpm portal:serve   # the blueprint, the plan and the scoreboard as a site (prints its address)
pnpm loop status               # the agent runs on this machine
```

## Where things are

| Directory | What it is |
|---|---|
| `blueprint/` | The design, as typed records: one folder per concept, plus `shared/`. `baseline/` is the old system's behaviour and is never edited. |
| `packages/` | The code, one package per component: `blueprint` (the engine that builds the blueprint), `portal`, `plan`, `evals`, `loop` (the agent runner, on pi-durable), `contracts`, `sdk`, `devnet`, `layout`. |
| `plan/` | The coordinator's plan, its log and the owner's answers. Changed only through `pnpm plan`. |
| `evals/` | Which check proves which eval of the blueprint. |
| `status/` | The scoreboard. Written only by `pnpm evals`. |
| `loops/` | The scripts the loop runs. |
| `spikes/` | Proven throwaway code, waiting to be moved into packages (plan task `m2-graduate-spike`). |
| `docs/` | Written designs, evidence the blueprint cites, and generated reports. |
| `archive/` | Dead material, kept at its old path. Nothing reads it. |
| `var/` | Working data on this machine (loop runs). Not in git. |

Every entry, what uses it and whether it stays: [docs/repository-map.md](docs/repository-map.md).
`pnpm layout` fails when something new appears at the top level without a reason.

## Read next

- [CLAUDE.md](CLAUDE.md): the rules for changing anything here, and the checks.
- [docs/blueprint.md](docs/blueprint.md): how the blueprint works, end to end.
- [START-HERE.md](START-HERE.md): the current goal, milestone, next task and links to the plan, rulings and portal.

## The checks

Every change passes these before it merges:

```bash
pnpm exec tsc -p packages/blueprint-engine && pnpm test
pnpm exec tsc -p blueprint
pnpm blueprint                                                # 0 problems
pnpm frozen                                              # 0 breaches: every old behaviour kept or classified
pnpm contracts:check-blueprint                                # the contract records match the code
pnpm portal:check
```

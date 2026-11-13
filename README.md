# Capxul Next

> **This branch is `master`, the rebuild line.** It is separate from `main` and `integration/build`; the rule is at the
> top of [AGENTS.md](AGENTS.md).

The rebuild of Capxul Core: the on-chain authority and money layer that plugs into a hosted Frappe as its sign-in,
its signer and its bank feed. Why: [GROUNDING.md](GROUNDING.md). The product is designed as a typed **blueprint** before
it is coded (`blueprint/`; older documents call it "the book"); a **portal** is generated from it; a **plan** says what is being done; a **scoreboard** says what
is proven. Agents work in Amp orbs, one task per branch and pull request into `integration/build` (decision `build.amp`).
Picking it up cold: [docs/handoff-amp.md](docs/handoff-amp.md).

## See where things stand

```bash
pnpm install
pnpm plan show                 # the goal, the milestones, the critical path, who is doing what
pnpm portal && pnpm portal:serve   # the blueprint, the plan and the scoreboard as a site (prints its address)
```

## Where things are

| Directory | What it is |
|---|---|
| `blueprint/` | The design, as typed records: one folder per concept, plus `shared/`. `baseline/` is the old system's behaviour and is never edited. |
| `packages/` | The code, one package per component: `blueprint` (the engine that builds the blueprint), `portal`, `plan`, `evals`, `contracts`, `sdk`, `devnet`, `frappe-app`, `bench-image`, `layout`. |
| `plan/` | The coordinator's plan, its log and the owner's answers. Changed only through `pnpm plan`. |
| `evals/` | Which check proves which eval of the blueprint. |
| `status/` | The scoreboard. Written only by `pnpm evals`. |
| `spikes/` | Proven throwaway code, waiting to be moved into packages (plan task `m2-graduate-spike`). |
| `docs/` | Written designs, evidence the blueprint cites, and generated reports. |
| `var/` | Working data on this machine (the built blueprint, eval runs). Not in git. |
| `.agents/` | Amp's orb setup and resume scripts. |

Every entry, what uses it and whether it stays: [docs/repository-map.md](docs/repository-map.md).
`pnpm layout` fails when something new appears at the top level without a reason.

## Read next

- [docs/philosophy.md](docs/philosophy.md): how we work, read first.
- [AGENTS.md](AGENTS.md) (`CLAUDE.md` links to it): the rules for changing anything here, the roles, and the checks.
- [docs/blueprint-guide.md](docs/blueprint-guide.md): the blueprint in plain words (the portal's Blueprint page).
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

# Start here

Capxul is one business system for people and agents: hosted, re-skinned Frappe with Capxul Core's on-chain authority, budgets, payments and Bridge banking built in. Frappe is not optional. The CLI and SDK are one door to the whole system; the chain owns authority and the site reflects it. See [GROUNDING.md](GROUNDING.md) for Aaron's strategy.

## Where we are and what comes next

**Current goal:** the blueprint fully specifies Capxul on Frappe, and one shared world runs a thin line through the whole stack on a machine, not a laptop: real contracts, service, company site, door, signed payment, record, clock and snapshot restored as a separate world.

**Current milestone:** `m1` — Foundation: the blueprint is complete and fit for purpose.

**Next task on the coordinator's written critical path:** `m1-loop-hardening` — make the loop trustworthy enough to run tasks unattended. This entry-document task is `m1-entry-docs`, not the start of a new build. These are a snapshot of `pnpm plan show` on 10 November 2026; always refresh before taking work:

```bash
pnpm plan show
pnpm plan show m1-loop-hardening
```

The live plan, not this snapshot, determines the current milestone and next task. “Next” here means the
first task on the coordinator's written critical path, not permission to abandon an assigned task or to
claim work already running in another thread. Read [plan/outline.md](plan/outline.md) for the route and [plan/tasks/](plan/tasks/) for each task's What, Why and Done when.

## Three sources to use

1. **Plan:** `pnpm plan show`, backed by [plan/plan.json](plan/plan.json). It says where work stands and what comes next. Coordination uses the plan and loop, not swarmD or a handoff folder.
2. **Rulings and blueprint:** [blueprint/shared/rulings.ts](blueprint/shared/rulings.ts) records Aaron's direction; concept decisions hold the design. In particular, `aaron.frappe-native`, `aaron.one-door`, `aaron.one-product` and `aaron.jurisdiction-open` govern this direction. **The first jurisdiction is open**, neither UK nor US; a crypto-friendly place is preferred. Equity, hosted FDE and individuals are parked, not current build scope ([cut archive](docs/cut-archive/INDEX.md)). Older direction does not override the plan or current rulings.
3. **Portal:** run `pnpm portal && pnpm portal:serve`, then open the address printed. `/plan/` shows the plan; the portal also presents the blueprint, Questions and scoreboard. Owner answers are applied by the coordinator as rulings, not left in chat.

Before editing, read [CLAUDE.md](CLAUDE.md) for rules and current checks, then [docs/blueprint.md](docs/blueprint.md) for blueprint work. The engine is `packages/blueprint-engine`, **not `packages/book`**.

## History, not instructions

The original 9 November direction is preserved verbatim at [archive/START-HERE.md](archive/START-HERE.md), and the original strategy at [archive/GROUNDING.md](archive/GROUNDING.md). [archive/HANDOFF.md](archive/HANDOFF.md) is older build evidence, not the next-task list. Their country assumptions, first steps, swarm instructions and claims to precedence are historical. Use [README.md](README.md) for the repository map.

# Start here

Capxul is one business system for people and agents: hosted, re-skinned Frappe with Capxul Core's on-chain authority, budgets, payments and Bridge banking built in. Frappe is not optional. The CLI and SDK are one door to the whole system; the chain owns authority and the site reflects it. See [GROUNDING.md](GROUNDING.md) for Aaron's strategy.

## Where we are and what comes next

**11 November 2026:** agents now work in Amp (decision `build.amp`); the home-made loop is gone. Where the product
stands, what waits on Aaron and the next tasks are in [docs/handoff-amp.md](docs/handoff-amp.md). The thin line
(`evals/thin-line.md`) passes 10 of its 12 tests on the real contracts; the last two wait on two of Aaron's decisions.

## Three sources to use

1. **Plan:** `pnpm plan show`, backed by [plan/plan.json](plan/plan.json). It is the old coordinator's task list; whether it stays is open (docs/handoff-amp.md, section 5).
2. **Rulings and blueprint:** [blueprint/shared/rulings.ts](blueprint/shared/rulings.ts) records Aaron's direction; concept decisions hold the design. In particular, `aaron.frappe-native`, `aaron.one-door`, `aaron.one-product` and `aaron.jurisdiction-open` govern this direction. **The first jurisdiction is open**, neither UK nor US; a crypto-friendly place is preferred. Equity, hosted FDE and individuals are parked, not current build scope ([cut archive](docs/cut-archive/INDEX.md)). Older direction does not override the plan or current rulings.
3. **Portal:** run `pnpm portal && pnpm portal:serve`, then open the address printed. The portal shows the product and where it stands: the blueprint, Questions, the architecture and where every operation stands. The plan is `pnpm plan show`, not a portal page. Owner answers are applied by the coordinator as rulings, not left in chat.

Before editing, read [CLAUDE.md](CLAUDE.md) for rules and current checks, then [docs/blueprint.md](docs/blueprint.md) for blueprint work. The engine is `packages/blueprint-engine`, **not `packages/book`**.

## History, not instructions

The original 9 November direction, strategy and handoff were in `archive/`, deleted on 11 November 2026; read them in git history (`git show 4b7deb2:archive/START-HERE.md`). Their country assumptions, first steps, swarm instructions and claims to precedence are historical. Use [README.md](README.md) for the repository map.

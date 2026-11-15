# Capxul Next

This is `master`, the rebuild line of Capxul: a hosted, re-skinned Frappe with Capxul's on-chain authority, budgets,
payments and banking built in. It is separate from `main` and `integration/build`.

Where it stands: the dashboard at https://claude.ai/artifact/6vhMzxXsWZptFjKREJnu8g.

## Where to go

| To | Read |
|---|---|
| know the rules before you change anything | [AGENTS.md](AGENTS.md) |
| see the plan, its items and what is Done | [docs/roadmap.md](docs/roadmap.md) |
| know why Capxul exists and how it earns | [docs/grounding.md](docs/grounding.md) |
| understand the blueprint, its formats and the words we use | [docs/design/blueprint.md](docs/design/blueprint.md) |
| understand how these docs are laid out | [docs/design/docs.md](docs/design/docs.md) |
| work on a package | its own `README.md`, under [packages/](packages) |

## The packages

<!-- generated:packages start -->
<!-- Written by `pnpm generate` from `PACKAGES` in packages/lint/src/shape.ts; never edit it. -->
| Package | Why it is there |
|---|---|
| [`blueprint`](packages/blueprint) | what Capxul does: operations, refusals, events and starting worlds as Effect declarations |
| [`blueprint-tools`](packages/blueprint-tools) | how the blueprint is written and checked: its language, the delta check, and its indexes' and pages' render |
| [`world`](packages/world) | what runs where: the Alchemy stacks that create and destroy a world |
| [`contracts`](packages/contracts) | the Solidity contracts, their Foundry tests and the seeded chain state |
| [`frappe-app`](packages/frappe-app) | the Capxul app on every hosted Frappe site |
| [`bench-image`](packages/bench-image) | the hosted Frappe bench's image and its check |
| [`platform`](packages/platform) | the shared platform: the bench host on AWS, the Frappe bench, the tunnel, site tokens and the drift check |
| [`indexer`](packages/indexer) | the Ponder app that indexes the chain into the world's database |
| [`status-feed`](packages/status-feed) | the data files behind the status dashboard |
| [`lint`](packages/lint) | the ladder's own rules and this shape check |
| [`core`](packages/core) | the Capxul server: a Cloudflare Worker that serves every blueprint operation |
| [`runner`](packages/runner) | the scenario runner: runs scenarios against a world, checks every call and writes run records |
| [`scenarios`](packages/scenarios) | the acceptance scenarios, each proving one blueprint claim through the door |
| [`sdk`](packages/sdk) | the typed client of every blueprint operation, derived from the blueprint, through which callers reach Core |
| [`cli`](packages/cli) | the one Capxul command line: every blueprint operation a command, called through the SDK |
| [`generate`](packages/generate) | `pnpm generate`: writes every derived file from its owner, the compiled contracts, the seed and the blueprint |
<!-- generated:packages end -->

## The gate, and a run

```bash
pnpm install
pnpm format                              # rewrite the code into shape
pnpm check                               # the gate: rungs 1 to 5, listed in AGENTS.md
packages/runner/run.sh scenarios         # rung 6: every journey in a fresh world (needs Cloudflare and Neon keys)
```

# Capxul Next

This is `master`, the rebuild line of Capxul: a hosted, re-skinned Frappe with Capxul Core's on-chain authority,
budgets, payments and banking built in ([GROUNDING.md](GROUNDING.md)). It is separate from `main` and
`integration/build`, and it follows [docs/roadmap.md](docs/roadmap.md). The rules for changing it are in
[AGENTS.md](AGENTS.md).

Where it stands: the dashboard at https://claude.ai/artifact/6vhMzxXsWZptFjKREJnu8g.

## Run the ladder

```bash
pnpm install
pnpm format       # rewrite the code into shape
pnpm check        # shape, format, lint, types and tests; AGENTS.md lists the rungs one by one
spikes/pipeline/run.sh scenarios   # the proof: every scenario in a fresh world (needs Cloudflare and Neon keys)
```

## Where things are

- `packages/blueprint`: what Capxul does, as Effect declarations.
- `packages/world`: the Alchemy stacks that create and destroy a world.
- `packages/contracts`: the Solidity contracts, their Foundry tests and the seeded chain state.
- `packages/frappe-app`: the Capxul app on every hosted Frappe site.
- `packages/bench-image`: the hosted Frappe bench's image and its check.
- `packages/indexer`: the Ponder app that indexes the chain.
- `packages/status-feed`: the data files behind the dashboard.
- `packages/lint`: the repository's own checks.
- `spikes/`: throwaway code that proves a risk, deleted when its step graduates it.

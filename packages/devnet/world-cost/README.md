# devnet/world-cost

A minimal Ponder app over one v4 world, and the harness that measured what Ponder costs per world. The numbers, the
method and the caveats are in [docs/mission/world-cost.md](../../../docs/mission/world-cost.md). Kept as a starting
point for the real indexer package (a separate task); it is not that package.

Not a workspace package: it has its own `npm install` and lockfile, so Ponder's dependencies stay out of the workspace.

| File | What |
|---|---|
| `ponder.config.ts` | One world's chain and the contracts the blueprint's indexing records name: Companies House (claims and company Safes), Installer, Budgets, Agreements, Payments, the escrow factory and its escrows, AgentOwner, the equity clones, Capxul's Safes (by factory), Hats, and the world's token. PGlite, or Postgres when `DATABASE_URL` is set |
| `ponder.schema.ts` | A cut-down copy of `blueprint/indexing/data.ts`: `chain_logs`, `transfers`, `chain_payments`, `safe_owners`, `chain_budgets`, `hat_wearers` |
| `src/index.ts` | The handlers. Safe projections read the Safe at the event's block, so the RPC load is the real one |
| `abis.ts` | The v4 events from `packages/contracts/abi/abi.json`; Safe, Hats and ERC-20 events |
| `load.ts` | Gives a world history: N companies born on the real contracts, each with a department, a hat, a budget and P payments |
| `measure.ts` | K worlds, each an anvil from the seeded state plus its own Ponder: start, catch-up, idle, live, park, unpark, disk |

```bash
source packages/devnet/cloud/setup.sh                 # anvil
(cd packages/contracts && forge build)                 # the Installer and token artifacts load.ts deploys from
(cd packages/devnet/world-cost && npm ci)
cd packages/devnet/world-cost && node --experimental-strip-types measure.ts --backend pglite --worlds 1 --companies 50 --payments 10
# Postgres: a server at PG_ADMIN_URL (default postgres://capxul:pw@127.0.0.1:55432/postgres), one database per world
```

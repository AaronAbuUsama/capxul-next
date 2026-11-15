# What lives in the Cloudflare account outside any stage

Every stack of ours keeps its Alchemy state in the account's shared state store (`Cloudflare.state()`): this
package's `alchemy.run.ts`, `host.run.ts` and `bootstrap/`, and `packages/world`'s stacks. The store is not a stage of
any stack, so no `destroy` removes it. It was made once, on 13 November 2026, by the state spike (whose code was
deleted when it graduated), with `alchemy state bootstrap` (23 s), and is left in place on purpose.

| In the account | What it is |
|---|---|
| Worker `alchemy-state-store` | The store's API on workers.dev. It answers 401 without its token; `/version` is open |
| Durable Object namespace `alchemy-state-store_Store` | Where the state is kept (SQLite), encrypted with the key below |
| Secrets Store `default_secrets_store` | Made by `alchemy state bootstrap`, since the account had none. It holds two secrets, `AlchemyStateStoreToken` and `AlchemyStateStoreEncryptionKey` |

**Cost**: nothing beyond the Workers Paid plan the account already has; an idle Worker and Durable Object are not
charged, and two secrets are inside the Secrets Store's free allowance (read from Cloudflare's prices, not a bill).

**Access**: whoever holds the Cloudflare key can read the store, since a command fetches the store's token through a
short-lived preview of its Worker (about 3.5 s a command with `CI=true`, which caches nothing on disk). So the store
hands out no secret of its own. With `CI=true` a missing store is an error, not something a deploy makes.

## Removing it

Only once no stage of any stack is recorded in it, since every stage's state goes with it and those resources could
then never be destroyed by Alchemy: take every stage down first, then run
`alchemy state teardown --backend cloudflare`. That also deletes the Secrets Store if nothing else is in it by then.
Never `alchemy nuke`.

## What the state spike found about the store and drift

- **The store has no lock** (Alchemy 2.0.0-beta.85 and beta.87): two processes deploying one stage at once both
  succeed, and the store records one Worker while the other is an orphan no destroy will find. So one stage is made
  by one process, under a name nobody else can pick.
- **A drift check does not look at a Worker's code**, only its settings, and on beta.85 `alchemy drift` exits 0 even
  on drift; why `src/drift.ts` checks code itself and exits 2 is its header.
- A stage whose first deploy died half-way has resources and no recorded outputs, so a sweeper reading the expiry
  from the outputs keeps it (read from Alchemy's source, not run).

# @capxul/world

A world is one whole, isolated Capxul, made, used and destroyed as one unit, with an operator who owns it and an
expiry. This package makes, resets, renews, destroys and sweeps worlds, and runs the cluster they live on. A world is
one stage of the Alchemy stack `CapxulWorld` (its api and database) plus Durable Objects named for it on the cluster
(the stack `CapxulWorldHub`); nothing of it lives on the machine that made it. Alchemy and Effect, run with Bun.

## Its parts

- **Database**: its own copy-on-write branch of the Neon project, with a Hyperdrive configuration in front of it.
- **Chain**: anvil on the seeded state (`packages/contracts/state/core.json`), in a container on the cluster, saved to
  R2 while it is used and woken by the next call after 10 idle minutes; test USDC and a test paymaster are put on it.
- **Index**: the real Ponder app of `packages/indexer`, in a container next to the world's branch.
- **Bundler**: Pimlico's alto, unpatched, serving the seeded EntryPoint v0.7 against the world's chain.
- **Endpoint**: `<gateway>/<token>`, the cluster's gateway (`src/parts/gateway/Gateway.ts`) under the world's token; the only way
  to its chain, index and bundler.
- **Api**: the real api (`packages/core`), deployed for the world and handed the world's own facts (`src/parts/api/Api.ts`).
- **Sites**: with `WORLD_BENCH` and `--company`, each company's Frappe site on a shared bench, made by the site service
  of [`packages/platform`](../platform) with the world's own site token (`src/things/site/bench.ts`).

`src/account` serves the account calls of the [blueprint's world domain](../blueprint/src/world) on the loopback of
the machine that holds the Cloudflare and Neon keys: the runner's own process, or `./run.sh platform serve`.

## Run it

`pnpm install` at the root, then from `packages/world` (`pnpm world <command>` is the same command line):

```bash
./run.sh platform up                               # once: the Neon project and the registry of world names
./run.sh hub up --owner me --lifetime "7 days"     # once: the cluster every world runs on (docs/cluster.md)
./run.sh create demo --owner me --lifetime "2 hours" [--from other] [--company "acme=Acme Ltd"]
./run.sh reset demo --to s0 [--template t]         # rewind the same world to its snapshot (docs/reset.md)
./run.sh renew demo --lifetime "7 days"            # a later expiry, the api deployed again (docs/renew.md)
./run.sh destroy demo
./run.sh sweep [--dry-run]                         # destroy what expired; CI's world.yml and platform.yml run it
./run.sh --help                                    # show, list, sql, inventory, images, prove and the rest
```

A command prints its result as JSON on standard output and its log on standard error. The network proxy adds the
keys. `./run.sh alchemy` only reads (`state list`, `drift`). In-process, a runner imports `withWorld` from `src/index.ts`.

## Where things are

The layout is [docs/design/world.md](../../docs/design/world.md); the map, one line per file, is
[generated/index.md](generated/index.md). In `src/`, beside `index.ts`, the one import entry:
`things/<thing>/` (world, cluster, registry, site, site-template: each its `values.ts`, `stage.ts`, `client.ts`,
`store.ts` and a file per verb), `parts/<part>/` (what runs on Cloudflare), `account/`, `stack/` (Alchemy), `cli/`,
`common/` and `proofs/`. The lifecycle rules of the [roadmap](../../docs/roadmap.md#world-lifecycle-rules-enforced-by-code)
are kept by `things/world/`: `use.ts` holds a run as one unit.

## More

- [docs/cluster.md](docs/cluster.md): the cluster, its capacity and how a world is admitted to it.
- [docs/reset.md](docs/reset.md) and [docs/renew.md](docs/renew.md): resetting a world in place, and renewing one.
- [records/README.md](records/README.md): the proofs, the timings and what was learned making them.
- How each part is reached and how it works: the comment at the top of its module, under [`src/`](src).

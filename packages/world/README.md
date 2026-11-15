# @capxul/world

What runs where: the Alchemy stacks that create and destroy a world. A world is one whole, isolated Capxul: its
database and its api, its chain, bundler and indexer on a shared cluster, and its companies' sites on the bench. Every
world has an owner and an expiry, and is made, used and destroyed as one unit. Nothing of it lives on the machine
that made it.

**The map**, one line per file, generated from the code: [generated/index.md](generated/index.md).

## The kinds of folder in `src/`

A folder says what kind of thing lives in it. Nothing is loose at the root of `src/` but `index.ts`.

| Folder | Holds |
|---|---|
| `index.ts` | The one file other packages import from |
| `things/<thing>/` | One thing this package makes and destroys: a world, the cluster, the registry, a site, a site template. `values.ts` says what it is, `stage.ts` holds its Alchemy stack, `client.ts` says how it is reached, `store.ts` holds its rows, and each verb is a file of its own: `create.ts`, `reset.ts`, `sweep.ts` |
| `parts/<part>/` | What runs in the cloud: the cluster's gateway, and each world's api, chain, bundler, indexer and database, each with its own client |
| `account/` | The operations served outside any world (`world.create`, `world.show`, `world.list`, the snapshots), on loopback or in the runner |
| `stack/` | Alchemy: the engine that deploys and destroys a stage, the images, the names, the cloud accounts |
| `cli/` | The command line. `cli/main.ts` is the only file that touches the process |
| `common/` | What every kind uses: the package's failures, run records, timing |
| `proofs/` | The proofs, one case per file, frozen with their records under `records/` |

Beside `src/`: `images/` and `ponder/` (what the cluster's containers are built from), `migrations/`, `records/`
(frozen), `run.sh` (the command line from an agent's container, until the `capxul` CLI takes the world's verbs over)
and `alchemy.run.ts` (the stack, for Alchemy's read-only commands).

`test/layout.test.ts` fails a file that lands outside this layout.

## Where to go

- Make, list and destroy a world by hand: [docs/commands.md](docs/commands.md)
- Reset a world in place, renew it: [docs/reset.md](docs/reset.md), [docs/renew.md](docs/renew.md)
- Serve the account's operations: [docs/account.md](docs/account.md)
- Pin or publish an image: [docs/images.md](docs/images.md)
- Run a proof: [docs/proofs.md](docs/proofs.md)
- How the cluster, the api, the sites and the containers work: [docs/cluster.md](docs/cluster.md),
  [docs/api.md](docs/api.md), [docs/sites.md](docs/sites.md), [docs/containers.md](docs/containers.md)
- What was learned building it: [docs/lessons.md](docs/lessons.md)
- The rules a world keeps: [docs/roadmap.md](../../docs/roadmap.md), "World lifecycle rules, enforced by code"
- Why the layout is this one: [docs/design/world.md](../../docs/design/world.md)

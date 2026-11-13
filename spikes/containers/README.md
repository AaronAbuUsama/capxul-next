# Containers spike

Throwaway code that answers one risk from [docs/roadmap.md](../../docs/roadmap.md): can a world's chain and its Ponder
indexer run as Cloudflare Containers, deployed by Alchemy, against the world's own Neon branch, and stop when the
world is idle? It is deployed with Alchemy (`alchemy` 2.0.0-beta.85 on Effect 4.1.2) from an agent's container.
Nothing here is product code. Core was out of scope and was not tried.

## What is proven (13 November 2026, from a Claude cloud container)

Three worlds were deployed, driven and destroyed. `records/ct-w3.prove.txt` is the output of `./prove.sh ct-w3` on a
world deployed from nothing; every line quoted below is in it.

| Question | Result |
|---|---|
| Does anvil run in a Cloudflare Container deployed by Alchemy and answer JSON-RPC through its Worker and Durable Object? | Yes. `eth_chainId` gave `0x14a34` (84532) and `eth_blockNumber` gave `0x2dacb0b` (47,893,259, where `packages/contracts/state/core.json` ends), so the seeded state loaded. Instance type `lite` (1/16 vCPU, 256 MiB). |
| Does the chain's state survive a stop? | Yes. The Durable Object calls `anvil_dumpState`, writes the answer to R2 and only then stops the container; the next start loads it with `anvil_loadState`. Block 47,893,260 had the same hash and transaction before the stop and after the start (`SAME BLOCK AND HASH AFTER THE STOP`). |
| What if the container goes away without being stopped? | It costs at most the last 20 s. While calls arrive the state is also saved every 20 s. A container killed without saving came back at the last saved block, the block mined after it was gone, and the start was recorded as `afterUnsavedStop: True`. This is not hypothetical: on `ct-w2` the chain's container disappeared by itself within four minutes of its application being created. |
| Does Ponder in a Cloudflare Container reach the world's Neon branch over Postgres and the chain's RPC, and index an event? | Yes. Ponder 0.18.6 connected to the branch on TCP 5432, created schema `ponder`, read the chain through the world's door and wrote the `Ping` events to `ponder.pings` (`neon says: [{'pings': '2', 'head': '47893261'}]`). A new event was in Neon within 6 s. It ran on `basic` (1/4 vCPU, 1 GiB) and also on `lite`. |
| Does the world stop when it is idle? | Yes. 30 s after the last call through `/rpc` the indexer was stopped and the chain was saved and stopped, although the indexer had been polling the whole time. The next call woke the chain in 1.6 s and the indexer carried on from its rows in Neon (`pings` went from 3 to 4, nothing re-created). A 600 s idle stop also fired on time across a redeploy of the Worker. |
| Does destroy leave anything behind? | The world, no; its images, yes. `alchemy destroy` removed the Worker, both container applications, the bucket and the branch in 9 s, but left the image repositories in Cloudflare's registry. `registry.py --delete` removes them; `./check-clean.sh` shows nothing of this stack is left. |

## Timings

| Step | Seconds |
|---|---|
| Deploy a world from nothing, building and pushing both images | 43 |
| Deploy a world whose images are already published (no Docker used) | 39 |
| Deploy the chain alone, first time (image build and push) | 32 |
| Redeploy after a change to the Worker only | 20 |
| Change a container's instance type (a rollout) | 68 |
| Destroy a world | 9 |
| Platform stage (the Neon project): create, destroy | 10, 2 |
| Chain cold start from the seed, measured inside the Durable Object | 0.5 to 0.8 |
| Chain cold start from saved state (R2 read, start, load) | 0.6 to 1.1 |
| First call after a stop, measured by the caller | 0.9 to 1.6 |
| Save the chain (2.45 MB) and stop the container | 0.8 to 2.1 |
| Ponder from start to `/ready`, first time | 10 |
| Ponder from the wake call to `/ready` after an idle stop | 13 to 15 |
| A JSON-RPC call to a running chain through the door | 0.2 to 0.6 |

## What was learned on the way

- **A container has no address.** Each one is reached only through its Durable Object, and one Durable Object class
  owns one container application. So a world is a Worker (the door) with one class per container, and Ponder reaches
  the chain through the door's public address, with outbound internet on and the world's token in the path.
- **The Durable Object must own the stop.** A container's disk is gone when it stops, and Cloudflare stops a container
  itself once its object has been quiet. The chain's object sets that limit well past its own idle time, stops the
  chain itself from a durable callback, and saves first.
- **The indexer must not keep the world awake.** Ponder polls every two seconds. Its calls go to `/quiet-rpc`, which
  neither wakes the chain nor pushes its idle stop forward.
- **A new container application is not ready at once.** On the very first deploy calls answered `Container exited`
  for about a minute; a start made in that time is lost silently. `prove.sh` retries both starts.
- **`core.json` needs anvil 1.7 or later.** The `stable` image (1.5.1) refuses it. The image pins 1.9.0 by digest.
- **`anvil_loadState` over HTTP needs `--no-request-size-limit`.** The saved state is 2.45 MB and the limit is 2 MB.
- **Ponder needs `reorgWindow: 0` here.** The seeded chain keeps nine blocks of history; Ponder's default looks for a
  block 180 s back and asks for blocks that do not exist.
- **Alchemy prints stack outputs in plain text, secrets included.** A connection string must never be an output.
  `spikes/hosting/alchemy.run.ts` returns one as `database`; this stack returns the branch id instead.
- **Share one image repository between worlds** (`publish.repository`). A world then deploys without Docker, and
  there is no per-world image to delete. Building an image needs a Docker daemon; `dockerd` runs in an agent's
  container and pushes through the session's proxy.
- **An unsaved stop can leave the index ahead of the chain.** With `reorgWindow: 0` Ponder will not notice that a
  block it indexed is gone. The world needs a rule for this before it carries real data.

## Not proven

- Core as a container.
- The real indexer in `packages/indexer` (six contracts, a deployment file); only a one-event app was run.
- What an idle world costs. A stopped application still shows instances as `healthy` in Cloudflare's API; whether
  those are billed was not measured.
- How the saved state grows. Every save writes the whole state, and anvil keeps it all in 256 MiB of memory.
- Deleting expired Cloudflare resources. The Neon branch expires by itself; nothing here does the same for a Worker,
  a container application, a bucket or an image.

## Run it

`pnpm install --ignore-workspace` here and in `ponder/` (its `node_modules` is copied into the image). Start a Docker
daemon if images must be built. Then `./run.sh deploy --stage ct-platform --yes`, and for a world
`WORLD_OWNER=<who> WORLD_EXPIRES_AT=<RFC 3339 time> ./run.sh deploy --stage ct-<name> --yes`. `./prove.sh ct-<name>`
drives it through every question above. `python3 sql.py ct-<name> "<sql>"` runs a statement on its database.
Finish with `./run.sh destroy --stage <stage> --yes` for every world and then `ct-platform`,
`python3 registry.py --delete` for the images, and `./check-clean.sh`. Never run `alchemy nuke`: it deletes every
resource in the account, not only this stack's.

`src/chain` is the chain (the anvil container, its Durable Object, its bucket), `src/indexer` the indexer, `src/Door.ts`
the Worker, `ponder/` the Ponder app and its image, `images/anvil` the chain's image.

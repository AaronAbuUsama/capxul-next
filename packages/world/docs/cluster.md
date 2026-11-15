# The cluster: where every world runs, and how a world gets a place on it

The cluster (the hub, roadmap step 1.15) is one stage of the stack `CapxulWorldHub` (`src/things/cluster/stage.ts`), deployed
once. It holds ONE container application of each kind: anvil (`lite`), Ponder (`standard-1`) and alto (`basic`), all
three in western Europe, next to the worlds' Neon project. Beside them are its gateway (the Worker
`src/parts/gateway/Gateway.ts`), the three Durable Object classes that own every world's containers (`Chain`, `Indexer`,
`Bundler`), the R2 bucket the chains are saved to, and an admin token. A world on the cluster is three Durable Objects
named by its stage and made in western Europe (`src/things/cluster/values.ts`), plus its Neon branch, its Hyperdrive configuration
and its api: `world create` deploys no container application.

## Making, keeping and taking it down

```bash
./run.sh hub up [--hub <stage>] --owner <operator> --lifetime "7 days"   # again on a live cluster: a later expiry only
./run.sh hub show [--hub <stage>]    # its owner, expiry, gateway and registry
./run.sh hub down [--hub <stage>]    # refused while a world names it or its registry holds one
```

Every world made with `WORLD_HUB=<stage>` (default `fleet`) lives on that cluster. Its owner and lifetime are written
to the shared state before its deploy, at most `HUB_MAX_LIFETIME` (30 days). No world may outlive its cluster, and the
sweeper destroys an expired cluster once no world is on it.

## How a world is reached, registered and forgotten

- **Its token** is `<stage>.<secret>`, one path segment, so a world's endpoint is `<gateway>/<token>` and its chain
  `<gateway>/<token>/rpc`. The secret is an HMAC of the world's stage, owner and expiry under the cluster's admin
  token (`src/things/cluster/client.ts`): stored only in the cluster's registration and the world's api, and worked out again by
  whoever reads the admin token from the shared state.
- **Registering**: a create registers its world (`POST /admin/<admin>/worlds/<stage>`, `src/things/cluster/registration.ts`)
  right after its name is reserved. The world's chain object keeps the registration and checks every call's token and
  the world's expiry against it (`src/parts/chain/admission.ts`); the bucket keeps the cluster's registry entry (its `ledger`).
- **Forgetting**: every take-down calls `POST /admin/<admin>/worlds/<stage>/forget`, which removes the bundler's and
  index's containers and storage, the chain's container, every object of the world in the bucket (its saved state, its
  snapshots' states, then its registry entry) and the chain object's storage and pending callbacks. The world's token
  then reaches nothing (`404 no world is registered here`).

A world's Neon branch is made by its create through Neon's API (`src/parts/database/neon.ts`), not by the stack, and its
take-down deletes every branch of the world, children first (`src/parts/database/branches.ts`, `dropBranches`).

## Capacity and admission: a world waits for room instead of dying half-way

A cluster admits `HUB_CAPACITY` worlds at once (`src/things/cluster/values.ts`), recorded in its outputs at its deploy; a cluster
recorded before admits `LEGACY_HUB_CAPACITY`. Each container application allows `HUB_CAPACITY + HUB_SPARE` instances,
the spare for the seconds Cloudflare still counts a destroyed world's container. Raising it on `fleet` takes
`hub up --hub fleet` again. Why it matters: on 14 November 2026 four `world` runs at once on `fleet` all failed, their
chains and indexes refused (`Maximum number of running container instances`) after their worlds were half made.

- **Admission** (`src/things/registry/reserve.ts`, `admit`): the row that reserves a world's name names its cluster, and the
  insert takes it only while the cluster's rows are fewer than its capacity, in one transaction under a lock on the
  owner and one on the cluster, so two processes cannot both take the last place (`records/admission`). A place is
  held until the name is released, so a world whose take-down failed, or that expired and was not swept yet, keeps it.
- **The wait**: the `admit` step, before `claim`, tries the insert again every `WORLD_ADMIT_EVERY` while the cluster is
  full, under `WORLD_TIMEOUT_ADMIT` (`src/things/world/values.ts`). Past that it fails with `HubFull`, with nothing of the
  world made. Its span `world.admit` shows each wait in a run's history.
- **The quota still refuses first**: an owner at `WORLD_MAX_PER_OWNER` live worlds is refused `WorldQuotaReached` at
  once, full cluster or not (`test/admit.test.ts`). A create waiting for room holds no row, so it is not counted.
- **An older registry** without a `hub` column gets it from the first claim that meets it (`prepareRegistry`, under
  its own lock), or from `platform up`. Rows of worlds created before have no cluster and are not counted.

## What it costs

An idle cluster runs no container: its applications keep instances placed but none active a few seconds after the
last world goes (`records/hub.proof.json`, `containersAfter`), and a container is billed only while active. What is
left is the Workers plan and the bucket's and objects' storage. From Cloudflare's prices, one world running all three
containers is at most 0.8125 vCPU, 5.25 GiB and 14 GB of disk, about $0.11 an hour; containers stop after 10 idle
minutes. A run is about one world-hour (`run-138efc`), about $0.12, so the $10 a day of `AGENTS.md` is about 80 runs
of containers: the cap bounds the rate, not the day.

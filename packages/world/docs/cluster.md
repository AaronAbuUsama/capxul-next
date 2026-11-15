# How the cluster works

## The fleet hub (step 1.15)

Each kind of world container is ONE container application per hub, deployed once: anvil (`lite`), Ponder (`standard-1`)
and alto (`basic`), all three constrained to western Europe, next to the worlds' Neon project. The hub's stack
(`src/things/cluster/stage.ts`) is its door Worker (`src/parts/gateway/Gateway.ts`), the three Durable Object classes that own every world's
containers (`Chain`, `Indexer`, `Bundler`), the bucket the chains are saved to and an admin token. A world on the hub is
three Durable Objects named by the world's stage, placed in western Europe, plus its Neon branch, its Hyperdrive
configuration and its Core: `world create` deploys no container application.

| What | How |
|---|---|
| How a stage gets its hub | `./run.sh hub up [--hub <stage>] --owner <op> --lifetime "7 days"`, once; again on a live hub moves its expiry and changes nothing else. Every world made with `WORLD_HUB=<stage>` (default `fleet`) lives on it. `hub show` prints its owner, expiry, door and ledger; `hub down` is refused while a world names it or its ledger holds one. |
| Owner and lifetime | Recorded in the shared state before its deploy (at most `HUB_MAX_LIFETIME`, 30 days). No world may outlive its hub; the sweeper destroys an expired hub once no world is on it. |
| A world's token | `<stage>.<secret>`, one path segment, so every caller reaches a world as before, at `<door>/<token>/rpc`. `secret` is an HMAC of the world's stage, owner and expiry under the hub's admin token (`src/things/cluster/client.ts`), so it is stored only in the hub's registration and the world's Core, and worked out again by whoever reads the hub's admin token from the shared state. |
| Registering a world | Its create registers it (`POST /admin/<admin>/worlds/<stage>`, `src/things/cluster/registration.ts`) right after its name is claimed: its chain's object keeps the registration and checks every call's token and the world's expiry against it (`src/parts/chain/admission.ts`); the hub's bucket keeps a ledger entry. |
| Forgetting a world | Every take-down calls `POST /admin/<admin>/worlds/<stage>/forget`: the bundler's and index's containers and storage, the chain's container, every object of the world in the bucket (its saved state, its snapshots' states, then its ledger entry) and the chain object's storage and pending callbacks are removed. The world's token then reaches nothing (`404 no world is registered here`). |
| How many worlds a hub admits | `HUB_CAPACITY`, 24, recorded in the hub's outputs at its deploy (a hub recorded before admits 10, its applications' old cap); each container application allows `HUB_CAPACITY + HUB_SPARE` (26) instances, the spare for the seconds Cloudflare still counts a destroyed world's container. A world holds its place from its claim until its name is released: see "Capacity", below. Raising it on `fleet` takes `hub up --hub fleet` again. |
| What an idle hub costs | Its applications keep instances placed in advance but run none: Cloudflare's own count of active instances is 0 for all three a few seconds after the last world goes (`records/hub.proof.json`, `containersAfter`, 16.4 s after the last destroy), and a container is billed only while active. What is left is the Workers plan, the bucket's and the objects' storage (a world's chain state is about 3.4 MB, removed with it) and nothing per hour. |

### Capacity: a world waits for room instead of dying half-way

On 14 November 2026 four `world` runs at once on `fleet` all failed: one run peaks at six worlds on the hub (its own,
four more of its first operator up to the quota of five in the journey "two operators and their worlds", and its
second operator's), so four needed 24 while each container application allowed 10, and chains and indexes were
refused (`Maximum number of running container instances`) after their worlds were half made. Now:

| What | How |
|---|---|
| Admission (`src/things/registry/reserve.ts`, `admit`) | The registry's row of a world names its hub, and the insert that claims the name takes it only while the hub's rows are fewer than its capacity, in one transaction under a lock on the owner and one on the hub. Two processes cannot both take a hub's last place: `records/admission` runs two processes at once, 20 worlds on a hub of 4, on a real Postgres 16, and the hub never held more than 4 (`summary.json`). A place is held until the name is released, so a world whose take-down failed, or that expired and was not swept yet, keeps it: counting stays on the safe side. |
| The wait | The `admit` step, before `claim`: while the hub is full the insert is tried again every `WORLD_ADMIT_EVERY` (10 s), under `WORLD_TIMEOUT_ADMIT` (15 minutes; a run's quota phase holds five places for about five minutes). It fails with `HubFull` only past that, with nothing of the world made. The step's duration is in every create's `ms` and its span `world.admit` in the platform's spans, so a run record shows each wait. |
| The quota still refuses | The owner's quota is in the same insert and is read first: an owner at five live worlds is refused `WorldQuotaReached` at once, full hub or not (`records/admission`, 8 to 22 ms; `test/admit.test.ts`). A create waiting for room holds no row, so it is not counted against its owner. |
| An older registry | A registry made before rows named their hub has no `hub` column: the first claim that meets that adds it and its index (`prepareRegistry`, one transaction under its own lock, since two claims at once doing it collided in `records/admission`) and tries again. `platform up` adds it too. Rows of worlds created before have no hub and are not counted. |

What it costs, at most, from Cloudflare's prices (memory $0.0000025 a GiB-second, CPU $0.000020 a vCPU-second,
disk $0.00000007 a GB-second; CPU is billed on use, so provisioned CPU is an upper bound): one world running all
three containers is 0.8125 vCPU (1/16 + 1/4 + 1/2), 5.25 GiB (0.25 + 1 + 4) and 14 GB of disk (2 + 4 + 8), so
$0.0585 + $0.0473 + $0.0035 = **$0.109 an hour**. A full hub of 24 is **$2.62 an hour** while every world on it is in
use (containers stop after 10 idle minutes). A run is about 1.05 world-hours (run `run-138efc`: its own world 26
minutes, five others about 5 minutes each, one restore), about **$0.12**, so the $10 a day across Cloudflare and
Neon is about 80 runs of containers; the cap bounds the rate, not the day. 24 worlds is 126 GiB and 19.5 vCPU at
once, inside the account's limits on running containers as Cloudflare documents them (not measured here).

A world's branch is made by its create through Neon's API (`src/parts/database/neon.ts`), not by the stack: Alchemy's Neon
provider looks at a new branch's operations every 5 s, which cost 6 to 9 s of every create. The take-down deletes the
world's branches, children first, read from the branches themselves (`src/parts/database/branches.ts`, `dropBranches`).

| Part | What it is |
|---|---|
| Database | Its own copy-on-write branch of the platform's Neon project, made through Neon's API, with a Hyperdrive configuration in front of it for Core, its query cache off so a handler reads what it wrote. App data and the index's `ponder` schema live in it together. |
| Chain | Anvil 1.9.0 with `packages/contracts/state/core.json`, started with `--no-request-size-limit`, as a Cloudflare Container owned by a Durable Object. Its state is saved to an R2 bucket every 20 s while it is used and when it stops; it stops after 10 idle minutes and wakes on the next call. A save keeps how far anvil's clock runs from the host's, and a wake sets it again after loading the state (`evm_setTime`), since `anvil_loadState` restarts anvil's clock at the saved head: the chain's time runs on through a stop as a running world clock does (`clock` proof). A start Cloudflare refuses is tried again (Containers, below). |
| Index | The real Ponder app of `packages/indexer` (its ABIs, schema and handlers, unchanged), as a Cloudflare Container placed in western Europe, next to the world's branch, which it writes to; it is told the branch's connection string when it is first started. When the chain wakes, the index's Durable Object starts it again by itself, without the chain's call waiting on it. It is stopped with SIGTERM, and killed only if it has not exited 10 s later (`src/parts/containers/stop.ts`): a Ponder killed outright leaves its schema locked, and the next one on the database waits the lock out. |
| Bundler | Pimlico's alto 0.0.21, unpatched, as a Cloudflare Container owned by a Durable Object, serving the seeded EntryPoint v0.7 against the world's chain. It starts on its first call, stops with the chain (before the chain is saved) and starts again on the next call. Its executor and utility keys are Anvil's public test accounts 9 and 10 (`src/parts/bundler/Keys.ts`), funded from the chain's faucet when the world is created. |
| Test paymaster | The contracts package's `MockPaymaster`, which sponsors every UserOperation from its deposit at the EntryPoint. Put on the chain when the world is created, through the seed's CREATE2 deployer, so it is at `0xE2dE380E3e8281e2cc458675102c3FC2277fC5A8` in every world, with 1 ETH deposited. |
| Door | The hub's Worker in front of every world's chain, index and bundler. Every path starts with the world's token. |
| Core | The real Core (`packages/core`): the blueprint's two groups at `/platform` and `/world` with their empty handlers, the chain's reads at `/chain`, `/health`, and a read-only site probe. It binds the world's branch through Hyperdrive and the world's door through a service binding. |
| Sites | With `WORLD_BENCH` set and `--company` given, each company's Frappe site on that shared bench (`packages/platform`), made by the bench's site door with the world's own site token, at `<label>-<world>.<domain>`. |
| Test USDC | The contracts package's `MockERC20`, put on the chain when the world is created. Its open `mint` is the faucet. |
| Platform | `src/account`: the blueprint's platform group (`world.create`, `world.show`, `world.snapshot.save`, `world.snapshot.restore`), served over HTTP by the process that holds the keys (below). |

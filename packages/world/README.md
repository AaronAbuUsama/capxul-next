# @capxul/world

One command creates and destroys a private world: its database, its chain, its index, its bundler, its Core and its
companies' sites ([roadmap](../../docs/roadmap.md) steps 1.3, 1.4, 1.11 and 1.15). A world is one stage of the Alchemy stack `CapxulWorld` (its
Core and its database) plus Durable Objects named for it on a **fleet hub**, a stage of the stack `CapxulWorldHub` deployed
once (below); nothing of it lives on the machine that made it. Built on `alchemy` 2.0.0-beta.85 and Effect 4.1.2, run with Bun.

## The fleet hub (step 1.15)

Each kind of world container is ONE container application per hub, deployed once: anvil (`lite`), Ponder (`standard-1`)
and alto (`basic`), all three constrained to western Europe, next to the worlds' Neon project. The hub's stack
(`src/hub/stack.ts`) is its door Worker (`src/door/Door.ts`), the three Durable Object classes that own every world's
containers (`Chain`, `Indexer`, `Bundler`), the bucket the chains are saved to and an admin token. A world on the hub is
three Durable Objects named by the world's stage, placed in western Europe, plus its Neon branch, its Hyperdrive
configuration and its Core: `world create` deploys no container application.

| What | How |
|---|---|
| How a stage gets its hub | `./run.sh hub up [--hub <stage>] --owner <op> --lifetime "7 days"`, once; again on a live hub moves its expiry and changes nothing else. Every world made with `WORLD_HUB=<stage>` (default `fleet`) lives on it. `hub show` prints its owner, expiry, door and ledger; `hub down` is refused while a world names it or its ledger holds one. |
| Owner and lifetime | Recorded in the shared state before its deploy (at most `HUB_MAX_LIFETIME`, 30 days). No world may outlive its hub; the sweeper destroys an expired hub once no world is on it. |
| A world's token | `<stage>.<secret>`, one path segment, so every caller reaches a world as before, at `<door>/<token>/rpc`. `secret` is an HMAC of the world's stage, owner and expiry under the hub's admin token (`src/hub/hub.ts`), so it is stored only in the hub's registration and the world's Core, and worked out again by whoever reads the hub's admin token from the shared state. |
| Registering a world | Its create registers it (`POST /admin/<admin>/worlds/<stage>`, `src/hub/registration.ts`) right after its name is claimed: its chain's object keeps the registration and checks every call's token and the world's expiry against it (`src/chain/admission.ts`); the hub's bucket keeps a ledger entry. |
| Forgetting a world | Every take-down calls `POST /admin/<admin>/worlds/<stage>/forget`: the bundler's and index's containers and storage, the chain's container, every object of the world in the bucket (its saved state, its snapshots' states, then its ledger entry) and the chain object's storage and pending callbacks are removed. The world's token then reaches nothing (`404 no world is registered here`). |
| What an idle hub costs | Its applications keep instances placed in advance but run none: Cloudflare's own count of active instances is 0 for all three a few seconds after the last world goes (`records/hub.proof.json`, `containersAfter`, 16.4 s after the last destroy), and a container is billed only while active. What is left is the Workers plan, the bucket's and the objects' storage (a world's chain state is about 3.4 MB, removed with it) and nothing per hour. |

A world's branch is made by its create through Neon's API (`src/database/neon.ts`), not by the stack: Alchemy's Neon
provider looks at a new branch's operations every 5 s, which cost 6 to 9 s of every create. The take-down deletes the
world's branches, children first, read from the branches themselves (`src/platform/branches.ts`, `dropBranches`).

| Part | What it is |
|---|---|
| Database | Its own copy-on-write branch of the platform's Neon project, made through Neon's API, with a Hyperdrive configuration in front of it for Core, its query cache off so a handler reads what it wrote. App data and the index's `ponder` schema live in it together. |
| Chain | Anvil 1.9.0 with `packages/contracts/state/core.json`, started with `--no-request-size-limit`, as a Cloudflare Container owned by a Durable Object. Its state is saved to an R2 bucket every 20 s while it is used and when it stops; it stops after 10 idle minutes and wakes on the next call. A save keeps how far anvil's clock runs from the host's, and a wake sets it again after loading the state (`evm_setTime`), since `anvil_loadState` restarts anvil's clock at the saved head: the chain's time runs on through a stop as a running world clock does (`clock` proof). A start Cloudflare refuses is tried again (Containers, below). |
| Index | The real Ponder app of `packages/indexer` (its ABIs, schema and handlers, unchanged), as a Cloudflare Container placed in western Europe, next to the world's branch, which it writes to; it is told the branch's connection string when it is first started. When the chain wakes, the index's Durable Object starts it again by itself, without the chain's call waiting on it. It is stopped with SIGTERM, and killed only if it has not exited 10 s later (`src/containers/stop.ts`): a Ponder killed outright leaves its schema locked, and the next one on the database waits the lock out. |
| Bundler | Pimlico's alto 0.0.21, unpatched, as a Cloudflare Container owned by a Durable Object, serving the seeded EntryPoint v0.7 against the world's chain. It starts on its first call, stops with the chain (before the chain is saved) and starts again on the next call. Its executor and utility keys are Anvil's public test accounts 9 and 10 (`src/bundler/Keys.ts`), funded from the chain's faucet when the world is created. |
| Test paymaster | The contracts package's `MockPaymaster`, which sponsors every UserOperation from its deposit at the EntryPoint. Put on the chain when the world is created, through the seed's CREATE2 deployer, so it is at `0xE2dE380E3e8281e2cc458675102c3FC2277fC5A8` in every world, with 1 ETH deposited. |
| Door | The hub's Worker in front of every world's chain, index and bundler. Every path starts with the world's token. |
| Core | The real Core (`packages/core`): the blueprint's two groups at `/platform` and `/world` with their empty handlers, the chain's reads at `/chain`, `/health`, and a read-only site probe. It binds the world's branch through Hyperdrive and the world's door through a service binding. |
| Sites | With `WORLD_BENCH` set and `--company` given, each company's Frappe site on that shared bench (`packages/platform`), made by the bench's site door with the world's own site token, at `<label>-<world>.<domain>`. |
| Test USDC | The contracts package's `MockERC20`, put on the chain when the world is created. Its open `mint` is the faucet. |
| Platform | `src/platform`: the blueprint's platform group (`world.create`, `world.show`, `world.snapshot.save`, `world.snapshot.restore`), served over HTTP by the process that holds the keys (below). |

## Reset in place (step 1.16)

`./run.sh reset <name> --to <snapshot>` (in-process: `reset` from the package's door, `src/lifecycle/reset.ts`) rewinds
the SAME world to one of its snapshots: its name, door, Core, token and branch id stay; nothing is deployed. The
blueprint's `world.snapshot.restore` still makes a new world (its claims and decisions say so); the reset is the
world's own command, for a runner that keeps one world for its run (roadmap, "One runner, one world").

| Part | What | ms (`records/reset.proof.json`) |
|---|---|---|
| index stopped | Ponder sent SIGTERM, so it lets go of its schema lock | 359, 432 |
| database restored | Neon's restore of the world's branch from the snapshot's, in place (same id, compute and connection string, so Hyperdrive and Core carry on) | 1297, 1356 |
| chain reset | the chain's object: alto stopped, `anvil_reset` and `anvil_loadState` of the snapshot's state, which becomes the chain's saved state | 2165, 1814 |
| index resumed | Ponder started again on the restored schema and chain, not waited for here | 239, 242 |
| clock | Core's clock set to read the snapshot's time from now on (`app.clock`) | 1801, 1436 |
| chain mined at the world's time | the next block mined at that time by the chain's object itself, next to anvil (`POST /chain/mine-at`) | 278, 1738 |
| sites | each company site put back to the snapshot's point on the bench, or claimed from its template, then the bench's clock entry set to the world's (`src/site/Points.ts`, below) | none: no bench in this proof (see packages/runner's one-world records) |
| index caught up, bundler, Core | side by side: Ponder has the chain's head; alto names the EntryPoint; Core answers | 8694, 6670 (index) |
| **reset** | | **14836, 13690** |

The spike's two hard rules hold by construction. The chain is never put back without its database: the database is
restored first, and a reset that fails after it fails loudly, for its caller to destroy the world. A snapshot never
carries Ponder's lock: `world.snapshot.save` stops Ponder with SIGTERM before it takes the branch and the chain's state,
and resumes it after (`src/platform/snapshots.ts`).

**One clock.** Core's clock, the chain's and the bench's entry read the snapshot's time from the reset on. A mine sent
from the caller lagged Core's clock by up to 3 s (the slowest of its three calls through the door); the chain's object
now works the world's time out next to anvil. Measured on Cloudflare's own clock (the chain's time and Core's clock at
the instant the chain's object read it; this machine's clock is some hundreds of ms off Cloudflare's): 348 and 486 ms
apart after the two resets, chain time being whole seconds.

**The destroy-order bug** (spikes/world-speed, 5.10): Neon's restore makes the world's branch a child of the snapshot's,
and the world's old state a branch of its own (`<stage>-pre-<n>`) that the world's other snapshots hang from. A reset
deletes that branch at once when nothing hangs from it; a take-down deletes every branch of the world, children first,
read from the branches themselves, and treats one Neon is already deleting as gone (`dropBranches`). The proof's world,
reset twice, was destroyed in 4.5 s with nothing left.

**Company sites** (`src/site/Points.ts`). The bench's door has `POST /world/save` and `POST /world/reset`
(packages/platform, `door/points.py`, step 1.17); `world.snapshot.save` of a world with companies saves a point beside
the backup. A reset of a world with a bench puts its sites where the snapshot had them, then sets the bench's clock
entry to the world's clock (`POST /clock`), since the door puts back the entry as it was saved:

| The snapshot, and the world now | What the reset does |
|---|---|
| no company | removes every site the world holds, so a company founded again makes its own (`site-exists` otherwise) |
| its point holds every one of its sites | puts them back in place (`POST /world/reset`) and removes any site made since |
| its point lost its sites (a site removed by an earlier reset is dropped from every point by the door), or one was made again since (`point-site-missing`, `point-site-changed`) | removes the world's sites, claims them ready from the bench's template of the snapshot's name (`POST /world/claim`), and saves the point again, so the next reset is in place |

The bench's template is kept by `keepSitesAsTemplate(world, snapshot)` (`src/lifecycle/templates.ts`, `POST
/templates`, with a pool of ready copies) and dropped by `dropSitesTemplate`; a template is the bench's, so a world's
destroy leaves it. The reset answers how it put the sites back (`sites`: `none`, `in place` or `claimed`, with what it
removed and claimed). Run by the runner's one-world rehearsal against a local bench (packages/runner, step 1.18).

**A local bench.** `WORLD_BENCH=local` names a bench this machine serves itself, not a platform stage: packages/platform's
`bin/pool-bench.sh`, from the images already built. Its door's address and key are given as `WORLD_BENCH_DOOR` and
`WORLD_BENCH_KEY` (the runner's `run.sh` reads the key from the bench's secrets file and never prints it); every site
call of the world is otherwise the same (`src/site/Bench.ts`, `tokenFor`). Only this machine reaches it.

## Commands

`pnpm install` at the repository's root installs the package. From the root:

```bash
pnpm --filter @capxul/world world platform up      # once: the Neon project and the registry of world names
pnpm --filter @capxul/world world hub up --owner me --lifetime "7 days"   # once: the fleet hub every world runs on
pnpm --filter @capxul/world world create demo --owner me --lifetime "2 hours" [--from other] [--mint 0xADDRESS=250000000]
WORLD_BENCH=pr-site pnpm --filter @capxul/world world create demo --owner me --lifetime "2 hours" --company "acme=Acme Ltd"
pnpm --filter @capxul/world world destroy demo
```

Inside `packages/world`, `pnpm world <command>` and `./run.sh <command>` are the same command line:

```bash
./run.sh show demo [--reveal]              # the world's addresses; the chain's token only with --reveal
./run.sh reset demo --to s0                # rewind the world in place to its snapshot s0 (above)
./run.sh sql demo "select * from app.notes"
./run.sh list                              # every world in the shared state, with owner and expiry
./run.sh sweep [--dry-run]                 # destroy every expired world; remove what destroys leave behind
./run.sh inventory                         # what the two accounts hold, naming what is this stack's
./run.sh images                            # each image's pin and whether its inputs still match it
./run.sh platform down                     # refused while a world or a hub exists
./run.sh hub up|show|down [--hub <stage>]  # the fleet hub (above)
./run.sh prove <case>                      # the proofs below; each writes records/<case>.proof.json
```

A command prints its result as JSON on standard output (`pnpm --silent` keeps pnpm's own lines out of it) and its log
on standard error, and exits non-zero when it fails. The keys are the session's: the network proxy adds them to
requests for the Cloudflare and Neon API hosts, so `run.sh` only sets placeholders. Never run `alchemy nuke`, and
never deploy a world with the alchemy command line: `./run.sh alchemy` is for reading (`state list`, `drift`).

In-process, a scenario runner imports the package's door (`@capxul/world`):

```ts
const { record, used } = yield* withWorld({ name: "run-1", owner: "ci", lifetime: Duration.hours(1) }, (world) =>
  world.sql("select 1"),          // world.coreUrl, world.rpcUrl and world.bundlerUrl (secrets), world.sql, world.funded
);
```

Provide `SharedState.layer` over `Alchemist.layer()`. `spec.migrations` names Core's migrations directory.

### The platform (roadmap steps 1.6 and 1.12)

`src/platform` serves the blueprint's platform group with Effect's Rpc server at `PLATFORM_PATH`, on the loopback of
the machine that holds the Cloudflare and Neon keys (blueprint decisions.md, 51): in the runner's own process
(`packages/runner`, `src/worlds/platform.ts`), or by `./run.sh platform serve [--port 8790]`. Its sign-in and its
spans are Core's middlewares; the first operator is `WORLD_OWNER` with `CAPXUL_PLATFORM_TOKEN`, the second
`WORLD_SECOND_OWNER` with `CAPXUL_SECOND_PLATFORM_TOKEN`.

| Operation | What it does |
|---|---|
| `world.create` | Refuses a real grade and a start before the seed (with an hour of room) before anything exists; then this package's create, with the chain's clock just after the seed and the owner operator's own token bound into Core (decisions 36); then the cast on the chain (`cast.ts`: dana, eli, sam and olga get a Safe claimed through Companies House's devnet claim role and 10,000 test USDC from the faucet, pat none; test accounts 4 to 8), the world's start block at its clock, its facts in its database (`packages/core/migrations/0003_world.sql`) and `world_created` as its record's first entry. It answers once Core has answered its health check ten times in a row. A failure after the claim destroys the world. |
| `world.show` | The shared state (owner, expiry, parked, door) and the world's database (contracts, clock, record head, cast; grade and parent from the record's latest `world_created`); its companies as its Core reads them (`GET /companies`, Core's `companiesOf`, which moves each site on towards ready). |
| `world.snapshot.save` | Owner only. Each of the world's company sites backed up on its bench under the snapshot's name (`src/site/Saved.ts`, the site door's `POST /world/backup`), a Neon branch of the world's branch with no compute (its expiry is lifted first: Neon will not fork a branch that has one), the chain's whole state saved in the world's R2 bucket under the snapshot's name (the door's `POST /chain/snapshot/<name>`), and a row in `platform.snapshots`; then `snapshot_saved`. A world with companies and no bench is a fault to save. |
| `world.snapshot.restore` | A template's to anyone, any other snapshot's to its owner; never past the source's expiry. A new world whose branch forks the snapshot's and whose chain adopts the saved state (`GET /chain/snapshot/<name>` of the source's door); its parent and clock rewritten, and its chain's next block mined at that clock's time, so the chain reads the world's one clock (the chain was loaded with the snapshot's head and runs on from it: `clock` proof); each site the snapshot saved made again in it from its backup, under its own label, on the new world's clock and with its site credential (the site door's `POST /world/restore`, with the source world's token shown too), and its companies pointed at their new sites; then its own `world_created`. |

What the platform keeps of its own is in the schema `platform` of the registry's branch: `platform.spans` (every
platform call's spans), `platform.calls` (the world each successful call acted on, whose record holds its events) and
`platform.snapshots`. A world's take-down deletes its snapshot branches before its own (`dropSnapshots`), so a world
restored from a snapshot must go first, which its expiry makes so.

### Core's slot, or a host of Core

A caller may run every world's Core itself instead (`src/core/host.ts`, `CoreHost`, provided around the platform):
the stack then deploys no Core Worker but keeps Core's secrets (`operator-token`, `site-key`, `site-secret`), the
world's door is where the host says its Core will answer, the `core` step starts it there before waiting for its
health, and every take-down stops it. The runner's `--core=local` rehearsal is the one host (`packages/runner`,
`src/local/`); a world made with it says so in every record the runner writes.



`src/core/Core.ts` is the one place that says what runs as Core: `packages/core`'s Worker, handed the world's own
facts through Core's `CoreDeployment` (never its own stage's): the world's branch through `WorldDatabase`, the
world's token (the door's `door-token`, which Core's world door and
its chain reads accept), the owner operator's token (`operator-token`: Core's platform door, and the world's door as
its owner, blueprint decisions 36), a service binding to the world's door for the chain, and, when the world has a
bench, the site door's address, the world's site token and the credential of the API user the door makes on each site
(`site-key`, `site-secret`). Every token is an `Alchemy.Random` of the stage, bound as a secret and read back from the
state (`World.doorToken`, `World.operatorToken`), never an output. `CORE_MIGRATIONS` is Core's `migrations/`. A world
is ready once Core answers 200 on `CORE_HEALTH`, Core's `/health`. A caller can also provide its own `Core` for one run.

The proof that a world made by `world create` answers every blueprint operation at its door is the runner's door
check, run against such a world: `packages/runner/records/w-c1/door.json` (`passed`: all twelve answered
`NotImplemented` through the SDK, every span, outcome and events check held, the spans read from the world's own
database). Core's `/chain` answered `eth_blockNumber` from the world's chain and refused `eth_sendTransaction` with
JSON-RPC's -32601 (run by hand, not recorded).

### A company's site (step 1.4)

`src/site/Bench.ts`, and two steps of a world's life:

| When | What |
|---|---|
| claim | With `WORLD_BENCH=<platform stage>`, the world's site token is minted under that platform's door key (read from the shared state with the world's own store, `@capxul/platform`'s `doorKeyIn` and `mint`), for this world, `WORLD_MAX_SITES` (3) sites and the world's expiry. The bench is written into the world's record before anything exists, and into its outputs. |
| deploy | Core is deployed with the token and the site door's address (src/core/Core.ts). |
| `site`, after `core` | Each company of `spec.companies` (`--company label=Name,...`): the door makes the site with the world's token and the world's site credential, and the step waits until every site is ready (declared timeout 8 minutes). |
| `unsite`, before `destroy` | Every take-down (a destroy, a failed or interrupted run, a failed create, the sweeper) removes every site of the world from the bench its record names, with a token minted anew (quota 0, 15 minutes: the world's own may have expired), and checks the door holds none. If that fails, the world's Cloudflare and Neon resources are still destroyed, but its record and name are kept, so the next sweep removes the sites. |

Why here: the world owns what runs where and is the only thing that lives and dies with its sites, so making and
removing them are world steps; reaching a site is what Core's operations will do, so that is a Core service
(`packages/core`, `SiteDoor`), which reads the token and credential the world bound into it. The site door
(`packages/platform`, `door/door.py`) is the only process that makes or removes sites, and the only way to a site: it
checks the token's world against the site's on every call and carries ERPNext's REST calls on the site's own API user.
Until `org.create` makes a company's site, the world makes it at create; one credential serves the world's sites.

### How Core reaches the bundler

The bundler is reached exactly as the chain is: through the world's door, under the world's token. The chain is at
`<door>/<token>/rpc` and the bundler beside it at `<door>/<token>/bundler` (`BUNDLER_PATH`), speaking ERC-4337
JSON-RPC (`eth_sendUserOperation`, `eth_getUserOperationReceipt`, `eth_estimateUserOperationGas`,
`pimlico_getUserOperationGasPrice` and the rest). The world's handle carries it as `world.bundlerUrl`, a `Redacted`
like `world.rpcUrl`, with `world.entryPoint` and `world.paymaster` beside it; the command line prints all three
(`show`, `create`), the token hidden unless `--reveal`. A Core that reaches its chain through the world's door, by a
service binding to the door Worker and the door's token (`/<token>/rpc`), reaches the bundler over the same binding
with the same token at `/<token>/bundler`: no new binding or secret. Once alto has started, a later start uses the
chain address of its first start (the create's, through the door's public address), so a call that arrives over a
service binding starts it correctly. Core needs nothing else: the EntryPoint (`ENTRY_POINT`) and the test paymaster
(`TEST_PAYMASTER`) are the same in every world and exported by the package's door, with `bundlerCall`, one JSON-RPC
call to a world's bundler. A UserOperation sponsored by the test paymaster names it in `paymaster` with
`paymasterData` `0x`; the paymaster checks nothing. A call to the bundler wakes a stopped chain and starts alto if it
is stopped (about 8 s, `records/spike-bundler`).

### Containers: a refused start is tried again

Cloudflare refuses to start a container now and then: "There is no container instance that can be provided to this
Durable Object, try again later". It does so for a while on a container application the deploy has just made, until
the application has instances, and again, now and then, when a world's container has stopped or gone away and its
Durable Object starts it anew. Often the start call itself is accepted and the refusal comes from the first call to the
container after it, or the container is gone again within seconds. So the chain, the index and the bundler start their
containers through one helper, `src/containers/patience.ts`:

- Each try starts the container if it is not running, together with that first call (its inactivity timeout), then asks
  whether it is ready: the chain answers `eth_chainId`, Ponder's server answers `/health`, alto names the EntryPoint.
- A refused try doubles the wait before the next (1, 2, 4, 4 ... s); a container that runs but does not answer yet is
  looked at again after 1 s. No try begins once it could not finish inside the window, and the whole is cut off at it.
- Every try is written down with when it began, how long it took, whether it asked Cloudflare to start the container,
  how it ended and why: in the part's own record (`GET /chain/status`, `/index/status`, `/bundler/status`), under each
  start (`attempts`, `startCalls`, `refusals`), and under `gaveUp` for a start that never got ready.

| Part | Window | Inside the step | Set from |
|---|---|---|---|
| Chain | `CHAIN_START`, 2 min | `chain`, 3 min | anvil answers within 1 to 3 s of an accepted start; the chain step's slowest recorded run, a restore copying its source's state, took 46.7 s |
| Index | `INDEX_START`, 4 min | `index`, 5 min | below (Timings, the index step) |
| Bundler | `BUNDLER_START`, 4 min | `bundler`, 5 min | as before: alto's first start took 2 to 13 start calls on a new application (`records/spike-bundler`) |

`test/patience.test.ts` runs the helper against a stubbed refusal (two refusals then a start; a refusal for good,
which gives up inside its window with every try; a container that runs but does not answer yet; a try that hangs) and
checks that each step's declared timeout holds its part's window and a minute more. A chain that never answers fails
the call that woke it with `ChainFailed` (`start`), naming its tries; a refused index never fails or holds up a chain
call: the chain asks for it (`resume`) and the index's Durable Object starts it from a durable callback, which a stop
cancels.

### Images

`capxulworld-anvil`, `capxulworld-ponder` and `capxulworld-alto` are shared by every world and belong to the platform.
Each is pinned in `src/stack/images.ts`: the digest it was published as, and a fingerprint of what it was built from.
The fingerprint reads only the files its Dockerfile can see (its `.dockerignore` followed), and reads each `node_modules`
folder as the lockfile and settings it is installed from, so it takes milliseconds and is the same however, or
whether, `node_modules` is installed. A deploy whose fingerprint matches the pin deploys the image by digest and hashes
no build context; `./run.sh images` prints each pin, the fingerprint now and whether they match.

Before the pins, Alchemy hashed each build context file by file on every deploy (Alto's 237 MB of `node_modules`
20.9 s, Ponder's 10.8 s: `spikes/world-speed`, 1.2), and named the image by that hash, which changes with how
`node_modules` was installed: in a container whose install differs, a create spent 39.6 s (Alto) and 26.8 s (Ponder) hashing and asking the registry, found no
such image and tried to build it (`records/speed/before-create-ewb1.*`, failed at the build: this container's Docker has
no daemon). With the pins, the deploy is 35.6 s and the create 81.0 s with no `node_modules` installed at all
(`records/speed/after-create-*`), against a deploy of 60.6 s and a create of 95.4 s before (`spikes/world-speed`,
`e1-create-wsb2`). The `patience` proof's four creates, run before and after: deploy 53.8 to 61.4 s before, 29.0 to
33.2 s after; create 92.5 to 108.1 s before, 48.5 to 81.0 s after (`records/p-pat-*.json`, and the same files at
`5693fc61`); what is left of a create is mostly the index's and the bundler's first starts, which Cloudflare refuses
for a while on a new container application.

When an image's inputs change (the indexer's code, a lockfile, a Dockerfile), its fingerprint no longer matches, and
the deploy logs so and builds by context as before: Alchemy tags the build with a hash of its inputs and reuses a tag
the registry already lists. The index's image copies `ponder/node_modules`: after a change to `ponder/package.json`,
run `pnpm install --ignore-workspace` in `ponder/`; the bundler's image copies `images/alto/node_modules` the same way.
Then pin it again: put the digest the deploy's log names ("using pre-pushed", "registry cache hit" or the push) and
the fingerprint `./run.sh images` prints into `PINS`.

In an agent's container the Docker daemon has no route out, so such a deploy builds the image and then fails at the
push. `images/publish.sh <repository:tag>...`, with the tags the failed deploy's log names, pushes them through the
session's proxy with curl; the next deploy then needs no Docker.

## The lifecycle rules, in code

| Rule | Where | How |
|---|---|---|
| 1. A run is one unit | `src/lifecycle/run.ts` | `withWorld` creates, runs the use, writes the record, destroys. The destroy cannot be interrupted and runs when the use fails, times out or the process is interrupted, also half-way through the create. `create` alone takes down whatever a failed create made. |
| 2. Owner and expiry | `world.ts`, `sweep.ts` | Both are checked (the blueprint's `OperatorName`; at most `WORLD_MAX_LIFETIME`, 7 days) and written to the shared state before anything exists. Neon deletes the branch by itself at the expiry; `sweep` reads only the shared state, destroys what has expired, and keeps and reports what has no readable expiry. |
| 2. One name, one world | `claim.ts` | The state store has no lock. A name is taken by inserting a row in a registry table on the platform's Neon branch, which Postgres makes atomic; only the holder creates. A taken name is the contract's `WorldExists`, an owner's sixth live world (`WORLD_MAX_PER_OWNER`, 5) its `WorldQuotaReached`. |
| 3. Keeping is explicit and time-limited | `run.ts`, `world.ts` | `keepOnFailure` is a duration, at most `WORLD_MAX_KEEP` (1 day) and never past the world's expiry. A kept world has its chain saved and both containers stopped, is marked `parked`, and its recorded expiry becomes the end of the keep, so the sweeper deletes it then. |
| 4. Destroy removes everything | `world.ts`, `account.ts`, `src/hub` | Side by side: the world forgotten on its hub (containers, objects' state, saved chain states), `alchemy destroy` of the stage, and every branch of the world, children first; then the stage's record and its name. Every proof lists both accounts before and after and compares them. Images belong to the platform and the hubs; `sweep` and `platform down` remove them once nothing accounts for them. A hub is destroyed by `hub down` or, once expired and empty, by the sweeper. |
| 5. Not on the agent's machine | `stack/engine.ts` | Every part runs on Cloudflare and Neon; the state is the account's shared store. |
| 6. Declared timeouts | `spec.ts`, `steps.ts`, `containers/patience.ts` | Each step runs under `WORLD_TIMEOUT_<STEP>`, and its duration is in the record however the step ended, interrupted included. A part's patience with a refused start is a declared window inside its step's timeout (`test/patience.test.ts`). |

Secrets: Alchemy prints and stores stack outputs in plain text, so neither the database's connection string nor the
door's token is an output. Both are read from the resources' own state in the shared store, held as `Redacted`, and
never printed. The connection string is also the index container's `DATABASE_URL` in Cloudflare.

## What is proven (13 November 2026, from a Claude cloud container)

Each proof is `./run.sh prove <case>`. It writes `records/<case>.proof.json`: its claim, its `outcome` (passed only
when every check held), each check, its observations, and the inventory of both accounts before and after. The run
records (`p-*.json`) are `withWorld`'s own, with every step's duration and declared timeout. The two accounts are
shared with other builders, whose worlds may be made or destroyed while a proof runs, so "the accounts hold what they
held before" compares everything except resources whose names carry another world's stage; the record keeps the
comparison of everything (`sameAsBeforeAccountWide`) and names the worlds it set aside (`otherWorlds`).

| Proof | What it shows | Records |
|---|---|---|
| `commands` | `world create` and `world destroy`, run as the pnpm commands above, each its own process: the world's chain answers as the seeded chain, the faucet funded the address asked for, the index is ready, Core answers `/health`, the database answers; after the destroy the accounts hold what they held before. | `commands.proof.json` |
| `fresh` | A world from nothing: a payment through its RPC address, and the faucet's mint, indexed into its database. A world forked from it starts with its row, its indexed payment and its balances; neither sees the other's writes. Both destroyed, nothing left. | `fresh.proof.json`, `p-fresh.json`, `p-fork.json` |
| `fails` | A use that fails is recorded `failed`, with why, and its world destroyed. | `fails.proof.json`, `p-fails.json` |
| `timeout` | A use that outlasts its declared 5 s is stopped at 5 s, recorded `timed out`, and its world destroyed. | `timeout.proof.json`, `p-slow.json` |
| `interrupted` | The command line, as its own process, is sent SIGINT during its use: it writes its record (`interrupted`), destroys the world, then exits 130. | `interrupted.proof.json`, `p-int.json` |
| `keep` | A failed run kept for 3 minutes: parked with chain and index stopped, kept by a sweep before the keep ends, destroyed by a sweep after. | `keep.proof.json`, `p-keep.json` |
| `race` | Two creates of one name at once: one world, one `WorldExists`, one world's resources in the accounts. | `race.proof.json` |
| `limits` | 8 days is `LifetimeTooLong`, an owner's sixth world `WorldQuotaReached`, a bad name `InvalidWorldName`; nothing is made. | `limits.proof.json` |
| `bundler` | A world made by `world create`, run as the pnpm command, with its bundler and test paymaster: a Safe owned by one of Anvil's public test keys sends one UserOperation, a 25 test USDC transfer signed through the Safe4337Module and sponsored by the paymaster, to the world's bundler. It lands as one transaction in its own block, sent by the bundler's executor to the EntryPoint, with one UserOperationEvent for it; the chain reads back the Safe's and the recipient's balances, the paymaster's deposit and the Safe's nonce; the index writes the transfer. Then `world destroy`, and the accounts hold what they held before. | `bundler.proof.json` |
| `sweep` | The sweeper, run as the command line with an empty home directory, keeps three worlds before an expiry; after it, destroys the expired one and keeps the live one and the one with no recorded expiry. | `sweep.proof.json` |
| `snapshot` | The platform's handlers make a world with its cast (four Safes of 10,000 USDC, pat with none), save it, refuse a second save of the name (`SnapshotExists`), a save by another operator (`NotWorldOwner`), a restore of a missing snapshot (`SnapshotNotFound`), one that outlives its source (`ExpiryBeyondSource`), another operator's restore of a snapshot that is not a template (`NotWorldOwner`) and a restore as a taken name (`WorldExists`); the first world then goes on (5 USDC more to dana's Safe); the restore names its parent, its record is the first world's birth and then its own, its chain holds what was saved and not what came after, and the first world is unchanged by it. Both destroyed, snapshot branch included, nothing left. | `snapshot.proof.json` |
| `clock` | Run again on the fleet hub, 14 November 2026, and passed. A world on a running clock two weeks behind the host (`p-clk`), saved 40 s after its create and restored 40 s after its save (`p-clk2`): a block mined then on the restored chain reads Core's clock (the world's `app.clock`, read as Core reads it) within a second (0.78 s), and again after its chain was stopped and woken from its saved state 30 s later (0.12 s); the first world's within 0.61 s. Before the restore mined its block at the world's time, the restored chain was 19.7 s behind Core (`speed/clock-before.proof.json`); with that block but before a wake kept the chain's clock, one run was 3.7 s behind (`speed/clock-align-only.proof.json`). Both destroyed, nothing left. | `clock.proof.json` |
| `patience` | Four worlds made one after another (`p-pat-1` to `p-pat-4`), each with its index step's duration and every try of each container start. Cloudflare refused the index's first start 0 to 6 times (tries spread over up to 25 s) and its restart after a chain stop in 5 of 8 cases; each was tried again until Ponder answered. In each world the chain was stopped right after the create, twice, and called at once: every call was answered (wake 0.9 to 1.7 s, one try each; none refused), and the index came back by itself 8.5 to 19.6 s later (11 to 23 s when Ponder was killed instead of stopped: every stop is now SIGTERM, on which Ponder exited in 0.2 to 0.5 s, and its next start was ready 7.5 to 11.4 s after it was accepted, against 9.2 to 19.1 s before). All four destroyed, nothing left. | `patience.proof.json`, `p-pat-1.json` to `p-pat-4.json` |
| `hub` | On the fleet hub, three worlds one after another, each made through the platform's `world.create` handler (its cast, its start block, its facts and `world_created` included) and destroyed before the next: each answered on every part (the chain's `eth_chainId`, the index ready, the bundler naming the EntryPoint, Core's health, four claimed Safes); each create under 20 s and each destroy under 8 s; a destroyed world's token reaches nothing on the hub; the hub's ledger holds none of them; the hub runs no container a while after; nothing of them is left in the accounts. Spans of the run in `records/hub/hub-spans.jsonl` (`WORLD_SPANS`). | `hub.proof.json`, `hub/hub-spans.jsonl`, `hub/up-*.log` (the hub's deploys: the first from nothing, and `up-6`, the one the proofs ran on) |
| `reset` | On the fleet hub, a world made by `world.create` on a clock three days behind, saved as `s0`, moved on (5 USDC more to dana's Safe, indexed; a second snapshot `s1`, one more record entry), left 20 s, then reset in place to `s0` twice: after each, `world.show` reads what it read at `s0` but its clock, which reads `s0`'s time since the reset; the chain and the index read `s0`'s balance and transfers; the chain's time reads Core's clock within a second; then the world is destroyed with nothing left, though its branch had become the snapshot's child. | `reset.proof.json`, `hub/reset-spans.jsonl` |
| `site` | Run with `WORLD_BENCH=pr-site`, a stand-in bench of `packages/platform` in this container (`PLATFORM_HOST=standin`, `PLATFORM_EDGE=none`). A world made with one company gets `acme-p-site.worlds.abuusama.dev`, ready in 93.5 s (new-site 21.3, ERPNext 42.8, capxul 3.0, wizard 16.5, migrate 5.8, scheduler 0.7, join the world 0.6, the API user 1.4). Through the door, on the site's own API user: the company's record (`Acme Ltd`), its Supplier list, `get_logged_user` answering `capxul-core@service.invalid` (never Administrator), and the site's clock reading world `p-site`. A second world, `p-site2`, made inside the first's run: its token is refused for the first world's site (`403 site-not-in-world`) and it sees no site. Both destroyed: the site removed in 1.8 s with its world, the door holding no site of either, the bench's folders, the door's registry and MariaDB's databases as before, and nothing of either world in either account. Core's probe at both worlds' doors answered the site door's typed failure `unreachable` (Cloudflare's own 403 for a loopback address): **Core reaching the site is recorded, not proven** (below). | `site.proof.json`, `p-site.json`, `p-site2.json`, `site-after.txt` (the bench's platform destroyed after, the zone at 66 records before and after) |

Every proof above but `site` and `hub` was run again after the patient starts (Containers, above) and passed; their
records are those runs', made before the fleet hub, when every world deployed its own containers. Only `hub` has been
run on the hub so far; the others' code was brought to it (one world is now 3 resources in the accounts, not 11) but
not run again. `site` was not: it needs the stand-in bench of `packages/platform` in the agent's container, which this
change does not touch.

## Timings on the fleet hub (step 1.15)

From `records/hub.proof.json` (14 November 2026, from a Claude cloud container near Cloudflare's IAD, the hub in
western Europe): `world.create` through the platform's handler, with its cast, took **18.4, 15.7 and 16.2 s**, and
`world destroy` **3.6, 3.9 and 3.6 s**. The first create in a process is the slowest (Core's bundle is made then; one
other run's first create, in `records/reset.proof.json`, took 20.2 s before its view stopped being read back). Where a create's time goes, from its spans (`records/hub/hub-spans.jsonl`):

| Lane | Step | s | |
|---|---|---|---|
| | claim | 0.4 to 0.7 | The registry's row and the world's record. |
| chain | register | 1.1 to 1.6 | The hub's admin call: the chain's object and the ledger. |
| chain | chain | 1.3 to 1.5 | anvil from the seed on the hub's warm application: no refused start. |
| chain | fund, bundler | 0.7 to 0.9, 9.6 to 10.8 | The faucet; the bundler's accounts and paymaster (2.9 to 3.1), then alto's start (4.7 to 7.7) beside the cast (6.1 to 7.4). |
| database | branch | 1.9 to 2.6 | Neon's API, looked at every 250 ms. |
| database | migrate | 0.8 | |
| database | index | 8.7 to 13.1 | Ponder on `standard-1`, started once the branch and the chain are there. |
| database | deploy | 9.1 to 11.5 | Alchemy: the plan (0.5 to 0.9, the shared state store reused), the Hyperdrive configuration (2.3 to 2.6), Core's Worker (bundled and uploaded, 6 to 8). |
| database | core | 3.1 to 3.3 | Core's health answered ten times in a row, 250 ms apart (`src/platform/steady.ts`). |
| | facts | about 0.6 | After the lifecycle: the world's facts and `world_created`, side by side; its view is what was made, not read back (its start block is mined at the end of the chain's lane, `startAtMs`). |

The critical path is the claim, the branch, Core's deploy and its steady answers; the index runs beside it. Before the
hub a create was 95 to 102 s (below) and a destroy 13.5 to 19.5 s.

## Timings before the fleet hub

From the records as they were at `20833298` (the proofs' records were made again since, on the patient starts of
Containers above; the index step's own numbers are below), all made on 13 November 2026 with the images already published, every world with its
bundler: eight creates one at a time (`bundler`, `commands`, `fresh` and its fork on the line with the real Core and
the site step; `fails`, `timeout`, `interrupted` and `keep` just before it, with the stand-in Core), three at once in
one process (`sweep`, stand-in Core), and seven destroys. "Before" is the same table from the ten creates recorded
before the bundler was added (the records at `1fd8698e`).

| Step | Median s | Range s | Before | Where the time goes |
|---|---|---|---|---|
| claim | 0.9 | 0.6 to 1.0; 0.8 to 1.2 three at once | 0.9 | One transaction on the registry branch, and the world's record in the shared state. |
| deploy | 60.5 | 53.7 to 63.6; 89 to 90 three at once | 45.8 | Alchemy: the Neon branch and Hyperdrive, two Workers, and three container applications, each created and then created again to attach its Durable Object. |
| migrate | 0.8 | 0.5 to 1.3 | 0.8 | Over Neon's HTTPS endpoint. |
| chain | 2.5 | 2.2 to 7.2; 2.1 to 2.5 three at once | 2.4 | Anvil's first start from the seed; a fork first copies its parent's state. |
| fund | 0.5 | 0.1 to 1.3 | 0.3 | The token's deployment and one transaction for each mint. |
| bundler | 16.7 | 11.7 to 44.6; 36 to 45 three at once | none | Beside the index step: the bundler's accounts funded, the paymaster deployed and funded (two transactions), then alto's first start on its new container application, which takes several start calls (2 to 13) and deploys alto's simulation contracts. A fork has the paymaster and the contracts already. |
| index | 36.8 | 23.6 to 46.4; 27 to 128 three at once | 46.5 | Cloudflare refusing the Ponder container's first start, then Ponder's own start on 1/4 vCPU. Since Ponder runs next to the database: 13.5 to 38.0 s (The index step, below). |
| core | 0.6 | 0.4 to 1.0 | 0.5 | Until Core's address answers `/health`: the real Core's 0.4 to 0.7 s, the stand-in's 0.5 to 1.0 s. |
| site | 93.5 | one run | none | The site door making one company's site (`site` above). |
| unsite | 1.8 | one run | none | `bench drop-site` of the world's site; 0.4 s or less for a world with no site. |
| **create** | **102.6** | **91.7 to 111.7; 132 to 223 three at once** | **95.3** | From the claim to a world whose every part answers. |
| destroy | 16.2 | 13.5 to 19.5 | 13.5 | `alchemy destroy` of the stage and the stage's record; 16 to 19.5 s with the real Core, which has more resources. |
| release | 0.3 | 0.3 to 0.6 | 0.2 | The name's row. |
| park | 5.1 | one run | 6.2 | Saving the chain and stopping the bundler and both containers. |

So the bundler adds about 15 s to a create, all of it in the deploy: one more container application, created and
created again to attach its Durable Object. Its own step runs beside the index's and outlasted it in two of eleven
creates, by 1.8 s and 9.1 s. A create is still nearly all Alchemy's deploy and the index's first start; neither was
attacked here. When an image must be rebuilt, the deploy also builds and publishes it.

From the bundler proof (`bundler.proof.json`): `eth_sendUserOperation` answered in 0.20 s and the operation's receipt
came 1.04 s after the send; the index wrote its transfer 9.1 s after the receipt. Stopping the bundler with the
chain took 0.39 s; after the stop, the next UserOperation woke the chain and alto (one start call, 5.8 s for alto)
and had its receipt 9.5 s after it was begun.

### The index step

Before this change, 32 creates recorded an index step (`packages/runner/records/run-717645` and `run-e710b3`, and
this package's records at `20833298`): median 39.4 s, 90th percentile 57.9 s, slowest 83.4 s one at a time and 128.3 s
three at once; a 33rd, `run-e710b3` `world.create 5`, ran out of the step's 180 s. Read from the spans of the runner's
records, the step was two things one after the other:

1. **Cloudflare refusing the start** of a container application the deploy had just made: the door's
   `POST /index/start` failed 0 to 18 times, three seconds apart, before one held (0 to 54 s; in `world.create 5`,
   every one of 59 for 180 s).
2. **Ponder's own start**, 20 to 30 s from the start that held to ready in every create, a fork's included.

Ponder's own metrics, now read into the index's record, split the second part: the process starts within a second of
the start (the image is pulled before), Ponder builds for about 8 s, then sets up its tables and syncs from the seed.
That last part was round trips to the world's branch: 17 to 21 s in 73 to 87 database calls with Ponder placed by
Cloudflare away from Neon's aws-eu-west-2, about 3 s with Ponder placed in western Europe. The sync itself is 2 to 3 s;
neither the image pull nor Neon's own start is a part that matters.

| Index step | Creates | Refused start | Accepted to ready | Step |
|---|---|---|---|---|
| Before (32 creates, records above) | 32 | 0 to 54 s (one for 180 s and more) | 20 to 30 s | median 39.4 s, 13.5 to 128 s |
| After (`patience.proof.json`, four in a row) | 4 | 0 to 6 refusals, up to 25 s | 8.4 to 15.0 s | 13.5, 18.2, 34.2, 38.0 s |

So the step is faster by the 10 to 15 s Ponder no longer spends crossing an ocean, and patient where it cannot be
faster: the refusals are Cloudflare's. **How its timeout was set:** the index step's declared timeout
(`WORLD_TIMEOUT_INDEX`) goes from 3 to 5 minutes: `INDEX_START`, 4 minutes, for the refusals, as long as the bundler,
whose start Cloudflare refuses in the same way on the same kind of application, has had without running out in any
recorded create, and longer than the 180 s the one failed create was refused for; then a minute for Ponder's own start,
twice the slowest measured before the move (29.8 s). It is a lifecycle limit, not a budget: nothing fails for being
slower than the median. The bundler's and the chain's timeouts are unchanged.

## What was learned on the way

- **A Durable Object stays where it was first made.** Before the hub's objects were placed in western Europe, a world's
  chain object was made where its first caller was (this container, near IAD), and Ponder in western Europe spent 9 s of
  its 12 s start on 22 calls to the chain through it (the first hub worlds, 14 November 2026). Every object of the hub is
  now made with `locationHint: "weur"` (`src/hub/names.ts`); a hint places an object only when it is first made, so the
  trial worlds' names `w-f1` to `w-f5` keep objects (emptied) in the US.
- **Cloudflare's count of a hub's active containers lags.** Right after the last world was forgotten each application
  still showed one active instance; about 16 s later none (`records/hub.proof.json`).

- **Neon refuses to fork a branch that has an expiry of its own** ("Branches with an expiration date cannot have
  child branches"). A world that another is made from therefore has its Neon expiry taken off; its record says so,
  and the sweeper alone deletes it, at the same recorded expiry. A fork must be destroyed before its parent.
- **The real index runs as it is, except for its configuration.** `ponder/ponder.config.ts` names the same six
  contracts and block handler, with `reorgWindow: 0` (the seeded chain keeps nine blocks, and Ponder's default looks
  180 s back), a one-second poll, and addresses from the contracts' deployment record. The seed's own history holds
  no event the real app handles, so the events shown are the faucet's mint and a payment.
- **A fork carries its parent's index.** Ponder resumes from the forked `ponder` schema; the chain's state is copied
  after the database is forked, so the chain is never behind the index. Fork a quiet world.
- **The Docker daemon of an agent's container cannot push.** See Images above.
- **anvil answers `null` to `anvil_setBalance`**, which the world's chain call takes for no answer, so the bundler's
  setup judges the faucet by reading the balance back.
- **The bundler's first start takes several start calls, as in the spike.** On a new container application a start
  is refused or lost for a while after the deploy, and the Durable Object starts alto again every second, for up to
  240 s, until it serves the EntryPoint. The committed record's first start took 2 start calls and 11.2 s; the
  other runs of the bundler proof in this session took 4 to 13 (17.7 to 28.4 s).
- **The bundler keeps the chain address of its first start.** The door gives alto the chain's quiet address built
  from the request's host, which is right for a call through the door's public address (the create's) and wrong for
  one over a service binding, so a later start uses the first one. It holds the door's token, so it is kept apart
  from the record that `/bundler/status` gives out.
- **The accounts are shared with other builders.** While these proofs ran, another builder's worlds were made and
  destroyed in the same accounts, and failed the account-wide "same as before" check of six proof runs; see What is
  proven. Two failures had nothing to do with the bundler, and the next run of each passed: one `commands` run's
  deploy was refused by Cloudflare while creating the Core Worker (`WorkerNotFound`), and in one `sweep` run one of
  its three simultaneous worlds' chains never answered within the chain step's 180 s. Each create removed what it had
  made. On the line with the real Core, two runs of the bundler proof had the chain's container go away during the
  proof's own use, just after the create, and Cloudflare then refused to start it again ("There is no container
  instance that can be provided to this Durable Object, try again later"). The chain did not try that start again; it
  now does (Containers, above).
- **A refused start often looks accepted.** Cloudflare takes the start call and then fails the first call to the
  container after it with the refusal, or lets the container go within seconds. The index's start used to end at the
  accepted call, so its refusals failed `POST /index/start` outside its Durable Object and were seen only as a step that
  took longer; in `run-e710b3`, `world.create 5`, all 59 of those calls failed for the step's 180 s and nothing said
  why. A start now holds only once the container answers, and each refusal is in the record.
- **Two runs of the snapshot proof failed before one passed**, after the change, both in the create of its first
  world. In one, the index step ran out of its 5 minutes; its account was not kept then (a timed-out index step now
  carries the index's own record in its failure, `src/index/account.ts`, since that record is destroyed with the
  world). In the other, the bundler's setup read back 0 wei after `anvil_setBalance` 17 s after the chain first
  answered, as if the chain had restarted from its seed: its container gone before its first save (every 20 s). Each
  create removed what it had made; the third run passed.
- **Ponder's start was mostly round trips to Neon.** Ponder ran wherever Cloudflare placed it, an ocean from the
  world's branch in aws-eu-west-2: 17 to 21 s of its 22 to 24 s to ready went to 73 to 87 database calls (Ponder's own
  `ponder_database_method_duration`, read from its `/metrics` into the index's record: `create_trigger` 6 s for 14,
  `migrate` 5.4 s for 28). Placed in western Europe (`constraints.regions`), the same calls take about 3 s.

## Not done

- **Only the `hub` and `reset` proofs (and `clock`) ran on the fleet hub.** The others were brought to it in code (one
  world is 3 resources in the accounts, not 11) but their records predate it.
- **`world.create` under 20 s holds with little room**: 15.7 to 18.4 s in the `hub` proof, once 20.2 s. What is left is
  Core's own deploy (its bundle, 3 to 4 s of this machine's CPU, and its upload) and its steady answers; Core's bundle
  could be made once per hub instead of once per world.
- The blueprint's `world.snapshot.restore` still makes a new world; the reset in place is this package's command. Making
  the operation itself rewind the world would change its claims (it now refuses a restore as the world's own name).
- A hub's world names keep their Durable Objects where they were first made (What was learned).

- Nothing schedules `sweep`. Until something does, a world that was forked from, a parked world and a half-created
  world wait for whoever runs it (Neon still deletes their branches at their expiry).
- **Core reaching a company's site is not proven.** Core runs on Cloudflare; the only bench there is now is the
  stand-in in an agent's container, which nothing on Cloudflare can reach: a tunnel's token is a credential the
  container may not create (`packages/platform/records/spike/01`), its proxy carries no WebSocket, and a home-made
  relay into the container was refused by the session's policy as an inbound tunnel. The route is built and its
  failure is typed; it is proven once the AWS bench and its Cloudflare Tunnel are up (roadmap 2.1, Aaron's bootstrap),
  by `WORLD_BENCH=staging ./run.sh prove site` with the probe check turned to a read.
- The sweeper's removal of an expired world's sites is the same `unsite` step as every take-down; no proof runs it on
  an expired world with a site.
- A company's site is saved with a snapshot and made again by a restore (blueprint decisions 52), rehearsed only on a
  stand-in bench with Core run locally (`packages/runner`, `--core=local`): Core on Cloudflare cannot reach a bench
  yet (step 1.4).
- The platform answers only on the machine that serves it. A caller elsewhere (a shared world's people) needs it hosted,
  which is a question for Aaron (blueprint decisions.md, 51).
- The index polls through the door, so a busy world makes about one Worker request a second for it. What an idle or a
  busy world costs was not measured.
- Who the cast is and how a mint is booked is not here: `spec.mint` is only the hook.
- The bundler: a signed paymaster (a verifying paymaster with a key and a validity window) and ERC-7677's `pm_*`
  methods; alto's safe mode (it runs with `ALTO_SAFE_MODE=false`: no ERC-7562 tracing, which anvil's tracer cannot
  give, and no stake checks); a UserOperation in alto's mempool when the world stops, which is lost, because alto
  keeps its mempool in memory; what alto's polling costs (about one `/quiet-rpc` Worker request a second while it
  runs). A paymaster with a validity window would also meet alto's wall clock against the seeded chain's, which is
  weeks behind.
- The chain's refused start was not provoked on purpose: stopping its container and calling it at once was not refused
  in the runs recorded here (the index's restart, right beside it, was). The chain's retry is the same helper the index
  and the bundler use, shown live by them and against a stubbed refusal by `test/patience.test.ts`.
- What is left of the index's time once Cloudflare accepts its start is mostly Ponder's own build, about 8 s on 1/4
  vCPU before its sync begins; a larger instance was not tried.
- The index records a UserOperationEvent only for a Safe claimed through Companies House (`known_safes`), so the
  bundler proof's Safe, made directly through the factory, is seen in the index by its transfer, not in
  `ponder.user_operations`.

`src/stack` is the stack and the only code that drives Alchemy, `src/database`, `src/chain`, `src/index`,
`src/bundler`, `src/door` and `src/core` are the world's parts, `src/lifecycle` is the rules, `src/failures.ts` the
package's own failures, `src/cli` and `src/main.ts` the command line, `src/proofs` the proofs, `ponder/` and
`images/` the three images. `records/spike-bundler/` is the record of `spikes/bundler`, the spike that proved the
bundler before it moved here, with that spike's README.

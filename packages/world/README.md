# @capxul/world

One command creates and destroys a private world: its database, its chain, its index, its bundler, its Core and its
companies' sites ([roadmap](../../docs/roadmap.md) steps 1.3, 1.4 and 1.11). A world is one stage of the Alchemy stack `CapxulWorld`; nothing of it
lives on the machine that made it. Built on `alchemy` 2.0.0-beta.85 and Effect 4.1.2, run with Bun.

| Part | What it is |
|---|---|
| Database | Its own copy-on-write branch of the platform's Neon project, with a Hyperdrive configuration in front of it for Core, its query cache off so a handler reads what it wrote. App data and the index's `ponder` schema live in it together. |
| Chain | Anvil 1.9.0 with `packages/contracts/state/core.json`, started with `--no-request-size-limit`, as a Cloudflare Container owned by a Durable Object. Its state is saved to an R2 bucket every 20 s while it is used and when it stops; it stops after 10 idle minutes and wakes on the next call. A start Cloudflare refuses is tried again (Containers, below). |
| Index | The real Ponder app of `packages/indexer` (its ABIs, schema and handlers, unchanged), as a Cloudflare Container placed in western Europe, next to the world's branch, which it writes to. When the chain wakes, the index's Durable Object starts it again by itself, without the chain's call waiting on it. |
| Bundler | Pimlico's alto 0.0.21, unpatched, as a Cloudflare Container owned by a Durable Object, serving the seeded EntryPoint v0.7 against the world's chain. It starts on its first call, stops with the chain (before the chain is saved) and starts again on the next call. Its executor and utility keys are Anvil's public test accounts 9 and 10 (`src/bundler/Keys.ts`), funded from the chain's faucet when the world is created. |
| Test paymaster | The contracts package's `MockPaymaster`, which sponsors every UserOperation from its deposit at the EntryPoint. Put on the chain when the world is created, through the seed's CREATE2 deployer, so it is at `0xE2dE380E3e8281e2cc458675102c3FC2277fC5A8` in every world, with 1 ETH deposited. |
| Door | A Worker in front of the chain, the index and the bundler. Every path starts with the world's token. |
| Core | The real Core (`packages/core`): the blueprint's two groups at `/platform` and `/world` with their empty handlers, the chain's reads at `/chain`, `/health`, and a read-only site probe. It binds the world's branch through Hyperdrive and the world's door through a service binding. |
| Sites | With `WORLD_BENCH` set and `--company` given, each company's Frappe site on that shared bench (`packages/platform`), made by the bench's site door with the world's own site token, at `<label>-<world>.<domain>`. |
| Test USDC | The contracts package's `MockERC20`, put on the chain when the world is created. Its open `mint` is the faucet. |
| Platform | `src/platform`: the blueprint's platform group (`world.create`, `world.show`, `world.snapshot.save`, `world.snapshot.restore`), served over HTTP by the process that holds the keys (below). |

## Commands

`pnpm install` at the repository's root installs the package. From the root:

```bash
pnpm --filter @capxul/world world platform up      # once: the Neon project and the registry of world names
pnpm --filter @capxul/world world create demo --owner me --lifetime "2 hours" [--from other] [--mint 0xADDRESS=250000000]
WORLD_BENCH=pr-site pnpm --filter @capxul/world world create demo --owner me --lifetime "2 hours" --company "acme=Acme Ltd"
pnpm --filter @capxul/world world destroy demo
```

Inside `packages/world`, `pnpm world <command>` and `./run.sh <command>` are the same command line:

```bash
./run.sh show demo [--reveal]              # the world's addresses; the chain's token only with --reveal
./run.sh sql demo "select * from app.notes"
./run.sh list                              # every world in the shared state, with owner and expiry
./run.sh sweep [--dry-run]                 # destroy every expired world; remove what destroys leave behind
./run.sh inventory                         # what the two accounts hold, naming what is this stack's
./run.sh images                            # each image's pin and whether its inputs still match it
./run.sh platform down                     # refused while a world exists
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
| `world.snapshot.restore` | A template's to anyone, any other snapshot's to its owner; never past the source's expiry. A new world whose branch forks the snapshot's and whose chain adopts the saved state (`GET /chain/snapshot/<name>` of the source's door); its parent and clock rewritten; each site the snapshot saved made again in it from its backup, under its own label, on the new world's clock and with its site credential (the site door's `POST /world/restore`, with the source world's token shown too), and its companies pointed at their new sites; then its own `world_created`. |

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
`e1-create-wsb2`).

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
| 4. Destroy removes everything | `world.ts`, `account.ts` | `alchemy destroy` of the stage, then the stage's record and its name. Every proof lists both accounts before and after and compares them. Images belong to the platform; `sweep` and `platform down` remove them once nothing accounts for them. |
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
| `patience` | Four worlds made one after another (`p-pat-1` to `p-pat-4`), each with its index step's duration and every try of each container start. Cloudflare refused the index's first start 0 to 6 times (tries spread over up to 25 s) and its restart after a chain stop in 5 of 8 cases; each was tried again until Ponder answered. In each world the chain was stopped right after the create, twice, and called at once: every call was answered (wake 0.9 to 1.7 s, one try each; none refused), and the index came back by itself 11 to 23 s later. All four destroyed, nothing left. | `patience.proof.json`, `p-pat-1.json` to `p-pat-4.json` |
| `site` | Run with `WORLD_BENCH=pr-site`, a stand-in bench of `packages/platform` in this container (`PLATFORM_HOST=standin`, `PLATFORM_EDGE=none`). A world made with one company gets `acme-p-site.worlds.abuusama.dev`, ready in 93.5 s (new-site 21.3, ERPNext 42.8, capxul 3.0, wizard 16.5, migrate 5.8, scheduler 0.7, join the world 0.6, the API user 1.4). Through the door, on the site's own API user: the company's record (`Acme Ltd`), its Supplier list, `get_logged_user` answering `capxul-core@service.invalid` (never Administrator), and the site's clock reading world `p-site`. A second world, `p-site2`, made inside the first's run: its token is refused for the first world's site (`403 site-not-in-world`) and it sees no site. Both destroyed: the site removed in 1.8 s with its world, the door holding no site of either, the bench's folders, the door's registry and MariaDB's databases as before, and nothing of either world in either account. Core's probe at both worlds' doors answered the site door's typed failure `unreachable` (Cloudflare's own 403 for a loopback address): **Core reaching the site is recorded, not proven** (below). | `site.proof.json`, `p-site.json`, `p-site2.json`, `site-after.txt` (the bench's platform destroyed after, the zone at 66 records before and after) |

Every proof above but `site` was run again after the patient starts (Containers, above) and passed; their records are
those runs'. `site` was not: it needs the stand-in bench of `packages/platform` in the agent's container, which this
change does not touch.

## Timings

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

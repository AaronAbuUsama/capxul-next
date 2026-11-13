# @capxul/world

One command creates and destroys a private world: its database, its chain, its index, its bundler, its Core and its
companies' sites ([roadmap](../../docs/roadmap.md) steps 1.3, 1.4 and 1.11). A world is one stage of the Alchemy stack `CapxulWorld`; nothing of it
lives on the machine that made it. Built on `alchemy` 2.0.0-beta.85 and Effect 4.1.2, run with Bun.

| Part | What it is |
|---|---|
| Database | Its own copy-on-write branch of the platform's Neon project, with a Hyperdrive configuration in front of it for Core, its query cache off so a handler reads what it wrote. App data and the index's `ponder` schema live in it together. |
| Chain | Anvil 1.9.0 with `packages/contracts/state/core.json`, started with `--no-request-size-limit`, as a Cloudflare Container owned by a Durable Object. Its state is saved to an R2 bucket every 20 s while it is used and when it stops; it stops after 10 idle minutes and wakes on the next call. |
| Index | The real Ponder app of `packages/indexer` (its ABIs, schema and handlers, unchanged), as a Cloudflare Container, writing to the world's branch. |
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
the machine that holds the Cloudflare and Neon keys (blueprint decisions.md, 48): in the runner's own process
(`packages/runner`, `src/worlds/platform.ts`), or by `./run.sh platform serve [--port 8790]`. Its sign-in and its
spans are Core's middlewares; the first operator is `WORLD_OWNER` with `CAPXUL_PLATFORM_TOKEN`, the second
`WORLD_SECOND_OWNER` with `CAPXUL_SECOND_PLATFORM_TOKEN`.

| Operation | What it does |
|---|---|
| `world.create` | Refuses a real grade and a start before the seed (with an hour of room) before anything exists; then this package's create, with the chain's clock just after the seed and the owner operator's own token bound into Core (decisions 36); then the cast on the chain (`cast.ts`: dana, eli, sam and olga get a Safe claimed through Companies House's devnet claim role and 10,000 test USDC from the faucet, pat none; test accounts 4 to 8), the world's start block at its clock, its facts in its database (`packages/core/migrations/0003_world.sql`) and `world_created` as its record's first entry. It answers once Core has answered its health check ten times in a row. A failure after the claim destroys the world. |
| `world.show` | The shared state (owner, expiry, parked, door) and the world's database (grade, contracts, parent, clock, record head, cast, companies). |
| `world.snapshot.save` | Owner only. A Neon branch of the world's branch with no compute (its expiry is lifted first: Neon will not fork a branch that has one), the chain's whole state saved in the world's R2 bucket under the snapshot's name (the door's `POST /chain/snapshot/<name>`), and a row in `platform.snapshots`; then `snapshot_saved`. A world with companies is a fault to save until a site can be backed up. |
| `world.snapshot.restore` | A template's to anyone, any other snapshot's to its owner; never past the source's expiry. A new world whose branch forks the snapshot's and whose chain adopts the saved state (`GET /chain/snapshot/<name>` of the source's door); its parent and clock rewritten, then its own `world_created`. |

What the platform keeps of its own is in the schema `platform` of the registry's branch: `platform.spans` (every
platform call's spans), `platform.calls` (the world each successful call acted on, whose record holds its events) and
`platform.snapshots`. A world's take-down deletes its snapshot branches before its own (`dropSnapshots`), so a world
restored from a snapshot must go first, which its expiry makes so.

### Core's slot

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

### Images

`capxulworld-anvil`, `capxulworld-ponder` and `capxulworld-alto` are shared by every world and belong to the platform. Alchemy tags each
build with a hash of its inputs and reuses a tag the registry already lists, so a deploy needs Docker only when an
image's inputs have changed. The index's image copies `ponder/node_modules`: after a change to `ponder/package.json`,
run `pnpm install --ignore-workspace` in `ponder/`. The bundler's image copies `images/alto/node_modules` the same
way: run `pnpm install --ignore-workspace` in `images/alto/` before a deploy whose bundler image must be built.

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
| 6. Declared timeouts | `spec.ts`, `steps.ts` | Each step runs under `WORLD_TIMEOUT_<STEP>`, and its duration is in the record however the step ended, interrupted included. |

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
| `site` | Run with `WORLD_BENCH=pr-site`, a stand-in bench of `packages/platform` in this container (`PLATFORM_HOST=standin`, `PLATFORM_EDGE=none`). A world made with one company gets `acme-p-site.worlds.abuusama.dev`, ready in 93.5 s (new-site 21.3, ERPNext 42.8, capxul 3.0, wizard 16.5, migrate 5.8, scheduler 0.7, join the world 0.6, the API user 1.4). Through the door, on the site's own API user: the company's record (`Acme Ltd`), its Supplier list, `get_logged_user` answering `capxul-core@service.invalid` (never Administrator), and the site's clock reading world `p-site`. A second world, `p-site2`, made inside the first's run: its token is refused for the first world's site (`403 site-not-in-world`) and it sees no site. Both destroyed: the site removed in 1.8 s with its world, the door holding no site of either, the bench's folders, the door's registry and MariaDB's databases as before, and nothing of either world in either account. Core's probe at both worlds' doors answered the site door's typed failure `unreachable` (Cloudflare's own 403 for a loopback address): **Core reaching the site is recorded, not proven** (below). | `site.proof.json`, `p-site.json`, `p-site2.json`, `site-after.txt` (the bench's platform destroyed after, the zone at 66 records before and after) |

## Timings

From the records above, all made on 13 November 2026 with the images already published, every world with its
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
| index | 36.8 | 23.6 to 46.4; 27 to 128 three at once | 46.5 | The Ponder container's first start on 1/4 vCPU: the image pull, Ponder's own start, its tables and the backfill. |
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
  instance that can be provided to this Durable Object, try again later"). The world's chain calls do not retry that
  refusal, as the bundler's do; the proof's next run passed.

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
- A company's site is not in a snapshot yet: the site door has no backup and restore, and Core cannot reach a bench
  from Cloudflare (step 1.4). Saving or restoring a world with companies is a fault until then.
- The platform answers only on the machine that serves it. A caller elsewhere (a shared world's people) needs it hosted,
  which is a question for Aaron (blueprint decisions.md, 48).
- The index polls through the door, so a busy world makes about one Worker request a second for it. What an idle or a
  busy world costs was not measured.
- Who the cast is and how a mint is booked is not here: `spec.mint` is only the hook.
- The bundler: a signed paymaster (a verifying paymaster with a key and a validity window) and ERC-7677's `pm_*`
  methods; alto's safe mode (it runs with `ALTO_SAFE_MODE=false`: no ERC-7562 tracing, which anvil's tracer cannot
  give, and no stake checks); a UserOperation in alto's mempool when the world stops, which is lost, because alto
  keeps its mempool in memory; what alto's polling costs (about one `/quiet-rpc` Worker request a second while it
  runs). A paymaster with a validity window would also meet alto's wall clock against the seeded chain's, which is
  weeks behind.
- The chain's Durable Object does not retry a refused start ("no container instance ... try again later") the way the
  bundler's does, so a chain whose container goes away fails the next call instead of waiting (see What was learned).
- The index records a UserOperationEvent only for a Safe claimed through Companies House (`known_safes`), so the
  bundler proof's Safe, made directly through the factory, is seen in the index by its transfer, not in
  `ponder.user_operations`.

`src/stack` is the stack and the only code that drives Alchemy, `src/database`, `src/chain`, `src/index`,
`src/bundler`, `src/door` and `src/core` are the world's parts, `src/lifecycle` is the rules, `src/failures.ts` the
package's own failures, `src/cli` and `src/main.ts` the command line, `src/proofs` the proofs, `ponder/` and
`images/` the three images. `records/spike-bundler/` is the record of `spikes/bundler`, the spike that proved the
bundler before it moved here, with that spike's README.

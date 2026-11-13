# @capxul/world

One command creates and destroys a private world: its database, its chain, its index, its Core and its companies'
sites ([roadmap](../../docs/roadmap.md) steps 1.3 and 1.4). A world is one stage of the Alchemy stack `CapxulWorld`; nothing of it
lives on the machine that made it. Built on `alchemy` 2.0.0-beta.85 and Effect 4.1.2, run with Bun.

| Part | What it is |
|---|---|
| Database | Its own copy-on-write branch of the platform's Neon project, with a Hyperdrive configuration in front of it for Core. App data and the index's `ponder` schema live in it together. |
| Chain | Anvil 1.9.0 with `packages/contracts/state/core.json`, started with `--no-request-size-limit`, as a Cloudflare Container owned by a Durable Object. Its state is saved to an R2 bucket every 20 s while it is used and when it stops; it stops after 10 idle minutes and wakes on the next call. |
| Index | The real Ponder app of `packages/indexer` (its ABIs, schema and handlers, unchanged), as a Cloudflare Container, writing to the world's branch. |
| Door | A Worker in front of the chain and the index. Every path starts with the world's token. |
| Core | The real Core (`packages/core`): the blueprint's two groups at `/platform` and `/world` with their empty handlers, the chain's reads at `/chain`, `/health`, and a read-only site probe. It binds the world's branch through Hyperdrive and the world's door through a service binding. |
| Sites | With `WORLD_BENCH` set and `--company` given, each company's Frappe site on that shared bench (`packages/platform`), made by the bench's site door with the world's own site token, at `<label>-<world>.<domain>`. |
| Test USDC | The contracts package's `MockERC20`, put on the chain when the world is created. Its open `mint` is the faucet. |

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
  world.sql("select 1"),          // world.coreUrl, world.rpcUrl (a secret), world.sql, world.funded
);
```

Provide `SharedState.layer` over `Alchemist.layer()`. `spec.migrations` names Core's migrations directory.

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

### Images

`capxulworld-anvil` and `capxulworld-ponder` are shared by every world and belong to the platform. Alchemy tags each
build with a hash of its inputs and reuses a tag the registry already lists, so a deploy needs Docker only when an
image's inputs have changed. The index's image copies `ponder/node_modules`: after a change to `ponder/package.json`,
run `pnpm install --ignore-workspace` in `ponder/`.

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
records (`p-*.json`) are `withWorld`'s own, with every step's duration and declared timeout.

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
| `sweep` | The sweeper, run as the command line with an empty home directory, keeps three worlds before an expiry; after it, destroys the expired one and keeps the live one and the one with no recorded expiry. | `sweep.proof.json` |
| `site` | Run with `WORLD_BENCH=pr-site`, a stand-in bench of `packages/platform` in this container (`PLATFORM_HOST=standin`, `PLATFORM_EDGE=none`). A world made with one company gets `acme-p-site.worlds.abuusama.dev`, ready in 93.5 s (new-site 21.3, ERPNext 42.8, capxul 3.0, wizard 16.5, migrate 5.8, scheduler 0.7, join the world 0.6, the API user 1.4). Through the door, on the site's own API user: the company's record (`Acme Ltd`), its Supplier list, `get_logged_user` answering `capxul-core@service.invalid` (never Administrator), and the site's clock reading world `p-site`. A second world, `p-site2`, made inside the first's run: its token is refused for the first world's site (`403 site-not-in-world`) and it sees no site. Both destroyed: the site removed in 1.8 s with its world, the door holding no site of either, the bench's folders, the door's registry and MariaDB's databases as before, and nothing of either world in either account. Core's probe at both worlds' doors answered the site door's typed failure `unreachable` (Cloudflare's own 403 for a loopback address): **Core reaching the site is recorded, not proven** (below). | `site.proof.json`, `p-site.json`, `p-site2.json`, `site-after.txt` (the bench's platform destroyed after, the zone at 66 records before and after) |

## Timings

From the records above: ten creates (one through `world create`, six through `withWorld`, three at once in one
process) and seven destroys whose duration was recorded, all on 13 November 2026 with the images already published.

| Step | Median s | Range s | Where the time goes |
|---|---|---|---|
| claim | 0.9 | 0.4 to 1.3 | One transaction on the registry branch, and the world's record in the shared state. |
| deploy | 45.8 | 38.4 to 53.1 | Alchemy: the Neon branch and Hyperdrive, two Workers, and two container applications, each created and then created again to attach its Durable Object. |
| migrate | 0.8 | 0.6 to 1.1 | Over Neon's HTTPS endpoint. |
| chain | 2.4 | 2.0 to 4.8 | Anvil's first start from the seed; a fork first copies its parent's state. |
| fund | 0.3 | 0.1 to 0.6 | The token's deployment and one transaction for each mint. |
| index | 46.5 | 37.5 to 59.2 | The Ponder container's first start on 1/4 vCPU: the image pull, Ponder's own start, its tables and the backfill. |
| core | 0.5 | 0.3 to 0.6 | Until Core's address answers `/health` (the stand-in's, in these runs; the real Core's took 0.5 to 0.6 s in `site`). |
| site | 93.5 | one run | The site door making one company's site (`site` above). |
| unsite | 1.8 | one run | `bench drop-site` of the world's site; 0.4 s for a world with no site. |
| **create** | **95.3** | **87.9 to 116.4** | From the claim to a world whose every part answers. |
| destroy | 13.5 | 12.8 to 17.2 | `alchemy destroy` of the stage and the stage's record. |
| release | 0.2 | 0.2 to 0.6 | The name's row. |
| park | 6.2 | one run | Saving the chain and stopping both containers. |

So a create is about a minute and a half, and two steps are nearly all of it: Alchemy's deploy and the index's first
start. Neither was attacked here; a larger instance for the index, or a world forked from a template that is
already indexed (step 0.9), are the places to look. When an image must be rebuilt, the deploy also builds and
publishes it.

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
- `WorldDatabase` keeps Hyperdrive's query cache on; Core's own stage turns it off so a read sees the write before it.
  No Core handler reads yet; turn it off here when one does.
- The index polls through the door, so a busy world makes about one Worker request a second for it. What an idle or a
  busy world costs was not measured.
- Who the cast is and how a mint is booked is not here: `spec.mint` is only the hook.

`src/stack` is the stack and the only code that drives Alchemy, `src/database`, `src/chain`, `src/index`, `src/door`
and `src/core` are the world's parts, `src/lifecycle` is the rules, `src/failures.ts` the package's own failures,
`src/cli` and `src/main.ts` the command line, `src/proofs` the proofs, `ponder/` and `images/` the two images.

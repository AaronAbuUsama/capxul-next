# @capxul/world

One command creates and destroys a private world: its database, its chain, its index and its Core
([roadmap](../../docs/roadmap.md) step 1.3). A world is one stage of the Alchemy stack `CapxulWorld`; nothing of it
lives on the machine that made it. Built on `alchemy` 2.0.0-beta.85 and Effect 4.1.2, run with Bun.

| Part | What it is |
|---|---|
| Database | Its own copy-on-write branch of the platform's Neon project, with a Hyperdrive configuration in front of it for Core. App data and the index's `ponder` schema live in it together. |
| Chain | Anvil 1.9.0 with `packages/contracts/state/core.json`, started with `--no-request-size-limit`, as a Cloudflare Container owned by a Durable Object. Its state is saved to an R2 bucket every 20 s while it is used and when it stops; it stops after 10 idle minutes and wakes on the next call. |
| Index | The real Ponder app of `packages/indexer` (its ABIs, schema and handlers, unchanged), as a Cloudflare Container, writing to the world's branch. |
| Door | A Worker in front of the chain and the index. Every path starts with the world's token. |
| Core | A Worker. Until `packages/core` lands, a stand-in with Core's door shape: one endpoint, `GET /health`. |
| Test USDC | The contracts package's `MockERC20`, put on the chain when the world is created. Its open `mint` is the faucet. |

## Commands

`pnpm install` at the repository's root installs the package. From the root:

```bash
pnpm --filter @capxul/world world platform up      # once: the Neon project and the registry of world names
pnpm --filter @capxul/world world create demo --owner me --lifetime "2 hours" [--from other] [--mint 0xADDRESS=250000000]
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

`src/core/Core.ts` is the one place that says what runs as Core. It holds the stand-in (`src/core/StandIn.ts`) and
the stand-in's migrations. Swapping in `packages/core` is that file alone: import its Worker in place of
`StandInCore` and point `CORE_MIGRATIONS` at its migrations. A world is ready once Core answers 200 on
`CORE_HEALTH` (`src/core/health.ts`). A caller can also provide its own `Core` for one run.

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
| core | 0.5 | 0.3 to 0.6 | Until the stand-in's address answers `/health`. |
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
- Core is the stand-in. The real Core (`packages/core`) and its use of `WorldDatabase` are not proven here.
- The index polls through the door, so a busy world makes about one Worker request a second for it. What an idle or a
  busy world costs was not measured.
- Who the cast is and how a mint is booked is not here: `spec.mint` is only the hook.

`src/stack` is the stack and the only code that drives Alchemy, `src/database`, `src/chain`, `src/index`, `src/door`
and `src/core` are the world's parts, `src/lifecycle` is the rules, `src/failures.ts` the package's own failures,
`src/cli` and `src/main.ts` the command line, `src/proofs` the proofs, `ponder/` and `images/` the two images.

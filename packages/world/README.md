# @capxul/world

One command creates and destroys a private world: its database, its chain, its index and its Core
([roadmap](../../docs/roadmap.md) step 1.3). A world is one stage of the Alchemy stack `CapxulWorld`; nothing of it
lives on the machine that made it. Built from the spikes in `spikes/hosting`, `spikes/state`, `spikes/containers` and
`spikes/pipeline` (`alchemy` 2.0.0-beta.85 on Effect 4.1.2, run with Bun).

| Part | What it is |
|---|---|
| Database | A copy-on-write branch of the platform's Neon project, with a Hyperdrive configuration in front of it for Core. App data and the index's `ponder` schema live in it together. |
| Chain | Anvil with `packages/contracts/state/core.json`, as a Cloudflare Container owned by a Durable Object. Its state is saved to an R2 bucket every 20 s while it is used and when it stops; it stops after 10 idle minutes and wakes on the next call. |
| Index | The real Ponder app of `packages/indexer` (its ABIs, schema and handlers, unchanged), as a Cloudflare Container, writing to the world's branch. |
| Door | A Worker in front of the chain and the index. Every path starts with the world's token. |
| Core | A Worker the caller supplies. Until one is supplied, a placeholder that says which world it serves. |
| Test USDC | The contracts package's `MockERC20`, put on the chain when the world is created. Its open `mint` is the faucet. |

## Commands

`pnpm install --ignore-workspace` here and in `ponder/` (its `node_modules` goes into the index's image). A Docker
daemon is needed only when an image has changed since it was last published.

```bash
./run.sh platform up                       # once: the Neon project and the registry of world names
./run.sh create demo --owner me --lifetime "2 hours" [--from other] [--mint 0xADDRESS=250000000]
./run.sh show demo [--reveal]              # the world's addresses; the chain's token only with --reveal
./run.sh sql demo "select * from app.notes"
./run.sh list                              # every world in the shared state, with owner and expiry
./run.sh destroy demo
./run.sh sweep [--dry-run]                 # destroy every expired world; remove what destroys leave behind
./run.sh inventory                         # what the two accounts hold, naming what is this stack's
./run.sh platform down                     # refused while a world exists
./run.sh prove <case>                      # the proofs below; each writes records/
node_modules/.bin/tsc -p . && bun test src
```

A command prints its result as JSON on standard output and its log on standard error. Never run `alchemy nuke`, and
never deploy a world with the alchemy command line: `./run.sh alchemy` is for reading (`state list`, `drift`).

In-process, a scenario runner imports `src/door.ts`:

```ts
const { record, used } = yield* withWorld({ name: "run-1", owner: "ci", lifetime: Duration.hours(1) }, (world) =>
  world.sql("select 1"),          // world.coreUrl, world.rpcUrl (a secret), world.sql, world.funded
);
```

Provide `SharedState.layer` over `Alchemist.layer()`, and provide `Core` with your own Worker to fill the Core slot
(any Effect that yields a Worker; it may bind `WorldDatabase`). `spec.migrations` names Core's migrations directory.

## The lifecycle rules, in code

| Rule | Where | How |
|---|---|---|
| 1. A run is one unit | `src/lifecycle/run.ts` | `withWorld` creates, runs the use, writes the record, destroys. The destroy cannot be interrupted and runs when the use fails, times out or the process is interrupted, also half-way through the create. |
| 2. Owner and expiry | `world.ts`, `sweep.ts` | Both are written to the shared state before anything exists. `sweep` reads only the shared state, destroys what has expired, and keeps and reports what has no readable expiry. |
| 2. One name, one world | `claim.ts` | The state store has no lock. A name is taken by inserting a row in a registry table on the platform's Neon branch, which Postgres makes atomic; only the holder creates. |
| 3. Keeping is explicit | `run.ts` | `keepOnFailure` leaves a failed world stopped and marked `parked`; it expires like any other. |
| 4. Destroy removes everything | `world.ts`, `sweep.ts` | `alchemy destroy` of the stage, then the stage's record and its name. Images are shared by all worlds and belong to the platform; `sweep` and `platform down` remove them once nothing accounts for them. |
| 6. Declared timeouts | `spec.ts`, `steps.ts` | Each step runs under `WORLD_TIMEOUT_<STEP>` and its duration is in the record. |
| Limits | `spec.ts`, `claim.ts` | A world lives at most 7 days (`WORLD_MAX_LIFETIME`); an owner has at most 5 live worlds (`WORLD_MAX_PER_OWNER`), counted under a lock on the owner. |

Secrets: Alchemy prints and stores stack outputs in plain text, so neither the database's connection string nor the
door's token is an output. Both are read from the resources' own state in the shared store, held as `Redacted`, and
never printed. The connection string is also the index container's `DATABASE_URL` in Cloudflare.

## What is proven (13 November 2026, from a Claude cloud container)

Every line is from a run; the records are in `records/`.

| Question | Result | Record |
|---|---|---|
| Does a world made from nothing answer on every part? | Yes. Chain id `0x14a34` at the seed's head `0x2dacb0b`; the index at block 47,893,259; Core answered `{"core":"placeholder","world":"w-p-fresh"}`. | `fresh.proof.json`, `p-fresh.json` |
| Does the faucet fund at creation, and does the index see it? | Yes. 250 test USDC minted to one address during the create; `balanceOf` gave 250000000; the index wrote the mint's `Transfer` from the zero address to `ponder.transfers`, and then a payment of 1 USDC made through the world's RPC address. | `fresh.proof.json` |
| Does a world made `--from` another start with its rows? | Yes: its `app.notes` row, its indexed transfers and its chain balances. A row the fork then wrote was not seen by the first world. | `fresh.proof.json`, `p-fork.json` |
| Is the world destroyed when the use fails, times out or is interrupted? | Yes, each time: `failed`, `timed out` (declared 5 s), `interrupted` (SIGINT during the use; destroyed 14 s later, exit 130). | `p-fails.json`, `p-slow.json`, `p-int.json` |
| Is a kept failed world parked, and does it still expire? | Yes. Chain and index stopped, `status: parked`; a sweep before its expiry kept it, a sweep after destroyed it. | `keep.proof.json`, `p-keep.json` |
| Are two creates of one name at once safe? | Yes, in one process and in two. One created; the other failed with `WorldAlreadyExists` before making anything; the accounts held one world's resources. | `race.proof.json`, `race.two-processes.txt` |
| Does the sweeper need only the shared state? | Yes. Run from another copy of this package with an empty home directory, it destroyed the expired world, kept the live one and kept and reported the one with no expiry. | `sweep.*.json` |
| Does destroy leave anything? | No. The listing of Workers, container applications, Durable Object namespaces, R2 buckets, Hyperdrive configurations, Neon branches and image repositories is the same before and after. | `fresh.proof.json`, `final.inventory.json` |
| Are the limits refused? | Yes: `LifetimeTooLong` for 8 days, `TooManyWorlds` for an owner's sixth name; nothing was created. | `limits.proof.json` |

## Timings

Creating a world took 80 to 105 s over fourteen creates; destroying one took 12 to 18 s.

| Step | Seconds | Where the time goes |
|---|---|---|
| claim | 0.4 to 1.0 | One transaction on the registry branch, and the record in the shared state. |
| deploy | 41 to 51 | Alchemy: opening the state store (3.5 s), the Neon branch, two Workers, and two container applications, each created and then created again to attach its Durable Object. |
| migrate | 0.5 to 0.9 | Over Neon's HTTPS endpoint. |
| chain | 2 (6 for a fork) | First start from the seed; a fork first copies its parent's state (2.5 MB). |
| fund | about 1 | The token's deployment and one transaction for each mint. |
| index | 28 to 57 | The Ponder container's first start on 1/4 vCPU: the image pull, Ponder's own start, its tables and the backfill. |
| core | 0.3 to 0.6 | |
| destroy, release | 12 to 18, 0.3 | |

So a create is over a minute, and two things are the time: Alchemy's deploy and the index's first start. Neither was
attacked here. A larger instance for the index, or a world that is forked from a template that is already indexed,
are the places to look (step 0.9).

## What was learned on the way

- **Neon refuses to fork a branch that has an expiry of its own** ("Branches with an expiration date cannot have
  child branches"). A world that another is made from therefore has its Neon expiry taken off; its record says so,
  and the sweeper alone deletes it, at the same recorded expiry. A fork must be destroyed before its parent.
- **The real index runs as it is, except for its configuration.** `ponder/ponder.config.ts` names the same six
  contracts and block handler, with `reorgWindow: 0` (the seeded chain keeps nine blocks, and Ponder's default looks
  180 s back), a one-second poll, and addresses from the contracts' deployment record. The seed's own history holds
  no event the real app handles (it is Safe and Roles deployment events), so the events shown are the faucet's mint
  and a payment.
- **A fork carries its parent's index.** Ponder resumes from the forked `ponder` schema; the chain's state is copied
  after the database is forked, so the chain is never behind the index. Fork a quiet world: under writes the copy
  of the chain can be ahead of the copy of the database.
- **Images are shared and need Docker only when they change.** `capxulworld-anvil` and `capxulworld-ponder` hold one
  tag for each build; a world whose build is published deploys with no Docker. Old tags stay until the repositories
  are removed.
- **Three creates at once in one process work**, each with its own settings (`sweep-setup.proof.json`).

## Not done

- Nothing schedules `sweep`. Until something does, a world that was forked from, a parked world's Workers and a
  half-created world wait for whoever runs it.
- The Core slot was proven with the placeholder only. The pipeline spike's Core (Hyperdrive, Effect SQL) was not put
  in it; `WorldDatabase` is deployed with every world for it to bind.
- The index polls through the door, so a busy world makes about one Worker request a second for it. What an idle or
  a busy world costs was not measured.
- Who the cast is and how a mint is booked is not here: `spec.mint` is only the hook.
- The package is not in the repository's pnpm workspace (the root file excludes it): Alchemy's beta releases are
  younger than the workspace's release-age policy allows.

`src/stack` is the stack and the only code that drives Alchemy, `src/database`, `src/chain`, `src/index`, `src/door`
and `src/core` are the world's parts, `src/lifecycle` is the rules, `src/cli` and `src/main.ts` the command line,
`src/proofs` the proofs, `ponder/` and `images/anvil/` the two images.

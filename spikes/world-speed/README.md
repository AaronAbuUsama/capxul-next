# World speed spike

Throwaway code that measures where a world's time goes, and how far each part comes down, for Aaron's model of the
test loop: **one runner, one world deployed once, moved by snapshot, restore in place and clock warp**, instead of a
new world for every scenario. Nothing here is product code, and nothing in `packages/` was changed: the one change
tried on `packages/world` (`patches/pinned-images.diff`) was applied for two creates and reverted.

Measured on 13 and 14 November 2026 UTC from a Claude cloud container, against the shared Cloudflare account and the
worlds' Neon project (`CapxulWorld-worlds-db-platform`). Every number below is read from a file in `records/`; nobody
wrote a record by hand except the three notes named as notes.

## What is here

| Path | What it is |
|---|---|
| `alchemy.run.ts`, `src/hub.ts` | The hub: one Worker whose three Durable Object classes (`ChainBox`, `IndexBox`, `BundlerBox`) own the container applications of every world. A world on the hub is only a name (`getByName(<world>)` of each class) plus a Neon branch. `WS_MODE=fleet`: one container application per class, Ponder's constrained to `WEUR`. `WS_MODE=native`: `schedulingPolicy: "durable_object"`, the image chosen at start. Images are `packages/world`'s published ones, by digest; nothing is built. |
| `run.sh` | The Alchemy command line for the hub: `WS_MODE=fleet ./run.sh deploy --stage ws-fleet --yes`, `WS_MODE=native ./run.sh destroy --stage ws-native --yes`. State in `.alchemy/` on this machine (ignored). |
| `measure/*.py` | The measuring scripts (run with `python3 -I`); each writes one record. `lib.py` is the hub's and Neon's API. |
| `door.sh`, `capxul.sh` | One request to a `packages/world` world's door; the Capxul command line against `world platform serve`. |
| `patches/pinned-images.diff` | `packages/world`'s three containers pointed at their published images by digest, for question 2. |
| `records/` | Every run record. `records/failed/` is a create that failed before measuring anything. |

## Every measurement

Times in seconds unless marked ms. "Today" is `packages/world` at `3d2e8d7c`, run with `packages/world/run.sh`.

| # | Measurement | Result | Record |
|---|---|---|---|
| 1.1 | Today's create of world `wsb2`, by step | claim 0.8, **deploy 60.6**, migrate 0.8, chain 3.0, fund 0.4, **index 25.7**, **bundler 28.3** (beside the index), core 0.9; create 95.4 (wall 100.5) | `e1-create-wsb2.out.json`, `.log`, `.meta` |
| 1.2 | Inside that deploy, from the log's timestamps | the Cloudflare state store opened twice (4.3 s, then 3.6 s); Alto's precreate (build context hashed, registry checked) **20.9 s**, Ponder's **10.8 s**, Anvil's 1.5 s; each container application created, then **recreated "to attach durable object binding"** (Anvil at 18.6 s, Ponder at 50.2 s, Alto at 60.1 s); Door bundle+upload 4.5 s, Core 2.7 s | `e1-spans.json` (from `measure/spans.py`) |
| 1.3 | Today's index step, inside | 5 start calls, 4 refused ("no container instance") over 14 s, then Ponder healthy 8.7 s, ready 11.2 s (Ponder's build: process at 1.4 s, sync at 8.4 s) | `e1-wsb2-index-status.json` |
| 1.4 | Today's bundler step, inside | 6 start calls, 5 refused, ready 25.3 s | `e1-wsb2-bundler-status.json` |
| 1.5 | Today's chain step, inside | 1 start call, ready 1.3 s | `e1-wsb2-chain-status.json` |
| 1.6 | Today's destroy | destroy 18.2, release 0.3 (wall 23.6; the first delete at 11.8 s, after the state store was opened twice) | `e1-destroy-wsb2.out.json`, `.log`; spans in `e1-spans.json` |
| 1.7 | Today's `world.create` through the platform (with the cast) | wall 100.7 s; the deploy alone 57 s of it | `e6-world-create.meta`, `e6-platform-serve.log` |
| 2.1 | Create with images pinned by digest (`patches/pinned-images.diff`), two worlds | create **52.7 and 51.9** (deploy 33.0 and 33.6, index 8.3 and 8.1, bundler 13.9 and 13.2); every precreate under 0.01 s | `e2-create-pinned-wsp1.out.json`, `e2-create-pinned-wsp2.out.json`, spans in `e1-spans.json` |
| 2.2 | Their index and bundler steps | index: 1 start call, 0 refused, ready 8.0 s; bundler: 3 calls, 2 refused, ready 11.9 s | `e2-wsp1-index-status.json`, `e2-wsp1-bundler-status.json` |
| 2.3 | Their destroys | 15.8 and 17.4 (wall 20.5 and 23.1) | `e2-destroy-pinned-wsp1.out.json`, `e2-destroy-pinned-wsp2.out.json` |
| 2.4 | The recreate, per application | from "recreating" to the second create call: 1.7 to 3.6 s (delete, then wait until the list no longer shows it); a create call 2.2 to 5.2 s (e1, e2), the second one done 3.1 to 3.5 s after it on the hub | `e1-spans.json`, `e2-deploy-fleet2.log` |
| 2.5 | Hub deploy with the recreate (fleet) and without it (native), images already prepared | fleet **9.2, 9.9, 11.3**; native **7.2, 7.6** | `e2-deploy-fleet2.log`, `e3-deploy-fleet.log`, `e2-deploy-fleet3.log`; `e2-deploy-native2.log`, `e2-deploy-native3.log` |
| 2.6 | Native's first deploy on the account | 48.6 s, 41 s of it "Prepared Ponder image" (once per image, not per deploy) | `e2-deploy-native.log` |
| 2.7 | Hub destroys | fleet 1.6, 1.1, 2.3; native 1.7, 3.6 | `e2-destroy-fleet2.log`, `e2-destroy-fleet3.log`, `cleanup-destroy-ws-fleet.log`; `e2-destroy-native2.log`, `cleanup-destroy-ws-native.log` |
| 3.1 | World on the fleet hub (warm applications): Neon branch + chain + Ponder (fresh backfill) + alto, until all three answer; 3 one after another | **10.1, 14.0, 13.6** (chain 1.2 to 1.6, branch 2.4 to 2.5, bundler 9.2 to 9.8, index ready 9.8 to 13.6); 0 refusals | `e3-coldstart-fleet.json` |
| 3.2 | The same, 3 at once | **13.6, 14.2, 15.1**; 0 refusals; all three in 18.5 s with teardown | `e3-coldstart-fleet-parallel.json` |
| 3.3 | The same on the native hub, no placement | 23.7, 24.9, 24.2 (index healthy 12.4 to 12.7, then 11 s more to ready: Ponder far from Neon) | `e3-coldstart-native.json` |
| 3.4 | Native, Ponder's Durable Object hinted to `weur` | 29.1, 19.0, 15.0 | `e3-coldstart-native-weur.json` |
| 3.5 | Native, `standard-1` instances | 16.7, 11.3, 17.6 | `e3-coldstart-native-std1.json` |
| 3.6 | First world on a just-deployed hub ("newapp") | fleet: 246.9 (alto refused 61 times); native: never (every part "container has not been started" for its 240 s); second try, fleet 29.4 (3 refusals each for chain and alto), native 29.1 | `e3-coldstart-newapp-fleet.json`, `e3-coldstart-newapp-native.json`, `e3-coldstart-newapp2-fleet.json`, `e3-coldstart-newapp2-native.json` |
| 3.7 | Hub world teardown (stop 3 containers, delete the branch) | stops 0.35 to 0.9 s each, branch delete 1.4 to 2.1 s | `e3-coldstart-fleet.json`, `e3-coldstart-fleet-parallel.json` |
| 3.8 | One Hyperdrive configuration per world (if Core keeps one), 3 rounds | create 2.5, 2.2, 2.0; delete 1.0, 1.3, 1.1 | `e3-hyperdrive.json` |
| 4.1 | Ponder fresh start with backfill from the seed, on the hub | healthy 4.5 to 8.7, then ready 2.0 to 2.6 s later; backfill itself 1 s | `e5-reset-rs1.json`, `e5-reset-rs2.json`, `e4-lock.json`, `e4-ponder-words.json` |
| 4.2 | Ponder resumed on the same database after a kill (no SIGTERM) | **26.3**, of which 18.4 s "Schema is locked by a different Ponder app" then "Detected crash recovery" | `e4-ponder-words.json` |
| 4.3 | Ponder stopped by SIGTERM | exits in 63 to 114 ms and clears its lock (`is_locked` 0) | `e5-reset-rs1.json`, `e5-reset-rs2.json`, `e4-lock.json` |
| 4.4 | Index forked with its database: branch of the world's branch with compute, new anvil with `anvil_loadState`, Ponder resumed on the fork | branch 2.2, chain 1.3 to 1.4 + load 0.4 to 0.6, Ponder start 8.8 to 9.9 (healthy 6.7 to 7.5), caught up 1.3; the fork reads exactly the snapshot (no field differs) and indexes its own next mint in 1.3 to 1.4 s | `e5-reset-rs1.json`, `e5-reset-rs2.json` (steps `F ...`, `forkVersusP1`) |
| 4.5 | Fork of a database copied while Ponder ran, against one copied after SIGTERM | lock copied held (heartbeat 9.4 s old): fork's Ponder healthy 11.6 s, fork to caught up 21.8 s; after SIGTERM: 7.6 s and 17.5 s | `e4-lock.json` |
| 4.6 | Ponder against a chain put back while its database was not | "MigrationError: Finalized block for chain "84532" cannot move backwards", exits; the hub tried 22 and 31 starts for 361 s, never ready | `e4-ponder-words.json`, `e5-reset-rs1.json`, `e5-reset-rs2.json` (steps `K ...`) |
| 5.1 | Reset in place on the hub, R1: Ponder destroyed, Neon restore, `evm_revert`, Ponder started | **16.6, 19.5** | `e5-reset-rs1.json`, `e5-reset-rs2.json` (`r1TotalMs`) |
| 5.2 | R2: Ponder SIGTERM, Neon restore, `anvil_reset` + `anvil_loadState` | **17.1, 15.2** | same, `r2TotalMs` |
| 5.3 | R3: Ponder destroyed, Neon restore, chain container restarted empty + `anvil_loadState` | **17.2, 18.3** | same, `r3TotalMs` |
| 5.4 | Parts of those six resets | Ponder stop 0.3 to 1.4; Neon restore 2.3 to 8.2 (operation 1.6 to 7.2; the first restore of each run is refused 422 because the snapshot branch is a child of the world's, then goes through with `preserve_under_name`, which moves the children away); first SQL answer after it 1.9; `evm_revert` 0.2; `anvil_reset` + load 0.9 to 1.1; container stop, empty start and load 2.3 to 2.4; **Ponder start 7.4 to 10.3** (healthy 4.8 to 7.9); caught up 1.4 to 1.6 | same, `steps` |
| 5.5 | Do they read the same as at the snapshot? | yes, all six: chain head, hash, timestamp, balance, nonce; index block, hash, transfers (`r1VersusP1` etc. empty, while `p2DiffersFromP1` lists 8 fields); a mint after the reset is indexed in 1.4 s | same |
| 5.6 | Reset in place of a real `packages/world` world (`wsr`, made by `world.create`, saved by `world.snapshot.save` as `s2`, moved on by a 5 USDC mint): index stop, chain state of `s2` from R2, Neon restore, `anvil_reset` + load, index start | **16.7**: stop 0.5, state 0.9 (3.4 MB), restore 2.3, first SQL 1.9, reset 0.2, load 1.2, index start 6.9, ready 1.6, caught up 1.1 | `e6-inplace-wsr-reset.json` |
| 5.7 | `world.show` after that reset against before the move | the same in every field (record head 3, cast, contracts, state) but `clock.now`, which runs; the stored clock is the same (`offset_ms` 86306741); chain and database fingerprints equal | `e6-inplace-wsr-mark.json`, `e6-inplace-wsr-moved.json`, `e6-inplace-wsr-reset.json` |
| 5.8 | Core after the reset, no redeploy | `record.export` answers in 1.5 s with the snapshot's 3 entries (the move's 4th gone) | `e6-core-after-reset-record-export.json`, `e6-core-after-reset.meta` |
| 5.9 | Saving the snapshots | `world.snapshot.save` 8.6 and 7.9 s wall | `e6-snapshot-save.meta`, `e6-snapshot-save-s2.meta` |
| 5.10 | Destroying a world after an in-place reset | failed twice: the restore made the world's branch a child of the snapshot's, so `dropSnapshots` was refused; passed (12.0 s) after the branches were deleted by hand in the right order | `e6-destroy-wsr*.log`, `e6-destroy-wsr*.out.json`, `e6-destroy-wsr.notes.txt` (note) |
| 6.1 | Anvil's clock across a snapshot (world clock set 30 days behind host) | `evm_revert` keeps anvil's offset: the next block is the snapshot's time plus the host time since (offset -2592000 s before and after); `anvil_reset` + `anvil_loadState`, and a new anvil loading the dump, restart from the snapshot's head: the next block is head + 1 s, whatever time passed | `e6-clock.json` |
| 6.2 | `world.clock.warp` | moves Core's clock and mines the chain's next block at the new time (head 2026-11-14T23:43:32 after a warp to 23:43:31.7); no sites | `e6-warp.json`, `e6-warp-2.json`, `e6-inplace-wsr-mark.json` |
| 6.3 | Chain against Core after the in-place reset | the chain's next block (host 23:47:08) got world time host + 86212 s; Core's clock reads host + 86306.7 s: **95 s apart** | `e6-core-after-reset.meta`, `e6-inplace-wsr-reset.json` |

## Where today's world time goes

Today's create is 95 to 101 s (1.1, 1.7) and its destroy 18 to 24 s (1.6), about 120 s of world per scenario before
the scenario's own 20 s. Of the create:

- **60 s deploy.** About 30 s of it is hashing build contexts that never change: Alto's 237 MB `node_modules` (20.9 s)
  and Ponder's `packages/` (10.8 s), every create, although the images are already published (1.2). The rest is
  opening the state store twice (8 s), three container applications each created twice, and two Worker uploads.
- **26 to 28 s index and bundler**, side by side. Most of it is Cloudflare refusing to start a container on an
  application the deploy made seconds before (4 and 5 refusals, 1.3 and 1.4); Ponder's own start is 11 s.
- **5 s** for migrations, chain, fund and Core.

### Why each container is created and then recreated (question 2)

A world's Worker binds its containers, and a container application is attached to the Worker's Durable Object
namespace, which exists only once the Worker is uploaded. Alchemy breaks the cycle by creating each application in
*precreate* without its attachment; when the Worker is up, the attachment is set, and since Cloudflare will not
change an application's Durable Object attachment, Alchemy deletes the application, waits until Cloudflare's list no
longer shows it, and creates it again (`@alchemy.run/cloudflare` 2.0.0-beta.85,
`src/Containers/ContainerProvider.ts`, the branch that logs "recreating ... to attach durable object binding").

It costs 1.7 to 3.6 s per application plus a second create call (2.4), and the three run side by side, so on a deploy
it shows as 2.0 to 3.7 s: the fleet hub deploys in 9.2 to 11.3 s, the native hub (`schedulingPolicy:
"durable_object"`, where the application belongs to the class and no precreate is made) in 7.2 to 7.6 s (2.5). The
larger cost is indirect: an application made seconds before refuses starts for a while, and in today's create the
index and bundler steps are mostly those refusals (1.3, 1.4, 3.6). Avoiding the recreate per world does not avoid
that; not making applications per world does (3.1: 0 refusals in six worlds).

## The options

World create is until every part answers; reset is in place to a saved snapshot, until the index has caught up.

| Option | World create | Reset | Records |
|---|---|---|---|
| **A. Today**: a new `packages/world` stack per scenario | 95.4 (101 with the cast); destroy 18.2 | none: a new world, 95 to 101 + 18 | 1.1, 1.6, 1.7 |
| **B. A, images pinned by digest** | 51.9, 52.7; destroy 15.8, 17.4 | none: a new world, 52 + 16 | 2.1, 2.3 |
| **C. One `packages/world` world, reset in place** | as A or B, once per runner | **16.7** (Core and `world.show` right after, no redeploy) | 5.6, 5.7, 5.8 |
| **D. Fleet hub**: one container application per kind, deployed once (9.9); a world is Durable Object names plus a Neon branch | **10.1 to 15.1** for chain, index and bundler (three at once included); Core not included | **15.2 to 19.5** (six resets, three ways) | 3.1, 3.2, 5.1 to 5.3 |
| **E. Native hub**: `schedulingPolicy: "durable_object"` | 11.3 to 29.1, depending on where Ponder lands and its size | not measured | 3.3 to 3.5 |
| **F. A fresh application per world** (what A does, without the rest of the stack) | 29.1 to 29.4 when it works; once 247, once never | n/a | 3.6 |

Native saves 2 to 4 s on a deploy made once (2.5), but its Ponder cannot be pinned next to Neon (3.3, 3.4) and its
very first start failed for 240 s (3.6), so the fleet form is the one to build on. Neither matters for D's resets.

## The fastest credible design: one runner, one world, reset in place

1. **The hub is deployed once** per account or per runner host (fleet form: Anvil `lite`, Ponder `basic` constrained to
   `WEUR` next to Neon's `aws-eu-west-2`, alto `basic`; 9.9 s, 3.1's refusals gone). Its applications stay; its
   containers are started and stopped by world name.
2. **The runner's world is made once**: a Neon branch and three containers by name, about 14 s (3.1, 3.2), then
   migrations, the cast and a snapshot (`world.snapshot.save`, 8 s, 5.9). Core is either a Worker per world (its
   bundle and upload were 2.7 s in 1.2, a Hyperdrive 2.0 to 2.5 s in 3.8) or one Core told the world's branch; neither
   was measured end to end on the hub.
3. **Between scenarios, reset in place** (5.2, the R2 form): SIGTERM Ponder (it clears its lock, 4.3), restore the
   world's branch from the snapshot's (Neon `restore` with `preserve_under_name`), `anvil_reset` + `anvil_loadState` of
   the snapshot's dump, start Ponder (it resumes on the restored schema, 4.4), wait until it has the chain's head.
   Measured **15.2 to 17.1 s** on the hub and **16.7 s** on a real world, where `world.show`, the chain, the index and
   Core then read the snapshot (5.5, 5.7, 5.8).
4. Where the reset's time goes: Ponder's start is half of it (7.4 to 10.3 s; about 5 to 7 s of that is Ponder's build
   before it syncs, 1.3, 2.2, 5.6); Neon's restore 2.3 to 3.6 s (once 8.2) and the first query after it 1.9 s; the chain 1 s.
   The chain and the restore do not depend on each other and were run one after the other; side by side, and without
   the probe query, the measured parts add up to about 11 to 14 s (restore 2.3 + Ponder 7.4 to 10.3 + caught up 1.1 to
   1.6). That sum is an estimate from 5.4 and 5.6, not a measured reset.

Against today, that turns about 120 s of world per scenario (A) into about 17 s (C or D), with D also making the one
create about 14 s instead of 95 to 101.

What the reset must never do: put the chain back without the database (4.6, Ponder refuses for good), or start Ponder
on a database whose lock is fresh (4.2, 18 s lost; a snapshot taken while Ponder runs carries its lock, 4.5, so a
reset within 25 s of the save waits for it).

## The clock (question 6)

How it reaches each part: Core keeps the world's clock in the world's database (`app.clock`: frozen at an instant, or
running as host time plus an offset; `packages/core/src/site-ops/clock.ts`); the chain's time is its blocks'
timestamps, which `world.clock.warp` moves by mining the next block at the new time
(`packages/core/src/site-ops/chain-time.ts`, 6.2); a Frappe site reads its world's entry in the bench's
`sites/capxul-world-clocks.json` (`packages/frappe-app/capxul/clock.py`).

A snapshot does **not** hold them at one point. The database holds a running clock's *offset*, so after a restore Core
reads the snapshot's offset from host time now (5.7). Anvil's dump holds its head's timestamp, so after
`anvil_loadState` the chain runs on from that head (6.1). After the in-place reset of `wsr` the two were 95 s apart
(6.3): the time between the save and the reset, plus how far the head already lagged the clock at the save.
`evm_revert` keeps anvil's offset instead (6.1), which would agree with Core's, but needs the same anvil process and a
snapshot id that one revert consumes. The fix that suggests itself, mining a block at Core's clock right after the
chain is loaded (what a warp does), was not tried.

## What is still unknown

- **Frappe sites.** No bench was reachable, so a reset with company sites (their backup and restore, and the bench's
  clock file, which no snapshot holds) was not measured. With sites, it may well be the largest part of a reset.
- **The bundler across a reset.** `measure/reset.py` has no alto, and the `wsr` reset did not restart alto. Whether alto
  (its nonces, its mempool) works on a chain put back under it is unknown.
- **Core on the hub.** A hub world was never given a Core: a Worker per world against one Core for all worlds, and
  Hyperdrive across a branch restore on the hub, are unmeasured (one `record.export` after a restore answered through
  `wsr`'s Hyperdrive, 5.8).
- **The parallel reset** (chain and restore side by side, no probe) is the 11 to 14 s estimate above, not a run.
- **Ponder's floor.** About 5 to 7 s of every start is Ponder building its app on 1/4 vCPU. A larger instance was only
  tried on the native hub, where placement swamps it (3.5); a prebuilt or kept-running Ponder was not tried.
- **Neon restore's spread** (2.3 to 8.2 s, 5.4) from six restores; and the branch tree it leaves breaks today's
  take-down order (5.10): `dropSnapshots` must delete the world's branch before the snapshot's, and treat "already
  deleted" as done.
- **Native's failed first start** (3.6, "container has not been started" for 240 s) was not explained; the second try
  worked.
- **One point in time for a snapshot.** The Neon branch and the anvil dump are taken seconds apart; with Ponder or a
  user writing between them they could disagree. The resets here were of quiet worlds.
- **Cost.** What an idle hub, or a world's containers left running between scenarios, cost was not measured; the hub's
  classes allow 10 instances each.

## Cleanup (14 November 2026, 00:10 UTC)

Both hub stages destroyed with `./run.sh destroy --stage ws-native --yes` and `--stage ws-fleet --yes`
(`records/cleanup-destroy-ws-native.log`, `records/cleanup-destroy-ws-fleet.log`): `.alchemy/state` holds no stage
of `CapxulSpikeWorldSpeed`. The account then held no Worker, container application, Durable Object namespace or
Hyperdrive configuration named for the spike, the worlds' Neon project only `main` and `registry`, and
`packages/world/run.sh list` printed `[]`. The worlds `wsb2`, `wsp1`, `wsp2` and `wsr` had been destroyed by
`packages/world/run.sh destroy` (their records above); `wsb1` was taken down by its own failed create
(`records/failed/e1-create-wsb1-ponder-rebuild.log`: its Ponder context hash had changed and Docker cannot build here,
another reason to pin images by digest). The published images `capxulworld-{anvil,ponder,alto}` belong to the
platform and were left as they were.

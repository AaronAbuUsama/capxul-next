# What a world costs

Two parts. **Part 1** is measured: what one test world's Ponder costs, on Postgres and on PGlite, written 12 November
2026 after Aaron's decision `aaron.postgres-and-ponder` (one Postgres holds Capxul's data and Ponder's index in every
environment, worlds included). **Part 2** is the research of 10 November, kept as it was written: its Ponder and Postgres
rows were estimates that Part 1 replaces, and its recommendation (design B, no Ponder in worlds) is superseded by that
decision.

## Part 1. Ponder per world, measured (12 November 2026)

### The answer in plain words

- **On Postgres, one world's Ponder takes about 210 to 240 MB of memory** while it follows its chain, and about 6.5% of
  one CPU core. The shared Postgres adds about 10 to 40 MB per world on top of its own 30 to 120 MB.
- **On PGlite it takes about 450 to 650 MB and 10% of a core**, because PGlite keeps its database inside Ponder's memory
  (about 275 MB of the total in every PGlite run). So PGlite halves how many worlds fit. Postgres, as decided, is
  the right one for hosts; PGlite stays fine for a single world in an orb.
- **Starting takes 2 to 4 s** to be up on Postgres (4 to 9 s on PGlite). **Catching up** on a world with 50 companies
  and 500 payments (3,950 events over 1,100 blocks) took **92 s**, the same on both databases. The time goes on the
  chain, not the database: 40% of it is Ponder asking anvil for each Safe's owners at past blocks. Without those reads
  it took 55 s.
- **Parking a world (stopping its Ponder) gives back all of Ponder's memory**, about 205 MB per world on Postgres
  (measured from the host's free memory: 10 worlds freed 2.06 GB), and Postgres drops back to its baseline. The index
  stays on disk (12 to 20 MB per world on Postgres, 37 to 48 MB on PGlite). **Unparking** is ready in 3.5 to 10 s,
  because Ponder caches what it read from the chain.
- **How many fit on a host.** Counting only the Capxul part of a world (Ponder, its share of Postgres, and its anvil),
  an active world needs about 0.3 to 0.5 GB. On a 16 GB host, keeping 2 GB for the system and Postgres, that is
  **about 30 active worlds**, with memory running out before the CPU does. Parked worlds cost disk only, so hundreds
  can wait. A world with Frappe sites costs more: Part 2 measured the Frappe bench at 0.85 GB shared plus about
  0.1 GB per busy site, so a four-company world needs about 0.85 GB, which means **about 15 of those at once**.
  This last figure combines Part 1's measurement with Part 2's estimate per site; it is not measured as one stack.

### What was measured, and how

**Machine.** A Claude cloud container: 4 vCPU, 16 GB RAM (16,086 MB), Linux 6.18, Node 22.23.4, no swap. Postgres 16.15
(the `postgres:16-alpine` image, default settings: `shared_buffers` 128 MB, `max_connections` 100) in Docker on the
host network. Anvil 1.7.1 from `packages/devnet/cloud/setup.sh`. Ponder 0.18.6, the current release.

**The world.** A fresh anvil per world from the seeded v4 state (`packages/contracts/state/core.json`, chain 84532), as
`bin/chain-up.sh` starts it. Its history is real: `load.ts` drives the devnet `company` module, so every company is
born on the real contracts (Companies House claims the founder's Safe and mints the company Safe, the Installer deploys
hats, Roles, the signer gate and a top budget), then the Board makes a department, grants a hat and sets its budget, and
the hat's wearer makes supplier payments through Budgets and Payments with a document hash. A company with 10 payments
is about 22 blocks and 79 events.

**The Ponder app** (`packages/devnet/world-cost`, kept as a starting point for the real indexer task). It indexes the
contracts and events the blueprint's indexing records name (`blueprint/indexing/data.ts`): Companies House (claims and
company Safes), Installer, Budgets, Agreements, Payments, the escrow factory and its escrows, AgentOwner, the five
equity clones (by factory from the Installer), every Safe Capxul made (by factory from Companies House and AgentOwner),
Hats, and the world's token. It writes a cut-down copy of the blueprint's tables: `chain_logs` (every log, with its
decoded arguments and the Safes it names), `transfers`, `chain_payments`, and three projections: `safe_owners` (read
from the Safe at the event's block, as the record says), `chain_budgets` and `hat_wearers`. Ponder's defaults otherwise:
polling once a second, a 180 s reorg window, the RPC cache on.

**The harness** (`measure.ts`). It starts K worlds, gives each the same history, then for every world at once: starts
Ponder on an empty database and times when it answers `/health` (up) and `/ready` (caught up); lets it sit 60 s at the
head; adds a live burst of 3 more companies while Ponder follows and times how long Ponder takes to reach the head once
the burst ends; stops Ponder (parks); mines more history; starts Ponder again on the same database (unparks). Memory is
**PSS** (proportional set size: a page shared by several processes is split between them, so sums across processes are
honest), read from `/proc` every 250 ms for Ponder's process tree, every Postgres process, and each anvil. CPU is from
`/proc/<pid>/stat` over the 60 s idle period. Postgres gets one database per world, as the decision's elaboration says.

### Results

Six runs. Raw output of each, unedited: `docs/mission/world-cost-runs/<run>.json`.

| Run | Worlds | History per world | Database |
|---|---|---|---|
| A | 1 | 50 companies, 500 payments: 3,950 events, 1,101 blocks | PGlite |
| B | 1 | the same | Postgres |
| C | 1 | the same, Safe reads switched off (`SAFE_READS=off`) | Postgres |
| D | 5 | 20 companies, 200 payments: 1,580 events, 441 blocks | Postgres |
| E | 5 | the same as D | PGlite |
| F | 10 | 5 companies, 25 payments: 295 events, 86 blocks (a test-sized world) | Postgres |

Per world unless it says total. Memory in MB (PSS); times in seconds; "slowest" is the last world to finish.

| | A PGlite | B Postgres | C no reads | D 5 × Postgres | E 5 × PGlite | F 10 × Postgres |
|---|---|---|---|---|---|---|
| Up (`/health`), mean | 4.0 | 2.0 | 2.3 | 3.3 | 8.8 | 6.9 |
| Caught up (`/ready`), slowest | 93.7 | 92.0 | 54.6 | 44.5 | 50.5 | 11.6 |
| Ponder while catching up, peak | 792 | 240 | 243 | 238 | 608 | 198 |
| Ponder idle at head, median | 648 | 240 | 195 | 231 | 456 | 211 |
| of which Node heap / outside the heap (PGlite) | 70 / 274 | 63 / 20 | 63 / 20 | 64 / 20 | 69 / 274 | 66 / 20 |
| Ponder CPU idle, % of one core | 10.7 | 6.9 | 5.9 | 6.2 | 10.0 | 6.5 |
| Postgres total: before / catching up peak / idle / live peak | | 28 / 67 / 45 / 73 | 39 / 69 / 52 / 71 | 42 / 162 / 80 / 229 | | 118 / 248 / 143 / 288 |
| Postgres CPU idle, % of one core | | (bad reading) | (bad reading) | (bad reading) | | 0.4 |
| Live burst: reaching the head after it, slowest | 0.4 | 0.2 | 0.4 | 0.7 | 2.4 | 5.1 |
| Park: host memory freed, total | 464 | 205 | 204 | 1,013 | 2,205 | 2,060 |
| Postgres total after parking | | 30 | 42 | 42 | | 118 |
| Unpark: ready, slowest | 3.4 | 3.7 | 3.5 | 4.9 | 7.1 | 9.6 |
| Unpark: at the head again, slowest | 14.5 | 14.7 | 13.8 | 15.8 | 18.8 | 21.6 |
| Index on disk | 48 | 21 | 19 | 17 | 37 | 13 |
| anvil: before Ponder / idle / after parking | 113 / 639 / 659 | 113 / 643 / 663 | 115 / 113 / 118 | 179 / 195 / 210 | 179 / 195 / 212 | 51 / 44 / 56 |

Postgres connections, measured separately with one world: Ponder held 5 to 6 connections while catching up and 1 to 5
once idle.

### What the numbers say

1. **Postgres, not PGlite, for any host with more than a few worlds.** PGlite's database lives inside Ponder's memory:
   274 MB outside the Node heap in every PGlite run against 20 MB on Postgres, and twice the idle CPU. The shared
   Postgres costs little per world: 10 to 40 MB, and it returns to its baseline when worlds park.
2. **Ponder's own floor is about 200 MB.** The heap is only 63 to 70 MB; the rest is Node, Ponder's code and buffers.
   It barely grows with history (F's 295 events and B's 3,950 both sit near 210 to 240 MB).
3. **Catch-up is bound by the chain.** The same history took 92 s on PGlite and on Postgres. Switching off the Safe
   reads at past blocks cut it to 55 s, and in runs A and B the anvil grew from 113 MB to about 640 MB while Ponder made
   those reads; with the reads off it stayed at 113 MB. This did not happen in D (441 blocks, reads on): anvil stayed
   near 195 MB. So the growth depends on the depth of history read, but the cause inside anvil is not established.
   **For the real indexer:** derive a Safe's owners and threshold from its own events (setup, AddedOwner, RemovedOwner,
   ChangedThreshold) rather than reading the Safe at each event's block, or accept that catch-up on a world costs
   anvil memory.
4. **Several worlds share the CPU well.** Five worlds caught up 5 × 1,580 events at once in 44.5 s; ten test-sized
   worlds in 11.6 s. Idle, each Ponder polls its chain once a second for about 6.5% of a core, so 4 cores carry about
   60 idle Ponders: memory runs out first.
5. **Parking works and is cheap to undo.** Stopping Ponder takes 0.1 s and frees all its memory; Postgres closes the
   connections and drops back. Unparking with history mined meanwhile is ready in 3.5 to 10 s and at the head in 14 to
   22 s (most of that is following the new blocks one by one, with the Safe reads).

### A trap found on the way: Ponder cannot start on a freshly seeded world

A world started with `anvil --load-state` has only one block of history, its head. At start Ponder looks for the
newest block older than its 180 s reorg window, and its first guess is 90 blocks below the head (chain 84532 is Base
Sepolia, a two-second chain). If that block is not old enough, the search goes lower, below the seed, to a block the
seeded state does not have, and Ponder retries it until it gives up. Measured: with no blocks mined after the seed, and
again with blocks one second apart, Ponder never started. What works (used in every run above): set anvil's block
timestamps two seconds apart, as on Base (`anvil_setBlockTimestampInterval 2`), and mine 200 empty blocks when the world
is born. Setting Ponder's `reorgWindow` to 0 would also avoid it, at the cost of Ponder's reorg handling, which a world
needs when it rolls back to a snapshot. **The devnet's world birth must do one of these**; it is a small change, for
the task that builds worlds.

Also seen: Ponder logs "No new block received within expected time" while a world is idle, because anvil only mines
when there is a transaction; harmless. Ponder's Postgres driver logs a deprecation warning (`client.query()` while a
query runs); harmless today, to watch when `pg` 9 lands.

### What this does not cover

- **Frappe and the Capxul backend.** Only Ponder, Postgres and anvil were measured. The per-host estimate for a world
  with sites uses Part 2's Frappe figures.
- **The full indexer.** Six of the blueprint's seventeen indexing tables, three projections written simply, no Postgres views or
  row-level security in `app`, no Ponder API used. The real package will write more per event; its catch-up will be
  somewhat slower and its memory similar (memory did not follow the write load).
- **Events nobody emitted.** The history has companies, hats, budgets and payments. It has no agreements, escrows,
  agents or equity, so those contracts were registered but produced no events. No user operations: the world has no
  bundler and the app does not index the EntryPoint (`m2-bundler-world` is that task).
- **Many chains.** One chain per Ponder. Aaron said there will be many chains; a shared environment's Ponder indexing
  several chains was not measured.
- **Reorgs and snapshot rollbacks.** Not exercised.
- **Postgres tuning and connection limits.** Default settings. Each Ponder held up to 6 connections while catching up,
  so the default 100 connections caps about 16 worlds catching up at once; raise `max_connections`, set Ponder's
  `poolConfig.max` lower, or put a pooler in front.
- **Isolation.** Plain processes, no containers or cgroups.
- **Postgres CPU in runs B, C and D** is a bad reading (the harness summed child processes twice; fixed before E and
  F). Only F's 0.4% is a real figure.
- **Anvil's own memory** was recorded but not studied; it ranged from 44 to 663 MB per world (see point 3).
- **The machine.** A shared cloud VM; numbers on Aaron's AWS host or in an Amp orb will differ somewhat.

### How to run it again

`packages/devnet/world-cost/README.md` gives the commands: set up the cloud tools, build the contracts, `npm ci` in the
app, then `node --experimental-strip-types measure.ts --backend postgres --worlds 5 --companies 20 --payments 10`. Each
run above took 3 to 5 minutes.

## Part 2. Research of 10 November 2026 (estimates; recommendation superseded)

Written 10 November 2026. Research only. Nothing was built, started or stopped.

Tags: **[M]** measured here today. **[R]** read, with source. **[E]** my estimate, with the arithmetic. Cloudflare pages were read on 10 November 2026.

### 1. Where the cost is

Measured on this Mac (10 cores, 16 GiB). The anvil on 8545 holds the skeleton's stand-in contracts, not the real v4 state.

| Process or store | Memory | CPU idle / busy | Disk | Start-up |
|---|---|---|---|---|
| anvil (stand-in state) | 11.6 MiB RSS [M] | 0.1% / one core while mining [E] | state file 376 KB [M]; real v4 seeded state 5.5 MB (`packages/contracts/state/core.json`) [M] | under 1 s [E] (not run: no services started) |
| Node Core stub service | 75 MB RSS [M] | 0.4% / short bursts [M] | none | about 1 s [E] |
| Node fake-Frappe + test runner | 57 MB + 72 MB [M] | test only | none | n/a |
| Ponder indexer (old) | 300 to 500 MB [E, typical Node + Ponder] | polling [E] | its own Postgres schema | tens of seconds [E] |
| PostgreSQL per world | 100 to 150 MB [E] | low | 50 MB+ [E] | 2 to 5 s [E] |
| alto + mock paymaster (old) | 150 to 250 MB together [E] | low | none | about 5 s [E] |
| Bench container (web, worker, scheduler) | 361 MiB, 6.5% CPU while tests ran [M] | | assets 68 MB shared [M] | 24 s stack restart [M] |
| MariaDB | 471 MiB [M]; datadir 765 MB [M] | 0.1% [M] | 4 sites x 60 MB data [M] | 11 s with the stack [M] |
| Redis | 22 MiB [M] | 1.9% [M] | small | instant |
| One company site | files about 1 MB [M] | | 60 MB database [M] | 143 s cold create [M `FINDINGS.md:81`], 7 s if it exists |

**What dominates.** The chain is tiny. Everything around it is not. Postgres, Ponder, alto and the paymaster are four extra runtimes that exist to serve one chain we fully control. The Capxul part is about 0.6 GiB [E, `worlds.md`], and about 0.1 to 0.2 GiB of that is the chain and service. So 70% of a world's Capxul memory is plumbing. Then Frappe: 0.85 GiB shared fixed [M] plus about 0.1 GiB per site [E].

### 2. The radical options, component by component

**The chain.**
- *Anvil per world.* Today. About 12 MiB plus state [M]. Cheap already; the cost is one process and one port per world.
- *One anvil serving many worlds.* Not supported by anvil [E]. Reject.
- *An EVM inside the service* (revm compiled to WASM, or Tevm/EthereumJS in JavaScript), loaded from the 5.5 MB state. Saves a process and a port per world. Anvil itself is revm [R, Foundry docs], so revm-in-WASM is the same engine. The JS EVMs are slower and might differ on the newest hardfork rules [E]. Anvil-only RPC calls (`evm_setNextBlockTimestamp`, snapshots, `anvil_loadState`) must be rebuilt as a thin layer: small, because we own the clock.
- *Chain only while in use, state as a file.* Anvil's `--state` already does this [M, the process on 8545 runs with it]. Fits parking.
- *Copy-on-write state.* A template of 5.5 MB is too small to need it. Copy the file. Reject as over-engineering.

**The indexer.** In a world we control the chain and the clock, so a plain ordered read of logs is enough. The old indexer is 2,701 lines of TypeScript around Ponder [M, `apps/indexer/src`]. Option: the service reads receipts as it sends transactions (or `eth_getLogs` in block order) and writes rows into its own store, with the same `event_key` idempotence the spike already uses (`INTERFACE.md`). Saves Ponder, its Postgres schema and 300 MB [E]. Costs: the old query shapes must be reproduced; reorgs do not exist in a world. Proof: replay the record into both indexers; compare every row.

**The service's database.** SQLite per world: one file, snapshot is a copy, parked cost is disk. Shared Postgres with a schema per world saves little and loses the file-copy snapshot. A shared stateless service keyed by world is the Durable Object shape (section 3).

**Bundler and paymaster.** Three levels. Real alto: full fidelity, 150 to 250 MB [E]. A mock bundler that executes `handleOps` on the EntryPoint (still real ERC-4337 contract code) inside the same EVM: loses only bundler policy (mempool rules, gas estimation quirks, rate limits). Skipping 4337 and calling the Safe: loses the EntryPoint, the Safe 4337 module's validation and the paymaster path, which is where production money moves. *Recommend the in-EVM mock bundler* for most worlds, and one real-alto world kept as a canary.

**Stand-ins, clock and record.** Functions inside the service. The record is an append-only file per world (or R2 object). No process needed.

**Whole-world techniques.**
- *Scale to zero.* Stop everything for an idle world; snapshots exist anyway. A core world resumes in about a second [E]. A full world resumes in the time to restore its site backups: unmeasured; I estimate 20 to 40 s per company [E] (60 MB database [M]).
- *Isolation.* Process per world: cheap, shared kernel, no memory cap unless cgroups are set. Container per world: adds about 20 to 50 MB and cgroup limits [E]. Micro-VM (Firecracker) per world: strongest, about 128 MB floor and 125 ms boot [R, Firecracker project claim, not checked today]; gVisor sits between. Worlds hold test money only, so process plus cgroup quotas is enough; use a container if agents run untrusted code.

**Proof of fidelity, for every chain proposal.** (1) Run the contracts' own 965 hermetic and 61 fork tests unchanged: they run in Foundry's revm, so they prove the contracts, not the substitute. (2) So add a *differential replay*: take the recorded transaction list of the 22-month history, run it on anvil and on the substitute from the same state file, and compare per-transaction gas used, status, logs, and the final state dump. Any gas difference means a rule difference. (3) Run the deploy script and the scenarios against the substitute's RPC. Gas parity on thousands of real transactions is the strongest test.

### 3. Cloudflare

**What the book decided.** Only the portal: one Worker `capxul-portal`, static assets, status from R2, Access in front (`blueprint/shared/portal.ts:555-582`). swarmD already runs as Workers on Aaron's account. Nothing about worlds on Cloudflare.

**Prices and limits** (read 10 November 2026):

| Item | Figure | URL |
|---|---|---|
| Workers Paid base | $5/month minimum per account; 10 M requests, 30 M CPU-ms included; then $0.30/M requests, $0.02/M CPU-ms | developers.cloudflare.com/workers/platform/pricing/ |
| Workers limits | 128 MB per isolate including WASM; CPU 30 s default, 5 min max per request; 64 MiB worker; 10,000 subrequests | .../workers/platform/limits/ |
| Durable Objects | 1 M requests, 400,000 GB-s included; $0.15/M requests; $12.50/M GB-s billed at 128 MB; idle objects that can hibernate are not billed for duration | .../durable-objects/platform/pricing/ |
| DO SQLite | 25 B rows read, 50 M rows written, 5 GB included; $1.00/M rows written, $0.20/GB-month; each `setAlarm()` is one row written | same |
| DO limits | 10 GB per object; unlimited objects; 1,000 requests/s soft limit per object; alarms 15 min wall | .../durable-objects/platform/limits/ |
| D1 | $0.75/GB-month beyond 5 GB; 100,000 databases included | .../d1/platform/pricing/ |
| R2 | $0.015/GB-month; egress free; 10 GB included | .../r2/pricing/ |
| Containers | basic 1/4 vCPU, 1 GiB; $0.00002/vCPU-s, $0.0000025/GiB-s; disk is ephemeral; cold start "often 1-3 seconds" | .../containers/pricing/ and .../architecture/ |
| Workflows | 10,000 steps default (25,000 max); `step.sleep` up to 365 days | .../workflows/reference/limits/ |

I did not fetch Queues or Hyperdrive pages; Hyperdrive reaches Postgres and is not needed if the service uses SQLite. I did not verify Queues.

**Could the Capxul part be a Durable Object per world?** Yes, with one open question. A DO gives SQLite (10 GB), alarms for the clock, a single-threaded owner of the world's order, and zero cost when idle. Frozen-clock stepping fits: the clock is a number in SQLite. The open question is the chain. An EVM in the DO must fit in 128 MB with the 5.5 MB state [M] and run each command within the CPU budget. A JS EVM doing a Safe user operation is tens to hundreds of ms [E, unmeasured]: within 30 s. revm-WASM is faster. What cannot run there: anvil (a native binary), alto, Postgres, Ponder, and `bench`. Anvil could run in a Cloudflare Container on demand, but its disk is ephemeral, so the state must be loaded from R2 each start and dumped at stop: workable for bursts, awkward for a world that is always on.

**Frappe link.** Frappe stays on a machine. The DO calls it over HTTPS (a tunnel), and Frappe calls the DO's public URL. The spike's HMAC contract already works that way. Added latency: tens of ms [E].

**Price of one world in this shape.**
- Idle for a month: storage about 60 MB (6 MB chain + 50 MB service, [E]) is inside the 5 GB included. Marginal about $0.00; the $5 base is shared by all worlds.
- 22-month history, 5,000 commands: assume 300 ms CPU, 200 rows written, 1 request each [E]. CPU 5,000 x 0.3 s = 1.5 M ms x $0.02/M = $0.03. Rows 1 M x $1/M = $1.00 (zero if inside the 50 M included). Duration 5,000 x 0.5 s x 0.128 GB = 320 GB-s x $12.50/M = $0.004. Total about $1 or less.
- A world-hour in use: 3,600 s x 0.128 GB = 461 GB-s x $12.50/M = $0.006, plus CPU: about $0.01 an hour [E].

### 4. Frappe: the floor

Measured on the running bench [M]: bench 361 MiB, MariaDB 471 MiB, Redis 22 MiB: 0.85 GiB with four sites, each 60 MB of data and about 1 MB of files, plus 68 MB shared assets. Datadir total is 765 MB. A cold site costs 143 s to create [M]; a repeat is 7 s [M].

- *Per site at rest:* about 60 MB disk, near-zero memory [E, no process per site].
- *In use:* about 0.1 GiB per busy site [E, `worlds.md`].
- *Parking:* back up and drop a site; restore on demand. Unmeasured. Estimate 20 to 40 s per site [E]; measure it first.
- *Capacity:* 16 GiB, less 2 GiB system and 0.85 GiB fixed leaves about 13 GiB [E]. At 0.1 GiB per active site that is about 130 sites, or 30 four-company worlds, if gunicorn workers stay few. `worlds.md` plans for 6 to 8 busy; I think 20 is reachable but this is unmeasured.
- **This is the bound.** Every design pays about $84 a month plus 0.1 GiB per active company. A world with companies can never be cheaper than its Frappe share: about $84 / 130 = $0.65 a site-month if all fit.

### 5. Three designs compared

A: as designed on one machine (anvil, Postgres, Ponder, alto, Node, per world). B: lean single machine: one Node process per world with in-process EVM (revm-WASM), SQLite, in-service indexer, in-EVM mock bundler, parked when idle; Frappe on the same machine. C: Capxul part as a Durable Object per world, Frappe alone on the machine.

| | A: today | B: lean machine | C: Cloudflare + Frappe machine |
|---|---|---|---|
| Idle world per month (core) | $84 / 12 idle worlds = $7 [E] | parked: disk only, about $0.01 [E]; machine shared | about $0.00 marginal (storage under 5 GB included) |
| Idle full world (4 sites) | $7 plus sites; sites keep 60 MB each | parked sites: disk only, 240 MB | Frappe side as B |
| One world-hour in use | $84/730 h = $0.115 machine, / 7 busy = $0.016 | $0.115 / about 20 active = $0.006 | $0.01 (Cloudflare) + Frappe share |
| 22-month history | 5,000 x 1 s = 83 min of 1/7 machine = $0.02 compute; the real cost is 0.6 GiB held | same, with 0.15 GiB | about $1 or less |
| Worlds per $100/month, core only | about 14 idle, 8 busy | about 85 active, thousands parked [E: 13 GiB / 0.15 GiB] | $95 / $0.20 per GB / 0.06 GB = over 1,500 stored; compute negligible |
| Worlds per $100, full (4 sites) | 8 busy | about 20 active (0.15 + 0.4 GiB each) | Frappe-bound, about 20 to 30 |
| Time to create a world | about 25 s deploy [R, `critical-path.md`] or 10 s from state [E] | under 1 s core [E] | about 1 s [E]; sites 143 s each cold [M] |
| Restore from snapshot | 10 s [E] | under 1 s core; sites 20 to 40 s each [E] | about 1 s core; sites same |
| Isolation | process + Postgres schema; weak | process + cgroup, or container | strong: separate object, own SQLite, no shared memory |
| Fidelity lost | none | JS/WASM EVM differences; mock bundler skips alto policy | same as B, plus no anvil, no real alto |
| Engineering effort [E] | 3 to 4 weeks (registry, ports, supervisor) | 4 to 6 weeks (EVM layer, indexer, bundler mock, differential replay) | 6 to 9 weeks (B's work, plus DO port, tunnel, R2 snapshots) |
| Main risk | memory, ports, many processes | EVM parity | 128 MB isolate and tunnel to Frappe |

### 6. Recommendation

**Build B first, shaped so it can move to C.** Write the service as a pure function over (world store, EVM, clock) with the six-slot layout, so the host (Node process or Durable Object) is a composition root. Drop Ponder, Postgres and alto for simulated worlds. Use SQLite and an in-process EVM loaded from `state/core.json`. Park idle worlds. Keep one real anvil + alto world as the faithfulness canary. Move to C only if worlds exceed what one machine's Frappe can hold, or if a public-facing arena is wanted, because Cloudflare cannot host Frappe, and Frappe is the dominant cost.

**Prototype first (under a day):** run the 5.5 MB seeded state in revm-WASM (or Tevm), replay the real v4 deploy and the first 200 transactions of any scenario against it and against anvil, and compare gas used, logs and the final state dump transaction by transaction. This tests the riskiest assumption: that a substitute EVM matches anvil exactly on Safe, Hats, Roles and the EntryPoint. Add a second measurement in the same day: peak RSS and wall time of the substitute on a Safe user operation, and the cold-start of a parked world.

**Explicitly not do:** a shared one-anvil-many-worlds hack; copy-on-write state (the state is 5.5 MB); a Workflows-driven history (10,000 steps cap and no gain over a loop); a rewritten EVM; skipping ERC-4337 in the worlds that train agents, since the EntryPoint path is where money moves; Hyperdrive or D1 (SQLite in the DO is simpler).

### 7. What I could not verify

- Real anvil memory with the full v4 state (I started no service); my 12 MiB is the stand-in state.
- Idle memory and CPU of Ponder, Postgres, alto and the paymaster: estimates only; the old stack is not running.
- Speed and gas parity of any substitute EVM; Firecracker figures; container cold start beyond Cloudflare's "1-3 seconds".
- Site park/restore time, per-site memory in use, and the 130-site capacity.
- Cloudflare Queues and Hyperdrive pricing (not fetched), tunnel latency, and whether the 1,000 requests/s soft limit or 128 MB isolate bites a loaded world.
- The Cloudflare pages disagree in places (DO free-plan storage; Workflows concurrency); I used the paid-plan figures.

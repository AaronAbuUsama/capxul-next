# What a world costs, and how to make it radically cheaper

Written 10 November 2026. Research only. Nothing was built, started or stopped.

Tags: **[M]** measured here today. **[R]** read, with source. **[E]** my estimate, with the arithmetic. Cloudflare pages were read on 10 November 2026.

## 1. Where the cost is

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

## 2. The radical options, component by component

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

## 3. Cloudflare

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

## 4. Frappe: the floor

Measured on the running bench [M]: bench 361 MiB, MariaDB 471 MiB, Redis 22 MiB: 0.85 GiB with four sites, each 60 MB of data and about 1 MB of files, plus 68 MB shared assets. Datadir total is 765 MB. A cold site costs 143 s to create [M]; a repeat is 7 s [M].

- *Per site at rest:* about 60 MB disk, near-zero memory [E, no process per site].
- *In use:* about 0.1 GiB per busy site [E, `worlds.md`].
- *Parking:* back up and drop a site; restore on demand. Unmeasured. Estimate 20 to 40 s per site [E]; measure it first.
- *Capacity:* 16 GiB, less 2 GiB system and 0.85 GiB fixed leaves about 13 GiB [E]. At 0.1 GiB per active site that is about 130 sites, or 30 four-company worlds, if gunicorn workers stay few. `worlds.md` plans for 6 to 8 busy; I think 20 is reachable but this is unmeasured.
- **This is the bound.** Every design pays about $84 a month plus 0.1 GiB per active company. A world with companies can never be cheaper than its Frappe share: about $84 / 130 = $0.65 a site-month if all fit.

## 5. Three designs compared

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

## 6. Recommendation

**Build B first, shaped so it can move to C.** Write the service as a pure function over (world store, EVM, clock) with the six-slot layout, so the host (Node process or Durable Object) is a composition root. Drop Ponder, Postgres and alto for simulated worlds. Use SQLite and an in-process EVM loaded from `state/core.json`. Park idle worlds. Keep one real anvil + alto world as the faithfulness canary. Move to C only if worlds exceed what one machine's Frappe can hold, or if a public-facing arena is wanted, because Cloudflare cannot host Frappe, and Frappe is the dominant cost.

**Prototype first (under a day):** run the 5.5 MB seeded state in revm-WASM (or Tevm), replay the real v4 deploy and the first 200 transactions of any scenario against it and against anvil, and compare gas used, logs and the final state dump transaction by transaction. This tests the riskiest assumption: that a substitute EVM matches anvil exactly on Safe, Hats, Roles and the EntryPoint. Add a second measurement in the same day: peak RSS and wall time of the substitute on a Safe user operation, and the cold-start of a parked world.

**Explicitly not do:** a shared one-anvil-many-worlds hack; copy-on-write state (the state is 5.5 MB); a Workflows-driven history (10,000 steps cap and no gain over a loop); a rewritten EVM; skipping ERC-4337 in the worlds that train agents, since the EntryPoint path is where money moves; Hyperdrive or D1 (SQLite in the DO is simpler).

## 7. What I could not verify

- Real anvil memory with the full v4 state (I started no service); my 12 MiB is the stand-in state.
- Idle memory and CPU of Ponder, Postgres, alto and the paymaster: estimates only; the old stack is not running.
- Speed and gas parity of any substitute EVM; Firecracker figures; container cold start beyond Cloudflare's "1-3 seconds".
- Site park/restore time, per-site memory in use, and the 130-site capacity.
- Cloudflare Queues and Hyperdrive pricing (not fetched), tunnel latency, and whether the 1,000 requests/s soft limit or 128 MB isolate bites a loaded world.
- The Cloudflare pages disagree in places (DO free-plan storage; Workflows concurrency); I used the paid-plan figures.

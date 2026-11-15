# The world run in under 10 minutes, and under 5: options from first principles

📐 Designer note, 15 November 2026. Analysis and options only: no code changed, no world, deploy or CI run made. Aaron
asked to think about the `world` run "from first principles, be radical", to find ways to take it from about half an
hour to under 10 minutes, and under 5 if possible. The agreed order stands: the pipeline is instrumented first (stage
3b, step 4.7), then the speed lane (stage 3d) builds what is chosen here, measured by those spans.

Every figure marked **measured** comes from a run record or a CI job's step times. Every figure marked **projected** is
an estimate from those records, to be settled by a measured run. The scripts that tabulated the records were throwaway
and are not committed; every number can be recomputed from `summary.json` (`oneWorld.timings`) and each journey file's
`calls[].timing`, `calls[].steps` and `steps[].ms`.

## The short answer: where the slowness really is

Aaron's premise (15 November 2026, about 17:30 UTC): "Everything's running on our own timers, clocks, our own chain,
right? So I don't understand why it would even take 10 minutes." The records bear it out. **Almost none of the 33
minutes is work. It is waiting**, in five kinds, and then every wait is lined up one after another:

1. **Distance, about 14 minutes.** The runner is in the United States; Core runs next to it; Core's database and the
   chain, bundler and index are in Europe. Every database query is a round trip across the Atlantic, about a tenth of
   a second, where the query itself takes under a millisecond. A run makes about 2,400 queries, 1,270 lookups of the
   world's own details, 880 calls from the runner to Core, and the checks' own chain reads; most of those are the
   checks reading the world back, not the operation under test.
2. **Things starting up, about 7 to 8 minutes.** After every reset the bundler takes 6 to 29 seconds to answer and the
   index 1 to 16 seconds to catch up; whole worlds are made (a deploy, a database branch, a registration) for the
   quota journeys; the runner probes 20 times in a row before each journey; worlds are destroyed before the run ends.
3. **Frappe doing real work, about 5 minutes.** Sites are claimed, removed, saved and restored on the bench, and a clock
   warp makes Frappe step through every day and run its daily jobs, about 0.8 s a day.
4. **Moving state around, about 3 minutes.** Database branches, the chain's state to and from storage, the chain reset
   and mined, the clock set.
5. **Gaps, polls and CI, about 3 minutes.**

**And all of it runs one after another.** Seven journeys, seven resets, three saves, two quota worlds: nothing
overlaps, though almost nothing depends on what came before.

If the same work ran in one process on one machine, the work itself would take on the order of **one to two minutes,
most of it Frappe's** (projected; section 2 has the floor of each piece). So the run is about 95% waiting.

## 1. Where the half hour goes today (measured)

Sources: the last three green `world` runs, all on 15 November 2026, all 7 journeys, after the speed note's changes 1
to 3 had landed.

| Run | Branch | Job | Inside the runner | Record |
|---|---|---|---|---|
| 43736529998 | `slice/docs` | 31.0 min | 30.1 min | artifact `world-43736529998-1`, `run-97526c` |
| 43733548394 | `slice/world-layout` | 36.7 min | 35.9 min | artifact `world-43733548394-1` |
| 43733471806 | `slice/blueprint` | 33.4 min | 32.5 min | artifact `world-43733471806-1` |

The second and third ran at the same time, on the same hub and bench.

### By phase (minutes; the three runs, then their mean)

| Phase | 1 | 2 | 3 | Mean | Share |
|---|---|---|---|---|---|
| CI outside the runner (setup 20 s, hub, upload, destroy, sweep) | 0.9 | 0.8 | 0.9 | 0.9 | 3% |
| Prepare: world create, make `founded`, `office-holder`, `payment-drafted`, three saves, two bench templates | 3.6 | 5.6 | 5.1 | 4.7 | 14% |
| Resets in place, 7 | 4.0 | 4.2 | 4.5 | 4.2 | 13% |
| Starting world `quota-full`, made twice | 1.5 | 2.4 | 2.0 | 2.0 | 6% |
| **Journeys, one after another** | **17.4** | **20.2** | **17.7** | **18.5** | **55%** |
| Gaps between parts (readiness probes, about 10 s before each journey; record writing) | 1.8 | 1.7 | 1.7 | 1.8 | 5% |
| Destroying the journeys' own worlds, then the run's world | 1.5 | 1.5 | 1.3 | 1.4 | 4% |
| Checks after each journey | 0.3 | 0.3 | 0.2 | 0.3 | 1% |

Inside prepare (run 1): world create 20 s, save `fresh` 9 s, **make `founded` 75 s** (126 and 143 s in runs 2 and 3),
save `founded` 34 s, bench template 12 s, make `office-holder` 13 s, make `payment-drafted` 5 s, save it 34 s, bench
template 12 s. Saving and templating cost more than making, except for `founded`.

### Inside the journeys (mean of the three runs)

| | Minutes | Note |
|---|---|---|
| Calls the runner makes | 13.2 | 876 to 879 calls a run |
| of which **observation reads** (`record.export`, `world.show`, `world.snapshot.list`, `world.list`) | **5.2** | **657 to 660 calls: 75% of all calls**. Finding F11, smaller since change 3 |
| of which snapshot save and restore, as journey steps | about 3.2 (run 1) | 10 saves, 7 restores; one restore 66 s, one save 25 to 28 s |
| of which `world.clock.warp` | about 0.7 | 3 calls; one is 38 s inside a single POST with no child span (an explainability gap) |
| Between calls: the runner's own waits and polls, and readiness | 5.3 | e.g. pay's `approval.sign` step: 45 s, of which 15 s are calls |

Each journey, in seconds (runs 1, 2, 3):

| Journey | Starting world | Seconds |
|---|---|---|
| two operators and their worlds | `quota-full` | 104, 116, 119 |
| an operator's inventory | `quota-full` | 116, 119, 78 |
| found Northwind and give sam the books | `fresh` | 151, 179, 139 |
| invite olga to Northwind | `founded` | 95, 110, 82 |
| seat sam on Northwind's Board | `founded` | 137, 185, 137 |
| give sam a budget at Northwind | `founded` | 154, 194, 201 |
| **pay Brightside and branch the books** | `payment-drafted` | **289, 311, 306** |

The longest journey, about 5 minutes, sets the floor for any plan that runs journeys side by side.

### Where the servers are (measured, a finding)

Every call record now carries `cf.colo`. Core ran in **Minneapolis, Detroit, Pittsburgh, Ashburn and Newark**: next to
the GitHub runner, as the speed note guessed. Its database (Neon, aws-eu-west-2, London) and the hub's containers
(WEUR) are in Europe. So nearly every database query and hub call crosses the Atlantic:

- the median of caller minus server time is 100 to 135 ms (the runner to Core, short);
- `record.export` makes 3 queries and takes 246 to 336 ms on the server (median): about 90 ms a query;
- run 1 has 1,902 `postgres` spans totalling 213 s, an average of 112 ms each, where a query next to its database
  takes a few milliseconds.

The speed note's change 2 recorded the colo; its second half, pinning Core next to its data, has not been done.

## 2. What each minute is waiting for, piece by piece

Every leaf span of every call in the three runs (the spans with no child), grouped by what it waits on, then the
runner's own parts. Minutes per run, the mean of the three. "On one machine" is the same work done in one process
beside a local Postgres, a local anvil and a local Frappe: a projection, from what such a step costs locally.

### Inside the journeys' calls (13.2 min)

| Piece | Count a run | Each | Minutes | Waiting for | On one machine |
|---|---|---|---|---|---|
| Core's database queries (`postgres`, `world.database.post`, `BEGIN`, `COMMIT`) | 2,396 | 103 ms | 4.1 | A round trip from a US data centre to Neon in London | Under 1 ms each: about 5 s |
| Core's lookups of the world: its stage, its secret, that it exists, its view (`world.engine.stages`, `world.mustExist`, `world.engine.secret`, `platform.view`, ...) | 1,271 | 108 ms | 2.3 | The same round trip, to the registry, repeated on every call | 0: kept in memory |
| The runner to Core and back | about 880 | 100 to 135 ms | 1.7 | The internet, GitHub's runner to Cloudflare | 0 |
| Chain and bundler calls from Core (`rpc eth_call`, `eth_sendUserOperation`, receipts, gas price) | 226 | 532 ms | 2.0 | Core in the US, through the gateway, to anvil and alto in Europe | A few ms each: about 2 s |
| Waiting for a new world's index and bundler to answer (inside restores and world creates) | 16 | 5.1 s | 1.3 | Containers starting, Ponder replaying the chain | 0 if they stay up |
| Snapshot plumbing: Neon branches, the chain's state to R2 and back | 76 | 0.8 s | 1.05 | Neon's API, R2, the hub | Under 1 s: a Postgres template copy and an anvil state dump |
| Frappe work inside calls (site save, restore, reconcile) | 46 | 0.7 s | 0.5 | The bench, behind Cloudflare's tunnel | Seconds |
| Deploying Core with Alchemy (inside world creates and restores) | 138 | 0.2 s | 0.45 | Cloudflare's API: plan, upload, configure | 0: the code is already loaded |
| `world.clock.warp` | 5 | 4.9 s | 0.4 | Frappe stepping through every day of the warp and running its daily jobs, 0.8 s a day | Only days with jobs due |

The pieces overlap a little (some spans run side by side), so they sum to slightly more than 13.2.

### Inside the journeys, between calls (5.3 min)

| Piece | Minutes | Waiting for | On one machine |
|---|---|---|---|
| The checks' own reads of the chain from the runner ("leaves the chain as it was", balances, logs): not in the call records, so **inferred** from step time no recorded call covers | about 4 | GitHub's runner, through the gateway, to anvil in Europe | Seconds |
| Readiness: 20 probes in a row, 0.5 s apart, before each journey | 0.85 | A fixed count, though no run has ever relapsed | 0 |
| The scenarios' 2 s polls (found Northwind waiting for its site, about 26 s) | about 0.5 | Frappe building or claiming a site | Seconds |

One example: give sam a budget, step 3, takes 39.8 s. It is nine tries of `org.budget.create`. The operation answers in
0.26 to 0.7 s each time (once 5.8 s). Around each try the checks call `world.show` once and `record.export` twice,
about 1.5 s, and read the chain before and after; that is the other 23 s.

### The runner's own parts (14.3 min)

| Part | Minutes | Its pieces, measured | Waiting for | On one machine |
|---|---|---|---|---|
| Resets, 7 | 4.2 | Per run: sites 93 s (removing the last journey's site, claiming a copy), **bundler answers 74 s**, index caught up 40 s, chain reset 31 s, database restored 13 s, chain mined 12 s, clock 11 s, the rest 13 s | Mostly services coming back after the chain is reset, and the bench | Under 1 s each, Frappe's database copy aside |
| Prepare | 4.7 | World create 20 to 32 s; make `founded` 75 to 143 s (a site from the bench's blank pool, the company founded on chain); three saves, 9 to 45 s each (a site save is a bench job of about 11 s, polled every 3 s, then the chain's state to R2 and a Neon branch); two bench templates, 12 to 19 s each | The bench, Neon, R2, Cloudflare | Seconds, Frappe's work aside |
| `quota-full`, made twice | 2.0 | Five whole worlds each time, for the quota journeys | Deploys, branches, registrations on the hub | Five rows in a table |
| Gaps between parts | 1.8 | Record writing, world handles, the runner moving on | Nothing in particular | Near 0 |
| Destroys | 1.4 | The journeys' own worlds, then the run's | Cloudflare and Neon deletes | 0; and they need not hold the verdict back |
| Checks after each journey, CI around the runner | 1.2 | | | |

### The floor, if everything ran in one process on one machine

Core's work for 880 calls is a few milliseconds each; 2,400 queries under a millisecond each; a few dozen chain
transactions, milliseconds each on anvil. What remains is Frappe: making `founded`'s site from a template copy, posting
documents, the daily jobs of a warp. **About one to two minutes of real work in all, most of it Frappe's**, and with
the journeys side by side, under a minute of wall clock after setup. This is a projection; nothing has been run that
way.

## 3. Every sleep, poll and timeout on the run's path

Timeouts add nothing unless they are hit, and none was hit in these runs. Polls add, on average, half their interval
to every wait they end; fixed counts add their whole length. These are the ones a green run passes through.

| Where | What | Setting | What it costs a run |
|---|---|---|---|
| `packages/runner/src/settings.ts:26`, `world/warmup.ts` | Readiness before each journey | a probe every 0.5 s, 20 in a row (`WORLD_PROBE_EVERY`; warm-up 30 s) | **About 10 s a journey, 0.85 min a run, fixed**; `relapses: 0` in every run |
| `packages/scenarios/src/support/wait.ts:10`, `tries.ts:122` | A try that waits for background work, and `eventually` | every 2 s, at most 150 times | Up to 2 s per wait; about 26 s of polling for found Northwind's site |
| `packages/runner/src/worlds/company.ts:86` | Making a company waits on its site | every 2 s, at most 300 times | Inside make `founded` |
| `packages/world/src/parts/bundler/client.ts:91` | After a reset, wait until the bundler serves the EntryPoint | every 2 s, no limit but the reset's | Part of **74 s a run** of "bundler answers" |
| `packages/world/src/things/world/reset.ts:68` | The reset's own waits (index caught up, Core answers) | every 250 ms | Part of 40 s of "index caught up" |
| `packages/world/src/things/site/snapshot.ts:66`, `site/bench.ts:152` | A site save or template waits for the bench's job | every 3 s | Up to 3 s per save; saves are on every snapshot |
| `packages/world/src/things/site/client.ts:95` | Site claims and resets | every 1 s | Small |
| `packages/world/src/parts/database/neon.ts:48,74`, `branches.ts:50` | Neon operations finishing | every 1 s, 250 ms, 2 s | Small, on every branch |
| `packages/world/src/parts/containers/patience.ts` | A container's start | 1 s, backing off to 4 s | On world creates and restores |
| `packages/world/src/things/world/values.ts:135` | Hub admission when it is full | every 10 s, at most 15 min | Nothing in these runs; up to minutes when runs overlap |
| `packages/world/src/parts/api/steady.ts` | Core answers after a deploy | every 250 ms, at most 2 min | Part of every world create |
| `packages/core/src/chain/userop.ts:159` | A user operation's receipt | every 200 ms, at most 60 s | Part of `approval.sign`, small |
| `packages/core/src/site-ops/world.ts` | A clock warp is made in stretches of 14 days, each one request | Frappe steps every day, 0.8 s a day | 38 s for one warp in pay Brightside |

None of these is the main cost. The main costs are distance and starting things up, which no interval change fixes.

## 4. What a green run must prove

Before cutting, the purpose. A green `world` run proves that the thin line's journeys pass end to end on the real
parts: Core as a Cloudflare Worker, its data in a Neon Postgres branch, the chain, bundler and index in the hub's
containers, the company sites on a Frappe bench; in a world nobody else touched, made and destroyed by the run; with
every call's generic checks holding. Anything that keeps all of that is free to change. Anything that drops part of
it has to say which part, and that is what the "proof risk" column below is for.

What it does **not** need, from first principles:

- **Journeys one after another.** Worlds are cheap (20 s to make, cents to run). Nothing in the proof needs one world.
- **Observation through Core's API.** The checks need to know what happened; the run already records every span,
  log and event in the tap. Reading them back once is enough; polling Core before and after every try is not.
- **Saves and resets on the critical path.** A lane can build its starting world directly in its own world. Saving a
  world to restore it into the same world costs more than building it for every starting world but `founded`.
- **Teardown before the verdict.** The destroy must always happen (lifecycle rule 1), but the green check can be
  reported before it, with the destroy in a following job that always runs.
- **Three continents.** The runner, Core, the database and the hub could all be in one region.

## 5. The options

Savings are for the whole run's wall clock unless marked "serial" (time removed from the work, before any
parallelism). Money: the cap is $10 a day across Cloudflare and Neon for everything. A world for 10 minutes costs
cents (a Neon branch's compute and a few container-minutes); these money figures are projections until the cost job
reads them.

| # | Option | Saves | Money | Build effort | What a green run would no longer prove | Changes an agreed decision? |
|---|---|---|---|---|---|---|
| 1 | **Run where the data is.** (a) Pin Core's Worker next to Neon and the hub in Europe (a placement hint); or (b) put the runner, Core, Neon and the hub in one region | Distance is about 14 min serial (section 2). (a) removes Core's queries, lookups and chain calls, about 8 min, but adds the Atlantic to each of the runner's 880 calls (about +1 min) and leaves the checks' chain reads where they are: **about 6 to 7 min serial**. (b) removes nearly all of it: **about 12 min serial**. Every call gets faster, so every lane does too | None | Small: the world's Core stack | Nothing. It is closer to how production should run | No. Placement is the world's (`packages/world`) |
| 2 | **Observation from the tap, not from Core.** The operation checks read the call's own spans, logs and events in one batch per step (part 3's design for layer 6), and one `world.show` per step at most, instead of `world.show` and `record.export` before and after every try | About 5 min serial (75% of calls), plus most of the checks' own chain reads (about 4 min, inferred) | None | Medium. The scenario author's code, never the builder's | Nothing, if the tap holds what the reads saw; the checks must be rewritten against it and fail first on empty handlers | No. It is change 6, made thorough |
| 3 | **Lanes all the way: K up to 7, a world per journey.** The agreed ratchet "One runner, K worlds", taken to its end (part 8's option C). Lanes are concurrent inside one job and one runner, so Actions minutes do not grow | Journeys 18.5 min become the longest lane: about 5 min today, 3 to 3.5 after options 1, 2 and 6 | Projected: K worlds for 10 min instead of 1 for 30. Cents a run | Medium: the runner; an owner per lane; the hub's capacity (24 places: a run at K = 7 is projected to peak near 17, so raise `fleet`'s or give each run its own hub) | Nothing about the product. Load on the bench and the hub rises, which the ratchet's four measures watch | Part 8 said option C is "not for now". K rising to 7 is inside "One runner, K worlds"; a ceiling, if any, is Aaron's |
| 4 | **Each lane builds its starting world in place.** A lane makes its world and builds its first journey's starting world directly in it: no save, no bench template, no reset before its first journey. Lanes needing no `founded` (found Northwind, both `quota-full` journeys) start at once | Removes most of prepare's saves and templates (about 1.8 min) and the first reset of each lane (about 0.6 min each) from the critical path | `founded` is made in several lanes at once: more bench claims at once (the pool holds 4 blank copies) | Small to medium: the runner | Resets in place are exercised only where a lane runs a second journey, or by the world's own proof. At K = 7 the run would not exercise `world.reset` at all | No. Building `founded` in every run stands, as Aaron decided. Says plainly that resets leave the run at K = 7 |
| 5 | **Starting worlds built once per code change, not per run.** Named by the fingerprint of the code that builds them; a run restores them into its lanes | Prepare 4.7 min becomes a restore per lane, about 0.5 to 1 min, all lanes at once | Kept snapshots and templates between runs: small, with the sweep removing old ones | Medium | No run would make `founded`; found Northwind still covers founding a company | **Yes.** Aaron declined it on 15 November 2026 ("no to keeping founded"). It also changes "Bench templates never change" and lifecycle rule 1. Only needed for under 5 minutes |
| 6 | **Plumbing on the critical path.** (a) Restore the site beside `world.lifecycle.create`, not after it (66 s restore: create 27.5 s, then site 29.6 s). (b) Explain and cut `world.clock.warp`'s 38 s POST. (c) Readiness probes 20 to 5 (`relapses: 0` in every run). (d) Skip Core's upload when its hash is unchanged (about 8 s of every world made). (e) The runner's 2 s polls, event-driven where the tap can say. (f) After a reset, keep the bundler running and reset its state with the chain, instead of waiting for it to answer again (74 s a run) | 3 to 4 min serial; about 1 min on the longest lane | None | Small each | Nothing | No |
| 7 | **Verdict before teardown.** The job reports the check when the journeys and their checks are done; a second job, which always runs, destroys and sweeps | About 1.5 min of wall clock to green | None | Small: `world.yml` | Nothing: the destroy still always happens, and a failed destroy still fails a job and raises a task | No, lifecycle rule 1 holds. The lead's call |
| 8 | **Core deployed once per run, worlds as configuration.** One Core Worker per run serving every world of the run, instead of an Alchemy deploy per world (about 8 s per world, and the two quota journeys make about 10 worlds between them) | About 1 to 2 min serial | Slightly less | Medium: Core's routing, the world's stack | That each world's own deploy works, except in `world.create`'s own proof | Touches "a world is created and destroyed as one unit" if Core is no longer part of the unit. Not recommended now |
| 9 | **A world in a box for every pull request.** Postgres, anvil, alto and Ponder in containers on the GitHub runner, Core under workerd, sites on the bench. A fast tier on pull requests into a slice, the real `world` at the slice's merge | Gives builders a journey run in minutes, before the merge | Actions minutes on every pull request | Large | Cloudflare, Neon and the hub are not exercised; it is not rung 6 | **Yes.** Aaron decided journeys run only at a slice's merge (14 and 15 November 2026). It does not shorten `world` itself. Not recommended now |
| 10 | **Journeys at once in one world.** Journeys on different companies share a world (worked through in section 7) | Like option 3, without extra worlds | Less than option 3 | Large: isolation between journeys, the quota journeys clash | Isolation: a green journey could depend on another's state | Changes "a journey starts from its starting world". Superseded by section 7, Aaron's version: each journey with its own company and people, isolation from the data, checked by the runner. Recommended there |
| 12 | **The whole world on one machine.** The `world` run makes its world on the CI runner itself: Core's own bundle in workerd (the runner already does this with `--core=local`), a local Postgres, anvil, alto and Ponder as processes, and Frappe from the bench image beside them (`packages/platform`'s local bench, `WORLD_BENCH=local`). The same code, the same journeys and checks; no network between the parts | Distance (14 min) and most of the start-up waits (7 to 8 min) go: **projected 4 to 8 min serial, 2 to 4 with lanes**, plus the bench image's start (about 1 to 2 min, beside the other setup) | No cloud spend at all; Actions minutes only, perhaps a larger runner | Large: the local database, chain, bundler and index as processes; the local bench in CI | That Core runs on Cloudflare itself, that Neon's branching and the hub's containers and gateway work, and real network latency. A daily cloud run on `master`, and a short cloud run at a slice's merge, would keep proving those | **Yes.** It redefines rung 6 ("a fresh private world on staging") and "Fleet hub" for the slice gate. Lifecycle rule 5 holds: a CI runner is not an agent's machine |
| 11 | **Fake Frappe, or the chain in-process.** | Little: the site work on the critical path is `founded`'s 75 to 143 s and the site save and restore, and the hub's chain answers fast | — | Large | Frappe or the hub, the parts most likely to break | Yes. Not recommended |

What I would not do: options 9, 10 and 11 buy speed with proof, and option 8 buys a minute or two with a change to
what a world is. In the cloud, option 5 is the only way under 5 minutes I can find, and it reopens a decision Aaron has
made. Option 12 is the radical one that matches Aaron's premise: the work is ours, so run it in one place. It trades
proof of the cloud plumbing for speed, and that proof can come from a separate, slower cloud run.

### The hard floor

With every journey in its own lane, the run cannot be shorter than: setup (about 0.5 min), getting the longest
journey's starting world into its world, and the longest journey itself. The longest is pay Brightside, about 5
minutes today, of which about 45 s are observation reads, 2 saves (53 s), a restore (66 s), a clock warp (39 s) and
the waits of signing payments on chain. After options 1, 2 and 6 it is projected at 3 to 3.5 minutes.

- Building its starting world in the run (option 4): `founded` 75 to 143 s plus `payment-drafted`, so the floor is
  about **6 minutes**.
- Restoring it from a kept snapshot (option 5): about 0.5 to 1 min, so the floor is about **4 to 4.5 minutes**.
- Below that, the journey itself must shrink: its snapshot round trip could become a journey of its own in another
  lane (the journey author's call), taking the floor to about 3.5 minutes.
- On one machine (option 12), the floor is the work itself, about 1 to 2 minutes (section 2), plus starting the
  bench: projected **2 to 4 minutes**.

## 6. Recommended paths

### To under 10 minutes, inside today's decisions

1. **Instrument first** (stage 3b, step 4.7), as agreed: every part below is then measured by its spans.
2. **Run where the data is** (option 1): pin Core next to Neon and the hub, then one measured run. Cheapest and
   biggest per unit of work, and it narrows the spread between runs.
3. **Observation from the tap** (option 2), by the scenario author, in parallel with step 2.
4. **The plumbing** (option 6) and **verdict before teardown** (option 7).
5. **Lanes** (option 3), starting at K = 2 as agreed and rising to 4, with **each lane building its starting world in
   place** (option 4). Lanes for K = 4, balanced on today's times: pay Brightside alone; found Northwind with two
   operators; an operator's inventory with invite olga; seat sam with give sam a budget.

Projected: the pay lane is setup 0.5 + world 0.4 + `founded` and `payment-drafted` about 2.2 + the journey about 3.5,
so **about 6.5 to 8 minutes**, with the other lanes about the same.

### To under 5 minutes

Everything above, and then:

6. **K = 7**, a world per journey, with the hub's capacity raised or a hub per run.
7. **Starting worlds kept across runs by fingerprint** (option 5), each lane restoring its own. This needs Aaron to
   reverse his "no to keeping founded".
8. Optionally, the journey author splits pay Brightside's snapshot round trip into its own journey.

Projected: setup 0.5 + restore about 0.6 + the longest journey about 3 to 3.5 + checks, so **about 4.5 to 5 minutes**,
3.5 with step 8. This is at the floor; one slow call to the bench or the hub moves it over 5.

### The radical alternative: under 5 on one machine

1. Instrument first, as above.
2. Build option 12: the world's parts as local processes on the CI runner, the bench from its image.
3. Lanes as local processes (option 3), each lane its own database, chain and Core: cheap, as nothing leaves the
   machine.
4. Keep a cloud run on Cloudflare, Neon and the hub: daily on `master`, and at a slice's merge either the full run or
   a short one, as D7 says.

Projected: **2 to 4 minutes** for the slice gate, without reopening "no to keeping founded", since making `founded`
locally is fast. It is the most build work of the three paths.

## 7. One world, every journey at once, each with its own company

Aaron's idea (15 November 2026, about 17:35 UTC): "if it's one chain, why does it have to be the same company on the
same journeys? Why can't they just be different companies? ... They could all be in the same block, no?" One world;
every journey at once; each journey with its own company, its own people and its own keys. Isolation comes from the
data, not from a world per lane or a reset between journeys.

### What stops it today, one by one

Read from the scenarios and the world on `master` (`packages/scenarios/src`, `packages/world/src`).

| What | Real limit, or how the scenarios are written? | What it would take |
|---|---|---|
| **The record is one list per world.** Every refusal and read is checked by "the record's head is what it was" (`support/world.ts`, `unchangedRecord`), and a success by "the record gained exactly this one entry" (`support/people.ts`, `recordedOnly`). Another journey writing at the same moment fails both | How they are written. Every entry already carries the `trace` of the call that emitted it (`record/operations.ts`, `Entry`) | Judge by the call's own trace: "no entry carries this call's trace", "exactly one entry carries it". Stronger than today, as it names the cause. A background step (the index writing an event a chain log caused) must carry or link the trace of the call that caused it, or a wrong side effect could be missed |
| **The chain check is the whole chain.** "The refused creation leaves the chain as it was" compares the chain's block number (`chainUntouched`). Any other journey's transaction moves it | How it is written | "No transaction from this journey's accounts, and no log naming its company, since before the call" |
| **People are named once per world.** The cast (dana, sam, olga, pat, zed, ...) is made by `world.create`; every journey uses the same sam. Two journeys would share sam's Safe, its nonce and his invitations | Partly real: one Safe's nonce does take one user operation at a time | Each journey gets its own people (`sam` of journey 4 is not `sam` of journey 5): a cast per journey, or a step that enrols a journey's people. Then the nonces never meet |
| **The bundler and paymaster** | Not a limit: alto bundles operations from different senders, many to a block, as Aaron says. One paymaster serves them all | Nothing, once people are per journey |
| **The world's one clock** | Not a limit for today's journeys: the one warp (pay Brightside) is made on the world it restores from a snapshot, not on the run's world | A rule: no journey moves the shared world's clock; a journey that needs time to pass does it in a world of its own, as pay Brightside already does |
| **Resets in place and shared starting worlds** | Not needed: they exist only because journeys share one company | Each journey builds its own starting company in the shared world (founded, office-holder, payment-drafted as steps, about 1.5 to 2.5 min today) and never resets |
| **Journeys about the world itself**: the two quota journeys fill an owner's 5 worlds; the inventory lists them; pay Brightside saves and restores the world | Real: these act on worlds, not companies. A snapshot of the shared world would catch other journeys half done, and a save pauses its index for everyone | They keep worlds of their own, beside the shared one, each under its own owner (they already make their own; only their starting point moves). Pay Brightside's company part runs in the shared world; its snapshot round trip runs on a world of its own, or becomes a journey of its own |
| **The index's lag** | Not a limit: one Ponder follows every company's logs; more logs, the same blocks | Waits stay per journey ("my company's event is indexed") |
| **The bench's site pool and Frappe's load** | **Real.** Each company needs its own site. The pool holds 4 blank copies and refills one in 105 to 120 s; six companies founded at once empty it | A bigger pool (8 to 10 blank copies), and watching the bench's load and 5xx answers as the ratchet's measures |
| **Checks of whole lists** ("its top budget alone", the world's companies, invitations) | Mostly scoped already: budgets, members and directors are listed per company. Lists of a world's companies would see others | Scope each to the journey's own company or people |

So of the eight things on the list, two are real limits (the bench's pool and the journeys that act on whole worlds),
one is half real (shared people), and the rest are how the scenarios were written.

### A rule the scenarios can keep, and the runner can check

"Every step of a journey acts on its own company and its own people; a journey that acts on a world uses a world of
its own." The runner can check it on every call, as a generic check: the journey declares its company and its people;
a call that names another company or person fails, unless it is a declared refusal about something nobody owns ("a
company nobody founded"). At the end of the run, a second check reads the whole record once: every entry's trace
belongs to a call of the journey whose company it names. That is a check of isolation between companies, which a world
per journey can never make.

### Time, projected

The run becomes setup once, plus the slowest journey's own company, plus that journey: roughly the longest single
journey, as Aaron says, with its starting company built in front of it.

| | Today's speeds | After distance, observation and plumbing (options 1, 2, 6, 7) |
|---|---|---|
| CI and the shared world made | 1.3 min | 1 min |
| Pay Brightside's company built (founded, office-holder, payment-drafted) | 2.5 min | 1.5 to 2 min |
| Pay Brightside itself | 5 min | 3 to 3.5 min |
| **The run** | **about 8.5 to 9 min** | **about 5.5 to 6.5 min** |

Under 5 needs pay Brightside's snapshot round trip moved out of its critical path (about 2 min of it: two saves, a
restore and a warp), or the world on one machine (option 12). Every other journey finishes inside that time.

### What it costs in proof, and what it changes

- **Lost:** a refusal is judged by what its own call caused, not by "nothing in the world changed". With traces carried
  through background steps, nothing a single call does is missed; without them, a wrong side effect written by the
  index under another trace could be.
- **Lost:** resets in place are no longer exercised by the run; the world's own proof covers them. The same as lanes at
  K = 7.
- **Gained:** the run proves that companies in one Capxul are isolated from each other while they work at the same
  time, which is how production runs and what a world per journey never tests. Races that would hit real customers
  (two companies' operations in one block, the bundler and the index under load) show up in the run.
- **Changed:** "One runner, K worlds" (agreed 15 November 2026) becomes "one shared world for company journeys, and a
  world of its own for each journey about worlds". Journeys stop starting from a named starting world; each builds
  its own company in the shared world, so the starting worlds become starting companies. "Bench templates never
  change" and the world lifecycle rules stand: one world, made and destroyed by the run, nothing kept. "No to keeping
  founded" stands too: nothing is kept.
- **Who does it:** the scoped checks and a cast per journey are the scenario author's work, never the builder's; the
  runner's isolation check is a generic check, written by a different agent from the one who changes the runner.

### Recommendation

Take it, in place of lanes for the company journeys. It needs less infrastructure than lanes (one world, one Core
deploy, one database branch, one set of hub objects), it does not reopen "no to keeping founded", and it proves
something lanes cannot. Order:

1. Instrument first, as agreed.
2. Distance and plumbing (options 1, 6, 7), which speed up any shape.
3. The scenario author makes the checks trace-scoped and company-scoped, and gives each journey its own people and
   company; the journeys still pass one after another in today's runner, so nothing breaks while it lands.
4. The runner's isolation check, written by another agent.
5. The runner starts every journey at once, with the world-level journeys in worlds of their own; the bench's pool
   raised to match.

Lanes stay the fallback if a race between companies turns out to be hard to make reliable.

## 8. Decisions for Aaron

Each is set out as options with a recommendation. Nothing here is decided until it is written in section 9 with its
date.

**D1. The target.** (a) Under 10 minutes in the cloud, inside today's decisions: within reach without reopening
anything. (b) Under 5 in the cloud, which needs D4. (c) Under 5 on one machine, which needs D7. Recommended: (a) now,
since it is mostly placement and plumbing, with (c) built beside it as the way under 5.

**D2. How far lanes go.** (a) K rises to 7 while the four measures hold, the hub's capacity raised to match
(recommended). (b) Keep a ceiling, such as K = 4, which is enough for under 10 minutes.

**D3. Lanes build their starting world in place** instead of save, template and reset. (a) Yes; resets stay proven
where a lane runs two journeys and by the world's own proof (recommended). (b) No; every lane resets from saved
starting worlds made once in the run, which costs about 2 to 3 minutes more on the critical path.

**D4. Starting worlds kept across runs, named by the fingerprint of their code.** (a) Keep it declined, as on 15
November 2026 (recommended if D1 is under 10). (b) Reverse it, with "Bench templates never change" and lifecycle rule
1 amended to allow templates that outlive a run (needed if D1 is under 5).

**D5. Where the world runs.** (a) Pin Core's Worker next to Neon and the hub in Europe; the runner's own calls cross
the Atlantic once each (recommended first: smallest change, measurable in one run). (b) Move Neon and the hub to the
United States next to GitHub's runners. (c) Leave it and measure more. This is inside the world's own decisions, but
it also says where production will run, so it is put to Aaron.

**D6. Tiers and a world in a box for pull requests** (option 9). (a) Not now; journeys run only at a slice's merge,
as decided (recommended). (b) Add a fast tier on pull requests into slices.

**D7. The world on one machine** (option 12). (a) Yes: the slice gate runs the journeys on one machine, and the cloud
run moves to the daily run on `master` plus a short cloud run at each slice's merge. (b) Yes, but the full cloud run
stays at every slice's merge as well, so the one-machine run is for speed of feedback only. (c) Not now. My
recommendation: (b) first, so the one-machine run earns trust against the cloud run on the same commits, then (a) once
they have agreed for a week of merges.

**D8. One world, every journey at once, each with its own company** (section 7). (a) Yes, in place of lanes for
the company journeys; lanes only as the fallback (recommended). (b) Lanes first as agreed, then this. (c) Not now.

Not decisions for Aaron: observation from the tap (the scenario author's work, already agreed as change 6),
the plumbing, and verdict before teardown (the speed lane's lead).

## 9. Decided

- **D1, the target: under 5 minutes** (Aaron, 15 November 2026, in this thread): "from first principles, I want to
  get it under 5 minutes if possible ... If we need to reverse some decisions, so be it." The paths to under 5 are
  put to him again, in full, as the next decision; D2 to D8 wait on that choice.

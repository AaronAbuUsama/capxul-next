# The world run in under 10 minutes, and under 5: options from first principles

📐 Designer note, 15 November 2026. Analysis and options only: no code changed, no world, deploy or CI run made. Aaron
asked to think about the `world` run "from first principles, be radical", to find ways to take it from about half an
hour to under 10 minutes, and under 5 if possible. The agreed order stands: the pipeline is instrumented first (stage
3b, step 4.7), then the speed lane (stage 3d) builds what is chosen here, measured by those spans.

Every figure marked **measured** comes from a run record or a CI job's step times. Every figure marked **projected** is
an estimate from those records, to be settled by a measured run. The scripts that tabulated the records were throwaway
and are not committed; every number can be recomputed from `summary.json` (`oneWorld.timings`) and each journey file's
`calls[].timing`, `calls[].steps` and `steps[].ms`.

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

## 2. What a green run must prove

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

## 3. The options

Savings are for the whole run's wall clock unless marked "serial" (time removed from the work, before any
parallelism). Money: the cap is $10 a day across Cloudflare and Neon for everything. A world for 10 minutes costs
cents (a Neon branch's compute and a few container-minutes); these money figures are projections until the cost job
reads them.

| # | Option | Saves | Money | Build effort | What a green run would no longer prove | Changes an agreed decision? |
|---|---|---|---|---|---|---|
| 1 | **Run where the data is.** Pin Core's Worker next to Neon and the hub (a placement hint), or move all three to one region. | Projected 3 to 6 min serial today: most of the 213 s of `postgres` spans and the hub calls. Every call gets faster, so every lane does too | None | Small: the world's Core stack | Nothing. It is closer to how production should run | No. Placement is the world's (`packages/world`) |
| 2 | **Observation from the tap, not from Core.** The operation checks read the call's own spans, logs and events in one batch per step (part 3's design for layer 6), and one `world.show` per step at most, instead of `world.show` and `record.export` before and after every try | About 5 min serial (75% of calls) | None | Medium. The scenario author's code, never the builder's | Nothing, if the tap holds what the reads saw; the checks must be rewritten against it and fail first on empty handlers | No. It is change 6, made thorough |
| 3 | **Lanes all the way: K up to 7, a world per journey.** The agreed ratchet "One runner, K worlds", taken to its end (part 8's option C). Lanes are concurrent inside one job and one runner, so Actions minutes do not grow | Journeys 18.5 min become the longest lane: about 5 min today, 3 to 3.5 after options 1, 2 and 6 | Projected: K worlds for 10 min instead of 1 for 30. Cents a run | Medium: the runner; an owner per lane; the hub's capacity (24 places: a run at K = 7 is projected to peak near 17, so raise `fleet`'s or give each run its own hub) | Nothing about the product. Load on the bench and the hub rises, which the ratchet's four measures watch | Part 8 said option C is "not for now". K rising to 7 is inside "One runner, K worlds"; a ceiling, if any, is Aaron's |
| 4 | **Each lane builds its starting world in place.** A lane makes its world and builds its first journey's starting world directly in it: no save, no bench template, no reset before its first journey. Lanes needing no `founded` (found Northwind, both `quota-full` journeys) start at once | Removes most of prepare's saves and templates (about 1.8 min) and the first reset of each lane (about 0.6 min each) from the critical path | `founded` is made in several lanes at once: more bench claims at once (the pool holds 4 blank copies) | Small to medium: the runner | Resets in place are exercised only where a lane runs a second journey, or by the world's own proof. At K = 7 the run would not exercise `world.reset` at all | No. Building `founded` in every run stands, as Aaron decided. Says plainly that resets leave the run at K = 7 |
| 5 | **Starting worlds built once per code change, not per run.** Named by the fingerprint of the code that builds them; a run restores them into its lanes | Prepare 4.7 min becomes a restore per lane, about 0.5 to 1 min, all lanes at once | Kept snapshots and templates between runs: small, with the sweep removing old ones | Medium | No run would make `founded`; found Northwind still covers founding a company | **Yes.** Aaron declined it on 15 November 2026 ("no to keeping founded"). It also changes "Bench templates never change" and lifecycle rule 1. Only needed for under 5 minutes |
| 6 | **Plumbing on the critical path.** (a) Restore the site beside `world.lifecycle.create`, not after it (66 s restore: create 27.5 s, then site 29.6 s). (b) Explain and cut `world.clock.warp`'s 38 s POST. (c) Readiness probes 20 to 5 (`relapses: 0` in every run). (d) Skip Core's upload when its hash is unchanged (about 8 s of every world made). (e) The runner's 2 s polls, event-driven where the tap can say | 2 to 3 min serial; about 1 min on the longest lane | None | Small each | Nothing | No |
| 7 | **Verdict before teardown.** The job reports the check when the journeys and their checks are done; a second job, which always runs, destroys and sweeps | About 1.5 min of wall clock to green | None | Small: `world.yml` | Nothing: the destroy still always happens, and a failed destroy still fails a job and raises a task | No, lifecycle rule 1 holds. The lead's call |
| 8 | **Core deployed once per run, worlds as configuration.** One Core Worker per run serving every world of the run, instead of an Alchemy deploy per world (about 8 s per world, and the two quota journeys make about 10 worlds between them) | About 1 to 2 min serial | Slightly less | Medium: Core's routing, the world's stack | That each world's own deploy works, except in `world.create`'s own proof | Touches "a world is created and destroyed as one unit" if Core is no longer part of the unit. Not recommended now |
| 9 | **A world in a box for every pull request.** Postgres, anvil, alto and Ponder in containers on the GitHub runner, Core under workerd, sites on the bench. A fast tier on pull requests into a slice, the real `world` at the slice's merge | Gives builders a journey run in minutes, before the merge | Actions minutes on every pull request | Large | Cloudflare, Neon and the hub are not exercised; it is not rung 6 | **Yes.** Aaron decided journeys run only at a slice's merge (14 and 15 November 2026). It does not shorten `world` itself. Not recommended now |
| 10 | **Journeys at once in one world.** Journeys on different companies share a world | Like option 3, without extra worlds | Less than option 3 | Large: isolation between journeys, the quota journeys clash | Isolation: a green journey could depend on another's state | Changes "a journey starts from its starting world". Not recommended: worlds are cheap, isolation is not |
| 11 | **Fake Frappe, or the chain in-process.** | Little: the site work on the critical path is `founded`'s 75 to 143 s and the site save and restore, and the hub's chain answers fast | — | Large | Frappe or the hub, the parts most likely to break | Yes. Not recommended |

What I would not do: options 9, 10 and 11 buy speed with proof, and option 8 buys a minute or two with a change to
what a world is. Option 5 is the only way under 5 minutes I can find, and it reopens a decision Aaron has made.

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

## 4. Recommended paths

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

## 5. Decisions for Aaron

Each is set out as options with a recommendation. Nothing here is decided until it is written in section 6 with its
date.

**D1. The target.** (a) Under 10 minutes, inside today's decisions (recommended: it is within reach without
reopening anything). (b) Under 5, which needs D4.

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

Not decisions for Aaron: observation from the tap (the scenario author's work, already agreed as change 6),
the plumbing, and verdict before teardown (the speed lane's lead).

## 6. Decided

None yet.

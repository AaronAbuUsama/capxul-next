# Why a world run takes 36 to 50 minutes, and how to make it shorter

Speed thread, 15 November 2026. This is analysis only, from records: no code changed and no world run. Aaron asked
why a CI world run takes 36 to 50 minutes and how to shorten it. Under "Measure first", every figure below comes from
a run record or a CI job's step times. A figure that is a projection says so.

## Sources

| Source | What it is |
|---|---|
| CI run 43686012226 (B1), artifact `run-930dc1` | `thin-line` on `slice/b1-director`, 7 journeys, job 36.2 min. This is the **quiet** baseline: no other CI world run overlapped it. |
| CI run 43696551161 (blank sites), artifact `run-2d296e` | `thin-line` on `slice/blank-sites`, the same 7 journeys, job 50.3 min. This is the **slow** run. Runs 112 and 113 started during its 30th minute. |
| CI run 43633183153 (capacity) | Job 28.9 min, 3 journeys. Used only for the CI steps. |
| `packages/runner/records/run-7c74ef`, `run-06e2b3` | Local runs from agents' containers, 5 journeys, 31.5 and 33.1 min. |
| `packages/platform/records/blank-sites` | The proof of #257's door on a stand-in bench, where every bench command takes a tenth of its real time. |

The scripts that tabulate these sources were throwaway work and are not committed. Every number can be recomputed
from `oneWorld.timings` in `summary.json`, and from each journey file's `calls[].timing` and `calls[].steps`.

## 1. Where every minute of a CI world run goes

### The job, wall clock (B1, 36.2 min, and blank sites, 50.3 min)

| CI step | B1 | blank sites |
|---|---|---|
| Set up, checkout, secrets | 3 s | 6 s |
| `platform-setup` (pnpm install with the pnpm cache, Bun) | 22 s | 24 s |
| Bench check, choose the hub | 4 s | 5 s |
| **`run.sh scenarios`** | **35.5 min** | **48.5 min** |
| Upload, destroy leftovers | 4 s | 5 s |
| Sweep | 6 s | 69 s |
| **Everything outside the runner** | **0.7 min** | **1.8 min** |

**Correction to the premise.** CI does not add 6 to 20 minutes. Install and setup take about 25 s. Core's deploy is
not a CI step: it is part of `world create` inside the runner, about 10 s each time. Two things explain the gap
between the 31 to 33 min local runs and the 36 to 50 min CI runs:

- CI ran 7 journeys and the local runs ran 5. `seat sam on Northwind's Board` and `give sam a budget at Northwind`
  were added after the local runs.
- In the 50-minute run, every call to Core was about twice as slow. Section 3 has the details.

### Inside the runner (B1, 35.4 min of timed parts)

| Part | min | share |
|---|---|---|
| Journeys' steps | 20.0 | 56% |
| `make founded` (almost all of it waiting for Northwind's site) | 6.0 | 17% |
| Resets in place, 7 of them | 3.1 | 9% |
| Gaps between parts (mostly the readiness probes, about 10 s before each journey) | 2.1 | 6% |
| Starting world `quota-full`, made twice | 1.2 | 3% |
| Destroying the journeys' own worlds | 0.8 | 2% |
| Saves of `fresh`, `founded` and `payment-drafted`, plus 2 bench templates | 1.4 | 4% |
| Making `office-holder` and `payment-drafted`, the world's create and destroy, checks | 0.9 | 3% |

### Inside the journeys (B1, 1197 s)

- **Calls: 810 s.** `world.show` 349 calls, 276 s. `record.export` 374 calls, 134 s. `world.snapshot.save` 10 calls,
  108 s. `world.snapshot.restore` 7 calls, 71 s. `approval.sign` 20 calls, 45 s. Everything else is small.
- **Between calls: 387 s.** Of this, 221 s is found Northwind's step 4 sleeping between polls, 2 s apart, while the
  site is built. The rest is mostly the waits of the payment and budget steps.
- **Most calls are observation, not the operation under test.** Every try of every step reads `world.show` and
  `record.export` before and after the operation, through the scenarios' operation checks
  (`packages/scenarios/src/checks/*`). Together these come to 723 of the 1,000 or so calls.

### Company sites: about 30% of the job

Northwind's site is built from nothing twice in every run:

- once in `make founded`: 300 to 368 s in every run;
- once in found Northwind's step 4: 322 s in B1 and 304 s in blank sites, 79 to 85 polls of `world.show`.

Together that is **10.4 min of the B1 job's 36.2**.

## 2. The causes, ranked by minutes, each with its change

The savings below are for a quiet run (B1 = 36 min of job) unless a row says otherwise. Each row's "after" assumes the
rows above it are done.

| # | Cause (minutes now) | Change | Saves | After | Risk | Cost | Roadmap decision? |
|---|---|---|---|---|---|---|---|
| 1 | Sites built from nothing, twice (10.4) | **Deploy #257's door to staging.** That needs Aaron to re-run the bootstrap so platform.yml's AWS login works again. | 8 to 9 min | **27 to 28** | Low. The pool holds 4 blank copies, and a run needs at most one at a time, so two runs at once still find it warm. | No code. Blocked on Aaron. | No |
| 2 | Core's calls 2× slower in some runs (+13 min in the 50-min run; see section 3) | **First record, then pin.** Record in every call's record which Cloudflare data centre ran Core, and Core's own time inside its Postgres queries. If the data confirms the cause, give Core's Worker a placement hint next to Neon (aws-eu-west-2) and the hub (WEUR). | 0 to 3 min on a quiet run, up to 13 on a slow one: the spread between runs closes | ~25 to 26 | Medium. This is a hypothesis until the colo is recorded. Pinning adds the runner's round trip to Europe to each call, about 80 to 100 ms, but saves 6 or more round trips from Core to Neon or the hub inside each call. | Small (world, Core) | No |
| 3 | `world.show` costs 0.7 to 1.35 s a call (4.6 to 7.7 min a run) | **Keep each world's handle in Core.** Today every call opens a fresh Neon connection (`world.neon.connection`, 300 to 420 ms), reads the engine secret twice (`world.engine.secret`, 2 × 100 to 390 ms) and opens the hub (`world.hub.open`, 80 to 290 ms). Cache the secret and the hub handle per world, and reach the database through a pooled connection. The same handle is opened at the start of every operation, so every call gains. | 3 min (projected: ~270 calls after #1, each about 0.7 s faster) | ~22 to 23 | Low to medium. A cached secret has to be invalidated when a world is restored or renewed. | Medium (world, Core) | No |
| 4 | Snapshots and new worlds (save 108 s, restore 71 s, 5 creates; more under load) | (a) Start the site's restore beside `world.lifecycle.create`, not after it: the two are independent and run 17 s and 30 s, one after the other. (b) Give the unnamed 4.7 s POST in every save a span (it is probably the chain's state going to R2), then see whether it can overlap `platform.branch`. (c) Shorten the 3 s poll of the site's door job to 1 s. (d) In `world.deploy` (about 10 s in every create and restore), skip the upload when Core's script hash is unchanged. | ~2 min | ~21 | Low. (b) also closes an explainability gap (4.2): about half of each save is in no declared span. | Small each (world) | No |
| 5 | Resets and readiness (3.1 + 2.1 min) | (a) Remove the template world's site (`removed northwind-tpl-…`, about 16 s) at teardown, not inside the first resets. (b) Cut the readiness probes from 20 in a row to 5: every journey in every run on `master` shows `relapses: 0`. (c) Fill the per-run template's pool right after its bench template is made, so the first claim does not find it cold. Today the `sites` part takes 26 to 31 s against the 1.1 s claim proven in step 1.17. | ~1.5 min | ~19.5 | Low. Readiness is runner plumbing, which the builder may change, and it shows in the diff. | Small (runner, world) | No |
| 6 | Observation calls in the operation checks (record.export 134 s, plus about 190 s of `world.show` around tries) | Share one before-read per try and one after-read per step where the checks allow it. This is the scenarios' code, so a **different agent from the builder** changes it, as for any check. | 1 to 2 min | ~18 | Medium: it touches what judges the work. | Small, but in the scenarios | No, but it is the scenario author's work, never the builder's |
| 7 | Journeys run one after another (about 19 min left after #1 to #6) | **The parallel ratchet.** Split the journeys across K worlds, each a lane with its own operator pair, and start at K = 2. Each lane makes its world and restores the run's saved starting worlds into it (about 1 min, all lanes at once). Raise K while these measures hold: the hub's admission waits, the door's 5xx answers, the green rate, and the daily spend. With K = 3, balanced lanes are pay + olga, found + two operators, and inventory + seat + budget. | 8 to 9 min (projected: longest lane about 6 to 7 min) | **~10 to 11** | Medium. (1) The owner's quota is 5 worlds, and both `quota-full` journeys fill it, so each lane needs its own `WORLD_OWNER`. (2) The hub: one run peaks at 6 worlds, so K = 3 means about 18 of the 24 places, and two such runs at once would wait in admission for up to 15 min. Raise `fleet`'s capacity, or give each run its own hub. (3) Spend: 3 worlds for 15 min is cents, far inside the $10 a day. | Medium (runner) | **Yes.** It changes "One runner, one world" (14 November). |
| 8 | `make founded` is redone in every run (about 1.5 to 2 min after #1, plus saves) | Keep `founded` as a template kept across runs, named only by the fingerprint of the code that builds it. A run would restore it (about 45 s with its site), not make it. | ~1 to 1.5 min (after #1) | — | Medium. No run would make `founded` any more; found Northwind still covers the founding path. A template outlives the run that made it. | Medium | **Yes.** It changes "Bench templates never change", whose names include the world that made the template, and the world lifecycle rules. **Not recommended now**: after #1 it is worth about a minute. |
| 9 | `quota-full` is made twice (about 2.3 min with destroys) | Absorbed by #7: the two journeys that need it go in different lanes. Alone, making it cheaper means changing what the quota counts. | 0 alone; covered by #7 | — | — | — | Only if the starting world itself changes (the blueprint; the lead's call) |
| 10 | CI around the runner (0.7 to 1.8 min) | Move the sweep into its own scheduled job; the scheduled run on `master` can do it. Install is already cached at 22 s, and Core's deploy is not a CI step. | 0.1 to 1 min | — | Low | Tiny | No |

### Expected job time, in order

| After | Quiet run | Slow run like blank sites' |
|---|---|---|
| Now | 36 | 50 |
| #1 blank sites deployed | 27 to 28 | ~40 |
| #2 Core next to its data (if confirmed) | 25 to 26 | 25 to 27 |
| #3 world handle kept | 22 to 23 | |
| #4 snapshots and creates | ~21 | |
| #5 resets and readiness | ~19.5 | |
| #6 fewer observation reads | ~18 | |
| #7 three lanes | **10 to 11** | |

## 3. The variance: why one run took 50 minutes and another 36

Both CI runs ran the same 7 journeys. The blank-sites run was slower **from its first journey**: two operators,
started at 09:02, was 1.4× slower. Runs 112 and 113 only started at 09:22. Every operation's median server time
doubled:

| Median server ms | B1 | blank sites | local 7c74ef |
|---|---|---|---|
| `world.show` | 714 | 1345 | 1115 |
| `record.export` (just `postgres`) | 250 | 514 | 249 |
| `approval.sign` | 756 | 1487 | |
| refused `world.show` (one registry query) | 27 | 93 | 66 |
| caller minus server (runner ↔ Core) | 84 | 132 | 114 |

The bench is not on the path of `record.export` or of a refused `world.show`, so the bench's load is not the cause.
Neon's queries, the hub's calls (`world.hub.open` 79 → 292 ms) and the bundler all slowed together. What they share
is Core's Worker. Core's Worker has no placement hint, so Cloudflare runs it near its caller, the GitHub runner,
while Neon is in aws-eu-west-2 and the hub's containers are in WEUR. Each `world.show` makes about 6 such round trips
one after another.

This is **consistent with Core running farther from its data in that run**, but the records cannot prove it, because
no record holds the colo. Load on the shared Neon project's platform branch is the other candidate. Change #2's first
half, recording the colo and Core's own query times, settles which one it is. It costs almost nothing, and is
"Measure first" applied to the variance.

**Two runs on the bench at once.** In the runs read here, I found no measured minutes from the bench's load:

- the site's build took 304 s in the run that overlapped another and 322 s in the one that did not;
- the only cost on record is failures: `run-686965` got 502s while two CI runs shared the bench.

The load that matters once lanes exist (#7) is the hub's: 24 places, and 6 per run at its peak. Two CI runs are in
flight as I write (112 and 113, 40 min and more); their artifacts will be the first records of two runs at once.

## 4. What needs a roadmap decision

- **#7, lanes of worlds:** it changes "One runner, one world" (14 November 2026). It is the biggest single cut once
  #1 is in.
- **#8, `founded` kept across runs:** it changes "Bench templates never change" and the world lifecycle. I do not
  recommend it now.
- Everything else is plumbing in `packages/world`, Core or the runner, inside the decisions. #6 is the scenario
  author's work, not the builder's.

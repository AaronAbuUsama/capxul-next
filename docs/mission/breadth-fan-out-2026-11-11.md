# How to fan breadth out to parallel agents

11 November 2026. A proposal for Aaron: nothing here is applied. It changes no blueprint record, milestone or plan entry.

**The question.** Once the thin line passes 12 of 12 on the AWS machine, how do we split the rest of the product across
many agents working in parallel, so that the split comes from the blueprint instead of fighting it?

**The answer in one line.** The lead agent picks journeys in waves. The machine cuts each journey into slices, one slice per
concept. One agent builds one slice. Only one agent at a time works inside a concept. A slice is done when its evals pass,
and a journey is done when its end-to-end eval passes. Six fixes have to land first (section 5).

Every number below was measured from the blueprint on branch `claude/project-thread-mwv0z6` (commit `7600543`) with the
engine's own `underOf` rule, the rule the portal uses to place an operation. The measuring script and its output are in the project files (`research/breadth-measure.ts`), runnable with `node --experimental-strip-types`.

## 1. What the blueprint gives us to cut with

| | Count |
|---|---|
| Records (design, not counting decisions) | 1,642 (plus 1,026 decisions) |
| Evals | 5,175 |
| Operations | 232 (155 in a journey; 77 in none) |
| Journeys | 23: the thin line and 22 more |
| Concepts (the areas the code is laid out by) | 22 |
| Evals passing today | 16 |

- **The thin line** reaches 282 records and 652 evals.
- **All 23 journeys together** reach 939 records and 3,522 evals. So breadth beyond the thin line is **657 records and
  2,870 evals**.
- **1,653 evals (32%) sit outside every journey.** No journey-based plan reaches them. They are the 77 operations that are in
  no journey, plus 500 evals on records that no operation reaches at all: 192 durable processes, 85 state transitions, 66
  server calls, 58 SDK flows, 37 tables, and the 19 invariants, 10 environment checks and 23 architecture checks.

**Overlap between journeys.** The 22 journeys add up to 2,225 records, but only 938 are distinct. Most records (595) belong to
one journey, and 122 records are in five or more. Of the 231 pairs of journeys:
- 84 pairs (36%) write to the same table or state machine;
- 118 pairs (51%) touch the same concept, which means the same code folder under `system.layout`.

The hot spots are the tables `organizations`, `approvals` and the four `book-*` tables, each written by 9 of the 22
journeys, and `payments`, written by 8. Most of these the thin line has already built. **After the thin line, only 17
breadth records are shared by three or more journeys.** This is why fan-out works after the thin line and not before.

## 2. The rubric

The repository has no rubric for splitting work, so I graded against `docs/philosophy.md`. Each criterion below is one of its
lines:

1. **No collisions.** "Prefer tasks that do not touch the same files, so that lanes do not collide."
2. **Done is proven.** "A task is done when its checks pass in a run, not when an agent says so."
3. **The blueprint first.** "The design is changed and rebuilt to zero problems before the code changes." A good unit is a
   record the blueprint already has, and when its design turns out wrong, the fix is a small record change.
4. **Movement.** "At every moment, every free agent slot works on something useful." This means many units, each small
   enough to finish.
5. **Aaron's attention, and the lead agent's.** "Spend as little of Aaron's attention as possible." The lead decides what to
   build next, not how, so a good unit needs little judgment to hand out.
6. **The climb is visible.** Each finished unit moves a score that means something, ideally "a person can now do X".

Scores run from 1 (poor) to 5 (strong).

## 3. The options

### A. One agent per journey

The unit is a journey, for example `pay_someone` or `close_the_books`. Done means its end-to-end eval (`jrn:`), its funnel eval
(`fun:`) and the evals of its steps all pass.

- **For it.** This is what a user would recognise, and the blueprint already has the records. Done comes with a real
  end-to-end proof.
- **Against it.** The sizes are very uneven. `run_company` adds 219 new records and 874 evals, while `pay_invoice_from_frappe`
  adds 2 records and 12 evals. Half the pairs of journeys share a concept folder, and `refer_someone` has no steps at all. It
  also never reaches the 1,653 evals outside the journeys.

### B. One agent per concept (area)

The unit is a concept, for example `payments` or `banking`. Done means the concept's evals pass.

- **For it.** The code layout already mirrors concepts (`src/<concept>/`), and concepts talk to each other only through
  `door.ts`. So two agents almost never touch the same file.
- **Against it.** 36% of the blueprint's links (1,083 of 3,030) cross a concept boundary, so a concept cannot pass on its own.
  The sizes are uneven too: the breadth work in `devnet` carries 469 evals, while `parties` carries 3. And no journey works
  until several concepts are finished, so the score moves without anyone being able to do anything new.

### C. One agent per operation

The unit is one CLI operation, for example `payment.send`. Done means the operation's L1 evals pass.

- **For it.** This is the finest unit the blueprint scores. The portal's stand (`standOf`: specify, decide, build, observe,
  done) is already worked out per operation. A typical operation reaches 16 records and 44 evals, 12 of them its own.
- **Against it.** There would be about 220 units to order. 129 of the 232 operations write a table that another operation
  also writes, so agents collide on the same tables, flows and files. Building a journey's steps one by one tends to build
  the shared parts twice or inconsistently, and nothing a user can do is proven until a whole journey is.

### D. One agent per layer or record kind

The unit is a layer: all tables, then all server calls, then all flows, then all operations.

- **For it.** It is good for sweeps that cover one kind across the whole system: spans, budgets and docs.
- **Against it.** For building product it is the worst option. Every agent works in every concept, and evals at the top
  layer cannot run until every layer below is built.

### E. Hybrid: journeys picked in waves, cut into concept slices (recommended)

1. **The lead picks** the next wave of journeys. That is the "what", and it is its only job here.
2. **The machine cuts** each journey into slices: the records that journey adds, grouped by concept. A record that two
   journeys both need goes to the first slice that reaches it, so slices never overlap. Today's blueprint gives **62
   slices** covering 2,826 evals. A typical slice carries 24 evals. Five carry more than 150: `run_company` in budgets and
   payments, `govern_company` in board, `delegate_to_agent` in agents, and `get_paid` in requests. These five are split
   further, by operation.
3. **One agent builds one slice.** While it works, it holds a lease on the concept, so no second agent writes the same
   folder or the same blueprint file.
4. **A slice is done** when its evals pass in a run. **A journey is done** when every slice is done and its `jrn:` and `fun:`
   evals pass.
5. **Two side tracks run alongside the waves:**
   - **Cross-cutting sweeps.** Each kind of eval that spans the whole system (spans, budgets, docs, invariants, the
     architecture checks) gets its own lane with one owner.
   - **The 77 operations in no journey.** Each either gets a journey or is booked as a single slice.

**How waves come out of the blueprint.** If you group the journeys so that no two in a group share a breadth record, you get
six waves of 9, 4, 4, 3, 1 and 1 journeys. Wave one:

> `run_company`, `organiser_runs_a_cohort`, `close_the_books`, `stays_true_when_broken`, `grant_hat_in_frappe`,
> `create_company_site`, `pay_invoice_from_frappe`, `run_a_world`

That is 8, plus `refer_someone`, which is empty. Grouping by concept instead, as a lease would, is stricter: it gives 12
waves. Slicing is what turns those 12 back into wide parallel work, because two slices of different journeys in different
concepts can run together even when their journeys overlap.

### Grades

| | No collisions | Done is proven | Blueprint first | Movement | Attention | Climb visible | **Total /30** |
|---|---|---|---|---|---|---|---|
| A. Per journey | 2 | 5 | 5 | 3 | 4 | 5 | **24** |
| B. Per concept | 5 | 2 | 4 | 2 | 3 | 2 | **18** |
| C. Per operation | 2 | 5 | 5 | 4 | 2 | 3 | **21** |
| D. Per layer | 1 | 2 | 3 | 3 | 3 | 1 | **13** |
| **E. Hybrid** | **4** | **4** | **5** | **5** | **4** | **5** | **27** |

E loses one point on collisions because shared files still exist (section 5). It loses one point on done because a slice's
evals can pass while its journey's end-to-end eval does not yet: the slice is done, and the journey is not.

## 4. What is easy to forget: the records that cut across everything

| What | In the blueprint | What it means for a fan-out |
|---|---|---|
| **Events** (state-machine events) | 50 records, 210 `evt:` evals ("it sends X, valid against its schema, carrying trace_id"), 23 `fun:` funnel evals | Each event is declared in its concept's `data.ts`, so it belongs to that concept's slice. But the reach rule never follows a transition to the event it sends, so **0 of 50 events and 0 of 56 contract events appear in any journey's slice**. Fix the rule (section 5, item 4), or event schemas will have no owner. |
| **Telemetry: spans** | 232 `spn:` (one trace from CLI through SDK to server), 250 server-call span evals, 128 flow span evals: 610 in all | None can pass without a trace collector in the test world. Build it **once, before the fan-out**, ideally on the thin line. Otherwise every agent invents its own. |
| **Telemetry: budgets** | 700 speed evals (p95 and p50 per operation, server call, flow and process) | They need one shared harness ("N warm runs") that does not exist yet. That is a cross-cutting lane. |
| **Product analytics, logs, alerts, dashboards** | **No record kind.** Journeys cite the old PostHog catalogue in their `was` field, but nothing in the target describes analytics events, log lines, alerts or dashboards. | The old system had all of these, with scouts watching them. If the rebuild needs them, they need a record kind first. That is a blueprint change, and a decision for you. |
| **Errors** | 51, all in one file (`blueprint/shared/vocabulary.ts`), with 836 refusal evals | Every slice that adds a refusal edits the same file. Split the file by concept, or give it one owner. |
| **Contracts** | 19 contracts, 161 functions; 17 of the contracts are in some journey | `pnpm contracts:check-blueprint` already guards them. A contract change touches many slices, so it gets a lease of its own. |
| **Durable processes** | 90 processes, 325 evals (a second run changes nothing; killed mid-run, it resumes) | 192 of these evals are on processes that no operation reaches: schedules and reactions. They need their own track, and a "kill it mid-run" harness. |
| **Invariants, environments, architecture checks** | 19 invariants, 10 environment checks, 23 import and size checks (L3) | No journey reaches them. They are one sweep lane, best checked in CI. |
| **Docs and design review** | 232 `doc:` (help, reference page and record agree) and 232 `des:` evals, the only evals an agent decides | The `doc:` evals need the reference pages generated. The `des:` evals are a judgment, so they need a reviewer that is not the builder. |
| **The web app's screens** | Deliberately not in the schema yet (React hook records were left out). The journey `tester_plays_through_screens` exists. | A fan-out by the blueprint would not build the screens. Either add screen records or keep the web app outside the fan-out on purpose. That is your call. |
| **"Done" in the portal** | The stand says done only when an operation's `live:` evals hold, but **the engine derives no `live:` evals** | No operation can reach done, and "observe" is the ceiling. Either define what live means or drop the step. |
| **Decisions** | 406 decisions affect breadth records | A decision still waiting turns a slice to "decide". The portal already shows this. Answering in batches per wave keeps your attention cost low. |

## 5. What must be fixed before the fan-out

These are in order of how badly they would hurt with many agents.

1. **Eval ids move when a claim is added.** 810 of the 5,175 ids end in a position, 727 of them acceptance claims
   (`acc:payment.send/3`). An agent that inserts a claim renumbers the rest, and the bindings quietly point at the wrong
   claim. Give each claim a stable key.
2. **A pass survives rewording.** A verdict is stored by id, so if a claim's words change, its old pass still counts. Store
   the claim's hash with the verdict and mark it stale when the hash changes.
3. **The test harness is four shared files.** Every check today lives in one 510-line script (`spikes/skeleton/run.sh`) and
   three binding files, and every run rewrites `status/status.json`. With twenty agents, all twenty edit the same four
   files. The fix: one check file and one binding file per slice or concept, and status merged per run instead of
   overwritten.
4. **Slices are not computed yet.** Add a small engine function: given a journey, return its breadth records by concept,
   with their evals and any waiting decisions. Use `underOf`, extended to follow transitions to their events and contract
   functions to their contract events. Show the slices on the portal's board with their lease holder, which is the board
   target (3) you already set.
5. **No CI.** Today nothing runs the checks unless an agent does. With many merges into `integration/build`, the six
   repository checks and the bound evals have to run on every pull request.
6. **Load errors don't name the record.** With many agents editing records, a failure that names no record costs an agent a
   lot of time to locate.

Then three things outside the engine:
- **One test world per agent.** `world create` and snapshot/restore already exist. Each agent starts from a snapshot of the
  green thin-line world, in its own cloud container. That costs a full Frappe, chain and Core stack per agent, so the number
  of agents is set by container size and rate limits, not by the blueprint.
- **Plan state from evals.** `plan/` is written only from your Mac. For cloud agents, a slice's state should come from its
  evals and runs, as the restart design already proposes, so that no agent writes the plan.
- **Waves ready before the thin line is green.** The waves above are measured from today's blueprint. They should be
  recomputed by the slicer from the blueprint as it stands then.

## 6. What carries over to the infrastructure repository

The infrastructure thread is moving the engine there. Everything in this proposal is built from records the engine already
knows (journey, concept, operation, `underOf`), so the method carries over unchanged:
- the slicer;
- the concept lease;
- the waves;
- the rubric.

**Fixes made there.** The infrastructure thread reports fixes already made there for load errors, stale verdicts and the
decision check. Whether its stale-verdict fix covers rewording, and whether eval ids are stable there, needs checking against
its branch, which is not pushed yet.

**The risk is two engines drifting apart.** Fix items 1 to 6 once, in the shared engine, and make capxul-next use that
package, rather than fixing them in two copies.

## 7. Recommendation

Choose **E**. In order:
1. Land fixes 1 to 3 and 5 while the thin line finishes. They are engine and harness work and need nothing from you.
2. Build the slicer and the board view (item 4).
3. Get the thin line to 12 of 12 on the machine.
4. Start wave one, with one cloud agent per slice and one lease per concept, plus one lane for spans and budgets.

Three things are yours to decide, and none blocks the fixes:
- whether product analytics, logs, alerts and dashboards become records;
- whether the web app's screens are in the fan-out;
- what the portal's "done" means for an operation.

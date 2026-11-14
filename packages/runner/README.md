# runner

The scenario runner (roadmap steps 1.2 and 1.14). It runs against a world through Core's door, applies the same
generic checks to every call it makes, and writes one JSON run record per run. It knows no operation and no journey
by name: it reads the blueprint (`@capxul/blueprint`), deploys Core (`@capxul/core`) and runs the journeys that
`@capxul/scenarios` registers (a scenario is a journey since 14 November 2026: docs/roadmap.md). Each journey's
operations judge their own calls with their checks; the runner records every step and adds its generic checks.
Built from `spikes/pipeline/runner`.

## Run it

```bash
./run.sh door                 # every blueprint operation called once through a fresh Core stage
./run.sh door --world=<name>  # the same, through the Core of a world `world create` made (packages/world)
./run.sh chain --world=<name> # the chain operations' journey (src/chain-journey.ts) through a world's Core
./run.sh scenarios [name...]  # the registered journeys (or those named), in one world on the run's hub, reset before each (below)
./run.sh starting-worlds      # make every starting world the runner can make, timed, then destroy them all
WORLD_BENCH=<platform stage> ./run.sh scenarios --core=local [name...]   # a rehearsal: Core in workerd here (below)
WORLD_BENCH=local POOL_SECRETS=<file> ./run.sh scenarios --core=local    # the same beside packages/platform's bin/pool-bench.sh bench
./run.sh scenarios --expect=not-implemented              # each in a fresh stage of Core's empty handlers; must fail at step 1
./run.sh scenarios --one-stage --expect=not-implemented  # the same, all in one fresh stage
```

`door` exits 1 if its run failed; `scenarios` exits 1 if a journey did not end as the run expected or a stage was
left behind. `run.sh` runs `src/main.ts` under Bun and sets the two key variables to a
placeholder: the session's network proxy adds the real Cloudflare and Neon keys, which never reach this machine. It
also makes a fresh pair of door tokens for the run (`CAPXUL_DOOR_TOKEN`, `CAPXUL_PLATFORM_TOKEN`), which Core reads at
deploy and the SDK sends; they are never printed or recorded.

## What one run does

1. **Creates a fresh stage** of the stack `CapxulCore` (`src/world/stage.ts`): deploys Core and its database, applies
   Core's migrations over Neon's HTTPS SQL endpoint, keeps the stage's first record entry, a `world_created` of a
   private world made from nothing (`src/world/born.ts`: a stage is not made by world.create, and record.export reads
   a world's grade and lineage from that entry), and waits until Core has answered 20 `Ping`s in a row
   (`src/world/warmup.ts`). Each step has a declared timeout. Until `packages/world` lands (step 1.3), a stage is the
   runner's world.
2. **Makes its calls through the SDK** (`src/client.ts`): `Sdk.layer(Capxul)` at the stage's two doors, with the
   run's door tokens, every call recorded with what was sent, what came back and the caller's time. Each call runs in
   a trace of its own, which the SDK sends in `traceparent`, so Core's server spans fall under it. The door plan
   calls every operation with its first blueprint example, as the world's owner; a scenario is handed that `Capxul`.
3. **Applies the generic checks** (`src/checks/`) to every call, reading what Core kept in `app.spans` and
   `app.events` under its trace id:

   | Check | Passes when |
   |---|---|
   | `span` | exactly one server span named after the operation exists under the call's trace id; none for a call its client rejected (`PayloadRejected`), which was never sent |
   | `outcome` | that span ended the way the caller saw the call end (success, refusal, defect) |
   | `events` | a successful call recorded exactly the events its outcome declares, each once, each carrying what the declaration computes from the call; any other call recorded none |

4. **Measures, and never fails on speed.** Every call's `timing` holds the caller's time, the server span's time and
   the operation's budget beside them, with `provisional`, `enforced: false` and `overBudget`. Its `steps` are the
   server spans beneath the operation's, each with its parent, start and duration. Nothing fails on speed until a
   budget is set from measured runs (AGENTS.md, "Measure first").
5. **Destroys the stage**, whatever happened: also when the run failed, a step timed out, the run was interrupted or
   the create failed half-way. Before and after the destroy it reads the Cloudflare and Neon accounts for anything
   named after the stage (`src/world/leftovers.ts`); the record keeps both lists.
6. **Writes the record** to `records/<stage>/<door or scenario>.json`, before the destroy and again after it.

A run's `outcome` is `passed` when its own expectations held (for the door, every operation answered with a success
or a declared refusal), every check passed on every call, the stage was destroyed and the accounts hold nothing of it.
Its `ended` says how the run's own program ended before any check: `succeeded`, `failed` with a typed failure's tag
(a refusal, a scenario's `ExpectationFailed`), or `died`.

## A run in a world

`door --world=<name>` runs the door plan through the Core in a world's Core slot (`src/in-world.ts`,
`src/world/existing.ts`): the world is opened from `packages/world`'s shared state, its Core is waited for as a stage's
is, the calls carry the world's door token and its owner's operator token (read from the world's state, never
printed), and the spans are read from the world's own database. The runner neither creates nor destroys the world, so
its record's `afterwards.stage` is `left to its owner`. A call made `at` another world's door (blueprint decisions 36)
has its telemetry read from the database of the world whose Core answers at that door, when the shared state holds it
(`OtherWorlds`); a stage run has no other worlds, so such a call still finds nothing to check against there.
`records/w-c1/door.json` is the first such run (`passed`), in a world made with `world create` and destroyed after.

## A run in one world (steps 1.6 and 1.18)

`./run.sh scenarios` expecting `pass` (the default) runs every journey in ONE private world of `packages/world`, kept
for the run and reset in place before each journey (`src/worlds/`; docs/roadmap.md, "One runner, one world"). This
process serves the platform group itself, on its loopback (`platform.ts`, blueprint decisions.md 51), signed in by the
run's two operators (`WORLD_OWNER`, `WORLD_SECOND_OWNER` and their tokens), and the journeys' client calls it there; a
world's own operations go to its Core.

1. **The hub** (`hub.ts`). The world lives on the fleet hub `WORLD_HUB` names; `run.sh` gives each run a fresh one
   (`rh-<6 hex>`) unless it is set. A hub that does not exist is brought up with the run's owner and
   `RUNNER_HUB_LIFETIME` (4 hours) and taken down at the end, whatever happened, once every world on it is gone; one
   that exists is used and left up.
2. **The one world and its starting worlds** (`starting.ts`, `makers.ts`, decisions 27 and 39). `fresh`'s maker
   creates the world (`world.create`, `tpl-<6 hex>`, 150 minutes): it is the kept template world. Every starting world
   made "from its template" that a journey starts from, and those it is made from, is made in it once, by its declared
   steps, in the blueprint's order; each one a journey starts from is saved as a snapshot of its own name
   (`world.snapshot.save`, with its sites' backup and a point on the bench), and one with a company also keeps its
   sites as the bench's template of that name (`POST /templates`, with a pool of ready copies).
3. **Before each journey** the world is reset in place to its starting world's snapshot (`World.reset`: index,
   database, chain, Core's clock, the chain mined at it, the sites, then everything waited for), the nearest
   template ancestor for a starting world made by its steps (`fresh` for `quota-full`, whose operator's other worlds
   are then made by its steps). The sites go back in place to the point; a snapshot with no company removes the
   world's sites (a site left there would refuse the company's founding as `site-exists`); a point that lost its
   sites (removed by an earlier reset) gets them by claim from the bench template, ready in about a second, and is
   saved again (packages/world, `src/site/Points.ts`).
4. **The journey** runs with its starting world's facts (decision 38): `world` is the one world's `world.create`
   answer, and `calls` every call made in making it, the saves included. Every world the journey made, and those its
   starting world made by its steps, is destroyed after it, the newest first, whatever happened; the accounts are
   read for anything of them before and after (`afterwards.*.worlds`).
5. **The end**: the bench templates dropped, the one world destroyed, the hub taken down, and the accounts read for
   every world the run made (`oneWorld.left`).

Every part is timed into the summary's `oneWorld.timings`, in order (`src/timings.ts`): `hub up`, `world create`,
`make <starting world>`, `save <…>`, `bench template <…>`, each `reset` with its own parts and how it put the sites
back, `starting world` (what is made by its steps), `journey` with each step's time, `checks`, `destroy the journey's
own worlds`, `drop bench template <…>`, `world destroy`, `hub down`. Each has when it began since the run began, how
long it took and whether it failed, with why.

A starting world with no maker here fails its journey naming the operations its steps call (`waitsOn`). The company
starting worlds (`founded` to `paid`) are made by their declared steps in `src/worlds/company.ts`, each approval
signed with the cast's keys (`CAST_KEYS`, through viem, blueprint decisions 34 and 42), each wait polling an
operation until it answers differently (decision 27). With Core on Cloudflare they need a bench Cloudflare can reach
(roadmap steps 1.4 and 2.1); until it exists they are rehearsed with `--core=local`.

The calls made in making a journey's starting world get the generic checks too (`making` in the run record). The
platform's own calls are checked against what it kept (`PlatformKept`: its spans, and the events each wrote into its
world's record). Records go to `records/<run>/<journey>.json`, the summary to `records/<run>/summary.json`.

`./run.sh starting-worlds` makes each starting world in turn the same way, in one world on the run's hub (reset to
each, then its steps), times each, checks every call, destroys each one's other worlds before the next and the one
world at the end, and writes `records/<run>/starting-worlds.json` with its `timings`.

## A rehearsal with Core run locally (`--core=local`)

`WORLD_BENCH=<stage> ./run.sh scenarios --core=local [name...]` (and `starting-worlds --core=local`) runs every
scenario as above, except that each world's Core runs in this process's machine instead of on Cloudflare, next to a
stand-in bench of `packages/platform` (`PLATFORM_HOST=standin`, `PLATFORM_EDGE=none`), which nothing on Cloudflare can
reach, or beside the local bench `packages/platform`'s `bin/pool-bench.sh` runs from the images already on the machine
(`WORLD_BENCH=local`, with `POOL_SECRETS` naming its secrets file: `run.sh` hands its door and key to `packages/world`,
`src/site/Bench.ts`, and never prints the key). Everything else of a world is unchanged: its database (a Neon branch), chain, index, bundler and door are on
Cloudflare and Neon, and the platform makes and destroys it as always. It is runner plumbing (`src/local/`), plugged
into `packages/world` through its `CoreHost` seam (`src/core/host.ts` there):

| Part | File | What |
|---|---|---|
| Core's bundle | `src/local/bundle.ts` | Alchemy's own rolldown build of `packages/core`'s Worker (`CORE_WORKER_MAIN`), wrapped in Alchemy's Worker bridge, with the compatibility date and flags a deploy gives it: the same bundle a deploy uploads. Built once per run into a temporary directory. |
| workerd | `src/local/workerd.ts` | One `workerd serve` per world (the version Alchemy's local runtime pins; `run.sh` finds it), on a free loopback port the world's door then names, with the bindings a deploy binds, by the same names. Its log is beside its configuration. |
| Database | `src/local/database.ts` | Core's `DATABASE` is a Hyperdrive binding whose origin is a loopback TCP port. This machine has no TCP route out, so each connection is carried byte for byte over a WebSocket of its own to the world's Neon endpoint (`wss://<host>/v2`, the serverless driver's way), through the session's proxy. A WebSocket closed before Neon answers the first message is opened again. |
| Chain | `src/local/forward.ts` | Core's `CHAIN` service binding goes to one loopback HTTP server, which carries each request to the door of the world whose token starts its path, through the proxy. |
| Host | `src/local/host.ts` | `World.CoreHost`: the address each world's Core will answer at (decided before its deploy, so its door names it), its start once the world's parts answer (the world's `core` step then waits for it), and its stop at its destroy. The run's end stops all. |

Every record such a run writes carries `core` (`LOCAL_CORE_LABEL`), and its `outcome` is `rehearsed` where it would
be `passed`: a step's Proof counts only `passed`, so a rehearsal can never be taken for the proof that the scenarios
pass with Core on Cloudflare (roadmap step 1.6). What it shows is everything else: the starting worlds, the sites, the
operations against real ERPNext, the snapshots with sites, and every generic check. What it cannot show is in
`records/` beside its runs.

## A journey's steps

A journey tells the runner each step's beginning and end and each try of its operation, with what the step expected,
what came back and every check of the operation that ran on it (`Steps` of `@capxul/scenarios`; `src/steps.ts`
hears it). A journey's run record (`kind: "journey"`) then holds, beside `calls`:

| Field | What it holds |
|---|---|
| `steps` | Every step of the journey's outline, in order: its operation and words, `passed`, `failed` or `not reached`, why it failed, its tries (expected, answered, each check's sentence, whether it held and what was seen), the calls it made as places in `calls` (its tries, its waits and every read it and its checks made, each with its caller and server time, its spans and its generic checks), and how long it took. A step whose call failed a generic check failed. |
| `failedStep` | The first step that failed, its operation and why; null when none did. |

## A run of the journeys and its summary

`./run.sh scenarios` also writes a summary (`src/summary.ts`, `src/scenario-runs.ts`): one JSON file whose `outcome`
is the run's, so a step's Proof can name it. It lists each journey with how it ended, the step that failed, each step's outcome and checks held, its calls (refusal, caller and
server time, whether every check passed) and where its full record is, and each stage with its create and destroy
times and what the accounts held of it afterwards. What the run expects is declared by a flag:

| `--expect=` | A journey is as expected when | For |
|---|---|---|
| `pass` (default) | its run record passed (or, with `--core=local`, was `rehearsed`) | step 1.6: the thin line passes |
| `not-implemented` | it failed at its first step on `NotImplemented` (or an `ExpectationFailed` that names it), never passed and never died, and reached no later step; it made a call, every call was answered `NotImplemented`, and every generic check passed on every call. Its stages are deployed in Core's empty-handler mode (`CAPXUL_HANDLERS=empty`, which `run.sh` sets; packages/core, `src/empty-handlers.ts`) | step 1.14: the journeys fail on Core's empty handlers |

The summary's `outcome` is `passed` exactly when every registered journey is in the run, every journey was as
expected, and every stage was destroyed with nothing of it left. A run of named journeys leaves some out, so its
summary fails; its exit code is still 0 when those journeys were as expected. Which claims each journey and each
operation's checks hold is `@capxul/scenarios`' `coverage.ts`; the summary counts them.

| Mode | Stages | Records |
|---|---|---|
| one world (`--expect=pass`, the default) | the run's one world on its hub, reset in place before each journey, and the worlds each journey makes (docs/roadmap.md, "One runner, one world"; step 1.18) | `records/<run>/<journey>.json` each, and the summary beside them with `oneWorld.timings` |
| a stage each (`--expect=not-implemented`) | one fresh stage per journey | `records/<stage>/<journey>.json` each; the summary at `records/run-<6 hex>/summary.json` |
| `--one-stage` | one fresh stage for all, created and destroyed once; each journey still has the use timeout of one run | `records/<stage>/summary.json`, the only JSON file in its folder, and every journey's record as one line of `records/<stage>/journeys.jsonl` |

One stage is sound only when no journey changes the stage's state, which holds against the empty handlers, so
`--one-stage` is refused without `--expect=not-implemented`. The generic checks are the same in both modes. A
dashboard that reads every JSON file of a folder counts only the summary, since the scenarios' own records (whose
`outcome` is `failed` against the empty handlers, by design) are JSON Lines.

## Settings

Each has a default and can be set in the environment (`src/settings.ts`).

| Variable | Default | Meaning |
|---|---|---|
| `WORLD_OWNER` | `runner` | Who the stages belong to; Core reads it at deploy as the world's owner. |
| `CAPXUL_DOOR_TOKEN`, `CAPXUL_PLATFORM_TOKEN` | fresh from `run.sh` | The tokens the stage's two doors accept. |
| `WORLD_SECOND_OWNER`, `CAPXUL_SECOND_PLATFORM_TOKEN` | `runner-2`, fresh from `run.sh` | The second operator the starting world `nothing` promises (blueprint decisions.md, 37). Until the platform accepts the token, its calls are refused `NotSignedIn`. |
| `WORLD_CREATE_TIMEOUT` | `4 minutes` | Deploy, migrations and the wait for Core's answers. |
| `WORLD_USE_TIMEOUT` | `3 minutes` | The calls and the checks. |
| `WORLD_SCENARIO_TIMEOUT` | `20 minutes` | The same for a scenario in private worlds, whose calls may make worlds. |
| `WORLD_DESTROY_TIMEOUT` | `4 minutes` | The destroy. |
| `WORLD_READY_ANSWERS` | `20` | Answers in a row before a stage is ready. |
| `WORLD_PROBE_EVERY` | `500 millis` | Between two probes, and between two sends of a call during the warm-up. |
| `WORLD_WARM_UP` | `30 seconds` | How long after ready a call Cloudflare's edge answered is sent again. |
| `RUNNER_RECORDS` | `records` | Where records are written. |

## Records

| Folder | What it holds |
|---|---|
| `records/spike/` | The pipeline spike's three green runs, the Proof of roadmap step 0.7. |
| `records/core-5104bd/` | `./run.sh door` on 13 November 2026: all twelve operations answered `NotImplemented` through the SDK at Core's two doors, every check passed, each call with its caller and server time and budget, the stage destroyed and nothing left. `passed`. |
| `records/core-205613/` | `./run.sh scenarios`: the one example failed on `NotImplemented`, as a scenario must against the empty handlers. `failed`, by design. |
| `records/core-189d55/` | `./run.sh scenarios --one-stage --expect=not-implemented` on 13 November 2026, step 1.5's proof: all 54 registered scenarios (the 53 claims and the example) in one fresh stage, each failing on the `NotImplemented` Core's empty handlers answered, every call passing every check. `summary.json` is `passed`; each scenario's record (`failed`, by design) is a line of `scenarios.jsonl`; `leftovers.txt` shows the accounts empty afterwards. |
| `records/leftovers.txt` | The two accounts read after every stage of that session: nothing of `CapxulCore` is left, and Alchemy keeps no state. |
| `records/w-cops4/` | `./run.sh chain --world=cops4` on 13 November 2026, in a world made with `world create` (its cast made by hand, as world.create does not yet): the real Core on Cloudflare founded northwind (org.create, 3.0 s on the server), dana's signature was kept and eli's sent the setup as one sponsored UserOperation through the world's bundler (3.5 s), a grant of manage-books to sam was proposed and sent the same way through the relayer (3.4 s), the chain read back through the world's door each time, and every call passed the span, outcome and events checks. `passed`. `inventory-after.json` is `world inventory` after `world destroy cops4`: nothing of the world left. |
| `records/w-c1/` | `./run.sh door --world=c1` on 13 November 2026 (roadmap step 1.4's first part): all twelve operations answered `NotImplemented` through the SDK at the real Core in a world made by `world create`, every check passed, the spans read from the world's own branch. `passed`. |
| `records/core-c109b1/` | `./run.sh door` on 13 November 2026, with `doc.create`, `doc.submit`, `report.run`, `world.clock.warp` and `record.export` built (roadmap step 1.6, site-ops): the three site operations refused `OrgNotFound` (a stage has no bench), the warp and the export succeeded with their events checked, the other seven answered `NotImplemented`. `passed`; the stage destroyed and nothing left. |
| `records/run-f2d91c/` | `./run.sh scenarios --expect=pass` of those five operations' 17 scenarios and the record.export example, a stage each, on 13 November 2026. The example passed; 15 scenarios died at `given` (the runner makes no starting world before step 1.12); record.export 1 and 4 ran in a bare stage and failed on its one-entry record, as they must without `restored` and `paid`. `failed`, as a run of some claims is; all 18 stages destroyed with nothing left. |
| `records/run-fc53ef/` | `./run.sh scenarios --expect=not-implemented` on 14 November 2026, step 1.14's proof: the three registered journeys, a fresh stage each in Core's empty-handler mode, each failing at its first step on the `NotImplemented` its own operation answered, every call passing every check. `summary.json` is `passed`; each journey's record (`failed`, by design) is in its stage's folder (`core-e5adc4`, `core-58a818`, `core-7484a8`); `leftovers.txt` shows the accounts empty afterwards. |
| `records/core-*/` | Further runs: one stage each, its door or scenario record, written by `./run.sh`. |

## Files

| File | What it holds |
|---|---|
| `src/main.ts` | The entry: arguments, the runs, the exit code. The only file that touches the process. |
| `src/run.ts` | A run as a plan: the door, a journey, and one stage from create to record. |
| `src/steps.ts` | What the runner hears of a journey's steps, and each step as its run record keeps it. |
| `src/in-world.ts`, `src/world/existing.ts` | A run in a world `world create` made, and the other worlds a call may be made `at`. |
| `src/client.ts` | `Capxul` for one stage: the SDK's client at its two doors, its chain and whatever a call reaches (the second operator, another world's door), every call recorded, a call its client rejected as `rejected`. |
| `src/given.ts` | `Given`: the facts of a scenario's starting world. `nothing`'s are the run's operators; for any other world, the declared example facts in a run that expects `not-implemented`, and a defect otherwise, until the runner makes starting worlds (step 1.12). |
| `src/checks/checks.ts`, `src/checks/events.ts` | The generic checks, the timings and the steps. A builder never changes these. |
| `src/world/` | The stage's life, its database, the warm-up and the inventory: the runner's plumbing. |
| `src/worlds/` | A run in private worlds: the platform this process serves, the starting worlds (`starting.ts`), their makers (`makers.ts`; those with a company in `company.ts`), how a fact is encoded (`encode.ts`), the run and its timing. |
| `src/local/` | `--core=local`: Core's bundle, its workerd, its database bridge, its chain forwarder and the host that runs one per world (above). |
| `src/scenario-runs.ts` | A run of the journeys in stages, in either mode, ending in its summary. |
| `src/summary.ts` | The summary: what each journey was expected to do, the journeys a run must hold, the stages it must leave. |
| `src/record.ts`, `src/failure.ts` | The run record, the JSON writers, and how a run ended and a failure is worded. |
| `test/` | The checks, the plumbing, the warm-up and the summary on made-up input. |

## Not done

- A stage has an owner but no expiry: if this process is killed outright (`kill -9`), nothing deletes the stage.
  `packages/world` gives worlds an expiry and a sweeper (step 1.3). Alchemy's state is local (`.alchemy/`, ignored).
- The template worlds are made once per run, not once per change to the code (decision 46): a run pays for them.
- A local Core's database connection is not pooled: each request opens one over its own WebSocket, which Hyperdrive
  on Cloudflare would pool. Its server times are therefore not Core's on Cloudflare.
- Runs go one at a time, and so do the journeys of a one-stage run.
- Runs of one world are one at a time, and so are its journeys; several runners would each make their own world.
- The snapshots a journey saves in the one world (`m3`, `draft`) stay with it for the run; a later journey that saved
  the same name would be refused `SnapshotExists`. None does today.
- A reset does not pause the bench's scheduler for the world's sites (packages/platform, "Sites from a pool").
- A company founded in a journey (`org.create` from `fresh`) still builds its site from nothing (about two minutes):
  the bench pools templates of starting worlds, not of a bare company site.

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
./run.sh shared               # make the shared world on its own hub, or renew it (below)
./run.sh scenarios --shared [name...]   # the journeys on the shared world, each from its templates (below)
WORLD_BENCH=<platform stage> ./run.sh scenarios --core=local [name...]   # a rehearsal: Core in workerd here (below)
WORLD_BENCH=local POOL_SECRETS=<file> ./run.sh scenarios --core=local    # the same beside packages/platform's bin/pool-bench.sh bench
./run.sh scenarios --via=cli [name...]                   # the same, every operation through the command line (below)
./run.sh scenarios --expect=not-implemented              # each in a fresh stage of Core's empty handlers; must fail at step 1
./run.sh scenarios --one-stage --expect=not-implemented  # the same, all in one fresh stage
```

`door` exits 1 if its run failed; `scenarios` exits 1 if a journey did not end as the run expected or a stage was
left behind. `run.sh` runs `src/main.ts` under Bun and, where the two key variables are unset, sets them to a
placeholder: in an agent's container the session's network proxy adds the real Cloudflare and Neon keys, which never
reach the machine; in CI the job's real keys are kept (`.github/workflows/world.yml`). It
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
   sites as a bench template (`POST /templates`, with a pool of ready copies) named `<starting world>-<code>-<world>`:
   `code` fingerprints `CODE` in `starting.ts` (the blueprint's, Core's, packages/world's and these makers' sources)
   and the bench's apps, and `world` is the one world, whose company facts the sites hold (packages/world,
   "Bench templates never change"). No other run asks for it, the bench never changes it, and no run drops it.
3. **Before each journey** the world is reset in place to its starting world's snapshot (`World.reset`: index,
   database, chain, Core's clock, the chain mined at it, the sites, then everything waited for), the nearest
   template ancestor for a starting world made by its steps (`fresh` for `quota-full`, whose operator's other worlds
   are then made by its steps). The sites go back in place to the point; a snapshot with no company removes the
   world's sites (a site left there would refuse the company's founding as `site-exists`); a point that lost its
   sites (removed by an earlier reset) gets them by claim from the bench template the world kept of it, ready in
   about a second, and is saved again (packages/world, `src/site/Points.ts`).
4. **The journey** runs with its starting world's facts (decision 38): `world` is the one world's `world.create`
   answer, and `calls` every call made in making it, the saves included. Every world the journey made, and those its
   starting world made by its steps, is destroyed after it, the newest first, whatever happened; the accounts are
   read for anything of them before and after (`afterwards.*.worlds`).
5. **The end**: the one world destroyed, the hub taken down, and the accounts read for every world the run made
   (`oneWorld.left`). The bench templates stay: packages/world's `sweep` removes them once unused for 6 hours, which
   `world.yml` runs after every run. With `RUNNER_TEARDOWN=job`, as `world.yml` sets it, the one world and a hub the
   run brought up are left up for CI's `teardown` job, which runs after the check has reported its verdict, always,
   destroys every world the run's operators own and then the hub, and reads the accounts afterwards, failing by name
   on anything of them left (its artifact `world-<run>-<attempt>-teardown`, world lifecycle rule 4). The summary
   names the world in `oneWorld.handedOver`, and `oneWorld.left` still lists what the accounts held of it before the
   teardown. Only what is left beyond the worlds handed over fails the run. Unset, the run takes everything down itself, as a local run should.

The summary is written however the run ends, but by interruption (`src/worlds/ending.ts`): a starting world that was
not made fails the journeys that start from it, each with why, while the others still run, and the summary's
`oneWorld.failure` names the first timed part that failed (`save payment-drafted (w-tpl-…) failed: …`); a run that
died says so there too (`the run did not finish: …`). Either fails the run (`outcome: "failed"`, exit 1). Before, a
defect in making the starting worlds (a door that answered Cloudflare's 524 page) ended the run with no record at all.

Every part is timed into the summary's `oneWorld.timings`, in order (`src/timings.ts`): `hub up`, `world create`,
`make <starting world>`, `save <…>`, `bench template <…>` (its note names the template), each `reset` with its own
parts and how it put the sites back, `starting world` (what is made by its steps), `journey` with each step's time,
`checks`, `destroy the journey's own worlds`, `world destroy`, `hub down`. Runs before 14 November 2026's "Bench
templates never change" also timed `drop bench template <…>`. Each has when it began since the run began, how
long it took and whether it failed, with why.

A starting world with no maker here fails its journey naming the operations its steps call (`waitsOn`). The company
starting worlds (`founded` to `paid`) are made by their declared steps in `src/worlds/company.ts`, each approval
signed with the cast's keys (`CAST_KEYS`, through viem, blueprint decisions 34 and 42), each wait polling an
operation until it answers differently (decision 27). With Core on Cloudflare they need a bench Cloudflare can reach:
the platform stage `staging` (`WORLD_BENCH=staging`, `records/run-22da37`), or a rehearsal with `--core=local`.

The calls made in making a journey's starting world get the generic checks too (`making` in the run record). The
platform's own calls are checked against what it kept (`PlatformKept`: its spans, and the events each wrote into its
world's record). Records go to `records/<run>/<journey>.json`, the summary to `records/<run>/summary.json`.

`./run.sh starting-worlds` makes each starting world in turn the same way, in one world on the run's hub (reset to
each, then its steps), times each, checks every call, destroys each one's other worlds before the next and the one
world at the end, and writes `records/<run>/starting-worlds.json` with its `timings`.

## A run on the shared world (steps 2.3 and 2.4)

A shared world is a world of grade `shared` that lives on for many callers and many runs (docs/roadmap.md, "The world
is the unit"). A run must never reset it or change it, since others use it; so a run on it does not reset it in
place, as a run in its one world does, but restores each journey's starting world from the shared world's template
snapshot of it into a world of the run (`world.snapshot.restore`, blueprint decisions 17, 18 and 27), and destroys
that world after the journey. The journeys and the checks are the same; only where the starting world comes from
differs (`src/shared/`).

| Command | What |
|---|---|
| `./run.sh shared` | The shared world `WORLD_SHARED` (`shared`), owned by `WORLD_OWNER` (`staging`), on its own hub `WORLD_HUB` (`shared`), its sites on the bench `WORLD_BENCH` names. Its hub is brought up, or up again (`SHARED_HUB_LIFETIME`, 30 days), unless it outlives the world's next expiry by a day. Missing, the world is made through the platform: `world.create` with grade `shared` and `WORLD_SHARED_LIFETIME` (7 days, the most a world may live), then every starting world the registered journeys start from a template of, by its steps, in order (`fresh`, `founded`, `office-holder`, `payment-drafted`), each saved as a template snapshot, with its maker's facts kept in the world's own database just before the save (`src/shared/facts.ts`, `runner.starting_worlds`), so each snapshot and every world restored from it carries them. A making that fails takes the half-made world down. Made or found, it is then renewed (packages/world, `renew`): its expiry moved to its lifetime from now and Core deployed again with the running code. The facts it keeps are then moved to the format the blueprint decodes now by the declared moves in `src/shared/facts.ts` (`MOVES`, never edited once merged; a later format is a new move), as is every world restored from its templates before its facts are read: facts kept on 14 November held world.create and world.show answers without `contracts.budgets`, which failed `record.export` on 15 November (`test/kept-facts.test.ts` keeps it from happening again, with a real Postgres, `CAPXUL_ROWS_DATABASE`). Its record is `records/<run>/shared.json`: every call with the generic checks, `world.show` of it, the templates it holds and every part's time. |
| `./run.sh scenarios --shared` | The registered journeys on it. The run signs its first operator in as the shared world's owner with the world's own operator token, read from the shared state, so a check may read the world a restore came from as its owner. Before each journey whose starting world is made from a template, the template is restored into a world of the run (`sj-<6 hex>`, at most 90 minutes and never past the shared world's expiry); its facts are the kept facts with the run's operators, the restore's answer as `world` (decisions 39) and the restore after the calls that made the template. A starting world made by its steps from nothing (`quota-full`) is made by its steps. Every world the run made is destroyed after its journey; the shared world and its hub are left as they were. The summary's `mode` is `shared world`. |

CI runs both after every deploy of the platform (`.github/workflows/platform.yml`, job `shared`), so the shared world
is renewed with each deploy; a week with no deploy lets it expire, the sweeper removes it, and the next deploy makes
it anew.

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
| `WORLD_READY_ANSWERS` | `5` | Answers in a row before a stage is ready. A relapse (a miss after the first answer) is still counted in `readiness.relapses`; none has ever been seen, so 20 was cut to 5 (docs/design/run-time.md, option 6c). |
| `RUNNER_TEARDOWN` | `run` | Who takes down a run in one world at its end: `run`, the run itself; `job`, CI's `teardown` job in `world.yml` (the one world and its own hub are left up for it, named in `oneWorld.handedOver`). Each journey's own worlds are destroyed after it either way. |
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
| `records/run-39c2b0/` | `WORLD_BENCH=local ./run.sh scenarios --core=local` on 14 November 2026 (roadmap step 1.18), a rehearsal: the three journeys in one world on the run's own hub, its starting worlds made once and saved, the world reset in place before each journey (the third reset claimed the company site from the bench template), every part timed in `summary.json`'s `oneWorld.timings`. Two journeys `rehearsed` (every step and check held); `found Northwind and give sam the books` failed at step 2 (org.create's padded bio rejected by the SDK as `PayloadRejected`, back to the journey's author). `failed`, as a run with a failing journey is; the hub, the world, every world the journeys made and the bench template all removed, nothing left. |
| `records/run-ea66b6/` | `./run.sh scenarios --expect=not-implemented "found Northwind and give sam the books"` on 14 November 2026, after the journey's org.create founding was changed to be decoded as the command line decodes it: in a fresh stage of Core's empty handlers (`core-591c5d`, its record there) it still failed at step 1 on `NotImplemented`, every call passing every check, the stage destroyed and nothing left. Its summary is `failed` only because the other two journeys were not in the run. |
| `records/run-327a7f/` | `WORLD_BENCH=local ./run.sh scenarios --core=local "found Northwind and give sam the books"` on 14 November 2026, a rehearsal: step 2's founding was sent and answered `Founded` with its bio and size trimmed, then failed org.create 1's check, which read `CompanySafeMinted` from the minter instead of Companies House (blueprint gaps.md, 9). Everything removed, nothing left. |
| `records/run-45390e/` | The same rehearsal with that check fixed: `found Northwind and give sam the books` `rehearsed`, all ten steps and every check held (the journey 310.6 s, `oneWorld.timings`); the hub, the world and the bench removed, nothing left. Its summary is `failed` only because the other two journeys were not in the run. |
| `records/run-7a9a59/` | `WORLD_HUB=fleet ./run.sh scenarios "two operators and their worlds"` on 14 November 2026, Core on Cloudflare (no bench): the run used the standing hub `fleet` and left it up, holding no world. The journey `passed`; the summary is `failed` only because the other two journeys were not in the run. Nothing left. |
| `records/run-de8bea/` | `WORLD_BENCH=staging WORLD_HUB=fleet ./run.sh scenarios` on 14 November 2026: the first run with Core on Cloudflare and the company sites on the platform's AWS bench, reached through its tunnel. `two operators and their worlds` and `pay Brightside and branch the books` passed; `found Northwind and give sam the books` failed at step 7 because one `record.export` call from this container got no answer (`HttpError` after 144 ms, no server span), its six steps before it passed. `failed`; nothing left. |
| `records/run-2166f8/` | The same run again. Two journeys passed; `pay Brightside and branch the books` failed at step 4 on the site door's HTTP 530 at 12:44 UTC: the staging tunnel was down (Cloudflare's error 1033 two minutes later), and platform.yml deployed `staging` again from 12:45. The template world's destroy then failed at `unsite`: its Cloudflare and Neon parts were removed, but its site and the bench template `payment-drafted` stayed on the bench and no world record was kept for the sweeper. Both were removed by hand through the site door afterwards. `failed`. |
| `records/run-22da37/` | The same run a third time, on 14 November 2026 (roadmap step 1.6): all three journeys passed every step and every check, Core on Cloudflare, the sites on the staging bench, the run on the standing hub `fleet`. 20.8 minutes of timed parts in `oneWorld.timings`: world create 20.4 s; `founded` made 212.4 s (its site built on the bench), `payment-drafted` saved 26.5 s and kept as the bench's template 12.0 s; resets 32.8, 16.8 and 46.2 s; journeys 140.8, 309.9 and 271.0 s; template dropped 13.0 s, world destroyed 24.8 s. `passed`; `oneWorld.left` empty, `fleet` holding no world, and the bench holding no site of the run and no template. |
| `records/run-f2e169/` | `WORLD_BENCH=staging WORLD_HUB=fleet ./run.sh scenarios` on 14 November 2026, with packages/world saving sites through the asynchronous backup (falling back to the old door's answer, since `staging` was not redeployed) while another builder's run made sites on `staging`: the starting worlds were made and saved (`save payment-drafted` 31.6 s, its backup answered by the old door within it), then every reset failed on `HTTP 502: upstream request failed`: a door call held past this container's network relay's 32 s while the old door's removal waited for `BENCH_LOCK`. The take-down's `unsite` failed the same way; the world's sites and point were removed through the door by hand afterwards. `failed`; the summary written and every journey's record with why. |
| `records/shared-09eeaf/` | `WORLD_BENCH=staging ./run.sh shared` on 14 November 2026 (roadmap step 2.3): the shared world `shared` made from nothing, owned by `staging`, on its own hub `shared` (brought up, 30 days): `world.create` grade `shared` 40.7 s; `fresh` saved; `founded` made 233.2 s (Northwind's site built on the staging bench with the world's own site token, `northwind-shared.worlds.abuusama.dev`); `office-holder` and `payment-drafted` made; each saved as a template snapshot with its facts kept beside it (saves 11.1 to 30.4 s); then renewed (15.5 s: Core deployed again 10.0 s). Every one of its 81 calls passed every check. `passed`. |
| `records/shared-dc9834/` | `./run.sh shared` again, 22 minutes later: the world found and renewed (16.5 s; its expiry moved from 13:45:48 to 14:08:24 on 21 November, Core deployed again 10 s), `world.show` read through the renewed Core with the world's own operator token (Northwind's site `ready`), and the bench's site door listing, to a token minted for `shared` alone, one site, `northwind-shared`, of world `shared`, ready. `passed`. |
| `records/run-6c07e4/` | `./run.sh scenarios --shared` on 14 November 2026, the first run on the shared world: `two operators and their worlds` and `found Northwind and give sam the books` passed (the second in a world restored from the shared world's `fresh`, 25.0 s); `pay Brightside and branch the books` failed at step 3 (`world.snapshot.save`) on the site door's HTTP 502 while platform.yml redeployed `staging` with an asynchronous backup (run 43602842394, 14:03 to 14:05 UTC); its world's site, left `failed` by the door's restart, was removed through the door by hand. `failed`. |
| `records/run-1126dd/` | The same, after that deploy: the same two passed; `pay Brightside and branch the books` failed at step 3 again, `SchemaError: Missing key`: the redeployed door answers a backup with `202 saving`, which this branch's client did not yet follow (master's `9c522b59`, since cherry-picked here). Nothing left. `failed`. |
| `records/run-686965/` | The same with that client, while two CI world runs used the staging bench: `two operators and their worlds` passed; `found Northwind and give sam the books` passed every step and every check, but its world's destroy failed at the site door (HTTP 502) after the site was removed (the door then held no site of it); `pay Brightside and branch the books` failed at step 3 on a transport error to the site door. Nothing of the run left in the accounts or on the bench. `failed`. |
| `records/shared-8eb1f8/` | `./run.sh shared` a third time, at 15:00 UTC: the world renewed (19.4 s, Core deployed again 12.8 s), its expiry now 15:00:06 on 21 November; `world.show` and the bench's listing as before. `passed`. |
| `records/run-bc959e/` | `./run.sh scenarios --shared` right after it, with the bench to itself, roadmap step 2.4: all three journeys passed every step and every check, each template restored into a world of the run (`fresh` 23.5 s, `payment-drafted` 61.4 s with its site) and every world the run made destroyed after its journey; the journeys 139.2, 352.1 and 306.8 s. `passed`; `oneWorld.left` empty, the bench holding no site of the run, the shared world as it was. |
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
| `src/checks/paths.ts` | The generic `path` check: each thing's events, across a journey's calls, form a path through its machine in the blueprint, and each refusal a machine declares names the state it was refused from; and `coverage`, what the calls reached of each machine, in every run record and summed in the summary. A builder never changes it. |
| `src/world/` | The stage's life, its database, the warm-up and the inventory: the runner's plumbing. |
| `src/worlds/` | A run in private worlds: the platform this process serves (`platform.ts`), the starting worlds (`starting.ts`), their makers (`makers.ts`; those with a company in `company.ts`), how a fact is encoded (`encode.ts`), the run, its summary however it ended (`ending.ts`) and its timing, and its take-down (`teardown.ts`): the worlds destroyed, a failure timed `ok: false` and listed in the summary's `oneWorld.notTakenDown`, which fails the run; the bench templates the run kept stay for the sweep. |
| `src/shared/` | A run on the shared world: making or renewing it (`make.ts`), its starting worlds restored from its templates (`starting.ts`), and the makers' facts it keeps (`facts.ts`). |
| `src/local/` | `--core=local`: Core's bundle, its workerd, its database bridge, its chain forwarder and the host that runs one per world (above). |
| `src/scenario-runs.ts` | A run of the journeys in stages, in either mode, ending in its summary. |
| `src/summary.ts` | The summary: what each journey was expected to do, the journeys a run must hold, the stages it must leave. |
| `src/record.ts`, `src/failure.ts` | The run record, the JSON writers, and how a run ended and a failure is worded. |
| `test/` | The checks, the plumbing, the warm-up and the summary on made-up input. |

## Against a platform stage from an agent's container

`WORLD_BENCH=<stage>` reads the stage's site door from the shared state: `http://<stage>-door.<domain>`, plain HTTP
through the tunnel, since Cloudflare's free certificate covers one level only. The session's network proxy takes only
CONNECT tunnels, and Bun sends a plain-HTTP request through a proxy in absolute form, which the proxy refuses. The runs
above therefore set `HTTP_PROXY` to a small loopback forwarder that carries each request through a CONNECT tunnel to
port 80. It is not in the repository. CI needs nothing of this kind.

## Not done

- A stage has an owner but no expiry: if this process is killed outright (`kill -9`), nothing deletes the stage.
  `packages/world` gives worlds an expiry and a sweeper (step 1.3). Alchemy's state is local (`.alchemy/`, ignored).
- The template worlds are made once per run, not once per change to the code (decision 46): a run pays for them. A
  bench template is the run's alone, since its sites hold the run's world's company facts (random org id, the Safe
  minted under it); a run that found another's would still found its own company through Core, building its site.
- A local Core's database connection is not pooled: each request opens one over its own WebSocket, which Hyperdrive
  on Cloudflare would pool. Its server times are therefore not Core's on Cloudflare.
- Runs go one at a time, and so do the journeys of a one-stage run.
- Runs of one world are one at a time, and so are its journeys; several runners each make their own world, and may
  run at once on one bench and one hub: nothing of one run's is named so another's could take it. Only making a site
  from nothing still waits, one at a time across the bench (the door's `BENCH_LOCK`), so concurrent runs queue there
  for about two to three minutes each. How many runs at once the staging bench (2 vCPU, 8 GiB) holds is not measured.
- The snapshots a journey saves in the one world (`m3`, `draft`) stay with it for the run; a later journey that saved
  the same name would be refused `SnapshotExists`. None does today.
- A reset does not pause the bench's scheduler for the world's sites (packages/platform, "Sites from a pool").
- A company founded in a journey (`org.create` from `fresh`) still builds its site from nothing (about two minutes):
  the bench pools templates of starting worlds, not of a bare company site.

## Through the command line (step 1.10)

`./run.sh scenarios --via=cli` (or `RUNNER_VIA=cli`) runs the journeys exactly as above, but every operation a journey
calls goes through the command line (`src/client.ts`, packages/cli `callVia`): the `capxul` command that makes the
call, run in this process at the same doors with the same credentials and the same HTTP client, and its one printed
line read back with the operation's own schemas. The recording, the generic checks and the operations' checks are the
same, so a run through the command line passes exactly when its journeys get the same answers as through the SDK.
Each run record and the summary say `via: "cli"`; a run through the SDK names no `via`. The chain reads, which are not
operations and have no command, still go through the SDK, and so does the making of the starting worlds, which is
not a journey. `test/via-cli.test.ts` runs the three journeys through both against the SDK's TestDoor in this process
and finds the same calls, answers and steps, and every call the door saw under the trace the runner recorded.

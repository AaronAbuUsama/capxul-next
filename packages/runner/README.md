# runner

The scenario runner (roadmap step 1.2). It runs against a world through Core's door, applies the same generic checks
to every call it makes, and writes one JSON run record per run. It knows no operation and no scenario by name: it
reads the blueprint (`@capxul/blueprint`), deploys Core (`@capxul/core`) and runs the scenarios that
`@capxul/scenarios` registers. Built from `spikes/pipeline/runner`.

## Run it

```bash
./run.sh door                 # every blueprint operation called once through a fresh Core stage
./run.sh door --world=<name>  # the same, through the Core of a world `world create` made (packages/world)
./run.sh scenarios [name...]  # the registered scenarios (or those named), each in fresh private worlds (below)
./run.sh starting-worlds      # make every starting world the runner can make, timed, then destroy them all
./run.sh scenarios --expect=not-implemented              # each in a fresh stage; must fail on NotImplemented
./run.sh scenarios --one-stage --expect=not-implemented  # the same, all in one fresh stage
```

`door` exits 1 if its run failed; `scenarios` exits 1 if a scenario did not end as the run expected or a stage was
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

## A run in private worlds (step 1.6)

`./run.sh scenarios` expecting `pass` (the default) runs every scenario in private worlds of `packages/world`
(`src/worlds/`). This process serves the platform group itself, on its loopback (`platform.ts`, blueprint
decisions.md 48), signed in by the run's two operators (`WORLD_OWNER`, `WORLD_SECOND_OWNER` and their tokens), and
the scenarios' client calls it there; a world's own operations go to its Core on Cloudflare.

For each scenario the runner makes its starting world (`starting.ts`, `makers.ts`, decisions 27 and 39) and hands it
the facts its steps answered (decision 38), with every call made in making it as `calls`:

| Starting world | How it is made |
|---|---|
| `nothing` | No world; its facts name the two operators. |
| `fresh` to `paid` | Once per run, one after another in one template world (`tpl-<6 hex>`, 6 hours), each saved there as a template snapshot of its own name; each scenario gets a restore of it into a world of its own (`s-<6 hex>`, 90 minutes), whose `world` fact is the restore's answer. |
| `quota-full`, `with-snapshot`, `restored` | By their steps for each scenario, from a world got the same way. |

A starting world whose steps need an operation no maker here makes yet fails its scenario with the operations it
waits on (`waitsOn`). Today the runner makes `nothing`, `quota-full` and `fresh`; `founded` to `paid` wait on
`org.create`, `approval.sign`, `org.member.grant`, `doc.create`, `doc.submit` and `report.run`, and so do
`with-snapshot` and `restored`, which are made from `paid`.

The calls made in making the world get the generic checks too (`making` in the run record). The platform's own
calls are checked against what it kept (`PlatformKept`: its spans, and the events each wrote into its world's record).
After the scenario every world made while it ran is destroyed, the newest first, whatever happened, and the accounts
are read for anything named after those worlds before and after (`afterwards.*.worlds`). The template worlds are
destroyed when the run ends. Records go to `records/<run>/<scenario>.json`, the summary to `records/<run>/summary.json`.

`./run.sh starting-worlds` makes each starting world in turn, as a scenario of it would get it, times each, checks
every call, destroys each one's worlds before the next and the template at the end, and writes
`records/<run>/starting-worlds.json`.

## A scenarios run and its summary

`./run.sh scenarios` also writes a summary (`src/summary.ts`, `src/scenario-runs.ts`): one JSON file whose `outcome`
is the run's, so a step's Proof can name it. It lists each scenario with how it ended, its calls (refusal, caller and
server time, whether every check passed) and where its full record is, and each stage with its create and destroy
times and what the accounts held of it afterwards. What the run expects is declared by a flag:

| `--expect=` | A scenario is as expected when | For |
|---|---|---|
| `pass` (default) | its run record passed | step 1.6: the thin line passes |
| `not-implemented` | it failed on `NotImplemented`, or on an `ExpectationFailed` that names it, never passed and never died; it made a call, every call was answered `NotImplemented`, and every generic check passed on every call | step 1.5: the scenarios fail on Core's empty handlers |

The summary's `outcome` is `passed` exactly when every claim the blueprint declares has its scenario in the run, every
scenario was as expected, and every stage was destroyed with nothing of it left. A run of named scenarios covers
only some claims, so its summary fails; its exit code is still 0 when those scenarios were as expected.

| Mode | Stages | Records |
|---|---|---|
| a world each (`--expect=pass`, the default) | the worlds each scenario makes, and its starting world's | `records/<run>/<scenario>.json` each, and the summary beside them |
| a stage each (`--expect=not-implemented`) | one fresh stage per scenario | `records/<stage>/<scenario>.json` each; the summary at `records/run-<6 hex>/summary.json` |
| `--one-stage` | one fresh stage for all, created and destroyed once; each scenario still has the use timeout of one run | `records/<stage>/summary.json`, the only JSON file in its folder, and every scenario's record as one line of `records/<stage>/scenarios.jsonl` |

One stage is sound only when no scenario changes the stage's state, which holds against the empty handlers, so
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
| `records/w-c1/` | `./run.sh door --world=c1` on 13 November 2026 (roadmap step 1.4's first part): all twelve operations answered `NotImplemented` through the SDK at the real Core in a world made by `world create`, every check passed, the spans read from the world's own branch. `passed`. |
| `records/core-c109b1/` | `./run.sh door` on 13 November 2026, with `doc.create`, `doc.submit`, `report.run`, `world.clock.warp` and `record.export` built (roadmap step 1.6, site-ops): the three site operations refused `OrgNotFound` (a stage has no bench), the warp and the export succeeded with their events checked, the other seven answered `NotImplemented`. `passed`; the stage destroyed and nothing left. |
| `records/run-f2d91c/` | `./run.sh scenarios --expect=pass` of those five operations' 17 scenarios and the record.export example, a stage each, on 13 November 2026. The example passed; 15 scenarios died at `given` (the runner makes no starting world before step 1.12); record.export 1 and 4 ran in a bare stage and failed on its one-entry record, as they must without `restored` and `paid`. `failed`, as a run of some claims is; all 18 stages destroyed with nothing left. |
| `records/core-*/` | Further runs: one stage each, its door or scenario record, written by `./run.sh`. |

## Files

| File | What it holds |
|---|---|
| `src/main.ts` | The entry: arguments, the runs, the exit code. The only file that touches the process. |
| `src/run.ts` | A run as a plan: the door, a scenario, and one stage from create to record. |
| `src/in-world.ts`, `src/world/existing.ts` | A run in a world `world create` made, and the other worlds a call may be made `at`. |
| `src/client.ts` | `Capxul` for one stage: the SDK's client at its two doors, its chain and whatever a call reaches (the second operator, another world's door), every call recorded, a call its client rejected as `rejected`. |
| `src/given.ts` | `Given`: the facts of a scenario's starting world. `nothing`'s are the run's operators; for any other world, the declared example facts in a run that expects `not-implemented`, and a defect otherwise, until the runner makes starting worlds (step 1.12). |
| `src/checks/checks.ts`, `src/checks/events.ts` | The generic checks, the timings and the steps. A builder never changes these. |
| `src/world/` | The stage's life, its database, the warm-up and the inventory: the runner's plumbing. |
| `src/scenario-runs.ts` | A scenarios run in either mode, ending in its summary. |
| `src/summary.ts` | The summary: what each scenario was expected to do, the claims a run must cover, the stages it must leave. |
| `src/record.ts`, `src/failure.ts` | The run record, the JSON writers, and how a run ended and a failure is worded. |
| `test/` | The checks, the plumbing, the warm-up and the summary on made-up input. |

## Not done

- A stage has an owner but no expiry: if this process is killed outright (`kill -9`), nothing deletes the stage.
  `packages/world` gives worlds an expiry and a sweeper (step 1.3). Alchemy's state is local (`.alchemy/`, ignored).
- The template worlds are made once per run, not once per change to the code (decision 46): a run pays for them.
- Runs go one at a time, and so do the scenarios of a one-stage run.

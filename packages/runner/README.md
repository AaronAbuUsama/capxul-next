# runner

The scenario runner (roadmap step 1.2). It runs against a world through Core's door, applies the same generic checks
to every call it makes, and writes one JSON run record per run. It knows no operation and no scenario by name: it
reads the blueprint (`@capxul/blueprint`), deploys Core (`@capxul/core`) and runs the scenarios that
`@capxul/scenarios` registers. Built from `spikes/pipeline/runner`.

## Run it

```bash
./run.sh door                 # every blueprint operation called once through a fresh Core stage
./run.sh scenarios [name...]  # the registered scenarios (or those named), each in its own fresh stage
```

Each run exits 1 if a run failed. `run.sh` runs `src/main.ts` under Bun and sets the two key variables to a
placeholder: the session's network proxy adds the real Cloudflare and Neon keys, which never reach this machine.

## What one run does

1. **Creates a fresh stage** of the stack `CapxulCore` (`src/world/stage.ts`): deploys Core and its database, applies
   Core's migrations over Neon's HTTPS SQL endpoint, and waits until Core has answered 20 `Ping`s in a row
   (`src/world/warmup.ts`). Each step has a declared timeout. Until `packages/world` lands (step 1.3), a stage is the
   runner's world.
2. **Makes its calls** (`src/client.ts`), each under its own trace id in `traceparent` and logged with what was sent,
   what came back and the caller's time. The door plan calls every operation with its first blueprint example, as the
   world's owner. A scenario is handed `Capxul`, the same recording client, until the SDK supplies it.
3. **Applies the generic checks** (`src/checks/`) to every call, reading what Core kept in `app.spans` and
   `app.events` under its trace id:

   | Check | Passes when |
   |---|---|
   | `span` | exactly one server span named after the operation exists under the call's trace id |
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

## Settings

Each has a default and can be set in the environment (`src/settings.ts`).

| Variable | Default | Meaning |
|---|---|---|
| `WORLD_OWNER` | `runner` | Who the stages belong to; Core reads it at deploy as the world's owner. |
| `WORLD_CREATE_TIMEOUT` | `4 minutes` | Deploy, migrations and the wait for Core's answers. |
| `WORLD_USE_TIMEOUT` | `3 minutes` | The calls and the checks. |
| `WORLD_DESTROY_TIMEOUT` | `4 minutes` | The destroy. |
| `WORLD_READY_ANSWERS` | `20` | Answers in a row before a stage is ready. |
| `WORLD_PROBE_EVERY` | `500 millis` | Between two probes, and between two sends of a call during the warm-up. |
| `WORLD_WARM_UP` | `30 seconds` | How long after ready a call Cloudflare's edge answered is sent again. |
| `RUNNER_RECORDS` | `records` | Where records are written. |

## Records

| Folder | What it holds |
|---|---|
| `records/spike/` | The pipeline spike's three green runs, the Proof of roadmap step 0.7. |
| `records/core-*/` | One stage each: its door or scenario record, written by `./run.sh`. |

## Files

| File | What it holds |
|---|---|
| `src/main.ts` | The entry: arguments, the runs, the exit code. The only file that touches the process. |
| `src/run.ts` | A run as a plan: the door, a scenario, and one stage from create to record. |
| `src/client.ts` | The recording client, and `Capxul` for the scenarios. |
| `src/checks/checks.ts`, `src/checks/events.ts` | The generic checks, the timings and the steps. A builder never changes these. |
| `src/world/` | The stage's life, its database, the warm-up and the inventory: the runner's plumbing. |
| `src/record.ts`, `src/failure.ts` | The run record, and how a failure is worded in it. |
| `test/` | The checks, the plumbing and the warm-up on made-up input. |

## Not done

- A stage has an owner but no expiry: if this process is killed outright (`kill -9`), nothing deletes the stage.
  `packages/world` gives worlds an expiry and a sweeper (step 1.3). Alchemy's state is local (`.alchemy/`, ignored).
- Every scenario starts from a fresh, empty stage; starting worlds come with step 1.12.
- Runs go one at a time.

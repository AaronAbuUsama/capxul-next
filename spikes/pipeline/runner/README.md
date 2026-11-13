# runner

The generic scenario runner. It knows no operation and no scenario by name: it reads the contract
(`../contract/door.ts`) and applies the same checks to every call of every scenario.

## What it does for each scenario

1. **Creates a fresh world** (`world.ts`): deploys one stage of the stack (a Neon branch, a Hyperdrive
   configuration, the Core Worker), applies `../core/migrations` to the branch, and waits until Core answers. The
   world has an owner and an expiry, and each step has a declared timeout.
2. **Runs the scenario** (`run.ts`, `client.ts`). The scenario is an Effect that gets two services: `Core`, a typed
   client derived from the contract's Rpc group, and `TraceIds`. Every call goes out under its own trace id in the
   `traceparent` header, and the runner keeps a log of every call: operation, trace id, outcome, milliseconds, the
   payload that was sent and, for a success, what came back.
3. **Applies the generic checks** (`checks.ts`) to every call in that log, reading what Core kept in `app.spans`
   and `app.events` under the call's trace id (`database.ts`):

   | Check | Passes when | Gates |
   |---|---|---|
   | `span` | exactly one server span named after the operation exists under the call's trace id, with its duration | yes |
   | `outcome` | that span ended the way the caller saw the call end (success, typed refusal, defect) | yes |
   | `events` | a successful call recorded exactly the events the contract declares, each once, and each one's stored payload equals what the declaration computes from that call's payload and result (and decodes with the event's schema); a refused or failed call recorded none | yes |
   | `budget` | the span's duration is within the operation's declared budget | no: it is measured and recorded |

   When an event does not carry what is declared, the check's detail in the run record names the operation, the
   event and each differing field, for example
   `record.append's record_appended differs in key (recorded "", declared "account/operating")`.

4. **Writes the run record** (`record.ts`) to `records/<scenario name as a slug>.json`, outside the world: scenario,
   outcome, failure text, every call with its outcome, timings, events seen and check results, and how long the
   world took to create and destroy.
5. **Destroys the world**, whatever happened: also when the scenario failed, a step timed out, the run was
   interrupted, or the create failed half-way. The record is written before the destroy and again after it.

A scenario passes when its own expectations hold and every gating check passes on every call.

## Run it

From `spikes/pipeline`:

```bash
./run.sh scenarios     # every *.scenario.ts under scenarios/, each in its own fresh world
./run.sh smoke         # the runner's own smoke scenario, runner/smoke/
bun test runner        # the generic checks, without a world
```

`./run.sh scenarios <dir>` runs the scenarios under another directory. The command exits 1 when a scenario failed or
a world was left behind, and 0 otherwise (also when there are no scenarios).

## Settings

Each has a default and can be set in the environment (`run.ts`).

| Variable | Default | Meaning |
|---|---|---|
| `WORLD_OWNER` | `pipeline` | Who the worlds belong to; part of each branch's name. |
| `WORLD_LIFETIME` | `30 minutes` | After this, Neon deletes the world's branch by itself. |
| `WORLD_CREATE_TIMEOUT` | `3 minutes` | Deploy, migrations and the first answer. |
| `WORLD_USE_TIMEOUT` | `2 minutes` | The scenario and the generic checks. |
| `WORLD_DESTROY_TIMEOUT` | `3 minutes` | The destroy. |
| `PIPELINE_RECORDS` | `records` | Where run records are written. |
| `PIPELINE_MIGRATIONS` | `core/migrations` | The `.sql` files applied to a new world. |

## Files

| File | What it holds |
|---|---|
| `main.ts` | The entry: finds scenarios, runs them, sets the exit code. The only file that touches the process. |
| `run.ts` | One scenario in one world, from create to record. |
| `world.ts` | The world's life as one unit (adapted from `spikes/hosting`). |
| `client.ts` | The recording client and the trace id source. |
| `checks.ts`, `checks.test.ts` | The generic checks and their tests. |
| `events.ts` | The `events` check: which events a call recorded and what each carries, against the declaration. |
| `database.ts` | Neon's HTTPS SQL endpoint: migrations in, spans and events out. |
| `record.ts`, `failure.ts` | The run record and how a failure is worded in it. |
| `scenario.ts` | What a scenario is: `scenario`, `expect`, `Core`, `TraceIds`. |
| `smoke/` | One throwaway scenario that proves the runner against the empty handlers. |

# runner

The generic scenario runner. It knows no operation and no scenario by name: it reads the contract
(`../contract/door.ts`) and applies the same checks to every call of every scenario.

## What it does for each scenario

1. **Creates a fresh world** (`world.ts`): deploys one stage of the stack (a Neon branch, a Hyperdrive
   configuration, the Core Worker), applies `../core/migrations` to the branch, and waits until Core has answered
   20 probes in a row (`warmup.ts`, and "Readiness and warm-up" below). The world has an owner and an expiry, and
   each step has a declared timeout.
2. **Runs the scenario** (`run.ts`, `client.ts`). The scenario is an Effect that gets two services: `Core`, a typed
   client derived from the contract's Rpc group, and `TraceIds`. Every call goes out under its own trace id in the
   `traceparent` header, and the runner keeps a log of every call: operation, trace id, outcome, milliseconds, the
   payload that was sent, for a success what came back, and how many times it had to be sent again during the
   world's warm-up.
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
   outcome, failure text, what the wait for the world saw (`readiness`: probes, relapses, milliseconds), every call
   with its outcome, timings, resends, events seen and check results, and how long the world took to create and
   destroy. Each call also lists its `steps`: every other server span kept under its trace id (the transaction,
   each statement), with when it started after the operation's span did and how long it took. That is where a
   slow call's time is read from.
5. **Destroys the world**, whatever happened: also when the scenario failed, a step timed out, the run was
   interrupted, or the create failed half-way. The record is written before the destroy and again after it.

A scenario passes when its own expectations hold and every gating check passes on every call.

## Run it

From `spikes/pipeline`:

```bash
./run.sh scenarios     # every *.scenario.ts under scenarios/, each in its own fresh world
bun test runner        # the generic checks, the readiness wait and the warm-up resend, without a world
```

`./run.sh scenarios <dir>` runs the scenarios under another directory. The command exits 1 when a scenario failed or
a world was left behind, and 0 otherwise (also when there are no scenarios).

## Readiness and warm-up

A workers.dev address does not go live everywhere at once. For some seconds after a deploy, Cloudflare's edge can
answer for it without the Worker: status 404 with an HTML page (or, for a name that does not exist at all,
`text/plain` and `error code: 1042`). One request reaches the Worker and the next gets that 404. Seen on 13
November 2026 with 40 probes 250 ms apart: probes 1 to 5 were answered by the Worker, probes 6 and 7 (about 3 s
after the deploy) by the edge, and every probe after that by the Worker. The runner used to take the first 200 as
ready, and one full run in three failed on the call after it.

What the runner does now (`warmup.ts`):

- **A probe that only the Worker can answer.** Each probe is the Rpc protocol's own `Ping`, sent as a POST to a URL
  no probe has used before. Ready means status 200 and the body `[{"_tag":"Pong"}]`: the Worker's Rpc server ran.
  A probe touches no operation and no table.
- **Twenty answers in a row, 500 ms apart** (about 11 s), inside the create step's declared timeout. One answer that
  is not a `Pong` starts the count again and, if the Worker had already answered, is counted as a relapse. Twenty
  is more than the relapse seen needs. It is twenty because of the database: in a world's first 10 s or so,
  Hyperdrive opens a new connection to Neon for most calls (see "Speed" in `../README.md`), and the wait also
  outlasts that.
- **A resend during the warm-up only.** For 30 s after the world is ready, a call that the edge answered (status
  404 and not JSON; Core answers every path with 200 and JSON, so such an answer cannot be Core's) is sent again
  500 ms later. The Worker never saw it, so an append cannot happen twice. Each resend is logged as a warning and
  counted in the call's `resent` in the run record. Once the 30 s are over, the same answer is passed on unchanged
  and the call is recorded as `unanswered`, which fails the scenario. A 500, a defect, a refusal, a timeout or a
  broken connection is never resent, during the warm-up or after it.

## Settings

Each has a default and can be set in the environment (`run.ts`).

| Variable | Default | Meaning |
|---|---|---|
| `WORLD_OWNER` | `pipeline` | Who the worlds belong to; part of each branch's name. |
| `WORLD_LIFETIME` | `30 minutes` | After this, Neon deletes the world's branch by itself. |
| `WORLD_CREATE_TIMEOUT` | `3 minutes` | Deploy, migrations and the wait for Core's answers. |
| `WORLD_USE_TIMEOUT` | `2 minutes` | The scenario and the generic checks. |
| `WORLD_DESTROY_TIMEOUT` | `3 minutes` | The destroy. |
| `WORLD_READY_ANSWERS` | `20` | How many probes in a row Core must answer before the world is ready. |
| `WORLD_PROBE_EVERY` | `500 millis` | The pause between two probes, and between two sends of a call during the warm-up. |
| `WORLD_WARM_UP` | `30 seconds` | How long after a world is ready a call answered by Cloudflare's edge is sent again. |
| `PIPELINE_RECORDS` | `records` | Where run records are written. |
| `PIPELINE_MIGRATIONS` | `core/migrations` | The `.sql` files applied to a new world. |

## Files

| File | What it holds |
|---|---|
| `main.ts` | The entry: finds scenarios, runs them, sets the exit code. The only file that touches the process. |
| `run.ts` | One scenario in one world, from create to record. |
| `world.ts` | The world's life as one unit (adapted from `spikes/hosting`). |
| `client.ts` | The recording client and the trace id source. |
| `warmup.ts`, `warmup.test.ts` | When a world is ready, the resend during its warm-up, and their tests. |
| `checks.ts`, `checks.test.ts` | The generic checks, each call's steps, and their tests. |
| `events.ts` | The `events` check: which events a call recorded and what each carries, against the declaration. |
| `database.ts` | Neon's HTTPS SQL endpoint: migrations in, spans and events out. |
| `record.ts`, `failure.ts` | The run record and how a failure is worded in it. |
| `scenario.ts` | What a scenario is: `scenario`, `expect`, `Core`, `TraceIds`. |

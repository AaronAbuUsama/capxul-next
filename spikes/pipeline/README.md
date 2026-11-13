# Pipeline spike

The skeleton of roadmap step 0.7: the smallest end-to-end proof that an operation can go from an Effect contract,
to a scenario that fails on an empty handler, to a pass. This directory holds the contract, the empty server, the
world and the runner. It holds **no scenarios and no implementation**: two other agents write those, in that order,
and the separation is the point. Nothing here is product code.

Built on `spikes/hosting` (Alchemy 2.0.0-beta.85 on Effect 4.1.2, deployed from an agent's container under Bun).

| Directory | What it is |
|---|---|
| `contract/` | Pure declarations: two operations of the world's record, their refusal, their event, their budgets, and the five acceptance claims. |
| `core/` | The server: a Cloudflare Worker that serves the contract and reaches the world's Neon branch. Its handlers are empty: every operation dies as "not implemented". |
| `runner/` | The generic scenario runner: a fresh world per scenario, the generic checks, a run record, and the world's destruction. |
| `scenarios/` | Empty. Written by a separate agent; each must fail against the empty handlers first. |
| `alchemy.run.ts` | The stack `CapxulSpikePipeline`. Stage `platform` owns the Neon project; every other stage is one world. |

## Run it

```bash
pnpm install --ignore-workspace
./run.sh scenarios     # every scenario in scenarios/, each in its own fresh world; exits 1 if any failed
./run.sh smoke         # the runner's own smoke scenario
pnpm typecheck         # tsc: fails when an operation has no handler
bun test runner        # the generic checks
```

The first run creates the `platform` stage (a Neon project, 8 s). **Destroy it when you finish**:
`./run.sh alchemy destroy --stage platform --yes`. Alchemy's state is on this machine's disk (`.alchemy/`, not
committed), so only the checkout that created a stage can destroy it. Never run `alchemy nuke`.

## What is proven (13 November 2026, from a Claude cloud container)

| Question | Result |
|---|---|
| Does the server refuse to compile without a handler for a declared operation? | Yes. `tsc` fails with `Property '"record.export"' is missing` (`core/README.md`). |
| Can a Worker written in Effect serve the Rpc group and reach the world's Neon branch? | Yes, through Hyperdrive and Effect SQL. One statement took 81 to 130 ms; `BEGIN`, an insert and `COMMIT` took 259 to 298 ms. |
| Is a declared event written in the same transaction as the write it reports? | Yes. A temporary handler (not committed) emitted inside `sql.withTransaction`: the commit left one `app.events` row, a typed refusal inside the transaction left none. |
| Are a call's server spans kept under the trace id the caller sent? | Yes. The operation's span and every span beneath it are in `app.spans` under the `traceparent` trace id. |
| Does the runner create a world, run a scenario, check it generically, record it and destroy the world? | Yes: the smoke run below, 30 s in all. |
| Does a scenario for a real claim fail against the empty handlers? | Yes. A temporary scenario for claim 4 (not committed) failed with `NotImplemented: not implemented: record.export`, and the command exited 1. |
| Is the world destroyed when the run goes wrong? | Yes, in three cases that happened: a create that timed out after the Worker was deployed, a create that failed outright, and a run interrupted with SIGINT 14 s into the create. Each left a record and no resource. |

### The smoke run

`./run.sh smoke` calls `record.export` against the empty handlers in a fresh world and expects the "not implemented"
defect. Its record, `records/smoke-export-is-not-implemented.json`:

```json
{
  "scenario": "smoke: export is not implemented",
  "world": "pl-smoke-expo-e0b99f",
  "owner": "pipeline",
  "expiresAt": "2026-11-13T08:47:41.847Z",
  "outcome": "passed",
  "failure": null,
  "calls": [
    {
      "operation": "record.export",
      "traceId": "bd98f5c733db08a0cb3c45d4f5d1e7fb",
      "outcome": "defect",
      "ms": 708,
      "serverMs": 0,
      "budgetMs": 500,
      "failure": "NotImplemented: not implemented: record.export",
      "events": [],
      "checks": [
        { "check": "span", "passed": true, "gating": true, "detail": "one record.export span, 0 ms" },
        { "check": "outcome", "passed": true, "gating": true, "detail": "the caller saw defect; the span says defect" },
        { "check": "events", "passed": true, "gating": true, "detail": "recorded: none; declared for a defect: none" },
        { "check": "budget", "passed": true, "gating": false, "detail": "0 ms against a budget of 500 ms" }
      ]
    }
  ],
  "worldAfterwards": "destroyed",
  "ms": { "create": 20051, "scenario": 714, "checks": 219, "destroy": 8554 }
}
```

Over three runs that reached their scenario, a world took 18.9 to 20.6 s to create; over eight runs, 8.5 to 9.5 s to
destroy.

## What was learned on the way

- **Alchemy's branch migrations cannot run from this container.** `Neon.Branch`'s `migrations` setting connects on
  port 5432, and the container has no route out but HTTPS (the name does not even resolve). The runner applies
  `core/migrations` over Neon's HTTPS SQL endpoint instead, as one transaction, right after the deploy.
- **A Worker's constructor runs again inside the Worker.** `core/world.ts` is therefore evaluated at cold start. A
  Worker whose world settings were provided as a service at deploy answered 500 until `world.ts` stopped asking
  for them at runtime (`ALCHEMY_PHASE`).
- **A deploy run in-process replaces the config provider** with one built from the process environment. So the
  runner cannot pass a world's owner and expiry as Effect `Config`; it provides them as a service
  (`WorldSettings`), and nothing is written to `process.env`.
- **A create that fails half-way must still be destroyed.** `spikes/hosting` destroyed a world only once its create
  had succeeded. Here the destroy runs after any create, and it did remove a Worker and a branch left by a create
  that timed out.
- **Inside a Worker the clock only moves on I/O**, so a handler that does no I/O measures 0 ms, as the empty
  handlers do.
- A stage name longer than about 20 characters makes Alchemy shorten the Worker's name to a hash. It still starts
  with the stack's name.

## Not done

- Only the Neon branch expires by itself. Nothing yet deletes an expired world's Worker and Hyperdrive
  configuration if a run is killed outright (`kill -9`, a lost container) before its destroy.
- Scenarios run one world at a time. Running them side by side has not been tried.
- The `budget` check is recorded and does not fail a scenario.
- Logs are not kept per call; only spans and events are.
- Alchemy's state is local, so a world can only be destroyed from the checkout that created it.

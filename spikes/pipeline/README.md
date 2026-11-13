# Pipeline spike

Roadmap step 0.7: the smallest end-to-end proof that an operation can go from an Effect contract, to a scenario
that fails on an empty handler, to a pass. Four agents worked here in turn, and the separation is the point: one
built the contract, the empty server, the world and the runner; one wrote the scenarios, each failing first; one
implemented the two operations without touching the scenarios or the runner; one hardened the runner and the
world without touching the scenarios or what the handlers do. Nothing here is product code.

Built on `spikes/hosting` (Alchemy 2.0.0-beta.85 on Effect 4.1.2, deployed from an agent's container under Bun).

| Directory | What it is |
|---|---|
| `contract/` | Pure declarations: two operations of the world's record, their refusal, their event and what it carries, their budgets, and the five acceptance claims. |
| `core/` | The server: a Cloudflare Worker that serves the contract and reaches the world's Neon branch through Hyperdrive. |
| `runner/` | The generic scenario runner: a fresh world per scenario, the generic checks, a run record, and the world's destruction. |
| `scenarios/` | The five acceptance scenarios, one per claim, and the record of each failing against the empty handlers (`red-records/`). |
| `../../packages/runner/records/spike/` | The records of three full runs in a row, all passed (moved there from `green-records/` when the runner became a package). |
| `alchemy.run.ts` | The stack `CapxulSpikePipeline`. Stage `platform` owns the Neon project; every other stage is one world. |

## Run it

```bash
pnpm install --ignore-workspace
./run.sh scenarios     # every scenario in scenarios/, each in its own fresh world; exits 1 if any failed
node_modules/.bin/tsc -p .   # typecheck: fails when an operation has no handler
bun test runner        # the generic checks, the readiness wait and the warm-up resend
```

Typecheck with `node_modules/.bin/tsc -p .`. A `pnpm <script>` here used to start an install first, under the
repository's pnpm, which refused the lockfile on its release-age policy and left `node_modules` empty;
`pnpm-workspace.yaml` in this directory now turns that install off (`verifyDepsBeforeRun: false`), so
`pnpm typecheck` is safe too. If `node_modules` is ever empty, run the install line again.

A full run takes about four minutes: five worlds, each about 30 s to create (11 s of that is the wait for 20
answers in a row) and 9 s to destroy. The first run creates the `platform` stage (a Neon project, 8 s). **Destroy it when you finish**:
`./run.sh alchemy destroy --stage platform --yes`. Alchemy's state is on this machine's disk (`.alchemy/`, not
committed), so only the checkout that created a stage can destroy it. Never run `alchemy nuke`.

## What is proven (13 November 2026, from a Claude cloud container)

| Question | Result |
|---|---|
| Does the server refuse to compile without a handler for a declared operation? | Yes. `tsc` fails with `Property '"record.export"' is missing` (`core/README.md`). |
| Can a Worker written in Effect serve the Rpc group and reach the world's Neon branch? | Yes, through Hyperdrive and Effect SQL. One statement is one round trip, median 87 ms. |
| Do the five scenarios pass against the implementation, run after run? | Yes: three runs in a row, each exit 0, fifteen fresh worlds, every one destroyed (`packages/runner/records/spike/`). |
| Is a declared event written in the same transaction as the write it reports? | Yes. A temporary handler (not committed) emitted inside `sql.withTransaction`: the commit left one `app.events` row, a typed refusal inside the transaction left none. |
| Are a call's server spans kept under the trace id the caller sent? | Yes. The operation's span and every span beneath it are in `app.spans` under the `traceparent` trace id. |
| Does the runner create a world, run a scenario, check it generically, record it and destroy the world? | Yes: every record in `packages/runner/records/spike/` is one such run, about 45 s in all. |
| Does a scenario for a real claim fail against the empty handlers? | Yes. A temporary scenario for claim 4 (not committed) failed with `NotImplemented: not implemented: record.export`, and the command exited 1. |
| Does the runner check what an event carries, against what Core really stored? | Yes. A temporary handler (not committed) emitted `record_appended` with the call's key and seq for one append, an empty key for a second and seq 0 for a third. The first passed the `events` check; the others failed it, and the record names the field: `record.append's record_appended differs in key (recorded "", declared "wrong-key")`. A refused append with no event passed. |
| Is the world destroyed when the run goes wrong? | Yes, in three cases that happened: a create that timed out after the Worker was deployed, a create that failed outright, and a run interrupted with SIGINT 14 s into the create. Each left a record and no resource. |

## Hardening (13 November 2026)

With all five scenarios passing, four problems were left in the runner and the world. Each is fixed or measured
here; `packages/runner/records/spike/` holds the three full runs in a row that prove it.

### 1. A world was called ready too early

The runner took one HTTP 200 as "Core answers". A new workers.dev address does not go live everywhere at once: for
some seconds Cloudflare's edge can still answer for it with its own 404 page, between two answers from the Worker.
Reproduced with 40 probes 250 ms apart: probes 1 to 5 were answered by the Worker, probes 6 and 7 (3 s after the
deploy) by the edge with `404 text/html`, and the rest by the Worker. One full run in three had failed on this.

Now (`runner/warmup.ts`; `runner/README.md` has the detail):

- A probe is the Rpc protocol's own `Ping`, and ready means the `Pong`: an answer only the Worker's Rpc server gives.
- A world is ready after **20 such answers in a row, 500 ms apart** (about 11 s), within the create timeout. An
  answer that is not a `Pong` starts the count again.
- For **30 s after that**, and only then, a call that the edge answered (404 and not JSON, which Core never sends)
  is sent again. The Worker never saw it, so nothing happens twice. Every resend is counted in the call's `resent`.
  After the 30 s the same answer fails the call as `unanswered`. Nothing else is ever resent.

In the fifteen worlds of the three runs: 300 probes, no relapse, no call resent.

### 2. Hyperdrive answered reads from a cache

Hyperdrive caches a `select` outside a transaction for up to 60 seconds by default, so an export after appends
could miss them. The implementation worked around it by exporting inside a transaction: two more round trips.
`core/world.ts` now creates the world's Hyperdrive configuration with `caching: { disabled: true }` (Cloudflare's
API reported `{"disabled": true}` for the configurations of two live worlds), and the workaround is gone:
`RecordStore.entries` in `core/record.ts` is one bare `select`. What it returns is unchanged.

The scenarios prove both halves. With the workaround removed and the cache still on, claim 2 failed: its last
export held two entries where three had been appended. With the cache off, all five pass, three runs in a row.

### 3. Speed

The time of every call is in its run record: `serverMs`, and `steps`, the server spans beneath it.

- **Every statement is one round trip, median 87 ms** (81 to 212 ms over 253 statements; a call's first is often
  115 to 170 ms) from the Worker (eastern United States, where the runner's container is) to the branch
  (`aws-eu-west-2`, London). An accepted append is four of them (`BEGIN`, the insert, the event, `COMMIT`): 331 to
  504 ms, median 379 ms. A refused append is three: 252 to 341 ms. An export is one: 83 to 144 ms. Connecting to
  Hyperdrive takes 0 to 17 ms, median 3 ms. No other step takes time.
- **The extra 650 ms of a call in a young world is all in its first statement**: 560 to 890 ms where it otherwise
  takes 85 to 170 ms. The statements after it are normal. The likeliest cause is that Hyperdrive has no open
  connection to Neon for the call and opens one (a TLS and login exchange across the Atlantic); Hyperdrive reports
  nothing about it, so that part is inferred from the timing. In a world called ready after one answer, five of the
  first six calls paid it, and none after the world was about 10 s old.
- **What was fixed.** An export is one round trip, not three: 83 to 144 ms where it was 250 to 410 ms warm and 789
  to 1178 ms in a young world. And the wait for 20 answers takes a world past its first 10 s, so calls after the
  first no longer pay for a connection: 9 of 84 calls were over the 500 ms budget, where 20 of 28 were before.
- **What is left.** In 7 of the 15 worlds the first call still paid for a connection (its first statement took 638
  to 893 ms), and in one world the second call did too. The wait cannot reach it, because a probe never touches
  the database. A probe that ran one statement through Hyperdrive would, but Core would need a route for it
  outside the contract, and that is a choice about Core, not a repair. Beyond that, an append is four round trips
  of 85 ms because the Worker and the database are an ocean apart; where worlds live is also not decided here.
- The budget is still recorded and still does not gate.

| Server ms | Before (one run, 28 calls) | After (three runs, 84 calls) |
|---|---|---|
| Accepted append | 334 to 1416, median 850 | 331 to 1305, median 384 |
| Refused append | 250 to 1089, median 328 | 252 to 341, median 287 |
| Export | 391 to 1178, median 834 | 83 to 839, median 117 |
| Calls over the 500 ms budget | 20 of 28 | 9 of 84 |

### 4. Leftovers

`core/README.md` described the empty handlers; it now describes the implementation. The runner's smoke scenario
expected the empty handlers and could only fail; it is deleted, with its `./run.sh smoke` command.
`./run.sh scenarios` is the proof.

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
  handlers did.
- **One good answer does not mean an address is routed**, and Hyperdrive caches reads unless told not to
  ("Hardening" above).
- A stage name longer than about 20 characters makes Alchemy shorten the Worker's name to a hash. It still starts
  with the stack's name.

## Not done

- Only the Neon branch expires by itself. Nothing yet deletes an expired world's Worker and Hyperdrive
  configuration if a run is killed outright (`kill -9`, a lost container) before its destroy.
- Scenarios run one world at a time. Running them side by side has not been tried.
- The `budget` check is recorded and does not fail a scenario.
- The first call in about half of all worlds is slow, because nothing has used the world's database before it
  ("Speed" above).
- Logs are not kept per call; only spans and events are.
- Alchemy's state is local, so a world can only be destroyed from the checkout that created it.

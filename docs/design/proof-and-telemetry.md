# Proof and telemetry

Status: agreed with Aaron, 15 November 2026 (`docs/roadmap.md`, decision "Proof and telemetry").

Design thread for proof and telemetry, 15 November 2026. This is a design for Aaron to decide on: no code changed and
no world run. It answers what proof is and where it lives, what each telemetry signal is, how each is emitted and
where it goes, how cost is measured, and how we move there by "side by side, then flip, then retire". The decisions
it needs are at the end, each with a recommendation.

Read for it: `AGENTS.md`; `docs/roadmap.md` (decisions "Measurement is part of the contract", "Measurement is
declared", "Typed once, by check", "Generated, never typed twice"; steps 1.2, 1.13, 4.1 to 4.3); Core's telemetry
(`packages/core/src/telemetry/`, `migrations/0001_telemetry.sql`); the runner's read-back and checks
(`packages/runner/src/world/database.ts`, `src/checks/checks.ts`); `packages/status-feed`; `.github/workflows/`;
the speed thread's note (`design-notes/speed.md` on `design/speed`); Effect 4.1.2's `effect/observability` module;
and Capxul Classic's telemetry (`xelmar-tech/infrastructure`: `packages/observability`, the backend's collector and
observation layer, the `prove-it` and observability skills).

## The plan, as Aaron agreed it (15 November 2026)

1. **Land what is in flight.** Every open slice and work branch lands by its own pull request when green.
   No new lanes start.
2. **Blueprint first, in one session with Aaron in the loop.** It finishes the blueprint so Aaron can watch the
   developer experience and its legibility as they emerge. It covers:
   - the blueprint's purpose and contents;
   - its enforcement;
   - one file per operation;
   - the telemetry vocabulary;
   - generated indexes;
   - the repository's layout;
   - the roadmap restacked.
3. **Then ratchet the existing code** into agreement with it, in parallel lanes, changing no behaviour.
4. **In parallel with 3, instrument the existing code in its own session.** The world package is not redesigned. Its
   work (world make, reset, snapshot, site claim, starting worlds, journeys) is declared in the blueprint and
   instrumented to match, so every second of a run is measured before anything is redesigned.

This note is that plan's chapter on proof and telemetry. Section 0 is its chapter on the blueprint.
`telemetry-in-the-blueprint.md` is its chapter on the fundamentals, Axiom, and how the blueprint owns every name
and dataset so that drift fails CI.

Answered by Aaron since: the sink is **Axiom**, with no trial (decision 4); agents run on subscriptions, so model
cost is estimated from Claude Code's own telemetry, with no admin key (decision 6); a session is whatever drove the
work.

## The model

Aaron asked for one cohesive way of doing things, not a list of fixes. This is it. Every signal, cost and proof
included, goes through the same four stages, and every current use of the JSON records is a read from one of the
keeps. The rest of the note is this model worked through.

```
  EMIT                      ROUTE                         KEEP                           CONFIRM
  one format: OTLP,         one door per stage,           three keeps, each one job:     every keep is read back:
  one vocabulary:           one routing table              tap     per world, minutes,    the run reads the sink
  the blueprint's           (signal × grade → sinks),      for the runner's checks        before its verdict; the
  attribute names           configuration only,            sink    weeks, queryable       feed verifies verdicts
                            holds every key                ledger  forever: verdicts on   against GitHub; the door
  span · log · event ·      stamps world and grade         `proofs`, OTLP archive in R2   counts what it forwarded
  metric                                                                                  and what failed
```

**1. Emit: one format and one vocabulary.** Everything is an OpenTelemetry record, of one of four kinds:

| Kind | What it carries | Examples |
|---|---|---|
| Span | Work, timed, with its outcome | an operation, a declared step, a journey, a reset; an error is a span's `ERROR` status with an exception on it |
| Log | A decision and why, with a declared schema | the log that decides a refusal |
| Event | A named fact (OpenTelemetry's event: a log record with `event.name`) | a declared event once its transaction commits; a check's result; **a verdict** |
| Metric | A number over time | durations, counts, **cost** |

Our code emits through Effect's own exporters. What our code cannot see is emitted by a collector in the same format:
the daily cost job writes cost as metrics; Cloudflare's own tracing adds platform spans. Attribute names come from
the blueprint, OpenTelemetry's conventions first. So there is one way to emit anything, and it is checked like every
other declared name (3.3).

**2. Route: configuration, in one place.** Every producer sends to the door of its stage and nowhere else. The door
holds the keys and stamps the envelope (below), so no producer can misstate it. It forwards by one routing table that
`packages/platform` owns. Every world gets every signal, product events included (Aaron, 15 November 2026): a test
world's events are how a failed run is debugged and how a slow one is improved. Test and real are kept in separate
sinks, never filtered apart inside one:

| Records | Test grades (private, shared) | Real grade |
|---|---|---|
| Spans, logs, metrics (cost included) | test sink | real sink |
| Events: declared events, as product events | test analytics sink | real analytics sink |
| Events: checks and verdicts | test sink | (none: real worlds run no journeys) |

Choosing or adding a sink is a row of this table and a key in the door, never a change to a producer.

**The envelope: every record is tagged to its session.** One set of attributes, declared once in the blueprint and
stamped at the door, so any record can be traced back to who and what made it, and any session can be asked for
everything it caused:

| Attribute | What it names | Set by |
|---|---|---|
| `capxul.session` | What drove the work: an agent's session, a CI run, or a person's sign-in in a real world | The caller's own resource attribute, checked by the door against its token |
| `capxul.world`, `capxul.grade`, `capxul.stage` | Where it ran | The door, from who called it |
| `capxul.run`, `capxul.journey`, `capxul.journey.step` | Which run, journey and step, in a test world | The runner, carried to Core in the trace's baggage |
| `vcs.ref.head.revision`, `vcs.ref.head.name` | Which code | Each producer's resource, from its deploy |
| trace and span id | Which call | OpenTelemetry |

So "show me everything session X caused" is one query across traces, logs, events and cost, in any world.

**3. Keep: three keeps, each with one job.**

- The **tap**, in each test world's database: the world's own OTLP, there within a second, gone with the world. It
  serves the runner's per-call checks.
- The **sink**: everything, queryable by people and agents, for weeks. It serves debugging, speed, the evals' trends,
  cost, and "deploy, then watch".
- The **ledger**: what must outlive the sink. Verdicts on the orphan branch `proofs`, and each CI run's OTLP archived
  in R2 under the verdict's digest. It serves the Proof column and the dashboard.

Declared events are also kept as state in the world's database (`app.events`), in the same transaction as the change,
because the system and the runner depend on them exactly once. That is the world's own data, not a fourth keep: the
event record the model routes is emitted from it after commit.

**4. Confirm: nothing counts until it is read back.** An HTTP 2xx from a sink is not proof that it kept anything
(Classic learned this). So:

- the door counts, per stage and trace, what it forwarded and what each sink refused, as metrics of its own;
- a proving job, before writing its verdict, reads the run's traces back from the sink and records in the verdict
  how many spans, logs and events arrived against how many were sent; a verdict whose telemetry did not arrive says
  so, and does not count;
- the status feed verifies every verdict against GitHub every hour (section 2);
- the cost job emits one heartbeat a day, and a missing day shows on the dashboard.

**What proof is, in the model.** A verdict is an event like any other, emitted by a trusted run: it goes through the
door to the sink, and it is also written to the ledger and notarised by a GitHub check. Proof is not a separate system;
it is the one record we keep forever and can verify from outside.

**What the records become, in the model.** Each use is a read from a keep: the runner's checks read the tap; the Proof
column and the dashboard read the ledger; the speed analysis, the evals' trends, debugging and cost read the sink; and
a run older than the sink's retention is read from the archive (section 9).

**Where the model comes from: the blueprint.** The model holds only if the blueprint declares every part of it and
the ladder fails what is not declared. Today it does not, and that is the root cause, not the records. Section 0
says why and what changes.

The note works through the model in this order: the blueprint (0), proof (2, 3), the signals (4), emitting (5),
routing and the sinks (6), the tap (7), cost (8), the uses of the records (9), the move (10).

## 0. Why the blueprint does not enforce this today, and what changes

Aaron's question: what is wrong with the blueprint, such that measurement is not enforced and not all one way?
Read from `packages/blueprint` on `master`:

1. **It declares the outside of an operation only.** An operation's declaration (`src/operation.ts`) is its Rpc, the
   events of each outcome, one budget and examples. Its steps, logs, machine, who may call, and its telemetry are not
   declared, so Core makes them up: 176 different span names are written as strings across Core, the world, the
   platform and the runner. Nothing can check what was never declared. Steps 3.4, 4.1 and 5.1 add these one by one,
   each as a separate format.
2. **The slow part of a run is not in the blueprint at all.** The 47-minute run is mostly making worlds, starting
   worlds, snapshots, resets and sites (`design-notes/speed.md`), not the product's operations. Only `world.create`
   and the snapshot calls are declared operations. Resets, site claims and the making of starting worlds are code in
   `packages/world` and the runner with ad hoc spans; the speed thread found a 4.7 s request in every save inside
   no named span. What is not declared is not measured, and what is not measured cannot be cut to 10 minutes.
3. **There is no telemetry vocabulary.** `src/telemetry.ts` holds headers and middleware. The envelope above, the
   step kinds and the attribute names have no owner, so each producer invents its own.
4. **Measured facts are typed by hand.** A budget's `provisional` and `basis` are typed prose ("the bench is not
   measured yet"), where they should be generated from measured runs.
5. **One operation is spread over six files.** `operations.ts`, `refusals.ts`, `claims.ts`, `subjects.ts`,
   `order.md` and a rendered `claims.md`, per domain, plus `decisions.md` (398 lines), `gaps.md` and `order.md` at the
   top. To understand `doc.submit` you open six files. Hand-written maps drift: the blueprint's README lists the
   domain folders twice, once with `board` and once with `budgets`, and `subjects.ts` twice, likewise.

### What changes: one declaration per operation, holding the whole model

Each operation is one file that declares everything about it, and a format check fails the file when a part is
missing (3.5, `pnpm delta:check`):

```
src/<domain>/<operation>.ts
  rpc          payload, answer
  outcomes     each kind of success and the events it sends (events carry the envelope)
  refusals     each with its exit code; from each machine state a move cannot start from
  machine      the moves it makes (3.4)
  allowed      who may call (5.1)
  steps        its spans, each with a kind: database, site, chain, bundler, wait (4.1)
  logs         each with a schema, including the one that decides each refusal (4.1)
  budget       the target; whether it is measured, and its p95, are generated from the sink, never typed
  examples, claims
```

The same format declares **the pipeline's own work**: creating, resetting, saving and restoring a world, claiming a
site, making a starting world, running a journey. These become declared operations of the platform group (or
declared steps of one), with their steps and budgets. Then a whole run has a declared budget too: **10 minutes**,
provisional until measured, as Aaron set it. The explainability measure (4.2) covers the whole run, not only Core's
calls: the share of a run's wall time inside declared spans. The goal is every second of a run accounted for, so the
speed work can see where each minute goes.

The telemetry vocabulary is a blueprint module: the envelope, the attribute names, the step kinds, the routing
table's record kinds. Producers import them; a lint rule fails a span name or attribute written as a string (3.3).

### One obvious way to find everything

- **The map is generated, never written by hand.** `pnpm generate` writes one index per level from the declarations:
  the blueprint's index (its domains, one line each), each domain's index (its operations, machines and events, one
  line each), and each operation's page (everything above, with its diagram). Nothing hand-written lists files, so
  nothing drifts.
- **Progressive disclosure, three levels.** Level one: each README is one screen: what this is, the map, where to go
  for what. Level two: a domain's index. Level three: an operation's file and page. A reader stops at the level that
  answers them.
- **The same folder shape everywhere.** Every domain has the same files: `index.md` (generated), `values.ts`,
  `machines.ts`, and one file per operation. Every package has a one-screen README; detail goes in `docs/` pages, one
  task each. The shape rung checks both (a README over 60 lines fails, as a source file over 300 does). Today's
  READMEs run 222 to 607 lines (Core, the runner, the platform, the world).
- **One home per decision.** Decisions Aaron agrees stay in the roadmap. The blueprint's `decisions.md`, `gaps.md` and
  `order.md` are folded in: a lead's design calls become comments on the declarations they explain, gaps become
  coverage (which the runner already reports), and the build order is generated from what each operation needs.

How this lands: it is not a rewrite. The per-operation file is the 3.5 format, introduced by the ratchet: new
operations use it from the day it lands, old ones move over in the same slice when cheap, and an `unmigrated` list
shrinks.

## 1. What is wrong today, restated as requirements

| Today | Requirement |
|---|---|
| Run records committed to git: 37 MB in `packages/runner/records` (173 files, 1.8 MB per CI run), noisy diffs, merge conflicts | Run data is not committed. What is committed is small and append-only |
| A committed file with `"outcome": "passed"` is proof; nothing ties it to a trusted run | A proof can be verified by anyone, from outside the repository, and cannot be made by hand |
| Container runs committed, CI runs uploaded as artifacts that expire in 90 days | One home for every proof, and one for every run's detail, with a stated retention |
| Every question is a script over JSON files | Run data is queryable, across runs, by people and agents |
| Our own span and timing format (`app.spans`, `timing`, `steps`) beside OpenTelemetry's | OpenTelemetry is the format. Ours only where OpenTelemetry has nothing: the verdict |
| Spans destroyed with the world | History across runs and worlds, with a viewer |
| Kept: an immutable record of what was proven, tied to a commit; per-call checks, per world, at once, isolated | Kept |

## 2. What proof is

### Options weighed

| Option | Trustworthy? | Lives where | Cost | Verdict |
|---|---|---|---|---|
| A. Records in git written by anyone (today) | No: any agent can commit a passing file | Git | Repo bloat | Replace |
| B. CI check results on a commit | Yes: only a workflow run can set a GitHub Actions check | GitHub, permanent with the commit | Free | The notary, not the store: a check holds a status and a short text, not the detail, and listing them across history is many API calls |
| C. Signed records (GitHub artifact attestations, Sigstore) | Yes, cryptographically | Attestation API, plus wherever the record is stored | Free on public repositories; on a private repository it needs GitHub Enterprise Cloud | Too much for what it adds over B, and likely unavailable on our plan |
| D. Records in git produced only by CI | Only if pushes are restricted, which needs repository rulesets (a paid plan on a private repository) or a check like B | Git | Bloat if the records are full | Good for small verdicts, bad for full records |

**Recommended: B and D together, with the detail moved out.** A verdict is small (D), produced only by CI, and
notarised by its check (B). The detail is telemetry (section 4), archived by digest. Signing (C) is not needed: GitHub
already vouches for which workflow ran on which commit.

### The verdict

A verdict says, for one proof, what one trusted run showed. Its schema is ours, because OpenTelemetry has no notion
of "what was proven", and it is declared once, in the runner (it is what the runner concludes), and imported by the
status feed's tests through a generated JSON Schema.

```
{
  "proof": "journeys/thin-line",        // the proof's name, declared (below)
  "outcome": "passed",                   // passed | failed
  "commit": "<sha>",                     // the commit the run tested
  "ref": "refs/pull/261/merge",          // what the workflow was started on
  "run": { "workflow": ".github/workflows/world.yml", "id": 43611871280, "attempt": 1 },
  "grade": "private", "world": "w-tpl-9ca547",
  "startedAt": "...", "endedAt": "...",
  "counts": { "journeys": 3, "passed": 3, "steps": 27, "checks": 240 },
  "failed": null,                        // or the journey, step and check that failed, in words
  "scores": { "explainability": null },  // 4.2, when it lands
  "telemetry": { "traceIds": ["..."], "archive": "sha256:<digest of the OTLP archive>" }
}
```

A verdict is a few kilobytes. It holds what must outlive any sink's retention; everything else is in the telemetry.

### A proof's name

Every proof is named and declared once, with the command that makes it: the thin line's journeys, each journey set,
a package's proof command (`world` sweep, race, keep; the platform's drift). One table, read by the proving workflow,
by the status feed and by a test that every `proof:` in the roadmap names a declared proof. The roadmap's Proof
column then names `proof:<name>` (or `check:<command>`, unchanged), never a file path.

### What makes a verdict trustworthy

A verdict counts only when all of these hold, and the status feed checks each one every hour:

1. It names a workflow run of this repository, made by the GitHub Actions app, from a workflow file declared as a
   proving workflow.
2. That run's head commit is the verdict's commit, and the run concluded `success` for a passing verdict.
3. The run set a check named `proof/<name>` on that commit whose text carries the verdict's digest. Only a workflow
   can create a GitHub Actions check, so the digest ties this exact file to that run.
4. The commit is on `master` (an ancestor of its head) when the step is to count as Done.

What this protects against: an agent writing or editing a result; a result from an agent's container passed off as
CI's; stale evidence. What it does not protect against: a change to the proving workflow or the generic checks
themselves, which runs in that pull request's own CI. That is a review question, as it is today ("a builder must not
change the scenarios or the runner's generic checks"). A `CODEOWNERS` entry naming Aaron or the lead for
`.github/workflows/`, `packages/scenarios/` and `packages/runner/src/checks/` would make the reviewer explicit
(decision 8).

### Runs from agents' containers

They are evidence for the agent, never proof. They export telemetry like any run (marked `capxul.run.trusted=false`),
so they can be queried and compared, but they make no verdict. Anything a step needs proven runs in CI: a proving
workflow, `prove.yml`, started by hand (`workflow_dispatch`) with a declared proof's name, runs that proof's command
and writes its verdict. Steps 1.6, 1.10, 2.3 and 2.4 were proven from containers; under this design they would have
been proven by `prove.yml`. That spends Actions minutes, which are capped (decision 3).

## 3. Where proof lives and how it is found

| What | Where | Written by | Retention |
|---|---|---|---|
| Verdict | `proofs` branch (orphan, never merged): `verdicts/<yyyy-mm-dd>/<proof>/<run>-<attempt>.json` | CI only, as the last step of a proving job | Forever (kilobytes each) |
| Notary | The check `proof/<name>` on the commit, with the verdict's digest | The same job | Forever, with the commit |
| Run detail | The sink (section 5), queried by trace id, run, journey, commit | Core, the runner, the world, as OTLP | The sink's retention (30 days or more) |
| Archive | R2 bucket `capxul-telemetry-archive`, one OTLP JSON file per CI run, named by its digest | The proving job, from the OTLP the runner and the tap hold | 180 days, by a lifecycle rule (decision 5) |
| Legacy records | Where they are now (`packages/*/records/`), frozen | Nobody from the flip | Kept: they are the proofs of the steps already Done |

Why an orphan branch and not `master`: verdicts never conflict with product work, never show in a pull request's diff,
and `master` stays free of bot commits. Why git at all: verdicts are small, immutable, ordered, tied to commits,
readable offline and greppable, and they outlive any vendor.

**The Proof column and the dashboard.** `status-feed` reads `proofs`, verifies each verdict as above through GitHub's
API, and works out each step's state: Done when a verified, passing verdict of the proof it names is on a commit on
`master`; the time it was done is when that commit landed on `master`. A step marked Done with no verified verdict
shows as Claimed, as today. A `check:` proof stays as it is, and is tightened to "the `gate` check passed on the
commit where the step landed".

**How we know it is there.** The hourly feed verifies every verdict and reports any that fail verification, by name,
on the dashboard. A `check:` in CI, `pnpm proofs:check`, fails a pull request whose roadmap names a proof that is not
declared, or names a file path for a step not already Done.

## 4. The signals

| Signal | What it is | Emitted by | Format | Goes to | Belongs with |
|---|---|---|---|---|---|
| **Traces and spans** | What a call did inside, timed: the operation's span, its declared steps (4.1), library spans | Core, the SDK and CLI (caller spans), the runner, the world and platform code | OTLP traces | The stage's telemetry door, then the sink; in test worlds also the tap | Logs and metrics |
| **Logs** | What a call decided and why, with a declared schema (4.1): the refusal's deciding log, warnings | Effect's `Logger`, inside spans | OTLP logs, carrying the trace and span id | As traces | Traces |
| **Errors** | A call that failed for a reason nobody declared: a defect, an undeclared failure, an interruption, a timeout | Not emitted separately: the span's status is `ERROR` with an `exception` event (type, message, stack), and an error log | Inside OTLP traces and logs | As traces; error tracking is a view the sink builds | Traces |
| **Declared events** | The facts the blueprint declares an operation sends (`invitation_declined`) | Core: kept as state in `app.events` in the change's own transaction, then emitted as an OpenTelemetry event after commit, under the call's trace | OTLP event, its attributes the blueprint's event schema | Through the door like everything else; the tap in test worlds | Spans (same trace) |
| **Product analytics** | Who did what, as people and companies, for funnels and retention | Nobody separately: it is the declared events of every world, routed by the door to the analytics sink of its grade | As declared events | The test or real analytics sink, by the routing table | Declared events: it is a route, not a signal |
| **Runtime metrics** | Counts and durations over time: calls per operation, durations, refusals, errors | Derived from spans in the sink, or by Effect's `Metric` where a span cannot show it | OTLP metrics | Through the door | Spans |
| **Cost** | Money and usage per world, run, journey, lane and day | The daily cost job, a collector: it pulls from Cloudflare, Neon, GitHub and the agents' telemetry, and emits | OTLP metrics (`capxul.cost.usd`, `capxul.usage.*`) | Through the door | Metrics |
| **Checks and verdicts** | What the runner judged: each check's result, and each run's verdict | The runner and the proving job | OTLP events | Through the door; the verdict also to the ledger | Spans of the run |

### Why one pipeline holds them all

- **They describe the same calls.** Spans, logs, events and errors of a call share its trace id and the same resource
  attributes, and are read together when a call is explained (4.2). Classic sent product events by one path and spans
  by another, and its catalog and code drifted apart; one path is what prevents that.
- **What differs between them is routing, not emitting.** Product analytics is the declared events routed to
  one more sink, so no handler emits a second, hand-typed analytics event ("Generated, never typed twice").
  Privacy differs by route too: the analytics route carries only ids and drops sensitive fields.
- **Declared events keep their guarantee.** They are kept exactly once, in the change's transaction, in the world's
  database, because the system and the runner depend on them. The pipeline carries their copy, which may be delayed
  or sampled. The runner checks the state; the sink is for reading across runs.
- **Cost is the same kind of record from a different producer.** Only the providers know it, so a collector emits it.

### Refusals are not errors

A refusal is a declared outcome: the span's status stays unset, with `capxul.outcome=refused` and
`capxul.refusal=<tag>`, and the deciding log (4.1). Only what nobody declared sets `ERROR`. So the sink's error view
shows bugs, not people being told no, and an alert on any error in a real world means something. Classic kept the same
split (expected outcomes apart from exceptions), and it is worth keeping.

### Names and attributes are declared once

Attribute names are facts, so the blueprint owns them (a `telemetry` module beside the operations), and code imports
them. Where OpenTelemetry's semantic conventions have a name, we use it: `service.name`, `service.version`,
`deployment.environment.name`, `vcs.ref.head.revision`, `cicd.pipeline.run.id`, `rpc.method`, `db.*`, `exception.*`,
`cloud.region`. Ours are under `capxul.`:

- on every span, by resource or stamped by the door: `capxul.world`, `capxul.grade`, `capxul.stage`;
- on the run's spans: `capxul.run`, `capxul.journey`, `capxul.journey.step`, `capxul.run.trusted`;
- on an operation's span: `capxul.operation`, `capxul.operation.version` (6.1), `capxul.outcome`, `capxul.refusal`,
  `capxul.caller.role` (5.1), `capxul.budget.ms` (the declared budget, imported, provisional);
- on a step's span: `capxul.step.kind` (database, site, chain, bundler, wait), so the waits a budget leaves out follow
  from the record;
- on Core's operation span: the Cloudflare colo, which the speed thread needs to settle why some runs are twice as
  slow (`design-notes/speed.md`, change 2).

**Privacy.** No email, name or free text from a person goes into an attribute or a log, in any grade. A person is an
id. A declared log field marked sensitive in its schema is dropped by the exporter. Real worlds' ids are those real
Core already holds; nothing is added that could link them to an email (Classic kept hashed emails on some events, which
can be linked back to a person; we do not).

## 5. How each signal is emitted

### From Effect code (the runner, the world, the platform client, the CLI)

Effect 4.1.2 ships `effect/observability`: `Otlp.layer` exports traces, logs and metrics over OTLP/HTTP through
Effect's own `HttpClient`, with a shared `Flusher`, and needs no OpenTelemetry SDK, so no non-Effect runtime
dependency is added. `Effect.fn` spans (4.1's declared steps), RPC spans and `Effect.log*` become OTLP as they are.
Each process provides the layer once at its entry, from configuration (section 6). Tests provide an in-memory tracer,
as Core's tests keep spans in memory today.

The runner's own run is a trace: a root span per run, a span per journey and per step, the caller's span per call
(already joined to Core's by the `traceparent` header the SDK sends), and each check as a span event with what it says
and whether it passed. The runner's `oneWorld.timings` (world create, starting worlds, resets and their parts) are
spans of the runner's and the world's code. So the run record becomes a query, and nothing is lost.

### From Core on Cloudflare Workers

- Core provides `Otlp.layer` with its base URL pointing at the telemetry door, reached through a **service binding**:
  no public route and no credential. It calls the `Flusher` inside `ctx.waitUntil` after the answer is sent, so export adds nothing to the caller's
  time or to `serverMs`.
- In test worlds (private and shared), a second exporter writes the same OTLP into the world's database: the **tap**
  (section 7). In real worlds there is no tap.
- **Cloudflare's own tracing.** Workers can trace themselves (fetches, subrequests, Durable Objects, CPU and wall
  time) and export it over OTLP to a destination. It sees what Effect cannot (CPU time, cold starts, an exception that
  escapes Effect) and nothing of our declared steps. Recommended: turn on Workers Logs and traces for Core and the hub
  as a second, platform-level view, exported to the same sink, never required by a check. Whether Cloudflare's spans
  continue the caller's trace id has to be tried before anything relies on it.

### The telemetry door

One Worker per platform stage (`staging`, later `production`), deployed by `packages/platform` with the stage's sink
key as its secret. It is Effect's `OtlpProxy`, which mounts `/v1/traces`, `/v1/logs` and `/v1/metrics` and forwards
the body unchanged with the configured headers, plus two things of ours:

- it stamps `capxul.world`, `capxul.grade` and `capxul.stage` from who called it (the service binding says which
  world's Core it is), overwriting anything the caller sent, so a test world cannot write into a real sink's view as
  a real world;
- callers outside Cloudflare (the runner in CI or a container, the CLI, agents' sessions) reach its public route with
  their operator's platform token, the way they reach the platform today.

Fan-out to a second sink, scrubbing and sampling can be added in the door later without touching any world. Classic
ran an OpenTelemetry Collector container for this; the door is that, made from a library we already have, on the
compute we already run.

## 6. How a sink is configured

Where telemetry goes is a fact of "what runs where", so `packages/world` and `packages/platform` own it. Code reads
only the standard settings (`Otlp.layerFromConfig`: an endpoint, and whether each signal is on).

| Where | Traces, logs, metrics | Tap | Product analytics | Sampling |
|---|---|---|---|---|
| Unit tests (rung 5) | In memory | No | No | All |
| Private world (test) | `staging` door, then the **test sink** | Yes | Yes, test analytics sink | All |
| Shared world (test) | `staging` door, then the test sink | Yes | Yes, test analytics sink | All |
| CI | The runner exports to the `staging` door with the run's attributes (`cicd.pipeline.run.id`, commit, ref); the proving job archives the run's OTLP to R2 | As its world | As its world | All |
| Agent's container | As CI, marked untrusted, tagged with the agent's session | As its world | As its world | All |
| Real world | `production` door, then the **real sink**: a separate project or dataset with its own key, never shared with test | No | Yes, derived from declared events | All to start; errors and refusals always kept if sampling comes |

Two sinks, one per grade group, not one sink filtered by a property: Classic's single PostHog project for every
environment held 76% localhost traffic by its own count, and kept real people's data beside test noise.

### Choosing the sink

The design does not depend on the sink. What a sink must do, in order:

1. Take OTLP traces, logs and metrics over HTTP.
2. Answer queries by trace id and by attribute, through an API an agent can call, within seconds of ingest.
3. Keep at least 30 days.
4. Cost nothing at our volume (a run is a few thousand spans; a busy day is well under a million).
5. Show a trace waterfall to a person.

PostHog takes OTLP traces, logs and metrics (Classic sent all three to its `/i/v1/` endpoints) and has a query API, so
it is one candidate; general observability services with free tiers are others. Recommended: a one-day spike that
exports the same CI run to two candidates and judges them by the list above, with ingest delay and query answers
measured (decision 4).

## 7. How the runner keeps its per-call checks

The runner needs every call's spans and logs right after the call, from its own world only. A sink cannot give that:
ingest takes seconds to minutes, a vendor outage would fail the gate, and queries cost. Core cannot push to the
runner either: the runner has no inbound route, and Cloudflare is never given one into an agent's container.

So in test worlds Core keeps a **tap**: the same OTLP it exports, written into the world's database
(`telemetry.otlp`: the trace id, the signal, and the OTLP JSON as OpenTelemetry defines it), off the request path in
`ctx.waitUntil`. The runner reads it by trace id, as it read `app.spans` until the retire, retrying briefly until the operation's
span is there. It is per world, at once and isolated, as today, and destroyed with the world, which is right: history
lives in the sink and the archive.

The generic checks are rewritten as functions over OpenTelemetry spans and logs (name, parent, status, attributes,
events), decoded from OTLP JSON by one schema at one edge file. Their source is the tap during a run and the sink
after a deploy, so "deploy, then watch" runs the same checks on what production records. Declared events are still
read from `app.events`.

Alternatives weighed: Core returning the call's spans in its answer (the operation's span is not finished when the
answer is encoded, and work in `waitUntil` would be missed); a Durable Object per world as the tap (faster, but one
more moving part, and the database already gives isolation, transactions and the runner's read path).

## 8. How cost is measured

A daily job (`cost.yml`, and on demand from the dashboard's task) pulls usage, prices it, attributes it and writes it
to the sink as metrics, with a summary on the dashboard. It replaces nothing of the limits that keep the cap today
(hub capacity, lifetimes, destroy and sweep); it measures whether they work.

| Source | How | Attributed by |
|---|---|---|
| Cloudflare | The GraphQL Analytics API (Workers invocations, CPU and duration by script; Durable Objects; containers; R2 operations and storage) through `api.cloudflare.com`, which the proxy already authenticates; priced from the published price list | Script and object names carry the world (Core's script, the hub's object names); a hub's shared cost is split by its worlds' hours |
| Neon | The consumption API through `console.neon.tech` (compute seconds, written data and storage, hourly, per branch) | One branch per world |
| CI minutes | GitHub's run timing for each workflow run (billable milliseconds), read by the proving job at its end and by the daily job | Workflow run, then its journeys by their share of time |
| Model cost | Claude Code exports its own OpenTelemetry metrics (tokens and cost per session) when its telemetry is turned on; the agents' environment sends it to the door with the session's lane and branch as resource attributes. If agents run on API billing, the Anthropic cost report is the reconciliation, which needs an admin key (decision 6) | Session, lane, branch, pull request |

The job compares each day's total with the $10 cap and raises a task when a day passes 80% of it. A month's figures are
checked by hand once against the invoices, so the price list stays honest. 4.3's "cost per journey" is a query over
these metrics.

## 9. What each use of the JSON records becomes

| Use today | Reads today | Becomes |
|---|---|---|
| The Proof column | A committed file whose `outcome` is `passed` | `proof:<name>`, made by a verified verdict on `proofs`. Legacy paths stay valid for steps already Done |
| The dashboard (`status-feed`) | Proof files in git, landing times from git | Verdicts on `proofs`, verified against GitHub; landing times from `master` as now. Adds a daily spend line from the cost job |
| The runner's per-call checks | `app.spans`, `app.events` | The tap (OTLP) and `app.events` |
| The speed analysis (`design/speed`) | `summary.json`'s `oneWorld.timings`, each call's `timing` and `steps` | Queries over the sink: durations by operation, step and step kind; reset and make parts from the runner's spans; the colo on Core's span; across all runs, not the ones someone committed. Until the flip, the records stay as they are, so that thread loses nothing |
| 4.2, the explainability eval | (not built) | A function over one journey's OTLP: every refusal has its deciding log, every span its parent, the share of each call's time in declared steps. The runner computes it from the tap and writes the score into the verdict; it can be recomputed from the archive |
| 4.3, the build evals | (not built) | Tries to green and breakage and recovery from the verdict ledger (every verdict, passed or failed, per proof and commit, is on `proofs`); speed from the sink; cost from the cost metrics |
| Debugging a failed run | Download the CI artifact, read the JSON | Open the run's trace in the sink by the trace id in the verdict and in the job's summary; after the sink's retention, the archive |

## 10. How we move there

Side by side, then flip, then retire, as `AGENTS.md` says. Nothing in a slice changes what a journey proves.

**Side by side**

1. **The vocabulary.** The blueprint declares the telemetry attribute names; the runner declares the verdict schema
   and the table of proofs.
2. **OTLP out.** Core, the runner, the world and the platform client provide `Otlp.layer`. The telemetry door on
   `staging`, with the test sink's key (Aaron's credential). Core also writes the tap, beside `app.spans`.
3. **Parity.** The runner reads both `app.spans` and the tap and a check of the runner's plumbing fails when they
   disagree for any call; the run record carries both. Every journey stays green.
4. **Verdicts.** The proving jobs write a verdict, set the `proof/<name>` check, append to `proofs` and archive the
   OTLP in R2, beside the records they upload today. `prove.yml` for proofs not yet in a workflow. The status feed
   accepts `proof:<name>` beside paths.
5. **Cost.** The daily job reports; nothing fails on it.

**Flip** (one pull request, nothing else in it): the runner's checks read only the tap; the runner stops writing run
records into the repository (it writes them to its temporary directory and the archive); `packages/*/records/` gets
no new files, checked by `pnpm shape`; the roadmap requires `proof:` or `check:` for any step not already Done; the
Proof column of steps not yet Done is rewritten to `proof:` names.

**Retire** (a later pull request, once the runs show nothing reads them): Core's `SqlSpanSink` and `app.spans` (a new
migration drops the table; the applied one is not edited); the runner's JSON record writer for anything the verdict
and the telemetry now hold; `upload-artifact` in `world.yml`. Optionally, later, the legacy records move to the
`proofs` branch under `legacy/`; history keeps them either way.

### Effect on the steps in flight

- **Lane B (3.3 to 3.5)** is unaffected. 3.3's rule that declared names are imported covers the new attribute names.
- **4.1 (declared steps and logs)** goes the right way if, and only if:
  - its logs go through Effect's `Logger` and are read from the tap, not from a new table of ours (an `app.logs`
    would be a second own format);
  - its generic checks are written over OpenTelemetry-shaped spans and logs (an interface in the runner), not over
    `app.spans`'s columns;
  - a step's kind is the attribute `capxul.step.kind`, its name the span's name, both imported from the blueprint.

  4.1's declarations and its lint rule need nothing from this design and can start when 3.3 lands. Its run-time
  checks of logs need the tap (step 4.4 below). I am telling the conductor now.

## 11. What it changes in the roadmap and `AGENTS.md`

**Roadmap, a new decision** "Proof and telemetry" (wording for the pull request once agreed): every signal, cost and
proof follow one model, emit, route, keep, confirm. Everything is an OpenTelemetry span, log, event or metric with the
blueprint's attribute names; every producer sends to its stage's telemetry door, which routes by one table of
configuration (signal and grade to sinks) and holds every key; three keeps (the tap per test world, the sink per grade
group, the ledger of verdicts on `proofs` with each CI run's telemetry archived by digest); and nothing counts until it
is read back. Proof is a verdict, an event only CI emits, notarised by GitHub. Declared events stay state in the
world's database and are emitted after commit; product analytics is their route to the analytics sink of each grade, in every world;
cost is emitted by a daily collector. It amends
"Measurement is part of the contract" (run data is stored in the sink and archive, not the repository).

**Roadmap, phase 4** keeps 4.1 to 4.3, so the references to them in `AGENTS.md` and phase 5 still hold, and adds:

| Step | What | Needs |
|---|---|---|
| 4.4 | Telemetry is OpenTelemetry: Core, the runner, the world and the platform client export OTLP through Effect's exporters; the telemetry door on `staging`; the test sink; the tap in test worlds, read by the runner side by side with `app.spans`, then flipped and `app.spans` retired | 1.2 |
| 4.5 | Proof is a verdict: the proving workflows write verdicts, notarised by checks, on `proofs`, with the OTLP archived in R2; the status feed verifies them; `prove.yml`; the Proof column uses `proof:` | 4.4 |
| 4.6 | Cost is measured daily per world, run, journey and lane, against the cap | 4.4 |

and changes 4.1 (logs through Effect's `Logger`, checks over OpenTelemetry spans and logs; its run-time log checks
need 4.4), 4.2 (scored from the tap, written into the verdict), 4.3 (reads verdicts, the sink and the cost metrics;
needs 4.5 and 4.6), and the "Steps to the goal" preamble (what a Proof may name). These would be one lane,
`slice/telemetry`, which can start at once: 4.4 needs only what is Done.

**`AGENTS.md`**:

- "Three sources, one owner for every fact": run records stop being something checks write into the repository.
  What is proven is owned by **verdicts**, made only by CI and verifiable against GitHub. What happened is
  **telemetry**, in the sink. "Nobody writes one by hand" becomes checked.
- "How it is measured": every call's record is its OpenTelemetry trace and logs, with the attributes the blueprint
  declares; the generic checks run over them, from the tap during a run and from the sink after a deploy; refusals
  are not errors; cost is measured.
- The table "Who owns each fact" gains: telemetry attribute names (the blueprint); where telemetry goes
  (`packages/world` and `packages/platform`); the verdict schema and the proofs (the runner); what is proven
  (verdicts on `proofs`, replacing "Run records").
- The ladder's rung 6 names `prove.yml` beside `world.yml`.

## 12. Decisions for Aaron

Each has a recommendation. The first three shape everything else.

1. **Proof is a CI-made verdict, notarised by GitHub, kept on an orphan `proofs` branch**, with the detail in the sink
   and an archive. Alternatives: verdicts committed to `master` by CI (bot commits on `master`); check runs only, no
   ledger (no offline history, many API calls to list); signed attestations (likely needs GitHub Enterprise Cloud on a
   private repository). **Recommend the orphan branch with checks as notary.**
2. **Runs from containers are never proof.** Every proof runs in CI, by `prove.yml` when no other workflow makes it.
   **Recommend yes.** The cost is the next question.
3. **Actions minutes for proving.** Today a slice's journeys run once at its merge and `master` once a day. Proofs a
   step needs beyond that (a world proof, a platform proof) would run by hand in `prove.yml`, a few per step. **Recommend
   yes, within the same minutes cap, with the cost job (4.6) reporting them.**
4. **The sink.** **Recommend a one-day spike of two candidates against the five criteria in section 6, then you
   choose.** PostHog is one candidate since Classic already sends OTLP to it; the design does not lock it in. I need to
   know whether you want PostHog in the bake-off, and which accounts you are willing to open (free tiers). Two sinks,
   test and real, kept apart.
5. **An R2 archive of every CI run's telemetry**, 180 days, in the platform stack. Pennies a month. **Recommend yes.**
   Alternative: no archive, and a run's detail is gone after the sink's retention (the verdict stays).
6. **Model cost.** Do agents run on API billing or on a plan? If API, the Anthropic cost report needs an admin key,
   which is a credential only you can create. In both cases, turning on Claude Code's own OpenTelemetry in the agents'
   environment, sent to the door, gives tokens and cost per session. **Recommend turning it on; the admin key only if
   you want invoices reconciled automatically.**
7. **Decided by Aaron, 15 November 2026: every world gets every signal, product events included, tagged to its
   session** (the envelope, in "The model"). Test and real worlds have separate analytics sinks. The original
   recommendation follows for the record: product analytics only in real worlds, derived from declared events. No handler emits an analytics event of its
   own. **Recommend yes.** It means no analytics until phase 8, which is when there are people to analyse.
8. **`CODEOWNERS`** naming you (or the lead) for `.github/workflows/`, `packages/scenarios/` and
   `packages/runner/src/checks/`, so a change to what judges the work needs a named reviewer. **Recommend yes**; it is
   the one gap verdicts cannot close.
9. **The roadmap shape:** keep 4.1 to 4.3, add 4.4 to 4.6, one new lane `slice/telemetry` started now, 4.1's run-time
   log checks needing 4.4. **Recommend yes.** Alternative: renumber phase 4 in order, which breaks the references to
   4.1 to 4.3 in `AGENTS.md` and phase 5.

Credentials this needs from you, all by the network proxy or as repository secrets, none in a container: the test
sink's key (for the `staging` door), later the real sink's (for `production`), and an R2 bucket in the existing
Cloudflare account under the existing token if its scope allows, otherwise a scope change.

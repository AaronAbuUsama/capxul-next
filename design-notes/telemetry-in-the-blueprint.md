# Telemetry in the blueprint

A chapter of the blueprint-first plan, 15 November 2026, written to stand on its own for the blueprint session. Its
companion, `proof-and-telemetry.md` in this folder, holds the model (emit, route, keep, confirm), proof and cost. This
chapter teaches the fundamentals, then says how they apply to our system and to the blueprint, so that every name,
attribute, event, span kind and dataset comes from the blueprint and drift fails CI.

Decided by Aaron (15 November 2026): the sink is **Axiom**, with no trial. Agents run on subscriptions (Claude Code,
Command Code, ChatGPT), so model cost is estimated from Claude Code's own telemetry. A **session** is whatever drove
the work: an agent's session, a CI run, or a person's sign-in.

Read for it: Axiom's documentation (`axiom.co/docs/llms.txt`, and its pages on datasets, OpenTelemetry, semantic
conventions, traces, metrics, correlations, map fields, limits, tokens, query cost limits, LLM observability, Claude
Code and Cloudflare Workers), its v2 API spec, and Effect 4.1.2's `effect/observability`.

## Part 1. The fundamentals, from first principles

### Everything is an event in a dataset

Axiom stores **events**: timestamped records of key-value pairs. Each event has `_time`, when it happened, and
`_sysTime`, when Axiom received it. A **dataset** is a collection of related events. Its schema is worked out as
data arrives ("schema on read"): a new key becomes a new **field**. Fields are counted and capped per dataset: 256 on
the free Personal plan and 1,024 on Axiom Cloud.

Axiom has two stores under that idea:

- **EventDB** holds logs, traces and plain events.
- **MetricsDB** holds OpenTelemetry metrics, which are already aggregated.

Each dataset has one **kind**: `otel:traces:v1`, `otel:logs:v1`, `otel:metrics:v1` or `axiom:events:v1`.

### The four kinds of record

- **A span** is one piece of work with a start and an end. It carries:
  - `trace_id`, `span_id` and `parent_span_id`;
  - `name`, which should be low in variety: the kind of work, not its data;
  - `kind`: server, client, internal, producer or consumer;
  - `duration`;
  - `status.code` and `status.message`, with `error` true when the status is an error;
  - its own timestamped `events`;
  - `links` to other spans;
  - `resource`: who produced it;
  - `attributes`: what it was about.

  A **trace** is every span sharing one `trace_id`, which is the life of one request. To count requests, rates and
  durations, filter to root spans (`isnull(parent_span_id)`). Otherwise every child span is counted too.
- **A log** is a record with a time, a severity, a body and attributes. When it carries `trace_id` and `span_id`, it
  belongs to the span that wrote it.
- **An event**, in OpenTelemetry's own sense, is a log record with an `event.name`: a named fact with a schema. In
  Axiom it is either such a log record, or a plain event in an `axiom:events:v1` dataset.
- **A metric** is a number aggregated over time by its producer and sent as summaries. There are four types:
  - a counter (a sum that only rises);
  - a gauge (a value at a moment);
  - a histogram (a distribution, in buckets);
  - a summary (precomputed quantiles).

  Use metrics when there are many measurements a second, or for rates and percentiles. MetricsDB is built to take
  high variety in a metric's tags, so tagging by world or run is fine. Metrics are queried with MPL, a language still
  in preview. Everything else is queried with APL, a Kusto-like language.

### Resource and attributes, and the conventions

- The **resource** is who produced a record: `service.name`, `service.version`, `deployment.environment.name`, the
  host. It is set once per process, and every record from that process carries it.
- **Attributes** are what one record is about, such as the HTTP route or the database statement.
- **Semantic conventions** are OpenTelemetry's standard names and meanings for attributes, versioned (1.24, 1.32,
  and so on). Axiom stores attributes it recognises as typed columns (`attributes.http.route`, `resource.host.name`).
  Everything else goes into one map field, `attributes.custom`.
  - A map field costs no field count, but it costs more query compute.
  - It can compress worse.
  - Its keys are invisible to the schema and autocomplete.
- **Pin the conventions' version.** A producer should say which version it follows (its schema URL). Otherwise Axiom
  interprets the data by its own default version. When that default moves, attributes move between
  `attributes.custom` and typed columns, and saved queries, dashboards and monitors break.

### Datasets: how to divide data

Axiom's guidance:

- Separate datasets by environment and by signal type, and by service only coarsely.
- Do not use a "kitchen sink". Mixing record kinds explodes the field count, slows queries, causes type conflicts and
  defeats access control.
- Do not filter one dataset by an `environment` attribute. That is how test and real data end up side by side.
- Keep **every span of a trace in one dataset**, and filter by `service.name`.
- Do not use separate organisations to separate data.
- Each OpenTelemetry signal needs its own dataset: logs, traces and metrics are never mixed.

A **correlation group** binds one logs, one traces and one metrics dataset. Axiom can then jump from a log to its
trace, and from a span to its logs and metrics.

### Sending data

- OTLP over HTTP goes to `/v1/traces`, `/v1/logs` and `/v1/metrics`, as Protobuf or JSON.
- The dataset is chosen by a header: `x-axiom-dataset` for logs and traces, `x-axiom-metrics-dataset` for metrics.
  So the headers differ by signal and by dataset, and one shared header set does not work.
- A plain-events dataset takes JSON or NDJSON at `/v1/ingest/<dataset>`. Its answer reports how many events were
  `ingested` and how many `failed`, which is a receipt.
- Limits:
  - an event dataset takes 10,000 events a batch, 1 MB a field and field names up to 200 bytes;
  - an over-long value is replaced, not refused;
  - metrics take 4 MiB a request, and an over-limit data point is dropped with a 200 answer, so only reading the
    answer shows it.

### Keeping the schema honest

- **Field metadata.** Each field can be given a description, a unit and a hidden flag through the v2 API
  (`PUT /datasets/{id}/fields/{field}`).
- **Locked schema.** An event dataset's schema can be locked. Fields not in the schema, or of the wrong type, are then
  dropped at ingest, and the answer warns, naming the field (`schema_rules_drop`). Locking is done in the console, not
  through the API. Metrics datasets cannot be locked.
- **Schema health.** The API reports a dataset's field count against its cap, and how many fields first appeared in
  the last 7 and 30 days. New fields are drift, made visible.
- Fields that are no longer sent can be vacuumed, and unwanted fields deleted.
- **Views** are saved filters that behave like datasets.
- **Virtual fields** are computed at query time.

### Tokens, cost and agents

- **Basic tokens** may only ingest, into the datasets named.
- **Advanced tokens** carry chosen capabilities.
- Every token can expire and be regenerated.
- A token, or a role, can be given an **hourly and a daily query-cost cap** in dollars. Past it, its queries get a
  429, which is how an agent can query freely with a known worst case.
- Axiom offers an MCP server and agent skills, for investigating, building dashboards, alerting and controlling cost.
- Monitors are threshold, match or anomaly monitors, and they notify through notifiers, a Claude Code notifier among
  them.
- Dashboards are JSON with a published JSON Schema, and monitors are API resources, so both can be generated.
- Datasets and monitors can also be Terraform resources.

### Plans

| Plan | Datasets | Fields per dataset | Retention | Free each month |
|---|---|---|---|---|
| Personal | 3 | 256 | 30 days at most | 500 GB loaded, 10 GB-hours of query, 25 GB stored |
| Axiom Cloud | 100 | 1,024 | Any, including forever | 1,000 GB loaded, 100 GB-hours of query, 100 GB stored; usage past that is charged |

Personal's three datasets cannot hold even one grade's traces, logs, metrics and events (decision T1).

### What is specific to LLMs and agents

- **GenAI conventions.** Model calls are spans with `gen_ai.*` attributes:
  - the operation (`chat`, `execute_tool`);
  - the provider;
  - the requested and the answering model;
  - input and output tokens;
  - finish reasons;
  - optionally the messages and the tool calls and results.

  Axiom's AI SDK adds `gen_ai.capability.name` and `gen_ai.step.name`. When `gen_ai.operation.name` appears in a
  dataset, Axiom builds a GenAI dashboard (cost, time to first token, calls by model, errors) and an AI trace view.
- **Redaction.** Axiom's SDK can capture everything (its default) or only metadata, tokens and errors (OpenTelemetry's
  default). Prompts and tool results can carry source code and secrets.
- **Claude Code exports its own OpenTelemetry**: metrics (`claude_code.session.count`, `claude_code.token.usage`,
  cost), logs (`claude_code.user_prompt`, `claude_code.tool_result`, `claude_code.api_request`), and traces in beta
  (`claude_code.interaction`, `claude_code.llm_request`). Each carries the session's id.
  - It is configured with environment variables, with separate endpoints and headers for each signal.
  - Extra resource attributes can tag every record (`OTEL_RESOURCE_ATTRIBUTES`).
  - Logging prompts and tool details is off unless turned on.

## Part 2. What this means for us

The fundamentals change five things in the model of `proof-and-telemetry.md`:

1. **Our own attributes are custom, so they land in `attributes.custom`.** Every `capxul.*` attribute (the
   envelope, the operation, the outcome, the step kind) is a key in one map field. It is queryable but slower, and
   invisible to the schema. So what we query most should not live only there (option A3).
2. **Datasets are per signal and per grade group**, never filtered apart by an attribute. That means at least eight
   datasets, more than Personal allows (T1).
3. **The door routes by header, per signal.** Effect's `OtlpProxy` takes one set of headers but can be mounted once
   for each signal (`signals`). So the door mounts three proxies for each grade group, each adding its own
   `x-axiom-dataset` or `x-axiom-metrics-dataset`, and the token.
4. **The sink can check us back.** Field lists, schema health, receipts at ingest and warnings when a field is dropped
   give the "confirm" stage something to read. Drift becomes a query, not a suspicion (Part 4).
5. **Agents are producers like any other.** Claude Code's session id is the `capxul.session` of everything that
   session caused.

## Part 3. Options for applying it

### A. To our system: Core, the world, the runner and the platform client

**A1. How each process emits**

| Option | What it is | For | Against |
|---|---|---|---|
| a. Effect's own exporters, through the door | `OtlpTracer`, `OtlpLogger`, `OtlpMetrics` from `effect/observability`, to the stage's door | Effect-native, no non-Effect dependency, runs on Workers with a `Flusher` in `waitUntil`, keys stay in the door | We write the door (small: three `OtlpProxy` mounts per grade group) |
| b. `@microlabs/otel-cf-workers` in Core, as Axiom's Workers guide does | The OpenTelemetry SDK wrapped for Workers | Documented path | A non-Effect runtime dependency; it traces fetches, not Effect's spans; the key lives in the Worker |
| c. Cloudflare's own tracing exported to Axiom | Workers export traces and logs through their own destinations | No code | Sees no declared step; cannot be the source of truth |

**Recommend a**, with c turned on beside it as a platform view (CPU time, cold starts, exceptions that escape Effect),
in its own dataset so it never mixes into ours.

**A2. Datasets**

| Option | Datasets | For | Against |
|---|---|---|---|
| a. Per grade group and signal, in one correlation group per grade group | `capxul-test-traces`, `-logs`, `-metrics`, `-events`; the same for `capxul-real-`; `capxul-agents-traces`, `-logs`, `-metrics` for agents' sessions; `capxul-cloudflare` for A1c | Axiom's guidance exactly; test never beside real; trace-to-log links within a grade group; agents' telemetry apart from the product's | 12 datasets: Axiom Cloud only |
| b. As a, without the separate agents' group | Agents' Claude Code telemetry goes into `capxul-test-*` | Fewer datasets | Claude Code adds many fields and keys of its own, the "kitchen sink" Axiom warns against |
| c. One set filtered by `capxul.grade` | 4 datasets | Fits a small plan | Exactly the mistake Classic made and Axiom warns against |

**Recommend a.** "What happened in session X" stays one query: join `capxul-agents-*` and `capxul-test-*` on
`capxul.session`.

**A3. Where the envelope lives, given custom attributes land in a map field**

| Option | What it is | For | Against |
|---|---|---|---|
| a. Attributes only | `capxul.*` on every record, in `attributes.custom` | Pure OpenTelemetry | Slower and costlier to query; invisible to the schema |
| b. Use conventions wherever one fits, ours only where none does | `deployment.environment.name` for the grade, `service.name` per producer, `session.id` for the session (a convention exists), `cicd.pipeline.run.id` for a CI run, `vcs.ref.head.revision` for the code; `capxul.*` only for world, run, journey, step, operation and outcome | Typed columns for the common filters; standard names that any sink understands | Some of ours still sit in the map |
| c. b, plus the product events in a plain-events dataset with flat, typed fields | The declared events go to `capxul-<grade>-events` (`axiom:events:v1`) as flat records: the event's name, its envelope and its fields as declared, each a typed column with a description | Product events are queried most and change least, so they get real columns, a lockable schema and field descriptions from the blueprint | The events are not OpenTelemetry log records there; the copy keeps the trace and span id, so the link to the trace stays |

**Recommend c.** Spans and logs stay pure OpenTelemetry (b). The product events, the one record people analyse,
get a declared, typed, lockable schema.

**A4. The world package's work**

It is instrumented, not redesigned, as Aaron set. Each step of world making, reset, snapshot, site claim, starting
worlds and journeys becomes a declared step (Part 3, B2) exported as spans. Metrics: Effect's `Metric` only where a
span cannot show it, such as the hub's capacity or the pool's size.

**A5. Agents' sessions**

Claude Code's telemetry is turned on in the agents' cloud environment, configured as follows:

- endpoints and headers are set per signal, to the door's public route, with the door's ingest credential added by
  the network proxy;
- `OTEL_RESOURCE_ATTRIBUTES` carries the lane and the branch;
- prompts and tool details are not logged (`OTEL_LOG_USER_PROMPTS` and `OTEL_LOG_TOOL_DETAILS` stay off), because
  tool results can carry secrets.

Command Code and ChatGPT have no OpenTelemetry we know of; their cost is their subscription, entered once a month.

### B. To the blueprint, as the single spec

What the blueprint declares, and what is generated from it:

| The blueprint declares | Generated from it |
|---|---|
| **The conventions' version** (one constant) | The schema URL every producer's resource carries |
| **The envelope**: each attribute's name, its OpenTelemetry convention or `capxul.*` name, its schema, who sets it | The attribute constants producers import; the door's stamping; the field descriptions in Axiom |
| **Producers**: Core, the runner, the world, the platform client, the SDK, the CLI, the door, the cost job, agents' sessions, each a `service.name` | Each process's resource |
| **Step kinds**: database, site, chain, bundler, wait, and the pipeline's own (deploy, branch, container, restore, poll) | The `capxul.step.kind` values; the waits a budget leaves out |
| **Steps and logs per operation** (4.1), and the pipeline's own operations | Span names (an `Effect.fn` takes the declared step, never a string); log schemas; the generic checks |
| **Events** (already declared) with their schemas | The events dataset's field manifest (names, types, units, descriptions) |
| **Metrics**: name, type, unit, allowed tags | Effect `Metric` definitions; the metrics dataset's expected names |
| **Datasets**: the logical datasets, by kind, signal and grade group (A2) | The datasets themselves (created by `packages/platform` from this list), the door's routing table, the correlation groups |
| **Monitors and dashboards** that watch what is declared (a refusal rate, a budget, a run over 10 minutes) | Axiom monitor and dashboard JSON, applied by the platform's deploy |
| **Redaction**: fields marked sensitive in their schemas | The door drops them; the analytics route carries ids only |

Where each lives in the blueprint: one `telemetry/` module holding the conventions' version, the envelope, the
producers, the step kinds, the metrics and the datasets. Steps, logs and events stay in each operation's own file
(the one-file-per-operation format of the plan). Dataset names and the routing table are generated into
`packages/platform`, which creates them. So "what runs where" stays its owner's, from the blueprint's list.

**B1. How strict the declared vocabulary is**

| Option | What it is | For | Against |
|---|---|---|---|
| a. Closed: every span, log, event, metric and attribute of our own is declared; library spans allowed by instrumentation scope only | Anything else fails | No drift by construction | Every new step is a blueprint change first, which is the loop as agreed |
| b. Closed for events and attributes, open for span names | Span names are free | Less ceremony | Span names are exactly what drifted (176 typed by hand) |

**Recommend a.** Aaron's rule is that nothing that should be in the blueprint is rolled by hand.

**B2. The pipeline's own work**

| Option | What it is | For | Against |
|---|---|---|---|
| a. Declared operations of the platform group, with steps | World make, reset, snapshot save and restore, site claim, starting-world make; journeys and runs as runner operations | One format for everything, budgets per piece, a 10-minute run budget | More declarations up front |
| b. Steps only, under a few operations | Fewer operations | Less to declare | Budgets and coverage at a coarser grain |

**Recommend a**, so the run's 10-minute budget can be broken down to the second.

## Part 4. Drift fails CI: the checks

Drift is caught at five places, from writing to keeping. Each is a check on a rung or a step of a run.

1. **Lint (rung 3).** No span name, attribute name, log message key, metric name or event name written as a string
   outside the blueprint. `Effect.fn` and `Effect.withSpan` take a declared step. An attribute key is an imported
   constant. This extends 3.3's rule that a declared name is imported.
2. **Generate (rung 1, `pnpm generate:check`).** The generated attribute constants, resources, field manifests,
   dataset list, routing table, monitors and dashboards match what generating again would write.
3. **The delta check (`pnpm delta:check`).** Every operation, the pipeline's own included, declares its steps, its
   logs and the refusal log of every refusal. Every metric names its type and unit.
4. **The tap, on every call of every journey (rung 6).** Each record Core and the runner emit decodes against the
   blueprint:
   - a span's name is a declared step, or comes from a library's instrumentation scope;
   - its attributes are declared;
   - every log and event decodes with its schema;
   - the envelope is complete.

   A record that does not decode fails the call. This is the runtime half of the generic checks.
5. **The sink, read back (the "confirm" stage, after each CI run and daily).** The job asks Axiom for:
   - each dataset's field list, and each field's first appearance (schema health);
   - the distinct span names, event names, log types and metric names of the run;
   - the ingest receipts (`ingested`, `failed`) and any `schema_rules_drop` warnings.

   Anything not in the blueprint is drift: the run's verdict says so and does not count, and the daily job raises a
   task. A field the blueprint declares that never arrives is reported too, the way Classic's "dead catalog entries"
   were, but by a check rather than a scout.

**Locking the events datasets.** Locking is done in the console only, so it is a one-time step for Aaron per events
dataset (decision T3). Once locked, Axiom drops undeclared fields at ingest and warns, and check 5 turns that warning
into a failed verdict.

## Part 5. Decisions

1. **T1. The Axiom plan.** Personal allows 3 datasets and 30 days, which cannot hold A2. **Recommend Axiom Cloud**,
   with an organisation spending limit set inside the $10 a day cap. Our volume (a run is a few thousand spans) sits
   far inside its free allowances.
2. **T2. Datasets as in A2a**: 12 datasets in correlation groups for test, real and agents, plus Cloudflare's own.
   **Recommend yes.**
3. **T3. Lock the events datasets' schemas** once created, by hand in the console, and let check 5 enforce them.
   **Recommend yes.**
4. **T4. The envelope uses conventions first (A3b), product events go to a typed events dataset (A3c).**
   **Recommend yes.**
5. **T5. A closed vocabulary (B1a)**, and **the pipeline's work as declared operations (B2a)**. **Recommend yes.**
6. **T6. Claude Code's telemetry on in the agents' environment**, with prompts and tool details off. **Recommend
   yes.** The ingest token it needs is made in Aaron's Axiom console, as an ingest-only token for the agents' datasets,
   and added by the network proxy, never put in the environment's variables.
7. **T7. Query-cost caps on every agent's Axiom token** (for example $1 an hour and $5 a day), so agents can query
   freely. **Recommend yes.**
8. **T8. Conventions' version.** Pin the newest version Axiom supports when the work starts, in one blueprint
   constant, and move it only on purpose, as a reviewed change. **Recommend yes.**

Credentials, all made in Aaron's Axiom console (Helium on his Mac, which a Claude Code session there can drive with
his yes):

- a basic ingest token per grade group's datasets, for the door;
- one for the agents' datasets;
- an advanced token with query capability and a cost cap, for the confirm stage and for agents to query.

None of these goes in a container: the door holds its token as a Worker secret, and the network proxy adds the rest.

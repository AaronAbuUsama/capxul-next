// The log rows every call writes: one wide row per rpc and one per durable process run, so no part of the server is
// silent (the gap rule unlogged-operation). What every row, event and metric also carries is the system's envelope
// (foundation.ts). The judgments are the decisions at the end of this file.

import { Schema } from "effect";
import { defineAlert, defineDashboard, defineDecision, defineInsight, defineLog, defineMetric } from "../../packages/blueprint-engine/src/index.ts";
import { component_backend, component_cli, system_capxul } from "./foundation.ts";

const Outcome = Schema.Literals(["ok", "refused", "failed"]);
/** The failure an outcome other than ok names: its error code from the vocabulary and how it failed. */
const Failure = Schema.NullOr(Schema.Struct({ code: Schema.String, mode: Schema.String, retryable: Schema.Boolean }));

export const log_operation_row = defineLog({
  id: "operation_row",
  title: "The wide row an rpc writes",
  about:
    "One row per rpc call, written when the call ends, inside the same trace as its span: which rpc, who called it, how it " +
    "ended and how long it took. A refusal is an expected outcome (refused) and a defect is failed; both name the error. " +
    "The row carries ids, never values a person typed: no email, name, address or amount note.",
  component: component_backend,
  level: "info",
  per: "rpc",
  attributes: Schema.Struct({
    rpc: Schema.String,
    concept: Schema.String,
    surface: Schema.Literals(["cli", "sdk", "react", "mcp", "http", "site"]),
    outcome: Outcome,
    failure: Failure,
    duration_ms: Schema.Number,
    db_ms: Schema.Number,
    chain_calls: Schema.Number,
    session_id: Schema.NullOr(Schema.String),
  }),
  redact: ["session_id"],
});

export const log_command_row = defineLog({
  id: "command_row",
  title: "The row a CLI command writes",
  about:
    "One row per CLI command, written when it exits: which operation, how it ended and its exit code. A journey step that " +
    "proves by its operation's success is counted from this row.",
  component: component_cli,
  level: "info",
  per: "operation",
  attributes: Schema.Struct({
    operation: Schema.String,
    outcome: Outcome,
    failure: Failure,
    exit_code: Schema.Number,
    duration_ms: Schema.Number,
    json: Schema.Boolean,
  }),
});

export const log_process_row = defineLog({
  id: "process_row",
  title: "The wide row a durable process run writes",
  about:
    "One row per run of a durable process, written when the run ends or parks on a wait: which process, what started it, " +
    "how long it waited to start after it was due, how many times it resumed, and how it ended.",
  component: component_backend,
  level: "info",
  per: "workflow",
  attributes: Schema.Struct({
    workflow: Schema.String,
    concept: Schema.String,
    trigger: Schema.Literals(["transition", "chain-event", "timer", "cron", "signal"]),
    idempotency_key: Schema.String,
    outcome: Schema.Literals(["done", "waiting", "refused", "failed"]),
    failure: Failure,
    queue_wait_ms: Schema.NullOr(Schema.Number),
    duration_ms: Schema.Number,
    resumes: Schema.Number,
  }),
});

export const metric_process_queue_age = defineMetric({
  id: "process_queue_age",
  title: "How long the oldest due process run has waited to start",
  about:
    "Sampled every minute by the scheduler, per process: the age of the oldest run that is due and not started. A run " +
    "that never starts writes no process_row, so a stopped worker shows here first.",
  component: component_backend,
  instrument: "gauge",
  unit: "ms",
  attributes: Schema.Struct({ workflow: Schema.String, due_runs: Schema.Number }),
  producer: component_backend,
});

export const decision_signals_envelope = defineDecision({
  id: "signals.envelope",
  title: "Every event, log row and metric carries one envelope",
  question: "What does every signal the product sends carry, so any one can be found from any other?",
  options: [
    { label: "one-envelope", text: "capxul_env, world_id, trace_id, producer, org_id and actor on every event, row and metric, from the system record." },
    { label: "per-signal", text: "Each event and row lists its own ids." },
  ],
  chosen: "one-envelope",
  why:
    "One trace id joins a command, its rpcs, its events, its rows and its chain transaction (the thin line's record export " +
    "follows exactly that). The old system needed capxul_env on every event because one analytics project took every " +
    "environment, and kept `unknown` as a loud defect marker rather than an absent property; that holds here. world_id is " +
    "new: every world, including a restored one, is a separate world whose signals must not mix.",
  source: "Aaron, 18:49 UTC 11 November 2026 (everything is a record); old repository packages/observability/src/catalog/envelope.ts (reference only)",
  affects: [system_capxul],
});

export const decision_signals_wide_rows = defineDecision({
  id: "signals.wide-rows",
  title: "One wide row per rpc and per process run",
  question: "How does the server log, so that no call is silent and rows can be counted and queried?",
  options: [
    { label: "wide-row", text: "One structured row per rpc call and per process run, written at the end, with outcome, failure and timings." },
    { label: "free-lines", text: "Free-text log lines wherever the code chooses." },
  ],
  chosen: "wide-row",
  why:
    "A row per call answers 'how did this call end and how long did it take' with one query, and makes a missing row a " +
    "fact an eval can see (log:operation_row/written). Free lines cannot be checked against the blueprint. The old system " +
    "wrote the same kind of row (capxul_backend_operation) and its slow-operation and error checks read it. Session ids " +
    "are masked; person-entered values are never attributes.",
  source: "Aaron, 18:49 UTC 11 November 2026; spec docs/mission/record-kinds-spec-2026-11-11.md section 2",
  affects: [log_operation_row, log_process_row, log_command_row],
});

// ── what is asked of the rows: system health, for the operator ─────────────────────────────

const LIVE = ["shared-world", "staging", "production"];

export const insight_rpc_failure_rate = defineInsight({
  id: "rpc_failure_rate",
  title: "Failed rpc calls, by rpc, over 15 minutes",
  about: "Each rpc's calls and failures (outcome failed: a defect, not a refusal) over the last 15 minutes of the environment's own traffic.",
  reads: [log_operation_row],
  query:
    "select attributes.rpc as rpc, count() as calls, countIf(attributes.outcome = 'failed') as failures " +
    "from logs where body = 'operation_row' and timestamp > now() - interval 15 minute " +
    "and resource_attributes.capxul_env = '<env>' group by rpc order by failures desc",
  display: "table",
  env: LIVE,
  answer: "On the thin-line world: every rpc the 12 steps call, with 0 failures.",
});

export const insight_rpc_p95 = defineInsight({
  id: "rpc_p95",
  title: "Slowest rpcs by p95 over 24 hours",
  about: "Each rpc's p95 duration over the day, to set against its budget (policy P5).",
  reads: [log_operation_row],
  query:
    "select attributes.rpc as rpc, count() as calls, quantile(0.95)(toFloat(attributes.duration_ms)) as p95_ms " +
    "from logs where body = 'operation_row' and timestamp > now() - interval 24 hour " +
    "and resource_attributes.capxul_env = '<env>' group by rpc order by p95_ms desc",
  display: "table",
  env: LIVE,
});

export const insight_process_backlog = defineInsight({
  id: "process_backlog",
  title: "Process runs failed or late to start, over 1 hour",
  about:
    "Each durable process's failed runs over the last hour (from process_row), and the age of its oldest due run that " +
    "has not started (from process_queue_age), so runs a stopped worker never starts are counted while it is stopped.",
  reads: [log_process_row, metric_process_queue_age],
  query:
    "select workflow, sum(failures) as failures, max(queue_age_ms) as oldest_due_ms from (" +
    "select attributes.workflow as workflow, countIf(attributes.outcome = 'failed') as failures, 0 as queue_age_ms " +
    "from logs where body = 'process_row' and timestamp > now() - interval 1 hour " +
    "and resource_attributes.capxul_env = '<env>' group by workflow " +
    "union all select attributes.workflow as workflow, 0 as failures, max(value) as queue_age_ms from metrics " +
    "where metric_name = 'process_queue_age' and timestamp > now() - interval 5 minute " +
    "and resource_attributes.capxul_env = '<env>' group by workflow) group by workflow order by oldest_due_ms desc",
  display: "table",
  env: LIVE,
});

export const alert_rpc_failing = defineAlert({
  id: "rpc_failing",
  title: "An rpc is failing",
  about: "Fires when one rpc fails often enough that it is not one bad call.",
  insight: insight_rpc_failure_rate,
  condition: "for any one rpc, 5 calls or more and a failure rate of 20% or more, over 15 minutes",
  cadence: "5m",
  severity: "notify",
  route: ["operator"],
  runbook:
    "Open the rpc's failed rows by trace_id, read the failure code and mode, and follow the trace to the span that " +
    "failed. A failure of an integration is the vendor's: check its status before changing code.",
  silence: ["a world being restored from a snapshot", "the devnet"],
});

export const alert_process_stuck = defineAlert({
  id: "process_stuck",
  title: "Durable processes are failing or starting late",
  about: "Fires when a process fails or its runs wait too long to start: payments, sweeps and reconciliation stop moving.",
  insight: insight_process_backlog,
  condition: "any process with a failed run in the last hour, or a due run not started for over 5 minutes",
  cadence: "15m",
  severity: "page",
  route: ["operator"],
  runbook:
    "Find the run by its idempotency key. A failed run is resumed after the cause is fixed (wfl:<id>/resume holds, so " +
    "resuming is safe); an old due run means the worker is down or saturated: check it before anything else.",
  silence: ["a world being restored from a snapshot"],
});

export const dashboard_operator_health = defineDashboard({
  id: "operator_health",
  title: "Operator: is the server healthy",
  about: "What Capxul's operator opens first: failing rpcs, slow rpcs and stuck processes, in the environment's own traffic.",
  audience: "operator",
  where: "posthog",
  tiles: [insight_rpc_failure_rate, insight_rpc_p95, insight_process_backlog],
});

export const decision_signals_operator_watch = defineDecision({
  id: "signals.operator-watch",
  title: "The operator watches failing rpcs and stuck processes from the wide rows",
  question: "Which server-wide alerts exist before any concept adds its own?",
  options: [
    { label: "two-alerts", text: "An rpc failing (5 calls, 20% failed, 15 minutes) notifies; a process failing or late to start pages." },
    { label: "none-yet", text: "Add alerts per concept only." },
  ],
  chosen: "two-alerts",
  why:
    "Every rpc and every process writes a wide row (signals.wide-rows), so two queries cover the whole server. The " +
    "thresholds are the old system's journey-reliability alert (5 starts, 20% failures), kept as a starting point; a " +
    "process failing pages because money stops moving. Refusals are expected outcomes and never count as failures.",
  source: "Aaron, 18:49 UTC 11 November 2026; old repository packages/tools/src/modules/analytics/internal/reliability.ts (reference only)",
  affects: [alert_rpc_failing, alert_process_stuck, dashboard_operator_health],
});

export const decision_signals_world_rows = defineDecision({
  id: "signals.world-rows",
  title: "A world keeps its own wide rows; its operator alerts read them in world time",
  question:
    "rpc_failing and process_stuck read operation_row, process_row and process_queue_age over windows of 15 minutes and an " +
    "hour. Where does a world without PostHog keep those rows, which clock bounds the windows, and where does the operator " +
    "read the two alerts?",
  options: [
    {
      label: "world-rows",
      text:
        "Core writes each row to the world's own Postgres (app.signal_rows, worker-only), stamped with the world's instant: " +
        "a stopped devnet clock where the world has one, otherwise the host clock through RealTime, which is the world's " +
        "time in staging and production (Runtime's world-time door replaces this reader, including a running devnet " +
        "clock). Both alerts are evaluated over those windows behind the authenticated, server-wide /admin/operator-alerts, " +
        "and each body's rows older than its longest window are pruned. A world paused for a snapshot writes no row. The " +
        "rows a live environment exports to PostHog are the same rows.",
    },
    { label: "host-rows", text: "Keep the rows in memory and bound the windows by the host's clock." },
  ],
  chosen: "world-rows",
  why:
    "Every world has one clock that everything in it follows (time.worlds), and time.no-direct-reads keeps the host clock " +
    "out of product code, so a row's time is the world's. A frozen devnet therefore holds its window until the clock moves, " +
    "and a warp past it clears it: on a devnet, the operator's hour is the world's hour. Rows in Postgres survive Core's " +
    "restarts and can be counted by an eval. Both alerts are server-wide with route operator (signals.operator-watch), " +
    "so they cannot join an Organization's /admin/alerts list, whose money-path faults must each fire alone. A row is " +
    "written after its answer is sent, so a slow or failing row write never changes an rpc's answer. A caller that never " +
    "passed Core's door (a bad signature, wrong method or oversize body) and the liveness probes write no row, so an " +
    "anonymous flood cannot fill the table or push real calls out of the windows. A process run writes a row when it did " +
    "work or failed, and each process registers where its due runs are read (plugs.payments.settle: unconsumed final " +
    "payments, due from their block time). Core cannot report its own death: a stopped Core is the supervisor's and the " +
    "hosted uptime check's to see, out of scope here.",
  source: "Integrator rulings, 13 November 2026 (Shared builds the wide-row writer and both alerts; the separate server-wide route)",
  affects: [log_operation_row, log_process_row, metric_process_queue_age, alert_rpc_failing, alert_process_stuck],
});

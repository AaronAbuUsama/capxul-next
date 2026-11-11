// The log rows every call writes: one wide row per rpc and one per durable process run, so no part of the server is
// silent (the gap rule unlogged-operation). What every row, event and metric also carries is the system's envelope
// (foundation.ts). The judgments are the decisions at the end of this file.

import { Schema } from "effect";
import { defineDecision, defineLog } from "../../packages/blueprint-engine/src/index.ts";
import { component_backend, system_capxul } from "./foundation.ts";

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
  affects: [log_operation_row, log_process_row],
});

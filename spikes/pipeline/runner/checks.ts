// The generic checks. They hold for every call of every operation, so no scenario writes them: they compare what
// the caller saw with what Core kept under the call's trace id, and with what the contract declares.
import * as Schema from "effect/Schema";
import { operations } from "../contract/door.ts";
import { CallOutcome, type Call } from "./client.ts";
import type { EventRow, SpanRow } from "./database.ts";
import { checkEvents } from "./events.ts";

export const Check = Schema.Struct({
  check: Schema.Literals(["span", "outcome", "events", "budget"]),
  passed: Schema.Boolean,
  /** A gating check fails the scenario. `budget` is measured and recorded, and does not gate yet. */
  gating: Schema.Boolean,
  detail: Schema.String,
});
export type Check = typeof Check.Type;

/** A server span beneath a call's own (a statement, a transaction, anything a handler wrapped): where the time went. */
export const Step = Schema.Struct({
  name: Schema.String,
  /** When it started, in milliseconds after the operation's span started. */
  startMs: Schema.Number,
  ms: Schema.Number,
});
export type Step = typeof Step.Type;

export const CheckedCall = Schema.Struct({
  operation: Schema.String,
  traceId: Schema.String,
  outcome: CallOutcome,
  /** The caller's time, network included. */
  ms: Schema.Number,
  /** How many sends were repeated during the call because the world's address was not routed yet (warmup.ts). */
  resent: Schema.Number,
  /** The duration of the operation's server span; null when no such span was kept. */
  serverMs: Schema.NullOr(Schema.Number),
  /** The other server spans under the call's trace id, in the order they started. Empty when the call has no span of its own. */
  steps: Schema.Array(Step),
  budgetMs: Schema.Number,
  failure: Schema.NullOr(Schema.String),
  /** The names of the events recorded for the call, in the order they were written. */
  events: Schema.Array(Schema.String),
  checks: Schema.Array(Check),
});
export type CheckedCall = typeof CheckedCall.Type;

/** What the operation's server span must say for each outcome the caller can see. */
const spanOutcomeFor = { success: "success", refusal: "failure", defect: "defect", unanswered: "none" } as const;

/** The spans kept under the trace id of `span` other than `span` itself, placed on its clock. */
const stepsOf = (span: SpanRow, kept: ReadonlyArray<SpanRow>): ReadonlyArray<Step> => {
  const started = span.ended_ms - span.duration_ms;
  return kept
    .filter((other) => other.trace_id === span.trace_id && other !== span)
    .map((other) => ({ name: other.name, startMs: Math.round(other.ended_ms - other.duration_ms - started), ms: Math.round(other.duration_ms) }))
    .sort((a, b) => a.startMs - b.startMs);
};

/** Applies every generic check to one call, given all that Core kept. Pure. */
export const checkCall = (call: Call, kept: { readonly spans: ReadonlyArray<SpanRow>; readonly events: ReadonlyArray<EventRow> }): CheckedCall => {
  const operation = operations[call.operation];
  const spans = kept.spans.filter((span) => span.trace_id === call.traceId && span.name === call.operation);
  const span = spans.length === 1 ? spans[0] : undefined;
  const events = kept.events.filter((event) => event.trace_id === call.traceId);
  const emitted = checkEvents(call, events);
  const checks: ReadonlyArray<Check> = [
    {
      check: "span",
      passed: span !== undefined,
      gating: true,
      detail: span !== undefined ? `one ${call.operation} span, ${span.duration_ms} ms` : `${spans.length} ${call.operation} spans under the call's trace id, expected one`,
    },
    {
      check: "outcome",
      passed: span?.outcome === spanOutcomeFor[call.outcome],
      gating: true,
      detail: `the caller saw ${call.outcome}; the span says ${span?.outcome ?? "nothing"}`,
    },
    {
      check: "events",
      passed: emitted.passed,
      gating: true,
      detail: emitted.detail,
    },
    {
      check: "budget",
      passed: span !== undefined && span.duration_ms <= operation.budgetMs,
      gating: false,
      detail: span !== undefined ? `${span.duration_ms} ms against a budget of ${operation.budgetMs} ms` : "no span to measure",
    },
  ];
  return {
    operation: call.operation,
    traceId: call.traceId,
    outcome: call.outcome,
    ms: call.ms,
    resent: call.resent,
    serverMs: span?.duration_ms ?? null,
    steps: span === undefined ? [] : stepsOf(span, kept.spans),
    budgetMs: operation.budgetMs,
    failure: call.failure,
    events: events.map((event) => event.event),
    checks,
  };
};

/** One line for every gating check that did not pass, across all calls. Empty when the generic checks pass. */
export const failuresOf = (calls: ReadonlyArray<CheckedCall>): ReadonlyArray<string> =>
  calls.flatMap((call, index) =>
    call.checks.filter((check) => check.gating && !check.passed).map((check) => `call ${index + 1} (${call.operation}): ${check.check}: ${check.detail}`),
  );

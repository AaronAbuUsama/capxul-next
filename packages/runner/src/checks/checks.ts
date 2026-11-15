// The generic checks, applied to every call of every run. They compare what the caller saw with what Core kept under
// the call's trace id and with what the blueprint declares. No scenario writes them, and a builder never changes them.
//
// Measure first (AGENTS.md): every call's timings, caller side and server side, and the spans of each step are
// recorded with the operation's budget beside them. The budget is never enforced, so no check is about speed.
import { operations } from "@capxul/blueprint";
import { SpanAttributes } from "@capxul/core";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import { CallOutcome, type Call } from "../client.ts";
import type { Kept, SpanRow } from "../world/database.ts";
import { checkEvents } from "./events.ts";

export const Check = Schema.Struct({
  check: Schema.Literals(["span", "outcome", "events"]),
  /** Every check gates: a call that fails one fails its run. */
  passed: Schema.Boolean,
  detail: Schema.String,
});
export type Check = typeof Check.Type;

/** A server span beneath the operation's own: a statement, a transaction, anything a handler wrapped. */
export const Step = Schema.Struct({
  name: Schema.String,
  /** The step it ran inside: the operation's span or another step. */
  parent: Schema.NullOr(Schema.String),
  /** When it started, in milliseconds after the operation's span started. */
  startMs: Schema.Finite,
  ms: Schema.Finite,
  outcome: Schema.String,
});
export type Step = typeof Step.Type;

/** A call's times and its operation's budget beside them. Recorded; never a reason for a run to fail. */
export const Timing = Schema.Struct({
  /** The caller's time: from the send to the answer decoded, network included. */
  callerMs: Schema.Finite,
  /** The operation's server span: from the request decoded to the answer encoded. Null when no span was kept. */
  serverMs: Schema.NullOr(Schema.Finite),
  /** The operation's declared budget for `serverMs` (packages/blueprint, `budget`). */
  budgetMs: Schema.Finite,
  /** True until the budget is set from measured runs. */
  provisional: Schema.Boolean,
  /** Always false: a budget is recorded and not enforced until it is set from measured runs. */
  enforced: Schema.Literal(false),
  /** Whether `serverMs` is over the budget; null when there is no server time. Information only. */
  overBudget: Schema.NullOr(Schema.Boolean),
});
export type Timing = typeof Timing.Type;

export const CheckedCall = Schema.Struct({
  operation: Schema.String,
  traceId: Schema.String,
  /** Another world's door the call went to; null or absent for the stage's own (records before it say nothing). */
  at: Schema.NullOr(Schema.String).pipe(Schema.optional),
  outcome: CallOutcome,
  /** The refusal's tag, for a refused call. */
  refusal: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(Schema.String),
  /** Sends repeated during the call because the stage's address was not routed yet. */
  resent: Schema.Finite,
  timing: Timing,
  /**
   * The declared attributes of the operation's server span: the Cloudflare data centre that ran Core (`cf.colo`) and
   * its Postgres round trips (`db.query_ms`, `db.query_count`). Recorded, never checked; absent when no span was kept
   * or it carries none (records before them say nothing).
   */
  attributes: SpanAttributes.pipe(Schema.optional),
  /** Every other server span under the call's trace id, in the order they started. */
  steps: Schema.Array(Step),
  /** The names of the events recorded for the call, in the order they were written. */
  events: Schema.Array(Schema.String),
  checks: Schema.Array(Check),
});
export type CheckedCall = typeof CheckedCall.Type;

/** What the operation's server span must say for each outcome the caller can see. */
const spanOutcomeFor = {
  success: "success",
  refusal: "failure",
  rejected: "none",
  defect: "defect",
  unanswered: "none",
} as const;

const round = (ms: number): number => Math.round(ms * 1000) / 1000;
const byStart = Order.mapInput(Order.Number, (step: Step) => step.startMs);

/** The spans kept under `span`'s trace id other than `span` itself, placed on its clock. */
export const stepsOf = (span: SpanRow, kept: ReadonlyArray<SpanRow>): ReadonlyArray<Step> => {
  const started = span.ended_ms - span.duration_ms;
  const names = new Map(Arr.map(kept, (each) => [each.span_id, each.name] as const));
  return pipe(
    Arr.filter(kept, (other) => other.trace_id === span.trace_id && other.span_id !== span.span_id),
    Arr.map((other) => ({
      name: other.name,
      parent: other.parent_span_id === null ? null : (names.get(other.parent_span_id) ?? null),
      startMs: round(other.ended_ms - other.duration_ms - started),
      ms: round(other.duration_ms),
      outcome: other.outcome,
    })),
    Arr.sortBy(byStart),
  );
};

/** The operation span's attributes, for the call's record; nothing when it has none. */
const attributesOf = (span: SpanRow | undefined): { readonly attributes?: SpanAttributes } => {
  const attributes = span?.attributes ?? null;
  return attributes === null ? {} : { attributes };
};

/** Applies every generic check to one call, given all that Core kept. Pure. */
export const checkCall = (call: Call, kept: Kept): CheckedCall => {
  const operation = operations[call.operation];
  const spans = Arr.filter(kept.spans, (span) => span.trace_id === call.traceId && span.name === call.operation);
  const [span] = spans.length === 1 ? spans : [];
  const events = Arr.filter(kept.events, (event) => event.trace_id === call.traceId);
  const emitted = checkEvents(call, events);
  // A call its client rejected never left the caller (decisions.md, 43): Core must have kept no span of it at all.
  const unsent = call.outcome === "rejected";
  const checks: ReadonlyArray<Check> = [
    unsent
      ? {
          check: "span",
          passed: spans.length === 0,
          detail: `${spans.length} ${call.operation} spans under the trace id of a call that was never sent, expected none`,
        }
      : {
          check: "span",
          passed: span !== undefined,
          detail:
            span === undefined
              ? `${spans.length} ${call.operation} spans under the call's trace id, expected one`
              : `one ${call.operation} span, ${round(span.duration_ms)} ms`,
        },
    {
      check: "outcome",
      passed: unsent ? spans.length === 0 : span?.outcome === spanOutcomeFor[call.outcome],
      detail: `the caller saw ${call.outcome}; the span says ${span?.outcome ?? "nothing"}`,
    },
    { check: "events", passed: emitted.passed, detail: emitted.detail },
  ];
  return {
    operation: call.operation,
    traceId: call.traceId,
    at: call.at,
    outcome: call.outcome,
    refusal: call.refusal,
    failure: call.failure,
    resent: call.resent,
    timing: {
      callerMs: round(call.callerMs),
      serverMs: span === undefined ? null : round(span.duration_ms),
      budgetMs: operation.budget.ms,
      provisional: operation.budget.provisional,
      enforced: false,
      overBudget: span === undefined ? null : span.duration_ms > operation.budget.ms,
    },
    ...attributesOf(span),
    steps: span === undefined ? [] : stepsOf(span, kept.spans),
    events: Arr.map(events, (event) => event.event),
    checks,
  };
};

/** One line for every check that did not pass, across all calls. Empty when the generic checks pass. */
export const failuresOf = (calls: ReadonlyArray<CheckedCall>): ReadonlyArray<string> =>
  Arr.flatMap(calls, (call, index) =>
    pipe(
      Arr.filter(call.checks, (check) => !check.passed),
      Arr.map((check) => `call ${index + 1} (${call.operation}): ${check.check}: ${check.detail}`),
    ),
  );

// The flip (roadmap 4.4): what the generic checks read of each call's spans comes from the tap (tap.ts), no longer from
// `app.spans`. Each tapped span is handed to the checks in the shape they already take (`SpanRow`,
// world/database.ts), so the checks themselves do not change; the events still come from `app.events`.
//
// Until the retire, Core still writes `app.spans` and the side-by-side parity (side-by-side.ts) still compares the
// two, so any drift shows. A call that reached Core and whose trace the tap does not hold whole is a plumbing failure
// of the runner, as parity already makes it, never a check's.
import { Envelope, Pipeline } from "@capxul/blueprint";
import { OUTCOME, SpanAttributes, type SpanOutcome } from "@capxul/core";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Redacted from "effect/Redacted";
import { checkCall, type CheckedCall } from "../checks/checks.ts";
import type { Call } from "../client.ts";
import { describe, RunnerFailure } from "../failure.ts";
import { eventsOf, telemetryOf, type Kept, type SpanRow } from "../world/database.ts";
import { OtherWorlds } from "../world/existing.ts";
import type { FlatSpan } from "./flat.ts";
import { stepOptions } from "./step.ts";
import { tapFor, WAIT, type Wait } from "./tap.ts";

/** The attribute every span Core keeps carries its outcome under (core/src/telemetry/spans.ts). */
const OUTCOME_KEY = Envelope.attributes.outcome.name;

/** Core's outcome of a span, from the envelope's word it was stamped with: `OUTCOME` read backwards. */
const keptOutcome = (stamped: unknown): Option.Option<SpanOutcome> =>
  Option.map(
    Arr.findFirst(Rec.toEntries(OUTCOME), ([, word]) => word === stamped),
    ([outcome]) => outcome,
  );

/** The attributes Core declares on a kept span (`SpanAttributes`), among all a tapped span carries. */
const DECLARED: ReadonlyArray<string> = Rec.keys(SpanAttributes.fields);
const decodeDeclared = Schema.decodeUnknownOption(SpanAttributes);

/** The declared attributes of a tapped span, as `app.spans.attributes` holds them: null when it carries none. */
const declaredOf = (attributes: Readonly<Record<string, unknown>>): SpanRow["attributes"] => {
  const kept = Rec.filter(attributes, (value, key) => DECLARED.includes(key) && value !== undefined && value !== null);
  return Arr.isReadonlyArrayEmpty(Rec.keys(kept)) ? null : Option.getOrNull(decodeDeclared(kept));
};

/**
 * A tapped span as the checks take a row of `app.spans`: the same ids, name, parent and declared attributes; its
 * outcome from its `capxul.outcome`; its time to the millisecond its end fell in, as Core keeps it. A span with no
 * outcome Core would stamp is not Core's, and fails.
 */
export const rowOf = (span: FlatSpan): Result.Result<SpanRow, string> =>
  Option.match(keptOutcome(span.attributes[OUTCOME_KEY]), {
    onNone: () => Result.fail(`${span.name} (${span.spanId}) carries no ${OUTCOME_KEY} Core stamps`),
    onSome: (outcome) =>
      Result.succeed({
        trace_id: span.traceId,
        span_id: span.spanId,
        parent_span_id: span.parentSpanId,
        name: span.name,
        outcome,
        duration_ms: span.durationMs,
        ended_ms: Math.floor(span.endedMs),
        attributes: declaredOf(span.attributes),
      }),
  });

/** True for a call Core answered, whose trace must therefore be in the tap: not one refused before it was sent, nor unanswered. */
const answeredByApi = (call: Pick<Call, "outcome">): boolean =>
  call.outcome !== "rejected" && call.outcome !== "unanswered";

const traceIdsOf = (calls: ReadonlyArray<Pick<Call, "traceId">>) => Arr.dedupe(Arr.map(calls, (call) => call.traceId));

/**
 * What Core kept of `calls` for the checks: their spans from the tap, their events from `app.events`. A call Core
 * answered waits up to `wait` for its trace, which must come whole; one it did not answer is read once, and has
 * nothing when the tap holds nothing of it.
 */
export const tapTelemetryOf = Effect.fn(
  Pipeline.checkCall.spans.read.name,
  stepOptions(Pipeline.checkCall.spans.read),
)(function* (database: Redacted.Redacted, calls: ReadonlyArray<Pick<Call, "traceId" | "outcome">>, wait: Wait = WAIT) {
  if (Arr.isReadonlyArrayEmpty(calls)) return { spans: [], events: [] } satisfies Kept;
  const reached = Arr.filter(calls, answeredByApi);
  const notReached = Arr.filter(calls, (call) => !answeredByApi(call));
  const [waited, once] = yield* Effect.all([
    tapFor(database, traceIdsOf(reached), wait),
    tapFor(database, traceIdsOf(notReached), { tries: 1, every: wait.every }),
  ]);
  const incomplete = Arr.filter(traceIdsOf(reached), (traceId) => waited.get(traceId)?.complete !== true);
  if (Arr.isReadonlyArrayNonEmpty(incomplete))
    return yield* RunnerFailure.make({
      step: "tap",
      message: `plumbing: the tap does not hold whole the trace of a call the api answered: ${Arr.join(incomplete, ", ")}`,
    });
  const tapped = Arr.flatMap([...waited.values(), ...once.values()], (each) => (each.complete ? each.spans : []));
  const [rows, bad] = Arr.partition(tapped, rowOf);
  if (Arr.isReadonlyArrayNonEmpty(bad))
    return yield* RunnerFailure.make({ step: "tap", message: `plumbing: ${Arr.join(bad, "; ")}` });
  return { spans: rows, events: yield* eventsOf(database, traceIdsOf(calls)) } satisfies Kept;
});

/**
 * What the api kept of `calls` in its own tables (`app.spans`, `app.events`): parity's other record until the retire.
 * A call through the stage's own endpoint is read in its database; one made at another world's endpoint in that
 * world's, found as the checks find it (`OtherWorlds`); one at an endpoint no known world answers at, nowhere.
 */
export const appKeptOf = Effect.fn(
  Pipeline.checkCall.spans.read.name,
  stepOptions(Pipeline.checkCall.spans.read),
)(function* (database: Redacted.Redacted, calls: ReadonlyArray<Pick<Call, "traceId" | "at">>) {
  const own = yield* telemetryOf(database, traceIdsOf(Arr.filter(calls, (call) => call.at === null)));
  const others = yield* Effect.serviceOption(OtherWorlds);
  const endpoints = Arr.dedupe(
    Arr.filterMap(calls, (call) => (call.at === null ? Result.failVoid : Result.succeed(call.at))),
  );
  const elsewhere = Option.isNone(others)
    ? []
    : yield* Effect.forEach(endpoints, (endpoint) =>
        Effect.flatMap(others.value.databaseAt(endpoint), (theirs) =>
          Option.match(theirs, {
            onNone: () => Effect.succeed<Kept>({ spans: [], events: [] }),
            onSome: (where) => telemetryOf(where, traceIdsOf(Arr.filter(calls, (call) => call.at === endpoint))),
          }),
        ),
      );
  return {
    spans: Arr.flatten([own.spans, ...Arr.map(elsewhere, (kept) => kept.spans)]),
    events: Arr.flatten([own.events, ...Arr.map(elsewhere, (kept) => kept.events)]),
  } satisfies Kept;
});

/** What a maker of calls outside a journey's own run gets of them: each checked, or a plumbing failure and no checks. */
export interface CheckedOrPlumbing {
  readonly checked: ReadonlyArray<CheckedCall>;
  readonly plumbing: ReadonlyArray<string>;
}

/**
 * Every call of `calls` checked against what `kept` reads of them; or, when that cannot be read whole (an answered
 * call's trace missing from the tap, a tapped span with no outcome), no checks and one plumbing failure line. A tap
 * that misses a call is the runner's failure, never the builder's missing spans, and it is never swallowed.
 */
export const checkedOrPlumbing = <E, R>(
  calls: ReadonlyArray<Call>,
  kept: Effect.Effect<Kept, E, R>,
): Effect.Effect<CheckedOrPlumbing, never, R> =>
  Effect.map(
    Effect.exit(kept),
    Exit.match({
      onSuccess: (found) => ({ checked: Arr.map(calls, (call) => checkCall(call, found)), plumbing: [] }),
      onFailure: (cause) => ({
        checked: [],
        plumbing: [`plumbing: what the api kept of ${calls.length} calls could not be read: ${describe(cause)}`],
      }),
    }),
  );

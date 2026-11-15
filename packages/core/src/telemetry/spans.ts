// One span per call, keyed by the caller's trace id, and every span beneath it handed to the `SpanSink`.
//
// Every operation runs under the blueprint's `Telemetry` middleware and one sign-in middleware. Effect applies a
// group's middlewares in the order they were added, each around the last, so sign-in is outermost: a call refused
// at sign-in never reaches `Telemetry`. So whichever middleware runs first opens the call's span (`measured`), and
// any middleware inside it joins that span. Either order gives each call exactly one span named after its operation.
//
// Inside a Worker the clock moves only on I/O, so a span with none, such as an empty handler's, measures 0 ms
// (spikes/pipeline).
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import * as HttpTraceContext from "effect/http/HttpTraceContext";
import type * as Headers from "effect/http/Headers";
import type * as Rpc from "effect/rpc/Rpc";
import { CurrentCall } from "@capxul/blueprint";
import { callAttributes, declaredOf, isPostgresRoundTrip, type SpanAttributes, type Where } from "./attributes.ts";
import type { SpanSink } from "./sink.ts";

/** How a span ended: it succeeded, failed with a typed error, died with a defect, or was interrupted. */
export type SpanOutcome = "success" | "failure" | "defect" | "interrupted";

export interface KeptSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly outcome: SpanOutcome;
  readonly durationMs: number;
  readonly endedMs: number;
  /** The declared attributes it carries (attributes.ts), or null: only a call's own span has them. */
  readonly attributes: SpanAttributes | null;
  /** True for a round trip of Core's Postgres driver, which the call's `db.query_ms` sums. */
  readonly roundTrip: boolean;
}

export const outcomeOf = (exit: Exit.Exit<unknown, unknown>): SpanOutcome => {
  if (Exit.isSuccess(exit)) return "success";
  if (Cause.hasDies(exit.cause)) return "defect";
  return Cause.hasFails(exit.cause) ? "failure" : "interrupted";
};

/** Effect's own span, which also hands itself to `keep` the moment it ends. */
class KeepingSpan extends Tracer.NativeSpan {
  readonly keep: (span: KeptSpan) => void;
  constructor(options: ConstructorParameters<typeof Tracer.NativeSpan>[0], keep: (span: KeptSpan) => void) {
    super(options);
    this.keep = keep;
  }
  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (this.status._tag === "Ended") return;
    super.end(endTime, exit);
    this.keep({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: Option.getOrNull(Option.map(this.parent, (parent) => parent.spanId)),
      name: this.name,
      outcome: outcomeOf(exit),
      durationMs: Number(endTime - this.startTime) / 1_000_000,
      endedMs: Number(endTime / 1_000_000n),
      attributes: declaredOf(this.attributes),
      roundTrip: isPostgresRoundTrip(this.kind, this.attributes),
    });
  }
}

/** A tracer that keeps every span it ends. One per call, so one call's spans never mix with another's. */
export const keepingTracer = (keep: (span: KeptSpan) => void): Tracer.Tracer =>
  Tracer.make({ span: (options) => new KeepingSpan(options, keep) });

/** True inside a call whose span is already open. */
const Measuring = Context.Reference<boolean>("capxul/core/Measuring", { defaultValue: () => false });

/** What a middleware is told about the call it wraps. */
export interface CallOptions {
  readonly rpc: Rpc.AnyWithProps;
  readonly headers: Headers.Headers;
}

/** Gives `effect` its `CurrentCall`, read from the call's open span. */
const withCurrentCall = <A, E, R>(options: CallOptions, effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.orDie(Effect.currentSpan), (span) =>
    Effect.provideService(effect, CurrentCall, { traceId: span.traceId, operation: options.rpc._tag }),
  );

/**
 * Runs `effect` in the call's span. The first middleware to call this opens the span, named after the operation,
 * under the trace id of the caller's `traceparent` header (a new trace when there is none), and hands it and every
 * span beneath it to `sink` after the call ends and before the answer leaves. A middleware inside it joins the open
 * span. A call whose spans cannot be kept dies: a call that cannot be measured does not count.
 *
 * Just before it ends, the call's span is given its attributes (attributes.ts): where it ran, from `placement`, and
 * the round trips to Postgres among the spans kept beneath it by then.
 */
export const measured = Effect.fnUntraced(function* <A, E, R>(
  sink: SpanSink["Service"],
  placement: Where,
  options: CallOptions,
  effect: Effect.Effect<A, E, R>,
) {
  if (yield* Measuring) return yield* withCurrentCall(options, effect);
  const kept: Array<KeptSpan> = [];
  const caller = HttpTraceContext.w3c(options.headers);
  const annotate = (span: Tracer.Span) =>
    Effect.sync(() => {
      for (const [key, value] of callAttributes(
        placement,
        Arr.filter(kept, (each) => each.roundTrip),
      ))
        span.attribute(key, value);
    });
  const exit = yield* Effect.useSpan(
    options.rpc._tag,
    { kind: "server", root: Option.isNone(caller), parent: Option.getOrUndefined(caller) },
    (span) =>
      withCurrentCall(options, effect).pipe(
        Effect.withParentSpan(span),
        Effect.provideService(Measuring, true),
        Effect.ensuring(annotate(span)),
      ),
  ).pipe(Effect.withTracer(keepingTracer((span) => kept.push(span))), Effect.exit);
  yield* Arr.match(kept, { onEmpty: () => Effect.void, onNonEmpty: sink.keep });
  return yield* exit;
});

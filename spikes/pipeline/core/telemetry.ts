// The measurement plumbing of Core. Two things a handler gets for nothing, and the runner can read afterwards:
//
//   spans   Every Rpc call runs in a span named after its operation, under the trace id the caller supplied in
//           the `traceparent` header. That span and every span opened beneath it (each SQL statement, anything
//           a handler wraps in `Effect.withSpan`) is kept in `app.spans` once the call ends.
//   events  `Events.emit(operation, event)` writes a declared event to `app.events` through the handler's own
//           SqlClient, so inside `sql.withTransaction` the event commits or rolls back with the write it reports.
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import * as HttpTraceContext from "effect/http/HttpTraceContext";
import type { SqlError } from "effect/sql/SqlError";
import * as SqlClient from "effect/sql/SqlClient";
import { CurrentCall, Telemetry, type EventOf, type Operation } from "../contract/door.ts";

/** How a span ended: it succeeded, failed with a typed error, died with a defect, or was interrupted. */
export type SpanOutcome = "success" | "failure" | "defect" | "interrupted";

interface KeptSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly outcome: SpanOutcome;
  readonly durationMs: number;
  readonly endedAtMs: number;
}

const outcomeOf = (exit: Exit.Exit<unknown, unknown>): SpanOutcome =>
  Exit.isSuccess(exit) ? "success" : Cause.hasDies(exit.cause) ? "defect" : Cause.hasFails(exit.cause) ? "failure" : "interrupted";

/** Effect's own span, which also puts itself in `kept` the moment it ends. */
class KeepingSpan extends Tracer.NativeSpan {
  constructor(
    options: ConstructorParameters<typeof Tracer.NativeSpan>[0],
    private readonly kept: Array<KeptSpan>,
  ) {
    super(options);
  }
  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (this.status._tag === "Ended") return;
    super.end(endTime, exit);
    this.kept.push({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: Option.getOrNull(Option.map(this.parent, (parent) => parent.spanId)),
      name: this.name,
      outcome: outcomeOf(exit),
      durationMs: Number(endTime - this.startTime) / 1_000_000,
      endedAtMs: Number(endTime / 1_000_000n),
    });
  }
}

/** A tracer that keeps every span it ends in `kept`. One per call, so one call's spans never mix with another's. */
const keepingTracer = (kept: Array<KeptSpan>): Tracer.Tracer => Tracer.make({ span: (options) => new KeepingSpan(options, kept) });

/**
 * The server half of the contract's `Telemetry` middleware. The spans are written after the handler has ended and
 * before the answer leaves, so whoever holds the answer can already read the spans. A call whose spans cannot be
 * written dies: a call that cannot be measured does not count.
 */
export const TelemetryLive = Layer.effect(
  Telemetry,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const write = (spans: ReadonlyArray<KeptSpan>) =>
      Arr.match(spans, {
        onEmpty: () => Effect.void,
        onNonEmpty: (rows) =>
          sql`insert into app.spans ${sql.insert(
            Arr.map(rows, (span) => ({
              trace_id: span.traceId,
              span_id: span.spanId,
              parent_span_id: span.parentSpanId,
              name: span.name,
              outcome: span.outcome,
              duration_ms: span.durationMs,
              at: new Date(span.endedAtMs),
            })),
          )}`.pipe(Effect.asVoid, Effect.orDie),
      });
    return Telemetry.of((handler, { rpc, headers }) =>
      Effect.gen(function* () {
        const kept: Array<KeptSpan> = [];
        const caller = HttpTraceContext.w3c(headers);
        const exit = yield* Effect.useSpan(
          rpc._tag,
          { kind: "server", root: Option.isNone(caller), parent: Option.getOrUndefined(caller) },
          (span) =>
            handler.pipe(
              Effect.provideService(CurrentCall, { traceId: span.traceId, operation: rpc._tag }),
              Effect.withParentSpan(span),
            ),
        ).pipe(Effect.withTracer(keepingTracer(kept)), Effect.exit);
        yield* write(kept);
        return yield* exit;
      }),
    );
  }),
);

/** How a handler emits the events its operation declares. Anything else is a compile error. */
export class Events extends Context.Service<
  Events,
  {
    /**
     * Records `event` against the current call. Call it inside the same `sql.withTransaction` as the write it
     * reports: both then commit together or not at all.
     */
    readonly emit: <O extends Operation>(operation: O, event: EventOf<O>) => Effect.Effect<void, SqlError | Schema.SchemaError, CurrentCall>;
  }
>()("capxul/core/Events") {}

export const EventsLive = Layer.effect(
  Events,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return Events.of({
      emit: (operation, event) =>
        Effect.gen(function* () {
          const call = yield* CurrentCall;
          const name = (event as { readonly _tag: string })._tag;
          const declared = operation.emits.find((candidate) => candidate.identifier === name);
          if (declared === undefined) return yield* Effect.die(`${operation.rpc._tag} does not declare the event ${name}`);
          const { _tag, ...payload } = (yield* Schema.encodeUnknownEffect(Schema.toCodecJson(declared))(event)) as { readonly _tag: string };
          const at = new Date(yield* Clock.currentTimeMillis);
          yield* sql`insert into app.events ${sql.insert({ trace_id: call.traceId, operation: call.operation, event: name, payload: JSON.stringify(payload), at })}`;
        }),
    });
  }),
);

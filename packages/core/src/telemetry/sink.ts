// Where the spans of a call go. In a world they are rows of `app.spans` in the world's database, written through the
// call's own SqlClient, so the runner can read them back by trace id; a test keeps them in memory.
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type { KeptSpan } from "./spans.ts";

export class SpanSink extends Context.Service<
  SpanSink,
  {
    /** Keeps the spans of one call. A failure to keep them is a defect of the call. */
    readonly keep: (spans: Arr.NonEmptyReadonlyArray<KeptSpan>) => Effect.Effect<void>;
  }
>()("@capxul/core/telemetry/sink/SpanSink") {}

/** Writes every span of a call to `app.spans` in one statement (`migrations/0001_telemetry.sql`). */
export const SqlSpanSink = Layer.effect(
  SpanSink,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return SpanSink.of({
      keep: (spans) =>
        sql`insert into app.spans ${sql.insert(
          Arr.map(spans, (span) => ({
            trace_id: span.traceId,
            span_id: span.spanId,
            parent_span_id: span.parentSpanId,
            name: span.name,
            outcome: span.outcome,
            duration_ms: span.durationMs,
            ended_ms: span.endedMs,
          })),
        )}`.pipe(Effect.asVoid, Effect.orDie),
    });
  }),
);

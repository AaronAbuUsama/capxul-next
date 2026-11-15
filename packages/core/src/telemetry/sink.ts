// Where the spans of a call go. In a world they are rows of `app.spans` in the world's database, written through the
// call's own SqlClient, so the runner can read them back by trace id; a test keeps them in memory.
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { KeptSpan } from "./spans.ts";

export class SpanSink extends Context.Service<
  SpanSink,
  {
    /** Keeps the spans of one call. A failure to keep them is a defect of the call. */
    readonly keep: (spans: Arr.NonEmptyReadonlyArray<KeptSpan>) => Effect.Effect<void>;
  }
>()("@capxul/core/telemetry/sink/SpanSink") {}

/**
 * Writes every span of a call to `app.spans` in one statement (`migrations/0001_telemetry.sql`). Its attributes
 * (0009) are kept as jsonb with Postgres's own JSON parameter, never as JSON text.
 */
export const SqlSpanSink = Layer.effect(
  SpanSink,
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    return SpanSink.of({
      // One row per span, written as its own fragment: a JSON parameter is a fragment, which goes into the statement
      // only as part of a template, never as a value of `sql.insert` (the first world run with attributes, #122, died
      // so on every call: "Cannot infer a PostgreSQL type").
      keep: (spans) =>
        sql`insert into app.spans (trace_id, span_id, parent_span_id, name, outcome, duration_ms, ended_ms, attributes)
          values ${sql.csv(
            Arr.map(
              spans,
              (span) =>
                sql`(${span.traceId}, ${span.spanId}, ${span.parentSpanId}, ${span.name}, ${span.outcome}, ${span.durationMs}, ${span.endedMs}, ${span.attributes === null ? null : sql.json(span.attributes)})`,
            ),
          )}`.pipe(Effect.asVoid, Effect.orDie),
    });
  }),
);

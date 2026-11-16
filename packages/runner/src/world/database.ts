// The runner's way in to a stage's database: Neon's HTTPS SQL endpoint, the only way this container reaches Postgres
// (it has no TCP route out). Used to apply Core's migrations when a stage is created and to read back what Core kept
// about each call. The connection string travels in a header and is never logged or recorded.
import { Pipeline } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { pipe } from "effect/Function";
import * as Order from "effect/Order";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { SpanAttributes } from "@capxul/core";
import { RunnerFailure } from "../failure.ts";
import { stepOptions } from "../telemetry/step.ts";

const Rows = Schema.Struct({ rows: Schema.Array(Schema.Unknown) });
const Refusal = Schema.Struct({ message: Schema.String });

/** The host of a Postgres connection string, which is also where its `/sql` endpoint answers. */
export const hostOf = (uri: string): string =>
  pipe(Str.split(uri, "@"), Arr.lastNonEmpty, Str.split("/"), Arr.headNonEmpty, Str.split(":"), Arr.headNonEmpty);

/**
 * POSTs one body to the database's `/sql` endpoint. A database with no host (an empty connection string: a stage with
 * no world of its own) is the runner's plumbing failure, said so, and nothing is sent.
 */
const post = Effect.fnUntraced(function* (database: Redacted.Redacted, body: object) {
  const uri = Redacted.value(database);
  if (Str.isEmpty(hostOf(uri)))
    return yield* RunnerFailure.make({
      step: "database",
      message: "plumbing: a database with no host was read (an empty connection string), so nothing was sent",
    });
  const response = yield* HttpClient.execute(
    HttpClientRequest.post(`https://${hostOf(uri)}/sql`).pipe(
      HttpClientRequest.setHeader("Neon-Connection-String", uri),
      HttpClientRequest.bodyJsonUnsafe(body),
    ),
  );
  const answer = yield* response.json;
  if (response.status === 200) return answer;
  const refusal = yield* Schema.decodeUnknownEffect(Refusal)(answer).pipe(
    Effect.orElseSucceed(() => ({ message: "no message" })),
  );
  return yield* RunnerFailure.make({ step: "database", message: `${response.status}: ${refusal.message}` });
});

/** One statement with positional parameters (`$1`, `$2`, ...); returns its rows. */
export const query = (database: Redacted.Redacted, sql: string, params: ReadonlyArray<unknown> = []) =>
  post(database, { query: sql, params }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Rows)),
    Effect.map((answer) => answer.rows),
  );

/** The statements of one migration file: comment lines dropped, split at `;`. Keep `;` out of strings and bodies. */
export const statementsOf = (file: string): ReadonlyArray<string> =>
  pipe(
    Str.split(file, "\n"),
    Arr.filter((line) => !Str.startsWith("--")(Str.trimStart(line))),
    Arr.join("\n"),
    Str.split(";"),
    Arr.map(Str.trim),
    Arr.filter(Str.isNonEmpty),
  );

/** Applies every `.sql` file in `directory`, in name order, as one transaction: all of it or none of it. */
export const migrate = Effect.fn(
  Pipeline.runPrepare.spans.migrate.name,
  stepOptions(Pipeline.runPrepare.spans.migrate),
)(function* (database: Redacted.Redacted, directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const files = Arr.sort(Arr.filter(yield* fs.readDirectory(directory), Str.endsWith(".sql")), Order.String);
  const statements = Arr.flatten(
    yield* Effect.forEach(files, (name) => Effect.map(fs.readFileString(`${directory}/${name}`), statementsOf)),
  );
  yield* post(database, { queries: Arr.map(statements, (statement) => ({ query: statement, params: [] })) });
  return files;
});

/** A server span Core kept for a call (`app.spans`). */
export const SpanRow = Schema.Struct({
  trace_id: Schema.String,
  span_id: Schema.String,
  parent_span_id: Schema.NullOr(Schema.String),
  name: Schema.String,
  outcome: Schema.String,
  duration_ms: Schema.Finite,
  /** When the span ended, in epoch milliseconds by the Worker's clock. */
  ended_ms: Schema.Finite,
  /** Its declared attributes (Core's `SpanAttributes`): null on every span but a call's own. */
  attributes: SpanAttributes.pipe(Schema.NullOr, Schema.optional),
});
export type SpanRow = typeof SpanRow.Type;

/** An event Core recorded for a call (`app.events`). */
export const EventRow = Schema.Struct({
  trace_id: Schema.String,
  operation: Schema.String,
  event: Schema.String,
  payload: Schema.Unknown,
});
export type EventRow = typeof EventRow.Type;

export interface Kept {
  readonly spans: ReadonlyArray<SpanRow>;
  readonly events: ReadonlyArray<EventRow>;
}

/** The events Core recorded under the given trace ids (`app.events`), in the order it wrote them. */
export const eventsOf = (database: Redacted.Redacted, traceIds: ReadonlyArray<string>) =>
  Arr.isReadonlyArrayEmpty(traceIds)
    ? Effect.succeed<ReadonlyArray<EventRow>>([])
    : query(
        database,
        "select trace_id, operation, event, payload from app.events where trace_id = any($1) order by id",
        [traceIds],
      ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(EventRow))));

/**
 * Everything Core kept under the given trace ids in its own tables, in the order it was written: `app.spans` and
 * `app.events`. Since the flip the checks read the spans from the tap (telemetry/kept.ts); this is the side-by-side
 * parity's other record until the retire.
 */
export const telemetryOf = Effect.fn(
  Pipeline.checkCall.spans.read.name,
  stepOptions(Pipeline.checkCall.spans.read),
)(function* (database: Redacted.Redacted, traceIds: ReadonlyArray<string>) {
  if (traceIds.length === 0) return { spans: [], events: [] } satisfies Kept;
  const spans = yield* query(
    database,
    "select trace_id, span_id, parent_span_id, name, outcome, duration_ms, ended_ms, attributes from app.spans where trace_id = any($1) order by id",
    [traceIds],
  );
  const events = yield* query(
    database,
    "select trace_id, operation, event, payload from app.events where trace_id = any($1) order by id",
    [traceIds],
  );
  return {
    spans: yield* Schema.decodeUnknownEffect(Schema.Array(SpanRow))(spans),
    events: yield* Schema.decodeUnknownEffect(Schema.Array(EventRow))(events),
  } satisfies Kept;
});

// The runner's way in to a world's database: Neon's HTTPS SQL endpoint, the only way this container can reach
// Postgres (it has no TCP route out). Used for two things: applying Core's migrations when a world is created,
// and reading back what Core kept about each call.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

export class DatabaseRefused extends Schema.TaggedError<DatabaseRefused>()("DatabaseRefused", {
  status: Schema.Number,
  message: Schema.String,
}) {}

const Rows = Schema.Struct({ rows: Schema.Array(Schema.Unknown) });
const Refusal = Schema.Struct({ message: Schema.String });

/** POSTs one body to the database's `/sql` endpoint. The connection string travels in a header and is never logged. */
const post = (database: Redacted.Redacted<string>, body: unknown) =>
  Effect.gen(function* () {
    const uri = Redacted.value(database);
    const response = yield* HttpClient.execute(
      HttpClientRequest.post(`https://${new URL(uri).hostname}/sql`).pipe(
        HttpClientRequest.setHeader("Neon-Connection-String", uri),
        HttpClientRequest.bodyJsonUnsafe(body),
      ),
    );
    const answer = yield* response.json;
    if (response.status === 200) return answer;
    const refusal = yield* Schema.decodeUnknownEffect(Refusal)(answer).pipe(Effect.orElseSucceed(() => ({ message: "no message" })));
    return yield* new DatabaseRefused({ status: response.status, message: refusal.message });
  }).pipe(Effect.withSpan("database.post"));

/** One statement with positional parameters (`$1`, `$2`, ...); returns its rows. */
export const query = (database: Redacted.Redacted<string>, sql: string, params: ReadonlyArray<unknown> = []) =>
  post(database, { query: sql, params }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Rows)),
    Effect.map((answer) => answer.rows),
  );

/** The statements of one migration file: comment lines dropped, split at `;`. Keep `;` out of strings and bodies. */
export const statementsOf = (file: string): ReadonlyArray<string> =>
  file
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");

/** Applies every `.sql` file in `directory`, in name order, as one transaction: all of it or none of it. */
export const migrate = (database: Redacted.Redacted<string>, directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = (yield* fs.readDirectory(directory)).filter((name) => name.endsWith(".sql")).sort();
    const statements = Arr.flatten(yield* Effect.forEach(files, (name) => Effect.map(fs.readFileString(`${directory}/${name}`), statementsOf)));
    yield* post(database, { queries: statements.map((statement) => ({ query: statement, params: [] })) });
    return files;
  }).pipe(Effect.withSpan("database.migrate"));

/** A server span Core kept for a call. */
export const SpanRow = Schema.Struct({
  trace_id: Schema.String,
  name: Schema.String,
  outcome: Schema.String,
  duration_ms: Schema.Number,
});
export type SpanRow = typeof SpanRow.Type;

/** An event Core recorded for a call. */
export const EventRow = Schema.Struct({
  trace_id: Schema.String,
  operation: Schema.String,
  event: Schema.String,
  payload: Schema.Unknown,
});
export type EventRow = typeof EventRow.Type;

/** Everything Core kept under the given trace ids: the spans and the events, in the order they were written. */
export const telemetryOf = (database: Redacted.Redacted<string>, traceIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (traceIds.length === 0) return { spans: [] as ReadonlyArray<SpanRow>, events: [] as ReadonlyArray<EventRow> };
    const spans = yield* query(database, "select trace_id, name, outcome, duration_ms from app.spans where trace_id = any($1) order by id", [traceIds]);
    const events = yield* query(database, "select trace_id, operation, event, payload from app.events where trace_id = any($1) order by id", [traceIds]);
    return {
      spans: yield* Schema.decodeUnknownEffect(Schema.Array(SpanRow))(spans),
      events: yield* Schema.decodeUnknownEffect(Schema.Array(EventRow))(events),
    };
  }).pipe(Effect.withSpan("database.telemetry"));

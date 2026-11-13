// The way in to a world's database from outside Cloudflare: Neon's HTTPS SQL endpoint. An agent's container has no
// TCP route out, so this is how migrations are applied when a world is created and how a run reads what it wrote.
// The connection string travels in a request header and is never logged or printed.
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
    const refusal = yield* Schema.decodeUnknownEffect(Refusal)(answer).pipe(
      Effect.orElseSucceed(() => ({ message: "no message" })),
    );
    return yield* new DatabaseRefused({ status: response.status, message: refusal.message });
  }).pipe(Effect.scoped, Effect.withSpan("world.database.post"));

/** One statement with positional parameters (`$1`, `$2`, ...); returns its rows. */
export const query = (database: Redacted.Redacted<string>, sql: string, params: ReadonlyArray<unknown> = []) =>
  post(database, { query: sql, params }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Rows)),
    Effect.map((answer) => answer.rows),
  );

const Results = Schema.Struct({ results: Schema.Array(Rows) });

/** Several statements as one transaction: all of them or none. Returns each statement's rows. */
export const transaction = (
  database: Redacted.Redacted<string>,
  queries: ReadonlyArray<{ readonly query: string; readonly params: ReadonlyArray<unknown> }>,
) =>
  post(database, { queries }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Results)),
    Effect.map((answer) => answer.results.map((result) => result.rows)),
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

const Applied = Schema.Array(Schema.Struct({ name: Schema.String }));

/**
 * Applies the `.sql` files of `directory` that the database has not seen, in name order, as one transaction: all of
 * them or none. What has been applied is kept in `world.migrations`, so a world forked from another, which already
 * holds its parent's schema, is given only what its parent lacked.
 */
export const migrate = Effect.fn("world.database.migrate")(function* (
  database: Redacted.Redacted<string>,
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* post(database, {
    queries: [
      { query: "create schema if not exists world", params: [] },
      {
        query:
          "create table if not exists world.migrations (name text primary key, applied_at timestamptz not null default now())",
        params: [],
      },
    ],
  });
  const applied = yield* query(database, "select name from world.migrations").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Applied)),
  );
  const seen = new Set(applied.map((row) => row.name));
  const files = (yield* fs.readDirectory(directory)).filter((name) => name.endsWith(".sql") && !seen.has(name)).sort();
  if (files.length === 0) return files;
  const queries = Arr.flatten(
    yield* Effect.forEach(files, (name) =>
      Effect.map(fs.readFileString(`${directory}/${name}`), (text) => [
        ...statementsOf(text).map((statement) => ({ query: statement, params: [] as ReadonlyArray<unknown> })),
        { query: "insert into world.migrations (name) values ($1)", params: [name] },
      ]),
    ),
  );
  yield* post(database, { queries });
  return files;
});

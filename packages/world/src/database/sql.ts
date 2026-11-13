// The way in to a world's database from outside Cloudflare: Neon's HTTPS SQL endpoint. An agent's container has no
// TCP route out, so this is how migrations are applied when a world is created and how a run reads what it wrote.
// The connection string travels in a request header and is never logged or printed.
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
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { DatabaseRefused } from "../failures.ts";

/** One statement and its positional parameters (`$1`, `$2`, ...). */
export interface Statement {
  readonly query: string;
  readonly params: ReadonlyArray<unknown>;
}

const Rows = Schema.Struct({ rows: Schema.Array(Schema.Unknown) });
const Results = Schema.Struct({ results: Schema.Array(Rows) });
const Refusal = Schema.Struct({ message: Schema.String });

const hostOf = (uri: string): string => new URL(uri).hostname;

/** What the endpoint takes: one statement, or several as one transaction. */
type Body =
  | { readonly query: string; readonly params: ReadonlyArray<unknown> }
  | { readonly queries: ReadonlyArray<Statement> };

/** Sends one body to the endpoint and decodes a 200 answer with `schema`; anything else is the database's refusal. */
const post = Effect.fn("world.database.post")(function* <S extends Schema.Constraint>(
  database: Redacted.Redacted,
  body: Body,
  schema: S,
) {
  const uri = Redacted.value(database);
  const response = yield* HttpClient.execute(
    HttpClientRequest.post(`https://${hostOf(uri)}/sql`).pipe(
      HttpClientRequest.setHeader("Neon-Connection-String", uri),
      HttpClientRequest.bodyJsonUnsafe(body),
    ),
  );
  if (response.status === 200) return yield* HttpClientResponse.schemaBodyJson(schema)(response);
  const refusal = yield* HttpClientResponse.schemaBodyJson(Refusal)(response).pipe(
    Effect.orElseSucceed(() => ({ message: "no message" })),
  );
  return yield* DatabaseRefused.make({ status: response.status, message: refusal.message });
}, Effect.scoped);

/** One statement with positional parameters; returns its rows. */
export const query = (database: Redacted.Redacted, sql: string, params: ReadonlyArray<unknown> = []) =>
  post(database, { query: sql, params }, Rows).pipe(Effect.map((answer) => answer.rows));

/** Several statements as one transaction: all of them or none. Returns each statement's rows. */
export const transaction = (database: Redacted.Redacted, queries: ReadonlyArray<Statement>) =>
  post(database, { queries }, Results).pipe(Effect.map((answer) => Arr.map(answer.results, (result) => result.rows)));

/** The statements of one migration file: comment lines dropped, split at `;`. Keep `;` out of strings and bodies. */
export const statementsOf = (file: string): ReadonlyArray<string> =>
  pipe(
    Str.split(file, "\n"),
    Arr.filter((line) => !pipe(line, Str.trimStart, Str.startsWith("--"))),
    Arr.join("\n"),
    Str.split(";"),
    Arr.map(Str.trim),
    Arr.filter(Str.isNonEmpty),
  );

const Applied = Schema.Array(Schema.Struct({ name: Schema.String }));

const SETUP: ReadonlyArray<Statement> = [
  { query: "create schema if not exists world", params: [] },
  {
    query:
      "create table if not exists world.migrations (name text primary key, applied_at timestamptz not null default now())",
    params: [],
  },
];

/**
 * Applies the `.sql` files of `directory` that the database has not seen, in name order, as one transaction: all of
 * them or none. What has been applied is kept in `world.migrations`, so a world forked from another, which already
 * holds its parent's schema, is given only what its parent lacked.
 */
export const migrate = Effect.fn("world.database.migrate")(function* (database: Redacted.Redacted, directory: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* transaction(database, SETUP);
  const applied = yield* query(database, "select name from world.migrations").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Applied)),
    Effect.map(Arr.map((row) => row.name)),
  );
  const files = pipe(
    yield* fs.readDirectory(directory),
    Arr.filter((name) => Str.endsWith(".sql")(name) && !Arr.contains(applied, name)),
  );
  const ordered = Arr.sort(files, Order.String);
  if (Arr.isReadonlyArrayEmpty(ordered)) return ordered;
  const queries = yield* Effect.forEach(ordered, (name) =>
    Effect.map(fs.readFileString(`${directory}/${name}`), (text) =>
      Arr.append(
        Arr.map(statementsOf(text), (statement): Statement => ({ query: statement, params: [] })),
        { query: "insert into world.migrations (name) values ($1)", params: [name] },
      ),
    ),
  );
  yield* transaction(database, Arr.flatten(queries));
  return ordered;
});

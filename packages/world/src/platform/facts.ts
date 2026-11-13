// A world's facts in its own database (packages/core/migrations/0002_world.sql): its grade, contracts, parent,
// clock, cast and companies, and its record (app.events). The platform writes them when it makes a world and reads
// them for world.show; the world's Core reads the same rows. Everything goes over Neon's HTTPS endpoint as
// statements with parameters; a JSON value is built in SQL (`jsonb_build_object`), never sent as JSON text.
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Values } from "@capxul/blueprint";
import { query, transaction, type Statement } from "../database/sql.ts";
import { PlatformFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import type { Member } from "./cast.ts";

/** A JSON value as the platform writes one: text, a number, a truth value, null, or an object of them. */
export type JsonValue = string | number | boolean | null | { readonly [key: string]: JsonValue };

/** `value` as an SQL expression whose parameters are appended after `params`. */
export const jsonSql = (value: JsonValue, params: Array<unknown>): string => {
  if (value === null) return "'null'::jsonb";
  if (Predicate.isString(value)) return `to_jsonb(${param(params, value)}::text)`;
  if (Predicate.isNumber(value)) return `to_jsonb(${param(params, value)}::double precision)`;
  if (Predicate.isBoolean(value)) return `to_jsonb(${param(params, value)}::boolean)`;
  const pairs = Arr.map(
    Rec.toEntries(value),
    ([key, inner]) => `${param(params, key)}::text, ${jsonSql(inner, params)}`,
  );
  return `jsonb_build_object(${Arr.join(pairs, ", ")})`;
};

const param = (params: Array<unknown>, value: unknown): string => {
  params.push(value);
  return `$${params.length}`;
};

/** One statement whose `$n` are numbered as `build` appends them. */
const statement = (build: (params: Array<unknown>) => string): Statement => {
  const params: Array<unknown> = [];
  return { query: build(params), params };
};

const failed = (cause: unknown) => PlatformFailed.make({ step: "facts", message: describeFailure(cause) });

export interface Birth {
  readonly grade: typeof Values.Grade.Type;
  readonly chainId: number;
  readonly contracts: typeof Values.ChainContracts.Type;
  readonly parent: typeof Values.Parent.Type | null;
  readonly clock: { readonly mode: typeof Values.ClockMode.Type; readonly worldMs: number; readonly hostMs: number };
  readonly cast: ReadonlyArray<Member>;
}

const clockRow = (clock: Birth["clock"]): Statement => ({
  query:
    "insert into app.clock (one, mode, world_ms, host_ms) values (true, $1, $2, $3) on conflict (one) do update set mode = excluded.mode, world_ms = excluded.world_ms, host_ms = excluded.host_ms",
  params: [clock.mode, clock.worldMs, clock.hostMs],
});

const parentJson = (parent: Birth["parent"]): JsonValue => parent;

/** Writes a new world's facts, in one transaction. */
export const writeBirth = (database: Redacted.Redacted, birth: Birth) =>
  transaction(database, [
    { query: "delete from app.world", params: [] },
    statement(
      (params) =>
        `insert into app.world (one, grade, chain_id, contracts, parent) values (true, ${param(params, birth.grade)}, ${param(params, birth.chainId)}, ${jsonSql(birth.contracts, params)}, ${jsonSql(parentJson(birth.parent), params)})`,
    ),
    clockRow(birth.clock),
    { query: "delete from app.cast", params: [] },
    ...Arr.map(birth.cast, (member, position) => ({
      query: "insert into app.cast (person, position, email, signer, safe) values ($1, $2, $3, $4, $5)",
      params: [member.person, position, member.email, member.signer, member.safe],
    })),
  ]).pipe(Effect.asVoid, Effect.mapError(failed));

/** Rewrites a restored world's parent and clock: the rest of its facts are its snapshot's. */
export const writeRestored = (database: Redacted.Redacted, parent: typeof Values.Parent.Type, clock: Birth["clock"]) =>
  transaction(database, [
    statement((params) => `update app.world set parent = ${jsonSql(parentJson(parent), params)}`),
    clockRow(clock),
  ]).pipe(Effect.asVoid, Effect.mapError(failed));

/** One event to write: its name and what it carries, already encoded as the record keeps it. */
export interface Emitted {
  readonly event: string;
  readonly carried: JsonValue;
}

/** Appends a call's events to the world's record, under the call's trace, at the world's time. */
export const emit = (
  database: Redacted.Redacted,
  call: { readonly traceId: string; readonly operation: string },
  events: ReadonlyArray<Emitted>,
  atMs: number,
) =>
  transaction(
    database,
    Arr.map(events, (event) =>
      statement(
        (params) =>
          `insert into app.events (trace_id, operation, event, payload, at_ms) values (${param(params, call.traceId)}, ${param(params, call.operation)}, ${param(params, event.event)}, ${jsonSql(event.carried, params)}, ${param(params, atMs)})`,
      ),
    ),
  ).pipe(Effect.asVoid, Effect.mapError(failed));

const Row = Schema.Struct({
  grade: Values.Grade,
  chain_id: Schema.Int,
  contracts: Values.ChainContracts,
  parent: Schema.NullOr(Values.Parent),
  mode: Values.ClockMode,
  world_ms: Schema.Finite,
  host_ms: Schema.Finite,
  head: Schema.Int,
  migrations: Schema.NullOr(Schema.String),
});
const CastRow = Schema.Struct({
  person: Schema.String,
  email: Schema.String,
  signer: Schema.String,
  safe: Schema.NullOr(Schema.String),
});
const CompanyRow = Schema.Struct({
  org: Schema.String,
  handle: Schema.String,
  name: Schema.String,
  site_state: Values.Company.fields.site.fields.state,
  site_url: Schema.NullOr(Schema.String),
});

const ONE = `select w.grade, w.chain_id, w.contracts, w.parent, c.mode, c.world_ms, c.host_ms,
  (select count(*)::int from app.events) as head,
  (select max(name) from world.migrations) as migrations
  from app.world w cross join app.clock c`;

/** An instant as the blueprint writes one, from epoch milliseconds. */
export const instantOf = (ms: number): string => DateTime.formatIso(DateTime.makeUnsafe(ms));

/** The world's clock now: frozen at its time, or running on from it at host time. */
export const clockNow = (
  row: { readonly mode: string; readonly world_ms: number; readonly host_ms: number },
  hostMs: number,
) => (row.mode === "frozen" ? row.world_ms : row.world_ms + (hostMs - row.host_ms));

/** Everything the world's database says of the world, its clock read at `hostMs`. */
export const readFacts = Effect.fn("platform.facts")(function* (database: Redacted.Redacted, hostMs: number) {
  const [rows, cast, companies] = yield* Effect.all(
    [
      query(database, ONE),
      query(database, "select person, email, signer, safe from app.cast order by position"),
      query(database, "select org, handle, name, site_state, site_url from app.companies order by position"),
    ],
    { concurrency: 3 },
  );
  const row = yield* Effect.fromOption(Arr.head(yield* Schema.decodeUnknownEffect(Schema.Array(Row))(rows))).pipe(
    Effect.mapError(() => "the world's database holds no facts of the world"),
  );
  const nowMs = clockNow(row, hostMs);
  return {
    grade: row.grade,
    chainId: row.chain_id,
    contracts: row.contracts,
    parent: row.parent,
    clock: { mode: row.mode, now: instantOf(nowMs) },
    clockMs: nowMs,
    recordHead: row.head,
    migrations: Option.getOrElse(Option.fromNullishOr(row.migrations), () => "none"),
    cast: yield* Schema.decodeUnknownEffect(Schema.Array(CastRow))(cast),
    companies: Arr.map(yield* Schema.decodeUnknownEffect(Schema.Array(CompanyRow))(companies), (company) => ({
      org: company.org,
      handle: company.handle,
      name: company.name,
      site: { state: company.site_state, url: company.site_url },
    })),
  };
}, Effect.mapError(failed));

export type Facts = Effect.Success<ReturnType<typeof readFacts>>;

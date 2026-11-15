// A world's facts in its own database (packages/core/migrations/0003_world.sql): its chain's contracts, its clock (in
// the shape Core's site operations keep it), its cast and its companies, and its record (app.events), whose latest
// `world_created` says its grade and its parent. The platform writes them when it makes a world and reads
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
import { transaction, type Statement } from "../../parts/database/sql.ts";
import { PlatformFailed } from "../../common/failures.ts";
import { describeFailure } from "../../common/describe.ts";
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
  readonly chainId: number;
  readonly contracts: typeof Values.ChainContracts.Type;
  readonly clock: { readonly mode: typeof Values.ClockMode.Type; readonly worldMs: number; readonly hostMs: number };
  readonly cast: ReadonlyArray<Member>;
}

/**
 * The clock as Core keeps it (packages/core, src/things/site-ops/clock.ts): a frozen clock's instant, or a running clock's
 * offset from host time, so that it reads `worldMs` at host time `hostMs`.
 */
const clockRow = (clock: Birth["clock"]): Statement => ({
  query:
    "insert into app.clock (id, mode, frozen_at_ms, offset_ms) values (1, $1, $2, $3) on conflict (id) do update set mode = excluded.mode, frozen_at_ms = excluded.frozen_at_ms, offset_ms = excluded.offset_ms",
  params: [clock.mode, clock.mode === "frozen" ? clock.worldMs : null, clock.worldMs - clock.hostMs],
});

/** Writes a new world's facts, in one transaction. */
export const writeBirth = (database: Redacted.Redacted, birth: Birth) =>
  transaction(database, [
    { query: "delete from app.world", params: [] },
    statement(
      (params) =>
        `insert into app.world (one, chain_id, contracts) values (true, ${param(params, birth.chainId)}, ${jsonSql(birth.contracts, params)})`,
    ),
    clockRow(birth.clock),
    { query: "delete from app.cast", params: [] },
    ...Arr.map(birth.cast, (member, position) => ({
      query: "insert into app.cast (person, position, email, signer, safe) values ($1, $2, $3, $4, $5)",
      params: [member.person, position, member.email, member.signer, member.safe],
    })),
  ]).pipe(Effect.asVoid, Effect.mapError(failed));

/**
 * Sets a restored world's clock to its snapshot's: the rest of its facts are its snapshot's, and its parent is what
 * its own `world_created` carries.
 */
export const writeRestored = (database: Redacted.Redacted, clock: Birth["clock"]) =>
  transaction(database, [clockRow(clock)]).pipe(Effect.asVoid, Effect.mapError(failed));

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
  chain_id: Schema.Int,
  contracts: Values.ChainContracts,
  mode: Schema.NullOr(Values.ClockMode),
  frozen_at_ms: Schema.NullOr(Schema.Finite),
  offset_ms: Schema.NullOr(Schema.Finite),
  head: Schema.Int,
  migrations: Schema.NullOr(Schema.String),
  /** What the record's latest `world_created` carried of how the world was made: its grade and its parent. */
  born: Schema.NullOr(Schema.Struct({ grade: Values.Grade, parent: Schema.NullOr(Values.Parent) })),
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

/** What `readFacts` asks of the world's database: the world, its clock, its record's head, its migrations and birth. */
export const ONE = `select w.chain_id, w.contracts, c.mode, c.frozen_at_ms, c.offset_ms,
  (select count(*)::int from app.events) as head,
  (select max(name) from world.migrations) as migrations,
  (select jsonb_build_object('grade', payload->'grade', 'parent', payload->'parent') from app.events
    where event = 'world_created' order by id desc limit 1) as born
  from app.world w left join app.clock c on true`;

export const CAST = "select person, email, signer, safe from app.cast order by position";
export const COMPANIES = "select org, handle, name, site_state, site_url from app.companies order by position";

/** An instant as the blueprint writes one, from epoch milliseconds. */
export const instantOf = (ms: number): string => DateTime.formatIso(DateTime.makeUnsafe(ms));

/**
 * The world's clock now, as Core reads it (packages/core, src/things/site-ops/clock.ts): frozen at its instant, or running
 * at host time plus its offset. No row is a running clock at host time.
 */
export const clockNow = (
  row: {
    readonly mode: string | null;
    readonly frozen_at_ms: number | null;
    readonly offset_ms: number | null;
  },
  hostMs: number,
) => (row.mode === "frozen" && row.frozen_at_ms !== null ? row.frozen_at_ms : hostMs + (row.offset_ms ?? 0));

/**
 * The world's facts from the rows its database answered to `ONE`, `CAST` and `COMPANIES`, its clock read at `hostMs`.
 * Rows written by earlier code decode here once the migrations since have moved them (test/old-rows.test.ts).
 */
export const factsOf = Effect.fnUntraced(function* (rows: unknown, cast: unknown, companies: unknown, hostMs: number) {
  const row = yield* Effect.fromOption(Arr.head(yield* Schema.decodeUnknownEffect(Schema.Array(Row))(rows))).pipe(
    Effect.mapError(() => "the world's database holds no facts of the world"),
  );
  const nowMs = clockNow(row, hostMs);
  return {
    born: row.born,
    chainId: row.chain_id,
    contracts: row.contracts,
    clock: { mode: row.mode ?? "running", now: instantOf(nowMs) },
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
});

const FACTS: ReadonlyArray<Statement> = [
  { query: ONE, params: [] },
  { query: CAST, params: [] },
  { query: COMPANIES, params: [] },
];

/**
 * Everything the world's database says of the world, its clock read at `hostMs`: its three reads sent as one request
 * (one round trip, and one snapshot of the database).
 */
export const readFacts = Effect.fn("platform.facts")(function* (database: Redacted.Redacted, hostMs: number) {
  const [rows = [], cast = [], companies = []] = yield* transaction(database, FACTS);
  return yield* factsOf(rows, cast, companies, hostMs);
}, Effect.mapError(failed));

export type Facts = Effect.Success<ReturnType<typeof readFacts>>;

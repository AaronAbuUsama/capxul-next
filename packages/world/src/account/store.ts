// What the platform keeps of its own, in the schema `platform` of the registry's branch (the platform stage's), beside
// the registry of world names: the spans of every platform call, which world each successful call acted on (its
// events are in that world's record), and every snapshot a world has saved. The world group's spans stay in each
// world's own database, where its Core keeps them.
import { type KeptSpan, SPAN_ATTRIBUTES, SpanAttributes, SpanSink } from "@capxul/core";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as HttpClient from "effect/http/HttpClient";
import { query, transaction } from "../parts/database/sql.ts";
import { PlatformFailed } from "../common/failures.ts";
import { registry } from "../things/registry/reserve.ts";
import { describeFailure } from "../common/describe.ts";

const failed = (step: PlatformFailed["step"]) => (cause: unknown) =>
  PlatformFailed.make({ step, message: describeFailure(cause) });

const TABLES = [
  "create schema if not exists platform",
  "create table if not exists platform.spans (id bigint generated always as identity primary key, trace_id text not null, span_id text not null, parent_span_id text, name text not null, outcome text not null, duration_ms double precision not null, ended_ms double precision not null)",
  "create index if not exists platform_spans_trace on platform.spans (trace_id)",
  // A span's declared attributes (Core's src/telemetry/attributes.ts), as Core exports them on the span.
  "alter table platform.spans add column if not exists attributes jsonb",
  "create table if not exists platform.calls (trace_id text primary key, stage text not null)",
  "create table if not exists platform.snapshots (stage text not null, snapshot text not null, branch_id text not null, record_seq integer not null, clock_mode text not null, clock_ms double precision not null, template boolean not null, saved_at text not null, companies integer not null, migrations text not null, primary key (stage, snapshot))",
];

/** Creates the platform's tables when they are missing. Safe to run again. */
export const prepareStore = Effect.flatMap(registry, (database) =>
  transaction(
    database,
    Arr.map(TABLES, (statement) => ({ query: statement, params: [] })),
  ),
).pipe(Effect.asVoid, Effect.mapError(failed("telemetry")));

/**
 * A span's declared attributes as jsonb, built by Postgres from one typed parameter each, so no JSON text is written
 * here: an attribute not set is left out, and a span with none keeps null.
 */
const attributesFrom = (colo: string, queryMs: string, queryCount: string) =>
  `nullif(jsonb_strip_nulls(jsonb_build_object('${SPAN_ATTRIBUTES.colo}', ${colo}::text, '${SPAN_ATTRIBUTES.queryMs}', ${queryMs}::float8, '${SPAN_ATTRIBUTES.queryCount}', ${queryCount}::int)), '{}'::jsonb)`;

/** Keeps every platform call's spans in `platform.spans`, where the runner reads them (a world's Core exports its own). */
export const PlatformSpanSink = (database: Redacted.Redacted) =>
  Layer.effect(
    SpanSink,
    Effect.map(Effect.context<HttpClient.HttpClient>(), (context) =>
      SpanSink.of({
        keep: (spans) =>
          Effect.gen(function* () {
            const params: Array<unknown> = [];
            const rows = Arr.map(spans, (span: KeptSpan) => {
              const base = params.length;
              params.push(
                span.traceId,
                span.spanId,
                span.parentSpanId,
                span.name,
                span.outcome,
                span.durationMs,
                span.endedMs,
                span.attributes?.[SPAN_ATTRIBUTES.colo] ?? null,
                span.attributes?.[SPAN_ATTRIBUTES.queryMs] ?? null,
                span.attributes?.[SPAN_ATTRIBUTES.queryCount] ?? null,
              );
              const at = (index: number) => `$${base + index + 1}`;
              return `(${Arr.join(Arr.makeBy(7, at), ", ")}, ${attributesFrom(at(7), at(8), at(9))})`;
            });
            yield* query(
              database,
              `insert into platform.spans (trace_id, span_id, parent_span_id, name, outcome, duration_ms, ended_ms, attributes) values ${Arr.join(rows, ", ")}`,
              params,
            );
          }).pipe(Effect.provide(context), Effect.orDie),
      }),
    ),
  );

/** Notes the world a successful call acted on, whose record holds the call's events. */
export const noteCall = (traceId: string, stage: string) =>
  Effect.flatMap(registry, (database) =>
    query(database, "insert into platform.calls (trace_id, stage) values ($1, $2) on conflict (trace_id) do nothing", [
      traceId,
      stage,
    ]),
  ).pipe(Effect.asVoid, Effect.mapError(failed("telemetry")));

const SpanRows = Schema.Array(
  Schema.Struct({
    trace_id: Schema.String,
    span_id: Schema.String,
    parent_span_id: Schema.NullOr(Schema.String),
    name: Schema.String,
    outcome: Schema.String,
    duration_ms: Schema.Finite,
    ended_ms: Schema.Finite,
    attributes: Schema.NullOr(SpanAttributes),
  }),
);
const CallRows = Schema.Array(Schema.Struct({ trace_id: Schema.String, stage: Schema.String }));

/** The spans of the platform calls under `traceIds`, and the world each successful one acted on. */
export const keptOf = (traceIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const database = yield* registry;
    const spans = yield* query(
      database,
      "select trace_id, span_id, parent_span_id, name, outcome, duration_ms, ended_ms, attributes from platform.spans where trace_id = any($1) order by id",
      [traceIds],
    ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(SpanRows)));
    const calls = yield* query(database, "select trace_id, stage from platform.calls where trace_id = any($1)", [
      traceIds,
    ]).pipe(Effect.flatMap(Schema.decodeUnknownEffect(CallRows)));
    return { spans, calls };
  }).pipe(Effect.mapError(failed("telemetry")));

/** A snapshot as the platform keeps it. */
export const SnapshotRow = Schema.Struct({
  stage: Schema.String,
  snapshot: Schema.String,
  branch_id: Schema.String,
  record_seq: Schema.Int,
  clock_mode: Schema.Literals(["frozen", "running"]),
  clock_ms: Schema.Finite,
  template: Schema.Boolean,
  saved_at: Schema.String,
  companies: Schema.Int,
  migrations: Schema.String,
});
export type SnapshotRow = typeof SnapshotRow.Type;

const COLUMNS =
  "stage, snapshot, branch_id, record_seq, clock_mode, clock_ms, template, saved_at, companies, migrations";

/** A world's snapshot by name, if it has one. */
export const snapshotOf = (stage: string, snapshot: string) =>
  Effect.flatMap(registry, (database) =>
    query(database, `select ${COLUMNS} from platform.snapshots where stage = $1 and snapshot = $2`, [stage, snapshot]),
  ).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SnapshotRow))),
    Effect.mapBoth({ onSuccess: Arr.head, onFailure: failed("snapshot") }),
  );

/** Every snapshot of a world, in the order they were saved (a replaced one where its new save puts it). */
export const snapshotsOf = (stage: string) =>
  Effect.flatMap(registry, (database) =>
    query(database, `select ${COLUMNS} from platform.snapshots where stage = $1 order by saved_at, snapshot`, [stage]),
  ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SnapshotRow))), Effect.mapError(failed("snapshot")));

const Counts = Schema.Array(Schema.Struct({ stage: Schema.String, snapshots: Schema.Int }));

/** How many snapshots each of `stages` keeps; a world that keeps none is not among them. */
export const snapshotCounts = (stages: ReadonlyArray<string>) =>
  Effect.flatMap(registry, (database) =>
    query(
      database,
      "select stage, count(*)::int as snapshots from platform.snapshots where stage = any($1) group by stage",
      [stages],
    ),
  ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Counts)), Effect.mapError(failed("snapshot")));

/** Keeps a snapshot, replacing one of the same name. */
export const keepSnapshot = (row: SnapshotRow) =>
  Effect.flatMap(registry, (database) =>
    query(
      database,
      `insert into platform.snapshots (${COLUMNS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (stage, snapshot) do update set branch_id = excluded.branch_id, record_seq = excluded.record_seq, clock_mode = excluded.clock_mode, clock_ms = excluded.clock_ms, template = excluded.template, saved_at = excluded.saved_at, companies = excluded.companies, migrations = excluded.migrations`,
      [
        row.stage,
        row.snapshot,
        row.branch_id,
        row.record_seq,
        row.clock_mode,
        row.clock_ms,
        row.template,
        row.saved_at,
        row.companies,
        row.migrations,
      ],
    ),
  ).pipe(Effect.asVoid, Effect.mapError(failed("snapshot")));

/** Forgets one snapshot of a world, once what it saved is gone. */
export const forgetSnapshot = (stage: string, snapshot: string) =>
  Effect.flatMap(registry, (database) =>
    query(database, "delete from platform.snapshots where stage = $1 and snapshot = $2", [stage, snapshot]),
  ).pipe(Effect.asVoid, Effect.mapError(failed("snapshot")));

/** Forgets a world's snapshots, once their branches are gone. */
export const forgetSnapshots = (stage: string) =>
  Effect.flatMap(registry, (database) =>
    query(database, "delete from platform.snapshots where stage = $1", [stage]),
  ).pipe(
    Effect.asVoid,
    // A platform whose store was never prepared holds no snapshot.
    Effect.catchTag("DatabaseRefused", () => Effect.void),
    Effect.mapError(failed("snapshot")),
  );

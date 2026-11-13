// The world's record (blueprint decisions.md, 8): the ordered list of every event emitted in the world, kept as rows
// of `app.events` (migrations/0001_telemetry.sql), the rows the runner's `events` check reads under each call's trace.
// An entry's position is its row's place in that order, so the positions run 1 to the head with no gap whatever a
// failed write burned of the table's identity, and a world made from a snapshot keeps its source's rows with its
// database. An entry's time is the world's, from its clock.
//
// A successful call records exactly what its declaration computes from its payload and answer
// (`operation.expected`), so an event cannot carry anything its blueprint declaration does not say.
import { CurrentCall, type Operation, type Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as PgClient from "@effect/sql-pg/PgClient";
import { instantOf, WorldClock } from "./clock.ts";

type Json = typeof Values.Json.Type;

/** One entry as it is kept: its position, the event's name, world time, the trace that emitted it, what it carried. */
export interface KeptEntry {
  readonly seq: number;
  readonly event: string;
  readonly atMs: number;
  readonly trace: string;
  readonly carried: Json;
}

/** One event to keep, as it is written. */
interface Written {
  readonly trace: string;
  readonly operation: string;
  readonly event: string;
  readonly atMs: number;
  readonly carried: Json;
}

export class WorldRecord extends Context.Service<
  WorldRecord,
  {
    /** Keeps the events a successful call of `operation` emits, under the call's trace, at the world's time now. */
    readonly emit: (
      operation: Operation,
      call: { readonly payload: unknown; readonly success: unknown },
    ) => Effect.Effect<void, never, CurrentCall>;
    /** The entries from `from` to `to` (both included), and the record's head. */
    readonly entries: (
      from: number,
      to: number | null,
    ) => Effect.Effect<{ readonly head: number; readonly entries: ReadonlyArray<KeptEntry> }>;
    /** What the record's latest `world_created` carried: how the world was made. None in a record without one. */
    readonly made: Effect.Effect<Option.Option<Json>>;
  }
>()("@capxul/core/site-ops/record/WorldRecord") {}

/** What a successful call of `operation` must keep, encoded as the record keeps it. A call that is not one dies. */
const written = (operation: Operation, call: { readonly payload: unknown; readonly success: unknown }) =>
  Effect.gen(function* () {
    const { traceId } = yield* CurrentCall;
    const { nowMs } = yield* Effect.flatMap(Effect.service(WorldClock), (clock) => clock.now);
    const expected = yield* Effect.fromOption(operation.expected(call)).pipe(
      Effect.mapError(() => `${operation.rpc._tag} answered what is not one of its successes`),
      Effect.orDie,
    );
    return yield* Effect.forEach(expected, (each) =>
      Schema.encodeUnknownEffect(Schema.toCodecJson(Schema.Struct(Struct.omit(each.event.fields, ["_tag"]))))(
        each.carried,
      ).pipe(
        Effect.orDie,
        Effect.map((carried): Written => ({
          trace: traceId,
          operation: operation.rpc._tag,
          event: each.event.identifier,
          atMs: nowMs,
          carried: Schema.is(Schema.Json)(carried) ? carried : null,
        })),
      ),
    );
  });

const Kept = Schema.Struct({
  seq: Schema.Int,
  event: Schema.String,
  at_ms: Schema.Finite,
  trace_id: Schema.String,
  payload: Schema.Json,
});

/** The record in the world's database. A failure to read or write it is a fault of the call. */
export const SqlWorldRecord = Layer.effect(
  WorldRecord,
  Effect.gen(function* () {
    // The record's `carried` is a JSON value, kept as jsonb with Postgres's own JSON parameter, never as JSON text.
    // @effect-diagnostics-next-line unstableApiUsage:off
    const sql = yield* PgClient.PgClient;
    const clock = yield* WorldClock;
    return WorldRecord.of({
      emit: (operation, call) =>
        Effect.gen(function* () {
          const rows = yield* written(operation, call).pipe(Effect.provideService(WorldClock, clock));
          if (Arr.isReadonlyArrayEmpty(rows)) return;
          yield* Effect.forEach(
            rows,
            (row) =>
              sql`insert into app.events (trace_id, operation, event, payload, at_ms)
                  values (${row.trace}, ${row.operation}, ${row.event}, ${sql.json(row.carried)}, ${row.atMs})`,
            { discard: true },
          ).pipe(Effect.orDie);
        }),
      entries: (from, to) =>
        Effect.gen(function* () {
          const counted = yield* sql`select count(*)::int as head from app.events`;
          const [{ head }] = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ head: Schema.Int })]))(
            counted,
          );
          const rows = yield* sql`select seq, event, at_ms, trace_id, payload from (
              select (row_number() over (order by id))::int as seq, event, at_ms, trace_id, payload from app.events
            ) as record where seq >= ${from} and seq <= ${to ?? head} order by seq`;
          const kept = yield* Schema.decodeUnknownEffect(Schema.Array(Kept))(rows);
          return {
            head,
            entries: Arr.map(kept, (row) => ({
              seq: row.seq,
              event: row.event,
              atMs: row.at_ms,
              trace: row.trace_id,
              carried: row.payload,
            })),
          };
        }).pipe(Effect.orDie),
      made: sql`select payload from app.events where event = 'world_created' order by id desc limit 1`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ payload: Schema.Json })))),
        Effect.map((rows) => Option.map(Arr.head(rows), (row) => row.payload)),
        Effect.orDie,
      ),
    });
  }),
);

/** A record in memory, beginning with `start`: for a test. Needs the world's clock. */
export const memoryWorldRecord = (start: ReadonlyArray<Omit<KeptEntry, "seq">> = []) =>
  Layer.effect(
    WorldRecord,
    Effect.gen(function* () {
      const clock = yield* WorldClock;
      const ref = yield* Ref.make<ReadonlyArray<Omit<KeptEntry, "seq">>>(start);
      const numbered = Effect.map(Ref.get(ref), (rows) => Arr.map(rows, (row, index) => ({ ...row, seq: index + 1 })));
      return WorldRecord.of({
        emit: (operation, call) =>
          Effect.flatMap(written(operation, call).pipe(Effect.provideService(WorldClock, clock)), (rows) =>
            Ref.update(ref, (kept) => [...kept, ...rows]),
          ),
        entries: (from, to) =>
          Effect.map(numbered, (rows) => ({
            head: rows.length,
            entries: Arr.filter(rows, (row) => row.seq >= from && row.seq <= (to ?? rows.length)),
          })),
        made: Effect.map(numbered, (rows) =>
          Option.map(
            Arr.findLast(rows, (row) => row.event === "world_created"),
            (row) => row.carried,
          ),
        ),
      });
    }),
  );

/** An entry as `record.export` answers it. */
export const entryOf = (kept: KeptEntry) => ({
  seq: kept.seq,
  event: kept.event,
  at: instantOf(kept.atMs),
  trace: kept.trace,
  carried: kept.carried,
});

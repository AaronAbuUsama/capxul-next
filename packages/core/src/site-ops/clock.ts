// The world's clock, as Core keeps it in the world's database (`app.clock`, migrations/0002_site_ops.sql): frozen at
// an instant, or running at rate 1 from host time plus an offset (blueprint decisions.md, 20). No row is a running
// clock at host time. Every event's time is read from it, and world.clock.warp moves it.
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export type ClockMode = "frozen" | "running";

/** The world's clock at one instant of host time: its mode and the world's time then, in epoch milliseconds. */
export interface WorldTime {
  readonly mode: ClockMode;
  readonly nowMs: number;
}

/** An epoch instant as the blueprint's `Instant`: RFC 3339 in UTC, to the millisecond. */
export const instantOf = (ms: number): string => DateTime.formatIso(DateTime.makeUnsafe(ms));

/** The blueprint's `Instant` as epoch milliseconds. */
export const millisOf = (instant: string): number => DateTime.toEpochMillis(DateTime.makeUnsafe(instant));

/** What is stored: a frozen clock's instant, or a running clock's offset from host time. */
export interface StoredClock {
  readonly mode: ClockMode;
  readonly frozenAtMs: number | null;
  readonly offsetMs: number;
}

const RUNNING_AT_HOST: StoredClock = { mode: "running", frozenAtMs: null, offsetMs: 0 };

/** The world's time when host time is `hostMs`. */
export const timeOf = (stored: StoredClock, hostMs: number): WorldTime => ({
  mode: stored.mode,
  nowMs: stored.mode === "frozen" && stored.frozenAtMs !== null ? stored.frozenAtMs : hostMs + stored.offsetMs,
});

/** The clock that reads `nowMs` at host time `hostMs`, in the same mode. */
export const movedTo = (mode: ClockMode, nowMs: number, hostMs: number): StoredClock =>
  mode === "frozen"
    ? { mode, frozenAtMs: nowMs, offsetMs: nowMs - hostMs }
    : { mode, frozenAtMs: null, offsetMs: nowMs - hostMs };

export class WorldClock extends Context.Service<
  WorldClock,
  {
    /** The world's time now. */
    readonly now: Effect.Effect<WorldTime>;
    /** Moves the clock so that it reads `nowMs` now, keeping its mode. */
    readonly moveTo: (nowMs: number) => Effect.Effect<WorldTime>;
  }
>()("@capxul/core/site-ops/clock/WorldClock") {}

const Row = Schema.Struct({
  mode: Schema.Literals(["frozen", "running"]),
  frozen_at_ms: Schema.NullOr(Schema.Finite),
  offset_ms: Schema.Finite,
});

/** Over any store of the clock: read it, or write it. */
const over = (read: Effect.Effect<StoredClock>, write: (clock: StoredClock) => Effect.Effect<void>) =>
  WorldClock.of({
    now: Effect.flatMap(read, (stored) => Effect.map(Clock.currentTimeMillis, (host) => timeOf(stored, host))),
    moveTo: (nowMs) =>
      Effect.gen(function* () {
        const stored = yield* read;
        const host = yield* Clock.currentTimeMillis;
        const next = movedTo(stored.mode, nowMs, host);
        yield* write(next);
        return timeOf(next, host);
      }),
  });

/** The clock in the world's database. A failure to read or write it is a fault of the call. */
export const SqlWorldClock = Layer.effect(
  WorldClock,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const read = sql`select mode, frozen_at_ms, offset_ms from app.clock where id = 1`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
      Effect.map((rows) =>
        Arr.match(rows, {
          onEmpty: () => RUNNING_AT_HOST,
          onNonEmpty: ([row]) => ({ mode: row.mode, frozenAtMs: row.frozen_at_ms, offsetMs: row.offset_ms }),
        }),
      ),
      Effect.orDie,
    );
    const write = (clock: StoredClock) =>
      sql`insert into app.clock (id, mode, frozen_at_ms, offset_ms) values (1, ${clock.mode}, ${clock.frozenAtMs}, ${clock.offsetMs})
          on conflict (id) do update set mode = excluded.mode, frozen_at_ms = excluded.frozen_at_ms, offset_ms = excluded.offset_ms`.pipe(
        Effect.asVoid,
        Effect.orDie,
      );
    return over(read, write);
  }),
);

/** A clock in memory, starting as `start`: for a test. */
export const memoryWorldClock = (start: StoredClock = RUNNING_AT_HOST) =>
  Layer.effect(
    WorldClock,
    Effect.map(Ref.make(start), (ref) => over(Ref.get(ref), (clock) => Ref.set(ref, clock))),
  );

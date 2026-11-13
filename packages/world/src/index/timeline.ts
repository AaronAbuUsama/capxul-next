// Where an index start's time goes, from Ponder's own metrics (`GET /metrics`, Prometheus text), read once when the
// index is first seen ready: when the Node process began, when Ponder began and ended its historical sync, and how
// long it spent in the database and on the chain. Every moment is counted from the start Cloudflare accepted.
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Str from "effect/String";

/** One index start, from the start Cloudflare accepted to Ponder's ready, in milliseconds. */
export interface Timeline {
  /** Until the Node process began: the image pulled and the container booted. */
  readonly processMs: number | null;
  /** Until Ponder began its historical sync: its build and its database set up on the world's branch. */
  readonly syncStartMs: number | null;
  /** Until Ponder ended its historical sync from the seed. */
  readonly syncEndMs: number | null;
  /** Until the index was first seen ready (`/ready` 200), as often as the world's status is asked for. */
  readonly readyMs: number;
  /** Ponder's time in the database, all calls together, and how many. */
  readonly databaseMs: number | null;
  readonly databaseCalls: number | null;
  /** The database methods Ponder spent longest in, with their time and calls. */
  readonly slowestDatabaseMethods: ReadonlyArray<{
    readonly method: string;
    readonly ms: number;
    readonly calls: number;
  }>;
  /** Ponder's time on the chain's RPC, all calls together, and how many. */
  readonly rpcMs: number | null;
  readonly rpcCalls: number | null;
}

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)/;

/** One sample of a Prometheus text: its metric's name, its labels as text, and its value. */
type Sample = readonly [string, string, number];

/** Every sample of a Prometheus text. */
const samples = (text: string): ReadonlyArray<Sample> =>
  pipe(
    Str.split(text, "\n"),
    Arr.flatMap((line): ReadonlyArray<Sample> => {
      const found = LINE.exec(Str.trim(line));
      const value = found === null ? Number.NaN : Number(found[3]);
      return found === null || !Number.isFinite(value) ? [] : [[found[1] ?? "", found[2] ?? "", value]];
    }),
  );

/** Every value of one metric, those that pass `keep`. */
const valuesOf = (all: ReadonlyArray<Sample>, name: string, keep: (value: number) => boolean) =>
  Arr.flatMap(all, ([metric, , value]) => (metric === name && keep(value) ? [value] : []));

/** The sum of every sample of one metric, none when it has none. */
const total = (all: ReadonlyArray<Sample>, name: string): number | null => {
  const values = valuesOf(all, name, () => true);
  return Arr.isReadonlyArrayEmpty(values) ? null : Arr.reduce(values, 0, (sum, value) => sum + value);
};

/** The smallest sample of one metric that is not zero (a moment not reached yet), none when it has none. */
const least = (all: ReadonlyArray<Sample>, name: string): number | null => {
  const values = valuesOf(all, name, (value) => value > 0);
  return Arr.isReadonlyArrayEmpty(values)
    ? null
    : Arr.reduce(values, Number.POSITIVE_INFINITY, (low, value) => Math.min(low, value));
};

const METHOD = /method="([^"]*)"/;

/** One metric's sum per `method` label, by method. */
const perMethod = (all: ReadonlyArray<Sample>, name: string): Record<string, number> =>
  Arr.reduce(all, {} as Record<string, number>, (sums, [metric, labels, value]) => {
    if (metric !== name) return sums;
    const method = METHOD.exec(labels)?.[1] ?? "other";
    return { ...sums, [method]: (sums[method] ?? 0) + value };
  });

/** The `count` methods Ponder spent longest in, in the database. */
const slowest = (all: ReadonlyArray<Sample>, count: number) => {
  const ms = perMethod(all, "ponder_database_method_duration_sum");
  const calls = perMethod(all, "ponder_database_method_duration_count");
  return pipe(
    Rec.toEntries(ms),
    Arr.map(([method, spent]) => ({ method, ms: Math.round(spent), calls: calls[method] ?? 0 })),
    Arr.sortBy(Order.mapInput(Order.Number, (one: { readonly ms: number }) => -one.ms)),
    Arr.take(count),
  );
};

const sinceMs = (acceptedAtMs: number, seconds: number | null): number | null =>
  seconds === null ? null : Math.round(seconds * 1000 - acceptedAtMs);

const rounded = (value: number | null): number | null => (value === null ? null : Math.round(value));

/** The timeline of a start Cloudflare accepted at `acceptedAtMs`, first seen ready at `readyAtMs`. */
export const timelineOf = (metrics: string, acceptedAtMs: number, readyAtMs: number): Timeline => {
  const all = samples(metrics);
  return {
    processMs: sinceMs(acceptedAtMs, least(all, "process_start_time_seconds")),
    syncStartMs: sinceMs(acceptedAtMs, least(all, "ponder_historical_start_timestamp_seconds")),
    syncEndMs: sinceMs(acceptedAtMs, least(all, "ponder_historical_end_timestamp_seconds")),
    readyMs: readyAtMs - acceptedAtMs,
    databaseMs: rounded(total(all, "ponder_database_method_duration_sum")),
    databaseCalls: total(all, "ponder_database_method_duration_count"),
    slowestDatabaseMethods: slowest(all, 6),
    rpcMs: rounded(total(all, "ponder_rpc_request_duration_sum")),
    rpcCalls: total(all, "ponder_rpc_request_duration_count"),
  };
};

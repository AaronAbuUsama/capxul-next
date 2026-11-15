// What the runner observed of each call, by trace: its spans and logs from the tap (tap.ts) and the events Core
// recorded under its trace id (`app.events`). The runner's side of the speed lane's `Observations` service
// (packages/scenarios/src/client.ts on `slice/run-time`, roadmap 4.11): the same shape, as a plain function until both
// slices reach master and the runner provides it as that service, choosing the database by `who`.
//
// A trace is `complete` once the tap holds its operation span, and with it every span and log of its request; an
// incomplete trace carries no span and no log, never part of them. While a world's Core writes no tap, every trace is
// incomplete at once, without a wait.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { RunnerFailure } from "../failure.ts";
import { EventRow, query } from "../world/database.ts";
import type { FlatSpan } from "./flat.ts";
import type { FlatLog } from "./logs.ts";
import { tapFor, tapIsOn, WAIT, type Tapped, type Wait } from "./tap.ts";

export interface ObservedSpan {
  readonly name: string;
  readonly spanId: string;
  /** Null on a root span. */
  readonly parentSpanId: string | null;
  readonly outcome: "ok" | "error" | "unset";
  /** When it began, in epoch milliseconds. */
  readonly startMs: number;
  readonly durationMs: number;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface ObservedLog {
  readonly level: string;
  readonly message: string;
  /** Null for a log written outside any span. */
  readonly spanId: string | null;
  readonly fields: Readonly<Record<string, unknown>>;
  /** When it was written, in epoch milliseconds. */
  readonly atMs: number;
}

export interface ObservedEvent {
  /** Its place among the trace's events, from 0, in the order Core recorded them. */
  readonly seq: number;
  readonly event: string;
  /** What it carried: its payload as Core recorded it. */
  readonly carried: unknown;
}

export interface Observed {
  readonly trace: string;
  readonly complete: boolean;
  readonly spans: ReadonlyArray<ObservedSpan>;
  readonly logs: ReadonlyArray<ObservedLog>;
  readonly events: ReadonlyArray<ObservedEvent>;
}

export const observedSpan = (span: FlatSpan): ObservedSpan => ({
  name: span.name,
  spanId: span.spanId,
  parentSpanId: span.parentSpanId,
  outcome: span.status,
  startMs: span.endedMs - span.durationMs,
  durationMs: span.durationMs,
  attributes: span.attributes,
});

export const observedLog = (log: FlatLog): ObservedLog => ({
  level: log.level,
  message: log.message,
  spanId: log.spanId,
  fields: log.fields,
  atMs: log.atMs,
});

/** The events Core recorded under each of `traces`, in the order it recorded them. */
const eventsOf = (database: Redacted.Redacted, traces: ReadonlyArray<string>) =>
  query(database, "select trace_id, operation, event, payload from app.events where trace_id = any($1) order by id", [
    traces,
  ]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(EventRow))),
    Effect.mapError((error) =>
      RunnerFailure.make({ step: "observe", message: `app.events could not be read: ${error.message}` }),
    ),
  );

/** One trace's observation from what the tap and `app.events` hold of it. */
export const observedOf = (trace: string, tapped: Tapped | undefined, events: ReadonlyArray<EventRow>): Observed => {
  const whole = tapped !== undefined && tapped.complete ? tapped : undefined;
  return {
    trace,
    complete: whole !== undefined,
    spans: Arr.map(whole?.spans ?? [], observedSpan),
    logs: Arr.map(whole?.logs ?? [], observedLog),
    events: Arr.map(
      Arr.filter(events, (row) => row.trace_id === trace),
      (row, seq) => ({ seq, event: row.event, carried: row.payload }),
    ),
  };
};

/** Every one of `traces` as the world whose database is `database` observed it, keyed by trace. */
export const observe = (
  database: Redacted.Redacted,
  traces: ReadonlyArray<string>,
  wait: Wait = WAIT,
): Effect.Effect<ReadonlyMap<string, Observed>, RunnerFailure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const unique = Arr.dedupe(traces);
    if (Arr.isReadonlyArrayEmpty(unique)) return new Map<string, Observed>();
    const tapped: ReadonlyMap<string, Tapped> = (yield* tapIsOn(database))
      ? yield* tapFor(database, unique, wait)
      : new Map();
    const events = yield* eventsOf(database, unique);
    return new Map(Arr.map(unique, (trace) => [trace, observedOf(trace, tapped.get(trace), events)] as const));
  });

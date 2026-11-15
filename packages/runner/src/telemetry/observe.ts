// What the runner observed of each call, by trace: its spans and logs from the tap (tap.ts) and the events Core
// recorded under its trace id (`app.events`). The runner's side of the speed lane's `Observations` service
// (packages/scenarios/src/client.ts on `slice/run-time`, roadmap 4.11): the same shape, as a plain function until both
// slices reach master and the runner provides it as that service, choosing the database by `who`.
//
// A trace is `complete` once the tap holds its operation span, and with it every span and log of its request; an
// incomplete trace carries no span and no log, never part of them. While a world's Core writes no tap, every trace is
// incomplete at once, without a wait.
import { Values, type CallOptions } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { RunnerFailure } from "../failure.ts";
import { EventRow, query } from "../world/database.ts";
import type { FlatSpan } from "./flat.ts";
import type { FlatLog } from "./logs.ts";
import { tapFor, tapIsOn, WAIT, type Tapped, type Wait } from "./tap.ts";

type Json = typeof Values.Json.Type;

/** Who a read is for: the run's own world, or another's (a call `at` its door). As the `Observations` service takes it. */
export type Who = Pick<CallOptions, "at" | "operator">;

export interface ObservedSpan {
  readonly name: string;
  readonly spanId: string;
  /** Null on a root span. */
  readonly parentSpanId: string | null;
  readonly outcome: "ok" | "error" | "unset";
  /** When it began, in epoch milliseconds. */
  readonly startMs: number;
  readonly durationMs: number;
  readonly attributes: Readonly<Record<string, Json>>;
}

export interface ObservedLog {
  readonly level: string;
  readonly message: string;
  /** Null for a log written outside any span. */
  readonly spanId: string | null;
  readonly fields: Readonly<Record<string, Json>>;
  /** When it was written, in epoch milliseconds. */
  readonly atMs: number;
}

export interface ObservedEvent {
  /** Its place among the trace's events, from 0, in the order Core recorded them. */
  readonly seq: number;
  readonly event: string;
  /** What it carried: its payload as Core recorded it. */
  readonly carried: Json;
}

export interface Observed {
  readonly trace: string;
  readonly complete: boolean;
  readonly spans: ReadonlyArray<ObservedSpan>;
  readonly logs: ReadonlyArray<ObservedLog>;
  readonly events: ReadonlyArray<ObservedEvent>;
}

const fieldsOf = Schema.decodeUnknownEffect(Values.Fields);
const jsonOf = Schema.decodeUnknownEffect(Values.Json);
const byStart = Order.mapInput(Order.Number, (span: ObservedSpan) => span.startMs);

export const observedSpan = (span: FlatSpan) =>
  Effect.map(fieldsOf(span.attributes), (attributes): ObservedSpan => ({
    name: span.name,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    outcome: span.status,
    startMs: span.endedMs - span.durationMs,
    durationMs: span.durationMs,
    attributes,
  }));

export const observedLog = (log: FlatLog) =>
  Effect.map(fieldsOf(log.fields), (fields): ObservedLog => ({
    level: log.level,
    message: log.message,
    spanId: log.spanId,
    fields,
    atMs: log.atMs,
  }));

/** The events Core recorded under each of `traces`, in the order it recorded them. */
const eventsOf = (database: Redacted.Redacted, traces: ReadonlyArray<string>) =>
  query(database, "select trace_id, operation, event, payload from app.events where trace_id = any($1) order by id", [
    traces,
  ]).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(EventRow))));

/** One trace's observation from what the tap and `app.events` hold of it: its spans in start order. */
export const observedOf = (trace: string, tapped: Tapped | undefined, events: ReadonlyArray<EventRow>) =>
  Effect.gen(function* () {
    const whole = tapped !== undefined && tapped.complete ? tapped : undefined;
    const spans = yield* Effect.forEach(whole?.spans ?? [], observedSpan);
    return {
      trace,
      complete: whole !== undefined,
      spans: Arr.sort(spans, byStart),
      logs: yield* Effect.forEach(whole?.logs ?? [], observedLog),
      events: yield* Effect.forEach(
        Arr.filter(events, (row) => row.trace_id === trace),
        (row, seq) => Effect.map(jsonOf(row.payload), (carried): ObservedEvent => ({ seq, event: row.event, carried })),
      ),
    } satisfies Observed;
  });

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
    const observed = yield* Effect.forEach(unique, (trace) => observedOf(trace, tapped.get(trace), events));
    return new Map(Arr.map(observed, (each) => [each.trace, each] as const));
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "RunnerFailure"
        ? error
        : RunnerFailure.make({ step: "observe", message: `what Core recorded could not be read: ${error.message}` }),
    ),
  );

/**
 * The `Observations` service's `read`, exactly (packages/scenarios/src/client.ts on `slice/run-time`): `databaseOf`
 * finds the database of the world `who` names, the run's own when `who.at` is left out. A read that fails, or a world
 * with no database known, is a defect, as the service says.
 */
export const observationsRead = (
  databaseOf: (who: Who | undefined) => Effect.Effect<Option.Option<Redacted.Redacted>>,
  wait: Wait = WAIT,
) =>
  Effect.map(
    Effect.service(HttpClient.HttpClient),
    (client) =>
      (traces: ReadonlyArray<string>, who?: Who): Effect.Effect<ReadonlyMap<string, Observed>> =>
        Effect.flatMap(databaseOf(who), (database) =>
          Option.match(database, {
            onNone: () =>
              Effect.die(new Error(`no database is known for the world at ${who?.at ?? "the run's own door"}`)),
            onSome: (found) => observe(found, traces, wait),
          }),
        ).pipe(Effect.provideService(HttpClient.HttpClient, client), Effect.orDie),
  );

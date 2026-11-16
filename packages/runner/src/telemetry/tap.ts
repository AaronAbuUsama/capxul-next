// The tap: in a test world, Core writes the OTLP it exports into the world's database as well (`telemetry.otlp`: the
// trace id, the signal, the body), and the runner reads a call's spans and logs back from it by trace id, through the
// same `/sql` endpoint it reads `app.events` by (world/database.ts; roadmap 4.4; design note "Proof and telemetry",
// section 7).
//
// Core writes every body of one request in one statement, after every exporter has flushed (core/src/telemetry/
// export.ts): so once a trace's server span (the call's operation span) is in the tap, every span and log of its
// request is there too. A read waits briefly for that span and answers a trace whole or not at all: `incomplete`
// on timeout, never part of it.
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as Redacted from "effect/Redacted";
import type * as Schema from "effect/Schema";
import { RunnerFailure } from "../failure.ts";
import { query } from "../world/database.ts";
import { flatSpans, type FlatSpan } from "./flat.ts";
import { flatLogs, type FlatLog } from "./logs.ts";
import { decodeLogsBody, decodeTapRows, decodeTraceBody, type TapRow } from "./otlp.ts";

/** OpenTelemetry's span kind for a server span: Core's operation span is one (core/src/telemetry/spans.ts). */
export const SERVER = 2;

/** One trace as the tap holds it: whole, once its server span is there, or `incomplete`. */
export type Tapped =
  | {
      readonly traceId: string;
      readonly complete: true;
      readonly spans: ReadonlyArray<FlatSpan>;
      readonly logs: ReadonlyArray<FlatLog>;
    }
  | { readonly traceId: string; readonly complete: false };

/** How long a read waits for a trace's server span: `tries` reads, `every` apart. */
export interface Wait {
  readonly tries: number;
  readonly every: Duration.Input;
}

/** About five seconds: Core writes the tap just after it answers, so the wait is normally none. */
export const WAIT: Wait = { tries: 20, every: Duration.millis(250) };

interface Read {
  readonly server: boolean;
  readonly spans: ReadonlyArray<FlatSpan>;
  readonly logs: ReadonlyArray<FlatLog>;
}

/** What one row holds of its own trace: a body is kept whole under every trace id it carries. */
const readRow = (row: TapRow): Effect.Effect<Read, Schema.SchemaError> =>
  row.signal === "traces"
    ? Effect.map(decodeTraceBody(row.body), (body) => ({
        server: Arr.some(body.resourceSpans, (resource) =>
          Arr.some(resource.scopeSpans, (scope) =>
            Arr.some(scope.spans, (span) => span.traceId === row.trace_id && span.kind === SERVER),
          ),
        ),
        spans: Arr.filter(flatSpans(body), (span) => span.traceId === row.trace_id),
        logs: [],
      }))
    : Effect.map(decodeLogsBody(row.body), (body) => ({
        server: false,
        spans: [],
        logs: Arr.filter(flatLogs(body), (log) => log.traceId === row.trace_id),
      }));

/** One read of the tap: what it holds now of each of `traceIds`, in the order Core wrote it. */
const readOnce = (database: Redacted.Redacted, traceIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const rows = yield* decodeTapRows(
      yield* query(database, "select trace_id, signal, body from telemetry.otlp where trace_id = any($1) order by id", [
        traceIds,
      ]),
    );
    const reads = yield* Effect.forEach(rows, (row) =>
      Effect.map(readRow(row), (read) => [row.trace_id, read] as const),
    );
    return new Map(
      Arr.map(traceIds, (traceId): readonly [string, Read] => {
        const own = Arr.map(
          Arr.filter(reads, ([id]) => id === traceId),
          ([, read]) => read,
        );
        return [
          traceId,
          {
            server: Arr.some(own, (read) => read.server),
            spans: Arr.dedupeWith(
              Arr.flatMap(own, (read) => read.spans),
              (a, b) => a.spanId === b.spanId,
            ),
            logs: Arr.flatMap(own, (read) => read.logs),
          },
        ];
      }),
    );
  }).pipe(
    Effect.mapError((error) =>
      RunnerFailure.make({ step: "tap", message: `the tap could not be read: ${error.message}` }),
    ),
  );

/**
 * Each of `traceIds` as the tap holds it, waiting up to `wait` for each one's server span: whole once it is there,
 * `incomplete` if it never came. Rereads only the traces still waiting.
 */
export const tapFor = (
  database: Redacted.Redacted,
  traceIds: ReadonlyArray<string>,
  wait: Wait = WAIT,
): Effect.Effect<ReadonlyMap<string, Tapped>, RunnerFailure, HttpClient.HttpClient> => {
  const loop = (
    waiting: ReadonlyArray<string>,
    found: ReadonlyMap<string, Tapped>,
    triesLeft: number,
  ): Effect.Effect<ReadonlyMap<string, Tapped>, RunnerFailure, HttpClient.HttpClient> =>
    Arr.isReadonlyArrayEmpty(waiting)
      ? Effect.succeed(found)
      : Effect.flatMap(readOnce(database, waiting), (read) => {
          const whole = new Map(found);
          for (const traceId of waiting) {
            const each = read.get(traceId);
            if (each !== undefined && each.server)
              whole.set(traceId, { traceId, complete: true, spans: each.spans, logs: each.logs });
          }
          const still = Arr.filter(waiting, (traceId) => !whole.has(traceId));
          if (Arr.isReadonlyArrayEmpty(still) || triesLeft <= 1) {
            for (const traceId of still) whole.set(traceId, { traceId, complete: false });
            return Effect.succeed(whole);
          }
          return Effect.andThen(Effect.sleep(wait.every), loop(still, whole, triesLeft - 1));
        });
  return loop(Arr.dedupe(traceIds), new Map(), Math.max(1, wait.tries));
};

/** Whether the tap is on in this world: it holds a row of some call. A tap that cannot be read is off. */
export const tapIsOn = (database: Redacted.Redacted): Effect.Effect<boolean, never, HttpClient.HttpClient> =>
  query(database, "select 1 from telemetry.otlp limit 1").pipe(
    Effect.map(Arr.isReadonlyArrayNonEmpty),
    Effect.orElseSucceed(() => false),
  );

/** Every span the tap holds under the given trace ids, flat; fails when any of them is incomplete. */
export const tapOf = (
  database: Redacted.Redacted,
  traceIds: ReadonlyArray<string>,
  wait: Wait = WAIT,
): Effect.Effect<ReadonlyArray<FlatSpan>, RunnerFailure, HttpClient.HttpClient> =>
  Effect.flatMap(tapFor(database, traceIds, wait), (tapped) => {
    const all = Arr.fromIterable(tapped.values());
    const incomplete = Arr.filter(all, (each) => !each.complete);
    return Arr.isReadonlyArrayEmpty(incomplete)
      ? Effect.succeed(Arr.flatMap(all, (each) => (each.complete ? each.spans : [])))
      : Effect.fail(
          RunnerFailure.make({
            step: "tap",
            message: `the tap is incomplete for ${Arr.join(
              Arr.map(incomplete, (each) => each.traceId),
              ", ",
            )}`,
          }),
        );
  });

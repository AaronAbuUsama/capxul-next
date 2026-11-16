// A whole run as its world kept it, for the isolation check (roadmap 4.8, part B; written by 4.11's author): every
// event of `app.events` in the order of its ids, and, for each trace the tap holds (`telemetry.otlp`, tap.ts), the
// producer that exported its root server span and that span's name. Read through the same `/sql` endpoint as a call's
// record (world/database.ts), decoded with the existing row schemas and the blueprint's values; the tap's bodies are
// decoded by otlp.ts, once.
import { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { RunnerFailure } from "../failure.ts";
import { EventRow, query } from "../world/database.ts";
import { attributesOf, SERVICE_NAME } from "./flat.ts";
import { decodeTapRows, decodeTraceBody, type TraceExport } from "./otlp.ts";
import { SERVER } from "./tap.ts";

/** One event of the run, at its place in the world's record. */
export interface Entry {
  /** Its id in `app.events`: its place in the world's record, the first being 1. */
  readonly seq: number;
  readonly trace: string;
  readonly operation: string;
  readonly event: string;
  /** What it carried: its payload. */
  readonly carried: unknown;
}

/** Who answered a trace: the `service.name` that exported its root server span (null when it named none), and the span's name. */
export interface Producer {
  readonly producer: string | null;
  readonly span: string;
}

export interface WholeRun {
  readonly entries: ReadonlyArray<Entry>;
  /** By trace id: each trace the tap holds a server span of. */
  readonly producers: ReadonlyMap<string, Producer>;
}

/** An `app.events` row with its id, as `seq`. */
const EntryRow = Schema.Struct({ seq: Values.Seq, ...EventRow.fields });

interface ServerSpan extends Producer {
  readonly spanId: string;
  readonly parentSpanId: string | null;
}

/** The server spans of `trace` in one traces body, each with the producer of its resource. */
const serverSpans = (body: TraceExport, trace: string): ReadonlyArray<ServerSpan> =>
  Arr.flatMap(body.resourceSpans, (resource) => {
    const service = attributesOf(resource.resource.attributes)[SERVICE_NAME];
    const producer = typeof service === "string" ? service : null;
    return Arr.flatMap(resource.scopeSpans, (scope) =>
      Arr.filterMap(scope.spans, (span) =>
        span.traceId === trace && span.kind === SERVER
          ? Result.succeed({ producer, span: span.name, spanId: span.spanId, parentSpanId: span.parentSpanId ?? null })
          : Result.failVoid,
      ),
    );
  });

/** The root among a trace's server spans: the first whose parent is not another of them. */
const rootOf = (spans: ReadonlyArray<ServerSpan>): Option.Option<Producer> =>
  pipe(
    Arr.findFirst(spans, (span) => !Arr.some(spans, (other) => other.spanId === span.parentSpanId)),
    Option.map(({ producer, span }) => ({ producer, span })),
  );

/** The run's events and its traces' producers, read from the world's database. */
export const wholeRun = (world: {
  readonly database: Redacted.Redacted;
}): Effect.Effect<WholeRun, RunnerFailure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const events = yield* Schema.decodeUnknownEffect(Schema.Array(EntryRow))(
      yield* query(
        world.database,
        "select id::int as seq, trace_id, operation, event, payload from app.events order by id",
      ),
    );
    const rows = yield* decodeTapRows(
      yield* query(
        world.database,
        "select trace_id, signal, body from telemetry.otlp where signal = 'traces' order by id",
      ),
    );
    const bodies = yield* Effect.forEach(rows, (row) =>
      Effect.map(decodeTraceBody(row.body), (body) => ({
        trace: row.trace_id,
        spans: serverSpans(body, row.trace_id),
      })),
    );
    const producers = new Map<string, Producer>();
    for (const trace of Arr.dedupe(Arr.map(bodies, (body) => body.trace))) {
      const own = Arr.flatMap(bodies, (body) => (body.trace === trace ? body.spans : []));
      const root = rootOf(own);
      if (Option.isSome(root)) producers.set(trace, root.value);
    }
    return {
      entries: Arr.map(events, (row) => ({
        seq: row.seq,
        trace: row.trace_id,
        operation: row.operation,
        event: row.event,
        carried: row.payload,
      })),
      producers,
    } satisfies WholeRun;
  }).pipe(
    Effect.mapError((error) =>
      RunnerFailure.make({ step: "whole-run", message: `the run could not be read: ${error.message}` }),
    ),
  );

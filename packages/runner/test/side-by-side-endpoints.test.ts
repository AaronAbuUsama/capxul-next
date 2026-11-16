// Side by side for calls made at another world's door (src/telemetry/side-by-side.ts): such a call is kept by that
// world, so its two records (`app.spans` and the tap) are compared in that world's database, found as the checks find
// it (`OtherWorlds`). Before, only calls through the stage's own door were compared: a journey whose every call went
// to another door ("two operators and their worlds") reported the tap `absent`, and its parity was never read.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Envelope, operations } from "@capxul/blueprint";
import { OUTCOME } from "@capxul/core";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Redacted from "effect/Redacted";
import type { Call } from "../src/client.ts";
import { flatSpans, type FlatSpan } from "../src/telemetry/flat.ts";
import { decodeTraces } from "../src/telemetry/otlp.ts";
import { sideBySide, tapFailures } from "../src/telemetry/side-by-side.ts";
import { OtherWorlds } from "../src/world/existing.ts";
import type { SpanRow } from "../src/world/database.ts";
import { bodiesTo, exported } from "./support/capture.ts";

/** The stage's own database, whose tap is on but holds nothing of these calls, and the other world's. */
const OWN = Redacted.make("postgresql://user:password@ep-own.test/neondb");
const THEIRS = Redacted.make("postgresql://user:password@ep-theirs.test/neondb");
const DOOR = "https://other-world.test";
const OPERATION = Rec.keys(operations)[0]!;
const QUICK = { tries: 3, every: Duration.millis(1) };

/** One call as the api makes it, each span carrying the outcome the api stamps. */
const oneCall = Effect.gen(function* () {
  const outcome = { [Envelope.attributes.outcome.name]: OUTCOME.success };
  const posted = yield* Effect.void.pipe(
    Effect.withSpan("postgres", { kind: "client", attributes: outcome }),
    Effect.withSpan(OPERATION, { kind: "server", attributes: outcome }),
    exported,
  );
  const traces = bodiesTo(posted, "/v1/traces")[0]!;
  const spans = flatSpans(yield* decodeTraces(traces));
  return { traceId: spans[0]!.traceId, spans, body: JSON.parse(traces) };
});

const rowOf = (span: FlatSpan): SpanRow => ({
  trace_id: span.traceId,
  span_id: span.spanId,
  parent_span_id: span.parentSpanId,
  name: span.name,
  outcome: "success",
  duration_ms: span.durationMs,
  ended_ms: Math.floor(span.endedMs),
  attributes: null,
});

const callAt = (traceId: string, at: string | null): Call => ({
  operation: OPERATION,
  traceId,
  at,
  outcome: "success",
  refusal: null,
  payload: {},
  success: Option.none(),
  callerMs: 1,
  resent: 0,
  failure: null,
});

interface Tables {
  readonly otlp: ReadonlyArray<{ trace_id: string; signal: string; body: unknown }>;
  readonly spans: ReadonlyArray<SpanRow>;
}

/** Neon's `/sql` endpoint for two databases, each answered from its own tables by the host the request goes to. */
const standIn = (byHost: Readonly<Record<string, Tables>>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      const tables = byHost[url.hostname] ?? { otlp: [], spans: [] };
      const sent =
        request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : { query: "" };
      const text: string = sent.query;
      const ids: ReadonlyArray<string> = sent.params?.[0] ?? [];
      const mine = <A extends { readonly trace_id: string }>(rows: ReadonlyArray<A>) =>
        Arr.filter(rows, (row) => Arr.contains(ids, row.trace_id));
      const rows = Str.includes("from app.events")(text)
        ? []
        : Str.includes("from app.spans")(text)
          ? mine(tables.spans)
          : Str.includes("limit 1")(text)
            ? Arr.map(Arr.take(tables.otlp, 1), () => ({ "?column?": 1 }))
            : mine(tables.otlp);
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ rows }, { status: 200 })));
    }),
  );

const otherWorlds = Layer.succeed(OtherWorlds, {
  databaseAt: (door: string) => Effect.succeed(door === DOOR ? Option.some(THEIRS) : Option.none()),
});

/**
 * Side by side for one call made at the other world's endpoint. Its `app.spans` rows come in `kept`, as the checks
 * read them there; its tap is in that world's database, which also holds rows that must not be read for it.
 */
const sideOfCallAtEndpoint = (theirSpans: (spans: ReadonlyArray<FlatSpan>) => ReadonlyArray<SpanRow>) =>
  Effect.gen(function* () {
    const call = yield* oneCall;
    const tables = {
      "ep-own.test": { otlp: [{ trace_id: "elsewhere", signal: "traces", body: call.body }], spans: [] },
      "ep-theirs.test": {
        otlp: [{ trace_id: call.traceId, signal: "traces", body: call.body }],
        // What the database's app.spans holds is not read again: `kept` is what counts.
        spans: Arr.map(call.spans, (span) => ({ ...rowOf(span), name: "not read" })),
      },
    };
    return yield* sideBySide(
      OWN,
      [callAt(call.traceId, DOOR)],
      { spans: theirSpans(call.spans), events: [] },
      QUICK,
    ).pipe(Effect.provide(Layer.merge(standIn(tables), otherWorlds)));
  });

test("a call made at another world's door is compared in that world's database, and agrees", async () => {
  const report = await Effect.runPromise(sideOfCallAtEndpoint((spans) => Arr.map(spans, rowOf)));
  assert.equal(report.state, "on");
  assert.equal(report.calls.length, 1);
  assert.equal(report.calls[0]!.complete, true);
  assert.equal(report.calls[0]!.agrees, true, JSON.stringify(report.calls[0]!.differences));
  assert.equal(report.calls[0]!.kept.length, 2);
  assert.deepEqual(tapFailures(report), []);
});

test("a call made at another world's door whose records differ there fails the run", async () => {
  const report = await Effect.runPromise(
    sideOfCallAtEndpoint((spans) => Arr.map(spans, (span) => ({ ...rowOf(span), name: `${span.name}!` }))),
  );
  assert.equal(report.state, "on");
  assert.equal(report.calls[0]!.agrees, false);
  assert.match(tapFailures(report)[0]!, new RegExp(`plumbing: the tap and app.spans disagree on ${OPERATION}`));
});

test("a call at a door no known world answers at is not compared, and the tap stays absent", async () => {
  const report = await Effect.runPromise(
    Effect.gen(function* () {
      const call = yield* oneCall;
      return yield* sideBySide(
        OWN,
        [callAt(call.traceId, "https://unknown.test")],
        { spans: [], events: [] },
        QUICK,
      ).pipe(Effect.provide(Layer.merge(standIn({}), otherWorlds)));
    }),
  );
  assert.deepEqual(report.calls, []);
  assert.equal(report.state, "absent");
  assert.deepEqual(report.unknownEndpoints, ["https://unknown.test"]);
});

test("a run with calls through its own endpoint and at another world's is compared in each one's database", async () => {
  const report = await Effect.runPromise(
    Effect.gen(function* () {
      const own = yield* oneCall;
      const theirs = yield* oneCall;
      const tables = {
        "ep-own.test": { otlp: [{ trace_id: own.traceId, signal: "traces", body: own.body }], spans: [] },
        "ep-theirs.test": { otlp: [{ trace_id: theirs.traceId, signal: "traces", body: theirs.body }], spans: [] },
      };
      const kept = { spans: [...Arr.map(own.spans, rowOf), ...Arr.map(theirs.spans, rowOf)], events: [] };
      const calls = [
        callAt(own.traceId, null),
        callAt(theirs.traceId, DOOR),
        callAt(theirs.traceId, "https://unknown.test"),
      ];
      return yield* sideBySide(OWN, calls, kept, QUICK).pipe(Effect.provide(Layer.merge(standIn(tables), otherWorlds)));
    }),
  );
  assert.equal(report.state, "on");
  assert.equal(report.calls.length, 2);
  assert.ok(
    Arr.every(report.calls, (call) => call.complete && call.agrees),
    JSON.stringify(report.calls),
  );
  assert.deepEqual(report.unknownEndpoints, ["https://unknown.test"]);
  assert.deepEqual(tapFailures(report), []);
});

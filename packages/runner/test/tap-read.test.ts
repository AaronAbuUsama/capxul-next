// The tap read beside app.spans (src/telemetry/tap.ts, side-by-side.ts, observe.ts) against a stand-in for a world's
// database: Neon's `/sql` endpoint, answering each query by what it reads. One call's traces and logs bodies, as
// Effect wrote them, are in `telemetry.otlp` under its trace id.
import { strict as assert } from "node:assert";
import { operations } from "@capxul/blueprint";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Redacted from "effect/Redacted";
import type { Call } from "../src/client.ts";
import { decodeTraces } from "../src/telemetry/otlp.ts";
import { flatSpans, type FlatSpan } from "../src/telemetry/flat.ts";
import { observationsRead, observe } from "../src/telemetry/observe.ts";
import { sideBySide, tapFailures } from "../src/telemetry/side-by-side.ts";
import { tapFor } from "../src/telemetry/tap.ts";
import type { SpanRow } from "../src/world/database.ts";
import { bodiesTo, exported } from "./support/capture.ts";

const DATABASE = Redacted.make("postgresql://user:password@ep-tap.test/neondb");
/** Any operation: parity is about spans, whatever the call's operation. */
const OPERATION = Rec.keys(operations)[0]!;
const QUICK = { tries: 3, every: Duration.millis(1) };

interface Tables {
  readonly otlp: ReadonlyArray<{ trace_id: string; signal: string; body: unknown }>;
  readonly events?: ReadonlyArray<{ trace_id: string; operation: string; event: string; payload: unknown }>;
}

/** Neon's `/sql` endpoint over `tables`: the tap's rows by trace id, the tap's probe, and `app.events`. */
const standIn = (tables: Tables, reads: { count: number } = { count: 0 }) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const sent =
        request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : { query: "" };
      const text: string = sent.query;
      const ids: ReadonlyArray<string> = sent.params?.[0] ?? [];
      const mine = <A extends { readonly trace_id: string }>(rows: ReadonlyArray<A>) =>
        Arr.filter(rows, (row) => Arr.contains(ids, row.trace_id));
      const rows = Str.includes("from app.events")(text)
        ? mine(tables.events ?? [])
        : Str.includes("limit 1")(text)
          ? Arr.map(Arr.take(tables.otlp, 1), () => ({ "?column?": 1 }))
          : (reads.count++, mine(tables.otlp));
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ rows }, { status: 200 })));
    }),
  );

/** One call as Core makes it: its server span, a step inside it, and a log in the step. */
const oneCall = Effect.gen(function* () {
  const posted = yield* Effect.log("inside the step").pipe(
    Effect.withSpan("database.query"),
    Effect.withSpan("call.op", { kind: "server" }),
    exported,
  );
  const traces = bodiesTo(posted, "/v1/traces")[0]!;
  const logs = bodiesTo(posted, "/v1/logs")[0]!;
  const spans = flatSpans(yield* decodeTraces(traces));
  const traceId = spans[0]!.traceId;
  return {
    traceId,
    spans,
    rows: [
      { trace_id: traceId, signal: "traces", body: JSON.parse(traces) },
      { trace_id: traceId, signal: "logs", body: JSON.parse(logs) },
    ],
  };
});

const rowOf = (span: FlatSpan): SpanRow => ({
  trace_id: span.traceId,
  span_id: span.spanId,
  parent_span_id: span.parentSpanId,
  name: span.name,
  outcome: span.status === "ok" ? "success" : span.status === "error" ? "failure" : "interrupted",
  duration_ms: span.durationMs,
  ended_ms: span.endedMs,
  attributes: null,
});

const callOf = (traceId: string): Call => ({
  operation: OPERATION,
  traceId,
  at: null,
  outcome: "success",
  refusal: null,
  payload: {},
  success: Option.none(),
  callerMs: 1,
  resent: 0,
  failure: null,
});

test("a complete trace carries its spans and its logs, flat", async () => {
  await Effect.gen(function* () {
    const call = yield* oneCall;
    const read = yield* tapFor(DATABASE, [call.traceId], QUICK).pipe(Effect.provide(standIn({ otlp: call.rows })));
    const tapped = read.get(call.traceId)!;
    assert.ok(tapped.complete);
    assert.deepEqual(
      Arr.map(tapped.spans, (span) => span.name),
      Arr.map(call.spans, (span) => span.name),
    );
    const step = Option.getOrThrow(Arr.findFirst(call.spans, (span) => span.name === "database.query"));
    assert.equal(tapped.logs.length, 1);
    assert.equal(tapped.logs[0]!.message, "inside the step");
    assert.equal(tapped.logs[0]!.spanId, step.spanId);
    assert.equal(tapped.logs[0]!.traceId, call.traceId);
  }).pipe(Effect.runPromise);
});

test("a trace whose server span never comes is incomplete, with nothing of it, after the wait", async () => {
  await Effect.gen(function* () {
    const posted = yield* Effect.void.pipe(Effect.withSpan("database.query"), exported);
    const body = bodiesTo(posted, "/v1/traces")[0]!;
    const traceId = flatSpans(yield* decodeTraces(body))[0]!.traceId;
    const reads = { count: 0 };
    const read = yield* tapFor(DATABASE, [traceId], QUICK).pipe(
      Effect.provide(standIn({ otlp: [{ trace_id: traceId, signal: "traces", body: JSON.parse(body) }] }, reads)),
    );
    assert.deepEqual(read.get(traceId), { traceId, complete: false });
    assert.equal(reads.count, QUICK.tries);
  }).pipe(Effect.runPromise);
});

test("with no tap in the world, side by side is absent and fails nothing", async () => {
  await Effect.gen(function* () {
    const call = yield* oneCall;
    const tap = yield* sideBySide(DATABASE, [callOf(call.traceId)], {
      spans: Arr.map(call.spans, rowOf),
      events: [],
    }).pipe(Effect.provide(standIn({ otlp: [] })));
    assert.equal(tap.state, "absent");
    assert.deepEqual(tapFailures(tap), []);
  }).pipe(Effect.runPromise);
});

test("with the tap on, a call app.spans and the tap agree on passes, and one they differ on fails the run", async () => {
  await Effect.gen(function* () {
    const call = yield* oneCall;
    const kept = { spans: Arr.map(call.spans, rowOf), events: [] };
    const agreed = yield* sideBySide(DATABASE, [callOf(call.traceId)], kept, QUICK).pipe(
      Effect.provide(standIn({ otlp: call.rows })),
    );
    assert.equal(agreed.state, "on");
    assert.equal(agreed.calls[0]!.agrees, true, JSON.stringify(agreed.calls[0]!.differences));
    assert.equal(agreed.calls[0]!.tapped.length, 2);
    assert.deepEqual(tapFailures(agreed), []);

    const renamed = { ...kept, spans: Arr.map(kept.spans, (row) => ({ ...row, name: `${row.name}!` })) };
    const differs = yield* sideBySide(DATABASE, [callOf(call.traceId)], renamed, QUICK).pipe(
      Effect.provide(standIn({ otlp: call.rows })),
    );
    assert.equal(differs.calls[0]!.agrees, false);
    assert.match(tapFailures(differs)[0]!, new RegExp(`plumbing: the tap and app.spans disagree on ${OPERATION}`));
  }).pipe(Effect.runPromise);
});

test("with the tap on, a kept call missing from the tap is incomplete and fails the run", async () => {
  await Effect.gen(function* () {
    const call = yield* oneCall;
    const other = yield* oneCall;
    const tap = yield* sideBySide(
      DATABASE,
      [callOf(call.traceId)],
      { spans: Arr.map(call.spans, rowOf), events: [] },
      QUICK,
    ).pipe(Effect.provide(standIn({ otlp: other.rows })));
    assert.equal(tap.state, "on");
    assert.equal(tap.calls[0]!.complete, false);
    assert.match(tapFailures(tap)[0]!, /incomplete in the tap: empty-tap/);
  }).pipe(Effect.runPromise);
});

test("observe answers each trace's spans, logs and events in the Observations shape", async () => {
  await Effect.gen(function* () {
    const call = yield* oneCall;
    const events = [
      { trace_id: call.traceId, operation: "call.op", event: "Happened", payload: { org: "o1" } },
      { trace_id: "elsewhere", operation: "call.op", event: "Happened", payload: {} },
      { trace_id: call.traceId, operation: "call.op", event: "Followed", payload: { member: "m1" } },
    ];
    const observed = yield* observe(DATABASE, [call.traceId], QUICK).pipe(
      Effect.provide(standIn({ otlp: call.rows, events })),
    );
    const one = observed.get(call.traceId)!;
    assert.equal(one.trace, call.traceId);
    assert.equal(one.complete, true);
    const server = Option.getOrThrow(Arr.findFirst(one.spans, (span) => span.name === "call.op"));
    assert.deepEqual(Arr.sort(Rec.keys(server), Order.String), [
      "attributes",
      "durationMs",
      "name",
      "outcome",
      "parentSpanId",
      "spanId",
      "startMs",
    ]);
    assert.equal(server.outcome, "ok");
    assert.deepEqual(Arr.sort(Rec.keys(one.logs[0]!), Order.String), ["atMs", "fields", "level", "message", "spanId"]);
    assert.deepEqual(one.events, [
      { seq: 0, event: "Happened", carried: { org: "o1" } },
      { seq: 1, event: "Followed", carried: { member: "m1" } },
    ]);
  }).pipe(Effect.runPromise);
});

test("observe with no tap answers every trace incomplete at once, with its events", async () => {
  await Effect.gen(function* () {
    const reads = { count: 0 };
    const observed = yield* observe(DATABASE, ["t1"]).pipe(
      Effect.provide(
        standIn(
          { otlp: [], events: [{ trace_id: "t1", operation: "call.op", event: "Happened", payload: {} }] },
          reads,
        ),
      ),
    );
    assert.deepEqual(observed.get("t1"), {
      trace: "t1",
      complete: false,
      spans: [],
      logs: [],
      events: [{ seq: 0, event: "Happened", carried: {} }],
    });
    assert.equal(reads.count, 0);
  }).pipe(Effect.runPromise);
});

test("the Observations read answers by who's database, its spans in start order, and dies for an unknown world", async () => {
  await Effect.gen(function* () {
    const call = yield* oneCall;
    const read = yield* observationsRead(
      (who) => Effect.succeed(who?.at === undefined ? Option.some(DATABASE) : Option.none()),
      QUICK,
    ).pipe(Effect.provide(standIn({ otlp: call.rows })));
    const one = (yield* read([call.traceId])).get(call.traceId)!;
    assert.equal(one.complete, true);
    assert.deepEqual(
      Arr.map(one.spans, (span) => span.name),
      ["call.op", "database.query"],
    );
    const elsewhere = yield* Effect.exit(read([call.traceId], { at: "https://elsewhere.test" }));
    assert.equal(elsewhere._tag, "Failure");
  }).pipe(Effect.runPromise);
});

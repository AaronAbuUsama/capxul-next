// The OTLP JSON edge (src/telemetry/otlp.ts) decodes what Effect's own serializer writes, and flat.ts turns a trace
// into the flat spans the checks read. The fixtures are made here, by running effects under `Otlp.layerJson` against
// an in-memory endpoint (support/capture.ts), so they are exactly Effect 4.1.2's bodies.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Metric from "effect/Metric";
import { decodeLogs, decodeMetrics, decodeTraces } from "../src/telemetry/otlp.ts";
import { flatSpans } from "../src/telemetry/flat.ts";
import { bodiesTo, exported, FIXTURE } from "./support/capture.ts";

/** A call-shaped trace: a server span with attributes and a log, a child that succeeds, one that dies. */
const traced = Effect.gen(function* () {
  yield* Effect.annotateCurrentSpan("db.query_count", 3);
  yield* Effect.annotateCurrentSpan("cf.colo", "LHR");
  yield* Effect.annotateCurrentSpan("not.finite", Number.NaN);
  yield* Effect.logInfo("inside the call");
  yield* Effect.void.pipe(Effect.withSpan("child.ok"));
  yield* Effect.die(new Error("no budget")).pipe(Effect.withSpan("child.failed"), Effect.exit);
}).pipe(Effect.withSpan("call.op", { kind: "server", attributes: { "cf.colo": "LHR" } }));

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

test("a trace Effect exports decodes, and flattens into its spans with their parents, outcomes and attributes", async () => {
  const posted = await run(traced.pipe(exported));
  const bodies = bodiesTo(posted, "/v1/traces");
  assert.ok(bodies.length > 0, "Effect exported no trace");
  const spans = Arr.flatten(
    await run(Effect.forEach(bodies, (body) => decodeTraces(body).pipe(Effect.map(flatSpans)))),
  );
  const byName = new Map(Arr.map(spans, (span) => [span.name, span] as const));
  const call = byName.get("call.op");
  const ok = byName.get("child.ok");
  const failed = byName.get("child.failed");
  assert.ok(
    call && ok && failed,
    `spans: ${Arr.join(
      Arr.map(spans, (span) => span.name),
      ", ",
    )}`,
  );
  assert.equal(call.parentSpanId, null);
  assert.equal(ok.parentSpanId, call.spanId);
  assert.equal(failed.parentSpanId, call.spanId);
  assert.equal(ok.traceId, call.traceId);
  assert.equal(call.status, "ok");
  assert.equal(failed.status, "error");
  assert.equal(failed.statusMessage, "no budget");
  assert.ok(Arr.some(failed.events, (event) => event.name === "exception"));
  assert.equal(call.attributes["db.query_count"], 3);
  assert.equal(call.attributes["cf.colo"], "LHR");
  assert.ok(Number.isNaN(call.attributes["not.finite"]), "a non-finite double reads back as NaN");
  assert.equal(call.service, FIXTURE.serviceName);
  assert.ok(call.durationMs >= 0 && call.endedMs > 1_700_000_000_000);
});

test("an interrupted span is unset, as Effect writes it", async () => {
  const posted = await run(Effect.interrupt.pipe(Effect.withSpan("cut.short"), exported));
  const spans = Arr.flatten(
    await run(Effect.forEach(bodiesTo(posted, "/v1/traces"), (body) => decodeTraces(body).pipe(Effect.map(flatSpans)))),
  );
  const cut = Arr.findFirst(spans, (span) => span.name === "cut.short");
  assert.ok(cut._tag === "Some");
  assert.equal(cut.value.status, "unset");
  assert.equal(cut.value.attributes["effect.fiber.interrupted"], true);
});

test("the logs Effect exports decode, each written in a span carrying its trace and span", async () => {
  const posted = await run(traced.pipe(exported));
  const bodies = bodiesTo(posted, "/v1/logs");
  assert.ok(bodies.length > 0, "Effect exported no log");
  const logs = await run(Effect.forEach(bodies, (body) => decodeLogs(body)));
  const entries = Arr.flatMap(logs, (each) =>
    Arr.flatMap(each.resourceLogs, (resource) => Arr.flatMap(resource.scopeLogs, (scope) => scope.logRecords ?? [])),
  );
  const entry = Arr.findFirst(entries, (each) => each.body?.stringValue === "inside the call");
  assert.ok(entry._tag === "Some");
  assert.equal(entry.value.severityText, "Info");
  assert.equal(entry.value.traceId?.length, 32);
  assert.ok(entry.value.spanId);
});

test("the metrics Effect exports decode: a counter, a gauge, a histogram and a summary", async () => {
  const measured = Effect.all([
    Metric.update(Metric.counter("fixture.calls"), 2),
    Metric.update(Metric.gauge("fixture.depth"), 7),
    Metric.update(Metric.histogram("fixture.ms", { boundaries: [10, 100, 1000] }), 42),
    Metric.update(Metric.summary("fixture.size", { maxAge: "1 minute", maxSize: 10, quantiles: [0.5, 0.99] }), 3),
  ]);
  const posted = await run(measured.pipe(exported));
  const bodies = bodiesTo(posted, "/v1/metrics");
  assert.ok(bodies.length > 0, "Effect exported no metric");
  const exports = await run(Effect.forEach(bodies, (body) => decodeMetrics(body)));
  const metrics = Arr.flatMap(exports, (each) =>
    Arr.flatMap(each.resourceMetrics, (resource) => Arr.flatMap(resource.scopeMetrics, (scope) => scope.metrics)),
  );
  const named = (name: string) => Arr.findFirst(metrics, (metric) => metric.name === name);
  const calls = named("fixture.calls");
  const depth = named("fixture.depth");
  const ms = named("fixture.ms");
  const size = named("fixture.size");
  assert.ok(calls._tag === "Some" && calls.value.sum, "the counter is a sum");
  assert.ok(depth._tag === "Some" && depth.value.gauge, "the gauge is a gauge");
  assert.ok(ms._tag === "Some" && ms.value.histogram, "the histogram is a histogram");
  assert.ok(size._tag === "Some" && size.value.summary, "the summary is a summary");
});

test("a body that is not OTLP JSON is refused", async () => {
  for (const body of ['{"resourceSpans":[{"scopeSpans":[]}]}', "not json"])
    assert.ok(Exit.isFailure(await run(decodeTraces(body).pipe(Effect.exit))), body);
});

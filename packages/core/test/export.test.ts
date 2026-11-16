// Core's export (src/telemetry/export.ts), in memory: the spans a call keeps and the spans it exports over OTLP are one
// set, with the same ids, names, parents and attributes; nothing leaves before the exporters' scope closes; and the
// tap is handed each body as OTLP JSON.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Envelope, WorldRpcs } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Str from "effect/String";
import * as Rec from "effect/Record";
import * as Tracer from "effect/Tracer";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as OtlpExporter from "effect/observability/OtlpExporter";
import type * as Rpc from "effect/rpc/Rpc";
import { SPAN_ATTRIBUTES } from "../src/telemetry/attributes.ts";
import { SpanSink } from "../src/telemetry/sink.ts";
import type { KeptSpan } from "../src/telemetry/spans.ts";
import { ENV } from "../src/env.ts";
import {
  apiTelemetry,
  type Held,
  requestExport,
  SERVICE_NAME,
  TAP_ON,
  transport,
  type Signal,
} from "../src/telemetry/export.ts";
import { CallTracer, measured, OUTCOME } from "../src/telemetry/spans.ts";

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a declared Rpc names its middlewares by their own types, which the general `AnyWithProps` a middleware is handed cannot follow
const rpc = Option.getOrThrow(Arr.head([...WorldRpcs.requests.values()])) as unknown as Rpc.AnyWithProps;

/** An OTLP attribute's value: one of its typed fields, read as text (OTLP/JSON writes an int64 as a string). */
const AnyValue = Schema.Struct({
  stringValue: Schema.optional(Schema.String),
  intValue: Schema.optional(Schema.Union([Schema.String, Schema.Finite])),
  doubleValue: Schema.optional(Schema.Finite),
});
const KeyValue = Schema.Struct({ key: Schema.String, value: AnyValue });
const OtlpSpan = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.optional(Schema.String),
  name: Schema.String,
  attributes: Schema.Array(KeyValue),
  status: Schema.Struct({ code: Schema.Int }),
});
const TraceData = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({
      resource: Schema.Struct({ attributes: Schema.Array(KeyValue) }),
      scopeSpans: Schema.Array(Schema.Struct({ spans: Schema.Array(OtlpSpan) })),
    }),
  ),
});
/** Every body of traces the tap was handed, decoded. */
const traceData = (tapped: ReadonlyArray<readonly [Signal, string]>) =>
  Effect.forEach(
    Arr.filter(tapped, ([signal]) => signal === "traces"),
    ([, body]) => Schema.decodeUnknownEffect(TraceData)(JSON.parse(body)),
  );

const spansOf = (traces: ReadonlyArray<typeof TraceData.Type>) =>
  Arr.flatMap(traces, (data) =>
    Arr.flatMap(data.resourceSpans, (resource) => Arr.flatMap(resource.scopeSpans, (scope) => scope.spans)),
  );

/** The one element of `all` that `found` picks, or a failed test. */
const one = <A>(all: ReadonlyArray<A>, found: (each: A) => boolean, missing: string): A =>
  Option.getOrThrowWith(Arr.findFirst(all, found), () => new assert.AssertionError({ message: missing }));

/** An attribute's value as text, whichever field holds it. */
const textOf = (value: typeof AnyValue.Type): string | undefined =>
  value.stringValue ?? (value.intValue ?? value.doubleValue)?.toString();

/** A call's work: a Postgres round trip and a step of its own. */
const steps = Effect.gen(function* () {
  yield* Effect.useSpan("postgres", { kind: "client", attributes: { "db.system.name": "postgresql" } }, () =>
    Effect.sleep("2 millis"),
  );
  yield* Effect.withSpan(Effect.sleep("1 millis"), "inner.step");
});

/** Runs a call through the exporters and returns what was kept, what the tap was handed, and when. */
const run = (caller: Headers.Headers, work: Effect.Effect<unknown, string> = steps) =>
  Effect.gen(function* () {
    const kept: Array<KeptSpan> = [];
    const tapped: Array<readonly [Signal, string]> = [];
    const sink = SpanSink.of({ keep: (spans) => Effect.sync(() => kept.push(...spans)) });
    const hold = (held: Held) => void tapped.push([held.signal, held.body]);
    const client = transport(Option.none(), Option.some(hold));
    const scope = yield* Scope.make();
    const built = yield* Layer.buildWithScope(
      apiTelemetry({ baseUrl: "https://collector", revision: "abc123" }).pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
      ),
      scope,
    );
    const tracer = Context.get(built, Tracer.Tracer);
    yield* measured(sink, { colo: Option.some("LHR") }, { rpc, headers: caller }, work).pipe(
      Effect.provideService(CallTracer, Option.some(tracer)),
      Effect.exit,
    );
    const beforeClose = tapped.length;
    yield* Context.get(built, OtlpExporter.Flusher).flush;
    yield* Scope.close(scope, Exit.void);
    return { kept, traces: yield* traceData(tapped), beforeClose };
  });

test("the spans exported are the spans kept: same ids, names, parents and declared attributes", async () => {
  const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
  const { kept, traces, beforeClose } = await Effect.runPromise(run(Headers.fromInput({ traceparent })));
  assert.equal(beforeClose, 0, "something was exported before the scope closed");
  const exported = spansOf(traces);
  assert.equal(kept.length, 3);
  assert.equal(exported.length, kept.length);
  for (const span of kept) {
    const twin = one(exported, (each) => each.spanId === span.spanId, `${span.name} was kept but not exported`);
    assert.equal(twin.traceId, Str.padStart(32, "0")(span.traceId));
    assert.equal(twin.name, span.name);
    assert.equal(twin.parentSpanId ?? null, span.parentSpanId);
    for (const key of Rec.values(SPAN_ATTRIBUTES)) {
      const value = span.attributes?.[key];
      if (value === undefined) continue;
      const found = one(twin.attributes, (each) => each.key === key, `${key} is not on the exported ${span.name}`);
      assert.equal(textOf(found.value), String(value), `${key} differs on ${span.name}`);
    }
  }
  const call = one(kept, (span) => span.name === rpc._tag, "the call's own span was not kept");
  assert.equal(call.traceId, "0af7651916cd43dd8448eb211c80319c");
  assert.equal(call.parentSpanId, "b7ad6b7169203331");
});

test("every export carries the api's service name and the code's revision", async () => {
  const { traces } = await Effect.runPromise(run(Headers.empty));
  assert.ok(traces.length > 0, "no traces were exported");
  const resource = Arr.flatMap(traces, (data) => Arr.flatMap(data.resourceSpans, (each) => each.resource.attributes));
  const named = (key: string) => one(resource, (each) => each.key === key, `no ${key}`).value.stringValue;
  assert.equal(named("service.name"), SERVICE_NAME);
  assert.equal(named("service.version"), "abc123");
});

test("with no CallTracer, a call's spans are made by the tracer around it, and kept too", async () => {
  const seen: Array<string> = [];
  const recording = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        seen.push(span.spanId);
        end(endTime, exit);
      };
      return span;
    },
  });
  const kept: Array<KeptSpan> = [];
  const sink = SpanSink.of({ keep: (spans) => Effect.sync(() => kept.push(...spans)) });
  await Effect.runPromise(
    measured(
      sink,
      { colo: Option.none() },
      { rpc, headers: Headers.empty },
      Effect.withSpan(Effect.void, "inner.step"),
    ).pipe(Effect.withTracer(recording)),
  );
  assert.equal(kept.length, 2);
  assert.deepEqual(
    Arr.map(kept, (span) => span.spanId),
    seen,
  );
});

test("with the tap on and no collector binding, a call answers, and closing its request fails nothing", async () => {
  // A Core of a world on the local bench: the tap on, no collector bound. Its database cannot be reached here, so the
  // tap's write fails after the answer, and that is only logged.
  const env = { [ENV.tap]: TAP_ON, [ENV.revision]: "abc123" };
  const unreachable = Effect.succeed(Redacted.make("postgresql://nobody:nothing@127.0.0.1:1/none"));
  const kept: Array<KeptSpan> = [];
  const sink = SpanSink.of({ keep: (spans) => Effect.sync(() => kept.push(...spans)) });
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const exported = yield* requestExport(env, unreachable);
      assert.ok(Option.isSome(exported), "the tap alone did not build the export");
      return yield* measured(
        sink,
        { colo: Option.none() },
        { rpc, headers: Headers.empty },
        Effect.succeed("answer"),
      ).pipe(Effect.provide(exported.value));
    }).pipe(Effect.scoped),
  );
  assert.ok(Exit.isSuccess(exit), `the request failed: ${Exit.isFailure(exit) ? String(exit.cause) : ""}`);
  assert.equal(exit.value, "answer");
  assert.equal(kept.length, 1);
});

test("with neither tap nor collector, nothing is built and nothing is exported", async () => {
  const exported = await Effect.runPromise(
    requestExport({}, Effect.succeed(Redacted.make("postgresql://nobody@127.0.0.1:1/none"))).pipe(Effect.scoped),
  );
  assert.ok(Option.isNone(exported));
});

/** The exported call span's `capxul.outcome` and OTLP status code, and the kept outcome, for a call doing `work`. */
const endedAs = (work: Effect.Effect<unknown, string>) =>
  Effect.map(run(Headers.empty, work), ({ kept, traces }) => {
    const span = one(spansOf(traces), (each) => each.name === rpc._tag, "the call's span was not exported");
    const outcome = one(
      span.attributes,
      (each) => each.key === Envelope.attributes.outcome.name,
      "the call's span carries no outcome",
    );
    return {
      outcome: outcome.value.stringValue,
      status: span.status.code,
      kept: one(kept, (each) => each.name === rpc._tag, "the call's span was not kept").outcome,
    };
  });

test("every exported span carries its outcome; a refusal leaves the status unset, a defect sets ERROR", async () => {
  const [ok, refused, defect] = await Effect.runPromise(
    Effect.all([endedAs(steps), endedAs(Effect.fail("refused")), endedAs(Effect.die("broken"))]),
  );
  assert.deepEqual(ok, { outcome: OUTCOME.success, status: 1, kept: "success" });
  assert.deepEqual(refused, { outcome: OUTCOME.failure, status: 0, kept: "failure" });
  assert.deepEqual(defect, { outcome: OUTCOME.defect, status: 2, kept: "defect" });
  const { traces } = await Effect.runPromise(run(Headers.empty));
  for (const span of spansOf(traces))
    assert.ok(
      Arr.some(span.attributes, (each) => each.key === Envelope.attributes.outcome.name),
      `${span.name} carries no outcome`,
    );
});

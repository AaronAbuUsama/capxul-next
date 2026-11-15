// The collector's own work (src/collector.ts; roadmap 4.4): it stamps who called it on every resource, refuses a
// public call without a valid platform token, and forwards the body to the sink with the sink's headers.
import { Producers } from "@capxul/blueprint";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { type Caller, type Identity, makeCollector, type Signal } from "../src/collector.ts";
import { KEYS } from "./support/envelope.ts";
import { capturing, type Posted } from "./support/otlp-endpoint.ts";

const SINK = "https://sink.test";
const HEADERS = {
  traces: { authorization: "Bearer sink-key", "x-axiom-dataset": "capxul-test-traces" },
  logs: { authorization: "Bearer sink-key", "x-axiom-dataset": "capxul-test-logs" },
  metrics: { authorization: "Bearer sink-key", "x-axiom-dataset": "capxul-test-metrics" },
} as const;

const BOUND: Identity = { world: "w-bound", grade: "private", stage: "staging" };
const OPERATOR: Identity = { world: "w-operator", grade: "shared", stage: "staging" };
const GOOD_TOKEN = "operator-token-good";
const verify = (token: Redacted.Redacted) =>
  Effect.succeed(Redacted.value(token) === GOOD_TOKEN ? Option.some(OPERATOR) : Option.none());

/** What a body grant about itself, which the collector must overwrite. */
const LIES = [
  { key: KEYS.world, value: { stringValue: "w-real" } },
  { key: KEYS.grade, value: { stringValue: "real" } },
  { key: KEYS.stage, value: { stringValue: "production" } },
  { key: "service.name", value: { stringValue: Producers.producers.api.service } },
];
const resource = (attributes: ReadonlyArray<unknown>) => ({ attributes, droppedAttributesCount: 0 });

/** A body of each signal with two resources: one that lies about who sent it, one that says nothing. */
const BODIES: Readonly<Record<Signal, { readonly list: string; readonly body: object }>> = {
  traces: {
    list: "resourceSpans",
    body: {
      resourceSpans: [
        { resource: resource(LIES), scopeSpans: [] },
        { resource: resource([]), scopeSpans: [] },
      ],
    },
  },
  logs: {
    list: "resourceLogs",
    body: {
      resourceLogs: [
        { resource: resource(LIES), scopeLogs: [] },
        { resource: resource([]), scopeLogs: [] },
      ],
    },
  },
  metrics: {
    list: "resourceMetrics",
    body: {
      resourceMetrics: [
        { resource: resource(LIES), scopeMetrics: [] },
        { resource: resource([]), scopeMetrics: [] },
      ],
    },
  },
};

/** Posts a signal's body to the collector as `caller`, with `authorization` if given; its answer and what it forwarded. */
const call = (signal: Signal, caller: Caller, authorization?: string) =>
  Effect.gen(function* () {
    const { posted, layer } = capturing();
    const collector = yield* makeCollector({ sinkUrl: SINK, headers: HEADERS, keys: KEYS, verify }).pipe(
      Effect.provide(layer),
    );
    const request = new Request(`https://collector.test/v1/${signal}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization === undefined ? {} : { authorization: `Bearer ${authorization}` }),
      },
      body: JSON.stringify(BODIES[signal].body),
    });
    const response = yield* collector[signal](caller).pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
      Effect.provide(layer),
    );
    return { status: response.status, posted: posted };
  });

/** A forwarded body, as far as this test reads it: each resource's attributes. */
type Forwarded = Readonly<
  Record<
    string,
    ReadonlyArray<{
      readonly resource: {
        readonly attributes: ReadonlyArray<{ readonly key: string; readonly value: { readonly stringValue?: string } }>;
      };
    }>
  >
>;

/** Each resource's attributes as a record, from a forwarded body. A key written twice fails: stamping overwrites. */
const stampsOf = (signal: Signal, forwarded: Posted): ReadonlyArray<Readonly<Record<string, unknown>>> => {
  const body: Forwarded = JSON.parse(forwarded.body);
  return Arr.map(body[BODIES[signal].list] ?? [], (each) => {
    const keys = Arr.map(each.resource.attributes, (attribute) => attribute.key);
    assert.equal(
      new Set(keys).size,
      keys.length,
      `a resource attribute was appended, not overwritten: ${Arr.join(keys, ", ")}`,
    );
    return Rec.fromEntries(
      Arr.map(each.resource.attributes, (attribute) => [attribute.key, attribute.value.stringValue]),
    );
  });
};

const stamped = (identity: Identity) => ({
  [KEYS.world]: identity.world,
  [KEYS.grade]: identity.grade,
  [KEYS.stage]: identity.stage,
});

const ACCEPTED = "the collector did not accept the call";
const REFUSED = "the collector did not refuse the call with 401";

for (const signal of ["traces", "logs", "metrics"] as const) {
  test(`${signal}: a bound caller's identity is stamped on every resource, whatever the body says`, () =>
    Effect.gen(function* () {
      const { status, posted } = yield* call(signal, { _tag: "Bound", identity: BOUND });
      assert.equal(status, 200, ACCEPTED);
      assert.equal(posted.length, 1, "the collector did not forward the body once");
      const [lied, silent] = stampsOf(signal, posted[0]!);
      assert.deepEqual({ ...lied }, { ...stamped(BOUND), "service.name": Producers.producers.api.service });
      assert.deepEqual({ ...silent }, stamped(BOUND));
    }).pipe(Effect.runPromise));
}

test("a public call with no token is refused, and nothing is forwarded", () =>
  Effect.gen(function* () {
    const { status, posted } = yield* call("traces", { _tag: "Public" });
    assert.equal(status, 401, REFUSED);
    assert.equal(posted.length, 0, "a refused call was forwarded");
  }).pipe(Effect.runPromise));

test("a public call with a token that is not the operator's token is refused, and nothing is forwarded", () =>
  Effect.gen(function* () {
    const { status, posted } = yield* call("logs", { _tag: "Public" }, "operator-token-forged");
    assert.equal(status, 401, REFUSED);
    assert.equal(posted.length, 0, "a refused call was forwarded");
  }).pipe(Effect.runPromise));

test("a public call with the operator's valid token is stamped with whom the token names", () =>
  Effect.gen(function* () {
    const { status, posted } = yield* call("metrics", { _tag: "Public" }, GOOD_TOKEN);
    assert.equal(status, 200, ACCEPTED);
    assert.equal(posted.length, 1, "the collector did not forward the body once");
    for (const stamps of stampsOf("metrics", posted[0]!))
      assert.deepEqual(
        { [KEYS.world]: stamps[KEYS.world], [KEYS.grade]: stamps[KEYS.grade], [KEYS.stage]: stamps[KEYS.stage] },
        stamped(OPERATOR),
      );
  }).pipe(Effect.runPromise));

for (const signal of ["traces", "logs", "metrics"] as const) {
  test(`${signal}: the body is forwarded to the sink's /v1/${signal} with the sink's headers, not the caller's`, () =>
    Effect.gen(function* () {
      const { status, posted } = yield* call(signal, { _tag: "Public" }, GOOD_TOKEN);
      assert.equal(status, 200, ACCEPTED);
      assert.equal(posted.length, 1, "the collector did not forward the body once");
      const forwarded = posted[0]!;
      assert.equal(forwarded.url, `${SINK}/v1/${signal}`);
      assert.equal(forwarded.headers["authorization"], HEADERS[signal].authorization);
      assert.equal(forwarded.headers["x-axiom-dataset"], HEADERS[signal]["x-axiom-dataset"]);
      assert.ok(!Str.includes(GOOD_TOKEN)(forwarded.body), "the caller's token reached the sink");
    }).pipe(Effect.runPromise));
}

// The collector without Cloudflare: its grant, who it lets in, how it stamps every resource whatever the caller
// sent, what it sends the sink (through OtlpProxy) and what it counts. The sink is a stand-in HttpClient.
import { Producers } from "@capxul/blueprint";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { boundTokenOf, verifierOf } from "../src/collector/caller.ts";
import { type CollectorGrant, mintCollectorToken } from "../src/collector/tokens.ts";
import { countsExport, outcomeOf } from "../src/collector/counts.ts";
import { STAMPED } from "../src/collector/forward.ts";
import { datasetsOf, forward, type Forwarding, sinkHeadersOf } from "../src/collector/forward.ts";
import { countItems, resourceAttributes, stampExport } from "../src/collector/otlp-json.ts";
import { cryptoLayer } from "../src/token.ts";

const KEY = Redacted.make(Str.repeat(32)("c3"));
const OTHER = Redacted.make(Str.repeat(32)("d4"));
const NOW = 1_800_000_000;
const WORLD: CollectorGrant = {
  operator: "ci-1-1",
  world: Option.some("acme"),
  grade: Option.some("private"),
  expires: NOW + 3600,
};
const OPERATOR: CollectorGrant = { operator: "amp-7", world: Option.none(), grade: Option.none(), expires: NOW + 60 };

const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof cryptoLayer>>) =>
  Effect.runPromise(Effect.provide(effect, cryptoLayer));
const tokenOf = (key: Redacted.Redacted, c: CollectorGrant) =>
  run(Effect.map(mintCollectorToken(key, c), Redacted.value));

const traces = (attributes: ReadonlyArray<unknown>) => ({
  resourceSpans: [
    {
      resource: { attributes, droppedAttributesCount: 0 },
      scopeSpans: [{ scope: { name: "api" }, spans: [{ name: "a" }, { name: "b" }] }],
    },
    { scopeSpans: [{ spans: [{ name: "c" }] }] },
  ],
});
const lying = [
  { key: "service.name", value: { stringValue: Producers.producers.api.service } },
  { key: STAMPED.world, value: { stringValue: "someone-else" } },
  { key: STAMPED.grade, value: { stringValue: "real" } },
  { key: STAMPED.stage, value: { stringValue: "production" } },
];

test("a binding's token names its world and grade; it is refused without them, expired or under another key", async () => {
  const good = await tokenOf(KEY, WORLD);
  const id = (token: string, key = KEY) => run(Redacted.make(token).pipe(verifierOf(key, "staging", NOW, true)));
  assert.deepEqual(Option.getOrNull(await id(good)), { world: "acme", grade: "private", stage: "staging" });
  assert.ok(Option.isNone(await id(await tokenOf(KEY, OPERATOR))));
  assert.ok(Option.isNone(await id(good, OTHER)));
  assert.ok(Option.isNone(await id(await tokenOf(KEY, { ...WORLD, expires: NOW - 1 }))));
  assert.ok(Option.isNone(await id(`${Str.slice(0, -1)(good)}0`)));
});

test("a binding's token is read from its props; a public request has none", () => {
  assert.ok(Option.isSome(boundTokenOf({ token: "c1.x" })));
  assert.ok(Option.isNone(boundTokenOf({})));
});

test("an operator's token, as a public caller's token, names no world: only the stage is stamped", async () => {
  const id = (token: string) => run(Redacted.make(token).pipe(verifierOf(KEY, "staging", NOW, false)));
  assert.deepEqual(Option.getOrNull(await id(await tokenOf(KEY, OPERATOR))), {
    world: "",
    grade: "",
    stage: "staging",
  });
  assert.ok(Option.isNone(await id("nonsense")));
  assert.ok(Option.isNone(await id(await tokenOf(OTHER, OPERATOR))));
});

test("stamping drops what the caller sent under the stamped keys and adds the collector's, on every resource", () => {
  const stamp = [
    { key: STAMPED.world, value: { stringValue: "acme" } },
    { key: STAMPED.stage, value: { stringValue: "staging" } },
  ];
  const stamped = stampExport("traces", traces(lying), [STAMPED.world, STAMPED.grade, STAMPED.stage], stamp);
  const [first, second] = resourceAttributes("traces", stamped);
  assert.deepEqual(first, [lying[0], ...stamp]);
  assert.deepEqual(second, stamp);
  assert.equal(countItems("traces", stamped), 3);
});

test("metric samples are counted under each metric's kind", () => {
  const body = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              { name: "a", sum: { dataPoints: [{}, {}] } },
              { name: "b", histogram: { dataPoints: [{}] } },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(countItems("metrics", body), 3);
});

/** A stand-in sink: records each request and answers with `status` and `body`. */
const standIn = (status: number, body: string) => {
  const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const client = HttpClient.make((request, url) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        (() => {
          const sent = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
          seen.push({ url: url.toString(), headers: { ...request.headers }, body: sent });
          return new Response(body, { status, headers: { "content-type": "application/json" } });
        })(),
      ),
    ),
  );
  return { seen, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const SINK: Forwarding = {
  sinkUrl: "https://sink.invalid",
  headers: sinkHeadersOf(datasetsOf("capxul-test"), Option.some(Redacted.make("ingest"))),
  keys: STAMPED,
};

const post = (body: string, contentType = "application/json") =>
  HttpServerRequest.fromWeb(
    new Request("http://collector/v1/traces", { method: "POST", headers: { "content-type": contentType }, body }),
  );

const forwardTo = (sink: ReturnType<typeof standIn>, request: HttpServerRequest.HttpServerRequest) =>
  Effect.runPromise(
    forward(SINK, "traces", { world: "acme", grade: "private", stage: "staging" }).pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      Effect.provide(sink.layer),
    ),
  );

test("a request is forwarded stamped, to its signal's dataset with the sink's key, and counted", async () => {
  const sink = standIn(200, "{}");
  const done = await forwardTo(sink, post(JSON.stringify(traces(lying))));
  assert.equal(done.response.status, 200);
  assert.equal(sink.seen.length, 1);
  const [sent] = sink.seen;
  assert.equal(sent?.url, "https://sink.invalid/v1/traces");
  assert.equal(sent?.headers["x-axiom-dataset"], "capxul-test-traces");
  assert.equal(sent?.headers.authorization, "Bearer ingest");
  const attributes = resourceAttributes("traces", JSON.parse(sent?.body ?? "{}"));
  for (const resource of attributes) {
    const value = (key: string) =>
      Arr.map(
        Arr.filter(resource, (a: any) => a.key === key),
        (a: any) => a.value.stringValue,
      );
    assert.deepEqual(value(STAMPED.world), ["acme"]);
    assert.deepEqual(value(STAMPED.grade), ["private"]);
    assert.deepEqual(value(STAMPED.stage), ["staging"]);
  }
  assert.deepEqual(Option.getOrNull(done.outcome), {
    signal: "traces",
    items: 3,
    forwarded: 3,
    refused: 0,
    reason: Option.none(),
  });
});

test("what the sink refuses is counted as refused, in whole or in part", async () => {
  const refused = await forwardTo(standIn(403, "{}"), post(JSON.stringify(traces([]))));
  assert.equal(refused.response.status, 403);
  assert.equal(Option.getOrNull(refused.outcome)?.refused, 3);
  const partial = await forwardTo(
    standIn(200, JSON.stringify({ partialSuccess: { rejectedSpans: "2" } })),
    post(JSON.stringify(traces([]))),
  );
  const outcome = Option.getOrNull(partial.outcome);
  assert.equal(outcome?.forwarded, 1);
  assert.equal(outcome?.refused, 2);
  assert.ok(outcome !== null && Option.contains(outcome.reason, "partial"));
});

test("a body that is not OTLP JSON is refused and never reaches the sink", async () => {
  const sink = standIn(200, "{}");
  assert.equal((await forwardTo(sink, post("x", "application/x-protobuf"))).response.status, 415);
  assert.equal((await forwardTo(sink, post("not json"))).response.status, 400);
  assert.equal(sink.seen.length, 0);
});

test("the counts are a delta sum under OpenTelemetry's exporter metric, with the reason on what was refused", () => {
  const body = countsExport(
    outcomeOf("logs", 5, 200, 2),
    { script: "cx-sites-staging-collector", own: [], stamp: [] },
    { startNanos: 1n, endNanos: 2n },
  );
  const metric = body.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0];
  assert.equal(metric?.name, "otel.sdk.exporter.log.exported");
  assert.deepEqual(
    Arr.map(metric?.sum.dataPoints ?? [], (p) => p.asInt),
    ["3", "2"],
  );
  assert.deepEqual(metric?.sum.dataPoints[1]?.attributes.at(-1), {
    key: "error.type",
    value: { stringValue: "partial" },
  });
});

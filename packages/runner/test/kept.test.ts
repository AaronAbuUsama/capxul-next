// The flip (src/telemetry/kept.ts): the generic checks read each call's spans from the tap. These show that the checks
// get the same input from a tap fixture as from the matching `app.spans` rows, and so check a call the same way; that
// a call the api answered whose trace is not in the tap is a plumbing failure; and that a call the api never answered needs
// nothing of the tap. The checks themselves (src/checks) are not changed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Envelope, operations, servedBy } from "@capxul/blueprint";
import { OUTCOME, SPAN_ATTRIBUTES } from "@capxul/core";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Redacted from "effect/Redacted";
import { checkCall } from "../src/checks/checks.ts";
import type { Call } from "../src/client.ts";
import { flatSpans } from "../src/telemetry/flat.ts";
import { appKeptOf, checkedOrPlumbing, rowOf, tapTelemetryOf } from "../src/telemetry/kept.ts";
import { decodeTraces } from "../src/telemetry/otlp.ts";
import type { SpanRow } from "../src/world/database.ts";
import { OtherWorlds } from "../src/world/existing.ts";
import { PlatformKept } from "../src/worlds/kept.ts";
import { bodiesTo, exported } from "./support/capture.ts";

const DATABASE = Redacted.make("postgresql://user:password@ep-kept.test/neondb");
/** Any operation: what is checked here is where the spans come from, whatever the call's operation. */
const OPERATION = Rec.keys(operations)[0]!;
const QUICK = { tries: 3, every: Duration.millis(1) };
const OUTCOME_KEY = Envelope.attributes.outcome.name;

/**
 * One call as the api makes it: its operation span refused (a typed failure), carrying its declared attributes, with a
 * Postgres round trip inside; each span with the `capxul.outcome` the api stamps.
 */
const oneCall = Effect.gen(function* () {
  const posted = yield* Effect.void.pipe(
    Effect.withSpan("postgres", { kind: "client", attributes: { [OUTCOME_KEY]: OUTCOME.success } }),
    Effect.andThen(Effect.fail("refused")),
    Effect.withSpan(OPERATION, {
      kind: "server",
      attributes: {
        [OUTCOME_KEY]: OUTCOME.failure,
        [SPAN_ATTRIBUTES.colo]: "LHR",
        [SPAN_ATTRIBUTES.queryMs]: 4.5,
        [SPAN_ATTRIBUTES.queryCount]: 1,
        "rpc.method": OPERATION,
      },
    }),
    exported,
  );
  const traces = bodiesTo(posted, "/v1/traces")[0]!;
  const spans = flatSpans(yield* decodeTraces(traces));
  const traceId = spans[0]!.traceId;
  return { traceId, spans, rows: [{ trace_id: traceId, signal: "traces", body: JSON.parse(traces) }] };
});

/** The same spans as the api's sink keeps them in `app.spans`: written here by hand, from what the api keeps. */
const appRows = (spans: ReturnType<typeof flatSpans>): ReadonlyArray<SpanRow> =>
  Arr.map(spans, (span) => ({
    trace_id: span.traceId,
    span_id: span.spanId,
    parent_span_id: span.parentSpanId,
    name: span.name,
    outcome: span.name === OPERATION ? "failure" : "success",
    duration_ms: span.durationMs,
    ended_ms: Math.floor(span.endedMs),
    attributes:
      span.name === OPERATION
        ? { [SPAN_ATTRIBUTES.colo]: "LHR", [SPAN_ATTRIBUTES.queryMs]: 4.5, [SPAN_ATTRIBUTES.queryCount]: 1 }
        : null,
  }));

const callOf = (traceId: string, outcome: Call["outcome"]): Call => ({
  operation: OPERATION,
  traceId,
  at: null,
  outcome,
  refusal: outcome === "refusal" ? "Refused" : null,
  payload: {},
  success: Option.none(),
  callerMs: 1,
  resent: 0,
  failure: null,
});

/** Neon's `/sql` endpoint over the tap's rows and `app.events`, answering each query by what it reads. */
const standIn = (otlp: ReadonlyArray<{ trace_id: string; signal: string; body: unknown }>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const sent =
        request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : { query: "" };
      const ids: ReadonlyArray<string> = sent.params?.[0] ?? [];
      const rows = Str.includes("from app.events")(sent.query)
        ? []
        : Arr.filter(otlp, (row) => Arr.contains(ids, row.trace_id));
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ rows }, { status: 200 })));
    }),
  );

test("a tapped span is handed to the checks as the app.spans row the api keeps of it", async () => {
  const call = await Effect.runPromise(oneCall);
  const fromTap = Arr.map(call.spans, (span) => Result.getOrThrow(rowOf(span)));
  assert.deepEqual(fromTap, appRows(call.spans));
});

test("the checks give the same verdicts from the tap as from app.spans", async () => {
  const call = await Effect.runPromise(oneCall);
  const kept = await Effect.runPromise(
    tapTelemetryOf(DATABASE, [callOf(call.traceId, "refusal")], QUICK).pipe(Effect.provide(standIn(call.rows))),
  );
  const fromApp = checkCall(callOf(call.traceId, "refusal"), { spans: appRows(call.spans), events: [] });
  const fromTap = checkCall(callOf(call.traceId, "refusal"), kept);
  assert.deepEqual(fromTap, fromApp);
  assert.ok(
    Arr.every(fromTap.checks, (check) => check.passed),
    JSON.stringify(fromTap.checks),
  );
});

test("a tapped span with no outcome the api stamps is not handed to the checks", async () => {
  const call = await Effect.runPromise(oneCall);
  const { [OUTCOME_KEY]: _dropped, ...rest } = call.spans[0]!.attributes;
  assert.ok(Result.isFailure(rowOf({ ...call.spans[0]!, attributes: rest })));
});

test("a call the api answered whose trace the tap does not hold is a plumbing failure", async () => {
  const exit = await Effect.runPromiseExit(
    tapTelemetryOf(DATABASE, [callOf("0af7651916cd43dd8448eb211c80319c", "success")], QUICK).pipe(
      Effect.provide(standIn([])),
    ),
  );
  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /plumbing: the tap does not hold whole the trace of a call the api answered/);
});

test("a call the api never answered needs nothing of the tap", async () => {
  const kept = await Effect.runPromise(
    tapTelemetryOf(
      DATABASE,
      [
        callOf("0af7651916cd43dd8448eb211c80319c", "rejected"),
        callOf("1af7651916cd43dd8448eb211c80319c", "unanswered"),
      ],
      QUICK,
    ).pipe(Effect.provide(standIn([]))),
  );
  assert.deepEqual(kept, { spans: [], events: [] });
});

/** A row of `app.spans` with nothing but its trace and its name. */
const row = (trace: string, name: string): SpanRow => ({
  trace_id: trace,
  span_id: `${name}-span`,
  parent_span_id: null,
  name,
  outcome: "success",
  duration_ms: 1,
  ended_ms: 1_800_000_000_000,
  attributes: null,
});

test("parity's app.spans side reads a call at another world's endpoint in that world's database", async () => {
  const own = Redacted.make("postgresql://user:password@ep-own.test/neondb");
  const theirs = Redacted.make("postgresql://user:password@ep-theirs.test/neondb");
  const endpoint = "https://other-world.test";
  const byHost: Readonly<Record<string, ReadonlyArray<SpanRow>>> = {
    "ep-own.test": [row(Str.repeat(32)("a"), "own")],
    "ep-theirs.test": [row(Str.repeat(32)("b"), "theirs")],
  };
  const tables = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      const sent =
        request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : { query: "" };
      const ids: ReadonlyArray<string> = sent.params?.[0] ?? [];
      const rows = Str.includes("from app.spans")(sent.query)
        ? Arr.filter(byHost[url.hostname] ?? [], (each) => Arr.contains(ids, each.trace_id))
        : [];
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ rows }, { status: 200 })));
    }),
  );
  const otherWorlds = Layer.succeed(OtherWorlds, {
    databaseAt: (at: string) => Effect.succeed(at === endpoint ? Option.some(theirs) : Option.none()),
  });
  const kept = await Effect.runPromise(
    appKeptOf(own, [
      { traceId: Str.repeat(32)("a"), at: null, operation: WORLD_SERVED },
      { traceId: Str.repeat(32)("b"), at: endpoint, operation: WORLD_SERVED },
      { traceId: Str.repeat(32)("c"), at: "https://unknown.test", operation: WORLD_SERVED },
    ]).pipe(Effect.provide(Layer.merge(tables, otherWorlds))),
  );
  assert.deepEqual(
    Arr.map(kept.spans, (span) => span.name),
    ["own", "theirs"],
  );
});

/** An operation each group serves: one served in this process in a run in private worlds, and one a world serves. */
const SERVED_HERE = Option.getOrThrow(Arr.findFirst(Rec.keys(operations), (op) => servedBy(op) !== "world"));
const WORLD_SERVED = Option.getOrThrow(Arr.findFirst(Rec.keys(operations), (op) => servedBy(op) === "world"));

/** An HTTP client that fails the test on any request: nothing may be sent. */
const sendsNothing = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) => Effect.die(new assert.AssertionError({ message: `${request.url} was sent` }))),
);

test("a stage with no world of its own reads nothing of app.spans for the calls served in this process", async () => {
  // Run 43807337978: a journey given `quota-full` in the shared shape owns no world, so its stage's database is empty,
  // and its own calls served in this process were read from app.spans there: "Transport error (POST https:///sql)".
  const servedHere = Layer.succeed(PlatformKept, { kept: () => Effect.succeed({ spans: [], events: [] }) });
  const kept = await Effect.runPromise(
    appKeptOf(Redacted.make(""), [{ traceId: Str.repeat(32)("d"), at: null, operation: SERVED_HERE }]).pipe(
      Effect.provide(Layer.merge(sendsNothing, servedHere)),
    ),
  );
  assert.deepEqual(kept, { spans: [], events: [] });
});

test("a database with no host fails as plumbing, saying so, and sends nothing", async () => {
  const exit = await Effect.runPromiseExit(
    appKeptOf(Redacted.make(""), [{ traceId: Str.repeat(32)("e"), at: null, operation: WORLD_SERVED }]).pipe(
      Effect.provide(sendsNothing),
    ),
  );
  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /plumbing: a database with no host was read/);
});

test("a starting world's call missing from the tap fails as plumbing, with no checks, never as nothing", async () => {
  const call = callOf("0af7651916cd43dd8448eb211c80319c", "success");
  const got = await Effect.runPromise(
    checkedOrPlumbing([call], tapTelemetryOf(DATABASE, [call], QUICK)).pipe(Effect.provide(standIn([]))),
  );
  assert.deepEqual(got.checked, []);
  assert.equal(got.plumbing.length, 1);
  assert.match(got.plumbing[0]!, /^plumbing: .*the tap does not hold whole the trace of a call the api answered/);
});

test("a starting world's calls the tap holds are checked, and nothing is plumbing", async () => {
  const made = await Effect.runPromise(oneCall);
  const call = callOf(made.traceId, "refusal");
  const got = await Effect.runPromise(
    checkedOrPlumbing([call], tapTelemetryOf(DATABASE, [call], QUICK)).pipe(Effect.provide(standIn(made.rows))),
  );
  assert.deepEqual(got.plumbing, []);
  assert.equal(got.checked.length, 1);
});

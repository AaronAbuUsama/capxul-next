// The runner's span reader (src/telemetry/kept.ts): the generic checks read each call's spans from the tap. These show
// that the checks get the same input from a tap fixture as from the rows Core's spans make, written by hand; that
// a call the api answered whose trace is not in the tap is a plumbing failure; and that a call the api never answered needs
// nothing of the tap. The checks themselves (src/checks) are not changed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Envelope, operations } from "@capxul/blueprint";
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
import { checkedOrPlumbing, rowOf, tapTelemetryOf } from "../src/telemetry/kept.ts";
import { decodeTraces } from "../src/telemetry/otlp.ts";
import type { SpanRow } from "../src/world/database.ts";
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

/** The same spans as rows of the shape the checks read (`SpanRow`), written here by hand from what the api keeps. */
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

test("a tapped span is handed to the checks as the row the api's span makes", async () => {
  const call = await Effect.runPromise(oneCall);
  const fromTap = Arr.map(call.spans, (span) => Result.getOrThrow(rowOf(span)));
  assert.deepEqual(fromTap, appRows(call.spans));
});

test("the checks give the same verdicts from the tap as from the hand-written rows", async () => {
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

/** An HTTP client that fails the test on any request: nothing may be sent. */
const sendsNothing = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) => Effect.die(new assert.AssertionError({ message: `${request.url} was sent` }))),
);

test("a database with no host fails as plumbing, saying so, and sends nothing", async () => {
  // Run 43807337978: a journey given `quota-full` in the shared shape owns no world, so its stage's database is empty;
  // a read there went to "https:///sql". Now it is the runner's plumbing failure, and nothing is sent.
  const exit = await Effect.runPromiseExit(
    tapTelemetryOf(Redacted.make(""), [callOf(Str.repeat(32)("e"), "success")], QUICK).pipe(
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

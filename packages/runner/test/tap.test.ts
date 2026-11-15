// The tap read (src/telemetry/tap.ts) against a stand-in for a world's database: `telemetry.otlp` holds one call's
// traces body, as Effect wrote it, under its trace id. Neon's `/sql` endpoint answers a jsonb column as JSON.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Redacted from "effect/Redacted";
import { decodeTraces } from "../src/telemetry/otlp.ts";
import { flatSpans } from "../src/telemetry/flat.ts";
import { tapOf } from "../src/telemetry/tap.ts";
import { bodiesTo, exported } from "./support/capture.ts";
import { failsUntilBuilt } from "./support/fails.ts";

const DATABASE = Redacted.make("postgresql://user:password@ep-tap.test/neondb");

/** Neon's `/sql` endpoint, answering every query with `rows`. */
const standIn = (rows: ReadonlyArray<unknown>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ rows }, { status: 200 }))),
    ),
  );

// Fails until "🔨 the runner reads the tap beside app.spans" (PR #317, item 5) replaces the stub: it reads nothing.
test("the tap read returns the spans Core wrote under a call's trace id", async () => {
  const reason = await Effect.gen(function* () {
    const posted = yield* Effect.void.pipe(Effect.withSpan("call.op", { kind: "server" }), exported);
    const body = bodiesTo(posted, "/v1/traces")[0]!;
    const written = flatSpans(yield* decodeTraces(body));
    const traceId = written[0]!.traceId;
    const rows = [{ trace_id: traceId, signal: "traces", body: JSON.parse(body) }];
    const client = standIn(rows);
    const read = yield* tapOf(DATABASE, [traceId]).pipe(Effect.provide(client));
    assert.deepEqual(
      Arr.map(read, (span) => [span.spanId, span.name]),
      Arr.map(written, (span) => [span.spanId, span.name]),
      "the tap read returned no span",
    );
  }).pipe(failsUntilBuilt, Effect.runPromise);
  assert.match(reason, /the tap read returned no span/);
});

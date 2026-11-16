// The whole run (src/telemetry/whole-run.ts) against a stand-in for a world's database: Neon's `/sql` endpoint,
// answering `app.events` and the tap's traces rows. Each trace's producer is the resource of its root server span.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Redacted from "effect/Redacted";
import { wholeRun } from "../src/telemetry/whole-run.ts";

const world = { database: Redacted.make("postgresql://user:password@ep-whole.test/neondb") };
const A = "4bf92f3577b34da6a3ce929d0e0e4736";
const B = "0af7651916cd43dd8448eb211c80319c";

interface Tables {
  readonly events: ReadonlyArray<unknown>;
  readonly otlp: ReadonlyArray<{ readonly trace_id: string; readonly signal: string; readonly body: unknown }>;
}

/** Neon's `/sql` endpoint over `tables`: the events in id order, and the tap's rows of the signal asked for. */
const standIn = (tables: Tables) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const sent =
        request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : { query: "" };
      const text: string = sent.query;
      const rows = Str.includes("from app.events")(text)
        ? tables.events
        : Arr.filter(tables.otlp, (row) => Str.includes(`signal = '${row.signal}'`)(text));
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ rows }, { status: 200 })));
    }),
  );

const resource = (service: string) => ({
  attributes: [{ key: "service.name", value: { stringValue: service } }],
});

const span = (trace: string, id: string, parent: string | undefined, name: string, kind: number) => ({
  traceId: trace,
  spanId: id,
  ...(parent === undefined ? {} : { parentSpanId: parent }),
  name,
  kind,
  startTimeUnixNano: "1000000",
  endTimeUnixNano: "2000000",
  attributes: [],
  events: [],
  links: [],
  status: { code: 1 },
});

/** A trace as the tap holds it: the caller's client span, and the server's span with a server span inside it. */
const traced = (trace: string, server: string, name: string) => ({
  resourceSpans: [
    {
      resource: resource("capxul-runner"),
      scopeSpans: [{ scope: { name: "runner" }, spans: [span(trace, "a1", undefined, "journey.run.call", 3)] }],
    },
    {
      resource: resource(server),
      scopeSpans: [
        {
          scope: { name: "core" },
          spans: [span(trace, "c2", "c1", "inner.server", 2), span(trace, "c1", "a1", name, 2)],
        },
      ],
    },
  ],
});

const event = (seq: number, trace: string, payload: unknown) => ({
  seq,
  trace_id: trace,
  operation: "a.thing",
  event: "a.thing-happened",
  payload,
});

test("every event in the record's order, and each trace's producer by its root server span", async () => {
  const run = await Effect.runPromise(
    wholeRun(world).pipe(
      Effect.provide(
        standIn({
          events: [event(1, A, { n: 1 }), event(2, B, { n: 2 }), event(4, A, { n: 3 })],
          otlp: [
            { trace_id: A, signal: "traces", body: traced(A, "capxul-core", "company.create") },
            { trace_id: A, signal: "logs", body: { resourceLogs: [] } },
            { trace_id: B, signal: "traces", body: traced(B, "capxul-world", "world.reset") },
          ],
        }),
      ),
    ),
  );
  assert.deepEqual(run.entries, [
    { seq: 1, trace: A, operation: "a.thing", event: "a.thing-happened", carried: { n: 1 } },
    { seq: 2, trace: B, operation: "a.thing", event: "a.thing-happened", carried: { n: 2 } },
    { seq: 4, trace: A, operation: "a.thing", event: "a.thing-happened", carried: { n: 3 } },
  ]);
  assert.deepEqual(Arr.fromIterable(run.producers), [
    [A, { producer: "capxul-core", span: "company.create" }],
    [B, { producer: "capxul-world", span: "world.reset" }],
  ]);
});

test("a trace with no server span has no producer, and an empty world reads empty", async () => {
  const body = traced(A, "capxul-core", "company.create");
  const clientOnly = { resourceSpans: [body.resourceSpans[0]!] };
  const run = await Effect.runPromise(
    wholeRun(world).pipe(
      Effect.provide(standIn({ events: [], otlp: [{ trace_id: A, signal: "traces", body: clientOnly }] })),
    ),
  );
  assert.deepEqual(run.entries, []);
  assert.equal(run.producers.size, 0);
});

test("a row that does not decode fails the read, naming it", async () => {
  const exit = await Effect.runPromiseExit(
    wholeRun(world).pipe(Effect.provide(standIn({ events: [event(0, A, {})], otlp: [] }))),
  );
  assert.ok(Exit.isFailure(exit));
  assert.match(String(exit.cause), /RunnerFailure: the run could not be read/);
});

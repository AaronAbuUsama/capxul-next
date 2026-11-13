// The generic checks on made-up calls and made-up rows of what Core kept: no stage is needed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { operations } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import type { Call } from "../src/client.ts";
import { checkCall, failuresOf } from "../src/checks/checks.ts";
import type { EventRow, SpanRow } from "../src/world/database.ts";

const TRACE = Str.repeat(32)("a");

const call = (over: Partial<Call> = {}): Call => ({
  operation: "record.export",
  traceId: TRACE,
  at: null,
  outcome: "refusal",
  refusal: "NotImplemented",
  payload: { from: null, to: null },
  success: Option.none(),
  callerMs: 140.5,
  resent: 0,
  failure: null,
  ...over,
});

const span = (over: Partial<SpanRow> = {}): SpanRow => ({
  trace_id: TRACE,
  span_id: "s1",
  parent_span_id: null,
  name: "record.export",
  outcome: "failure",
  duration_ms: 12,
  ended_ms: 1_000_012,
  ...over,
});

const passed = (checked: ReturnType<typeof checkCall>) =>
  Arr.map(checked.checks, (check) => `${check.check} ${check.passed}`);

test("a refused call with its one span and no events passes every check", () => {
  const checked = checkCall(call(), { spans: [span()], events: [] });
  assert.deepEqual(passed(checked), ["span true", "outcome true", "events true"]);
  assert.deepEqual(failuresOf([checked]), []);
});

test("a call has its caller's and server's time, and its budget beside them, never enforced", () => {
  const checked = checkCall(call(), { spans: [span({ duration_ms: 5000 })], events: [] });
  assert.deepEqual(checked.timing, {
    callerMs: 140.5,
    serverMs: 5000,
    budgetMs: operations["record.export"].budget.ms,
    provisional: true,
    enforced: false,
    overBudget: true,
  });
  assert.deepEqual(failuresOf([checked]), [], "a call over its budget fails nothing");
});

test("the spans beneath the operation's are its steps, on its clock, in the order they started", () => {
  const kept = [
    span(),
    span({ span_id: "s3", parent_span_id: "s2", name: "COMMIT", duration_ms: 2, ended_ms: 1_000_011 }),
    span({ span_id: "s2", parent_span_id: "s1", name: "sql.transaction", duration_ms: 8, ended_ms: 1_000_010 }),
    span({ trace_id: Str.repeat(32)("b"), span_id: "x", name: "elsewhere" }),
  ];
  assert.deepEqual(checkCall(call(), { spans: kept, events: [] }).steps, [
    { name: "sql.transaction", parent: "record.export", startMs: 2, ms: 8, outcome: "failure" },
    { name: "COMMIT", parent: "sql.transaction", startMs: 9, ms: 2, outcome: "failure" },
  ]);
});

test("no span, two spans, or a span that ended otherwise fails the call", () => {
  assert.deepEqual(passed(checkCall(call(), { spans: [], events: [] })), [
    "span false",
    "outcome false",
    "events true",
  ]);
  assert.deepEqual(
    passed(checkCall(call(), { spans: [span(), span({ span_id: "s9" })], events: [] }))[0],
    "span false",
  );
  assert.deepEqual(
    passed(checkCall(call(), { spans: [span({ outcome: "success" })], events: [] }))[1],
    "outcome false",
  );
});

test("a refused call that recorded an event fails the events check", () => {
  const event: EventRow = { trace_id: TRACE, operation: "record.export", event: "x", payload: {} };
  const checked = checkCall(call(), { spans: [span()], events: [event] });
  assert.equal(passed(checked)[2], "events false");
  assert.match(failuresOf([checked])[0] ?? "", /call 1 \(record\.export\): events:/);
});

test("a successful call must record exactly its declared events, carrying what is declared", () => {
  const example = operations["world.create"].examples[0];
  assert.ok(example !== undefined);
  const success = call({
    operation: "world.create",
    outcome: "success",
    refusal: null,
    payload: example.payload,
    success: Option.some(example.success),
  });
  const own = span({ name: "world.create", outcome: "success" });
  assert.equal(passed(checkCall(success, { spans: [own], events: [] }))[2], "events false");
});

test("a call its client rejected passes only when Core kept no span of it", () => {
  const rejected = call({ operation: "org.create", outcome: "rejected", refusal: "PayloadRejected" });
  assert.deepEqual(passed(checkCall(rejected, { spans: [], events: [] })), [
    "span true",
    "outcome true",
    "events true",
  ]);
  const reached = checkCall(rejected, { spans: [span({ name: "org.create" })], events: [] });
  assert.deepEqual(passed(reached).slice(0, 2), ["span false", "outcome false"]);
});

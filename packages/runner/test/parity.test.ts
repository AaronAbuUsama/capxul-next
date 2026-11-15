// Parity (src/telemetry/parity.ts): one call's spans as `app.spans` keeps them against the same spans read from the
// tap. They agree only when the tap holds every kept span with the same name, parent, outcome and declared attributes.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import { SPAN_ATTRIBUTES } from "@capxul/core";
import type { SpanRow } from "../src/world/database.ts";
import type { FlatSpan } from "../src/telemetry/flat.ts";
import { parity } from "../src/telemetry/parity.ts";

const TRACE = Str.repeat(32)("c");
const OPERATION = "board.decide";

const kept: ReadonlyArray<SpanRow> = [
  {
    trace_id: TRACE,
    span_id: "s-call",
    parent_span_id: "s-caller",
    name: OPERATION,
    outcome: "failure",
    duration_ms: 120,
    ended_ms: 1_800_000_000_120,
    attributes: { [SPAN_ATTRIBUTES.colo]: "LHR", [SPAN_ATTRIBUTES.queryMs]: 41.5, [SPAN_ATTRIBUTES.queryCount]: 2 },
  },
  {
    trace_id: TRACE,
    span_id: "s-query",
    parent_span_id: "s-call",
    name: "postgres",
    outcome: "success",
    duration_ms: 20,
    ended_ms: 1_800_000_000_060,
    attributes: null,
  },
];

const tapped: ReadonlyArray<FlatSpan> = [
  {
    name: OPERATION,
    traceId: TRACE,
    spanId: "s-call",
    parentSpanId: "s-caller",
    status: "error",
    statusMessage: "refused",
    durationMs: 120.2,
    endedMs: 1_800_000_000_120,
    attributes: {
      [SPAN_ATTRIBUTES.colo]: "LHR",
      [SPAN_ATTRIBUTES.queryMs]: 41.5,
      [SPAN_ATTRIBUTES.queryCount]: 2,
      "rpc.method": OPERATION,
    },
    events: [{ name: "exception", atMs: 1_800_000_000_119, attributes: {} }],
    service: "core",
  },
  {
    name: "postgres",
    traceId: TRACE,
    spanId: "s-query",
    parentSpanId: "s-call",
    status: "ok",
    statusMessage: null,
    durationMs: 20,
    endedMs: 1_800_000_000_060,
    attributes: { "db.system.name": "postgresql" },
    events: [],
    service: "core",
  },
];

const abouts = (rows: ReadonlyArray<SpanRow>, spans: ReadonlyArray<FlatSpan>) =>
  Arr.map(parity(rows, spans).differences, (difference) => difference.about);

/** Whether the second kept span, ended with `outcome`, agrees with its twin exported with `status`. */
const agreesOn = (outcome: string, status: FlatSpan["status"]) =>
  parity([{ ...kept[1]!, outcome }], [{ ...tapped[1]!, status }]).agrees;

test("the same spans agree, library attributes and timings aside", () => {
  assert.deepEqual(parity(kept, tapped), { agrees: true, differences: [] });
});

test("an empty tap never agrees", () => {
  const empty = parity(kept, []);
  assert.equal(empty.agrees, false);
  assert.deepEqual(
    Arr.map(empty.differences, (each) => each.about),
    ["empty-tap"],
  );
  assert.equal(parity([], []).agrees, false);
});

test("a tap missing one span does not agree, and names the span", () => {
  const result = parity(kept, [tapped[0]!]);
  assert.equal(result.agrees, false);
  assert.deepEqual(
    Arr.map(result.differences, (each) => [each.about, each.spanId]),
    [["missing", "s-query"]],
  );
});

test("a span only the tap holds does not agree", () => {
  assert.deepEqual(abouts([kept[0]!], tapped), ["extra"]);
});

test("a declared attribute that differs does not agree, and names the key", () => {
  const other = [
    { ...tapped[0]!, attributes: { ...tapped[0]!.attributes, [SPAN_ATTRIBUTES.queryCount]: 3 } },
    tapped[1]!,
  ];
  const result = parity(kept, other);
  assert.equal(result.agrees, false);
  assert.deepEqual(
    Arr.map(result.differences, (each) => [each.about, each.key, each.kept, each.tapped]),
    [["attribute", SPAN_ATTRIBUTES.queryCount, 2, 3]],
  );
});

test("a declared attribute only the tap carries does not agree", () => {
  const more = [tapped[0]!, { ...tapped[1]!, attributes: { ...tapped[1]!.attributes, [SPAN_ATTRIBUTES.colo]: "AMS" } }];
  assert.deepEqual(abouts(kept, more), ["attribute"]);
});

test("a different name, parent or outcome does not agree", () => {
  assert.deepEqual(abouts(kept, [{ ...tapped[0]!, name: "board.other" }, tapped[1]!]), ["name"]);
  assert.deepEqual(abouts(kept, [{ ...tapped[0]!, parentSpanId: null }, tapped[1]!]), ["parent"]);
  assert.deepEqual(abouts(kept, [{ ...tapped[0]!, status: "ok" }, tapped[1]!]), ["outcome"]);
});

test("each kept outcome matches the status Effect exports for it", () => {
  assert.ok(agreesOn("success", "ok"));
  assert.ok(agreesOn("failure", "error"));
  assert.ok(agreesOn("defect", "error"));
  assert.ok(agreesOn("interrupted", "unset"));
  assert.ok(!agreesOn("success", "unset"));
});

// Parity (src/telemetry/parity.ts): one call's spans as `app.spans` keeps them against the same spans read from the
// tap. They agree only when the tap holds every kept span with the same name, parent, outcome (its `capxul.outcome` and
// its OTLP status) and declared attributes.
import { Envelope, Producers } from "@capxul/blueprint";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import { OUTCOME, SPAN_ATTRIBUTES } from "@capxul/core";
import type { SpanRow } from "../src/world/database.ts";
import type { FlatSpan } from "../src/telemetry/flat.ts";
import { parity } from "../src/telemetry/parity.ts";

const TRACE = Str.repeat(32)("c");
const OUTCOME_KEY = Envelope.attributes.outcome.name;
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
    status: "unset",
    statusMessage: null,
    durationMs: 120.2,
    endedMs: 1_800_000_000_120,
    attributes: {
      [SPAN_ATTRIBUTES.colo]: "LHR",
      [SPAN_ATTRIBUTES.queryMs]: 41.5,
      [SPAN_ATTRIBUTES.queryCount]: 2,
      [OUTCOME_KEY]: OUTCOME.failure,
      "rpc.method": OPERATION,
    },
    events: [{ name: "exception", atMs: 1_800_000_000_119, attributes: {} }],
    service: Producers.producers.api.service,
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
    attributes: { "db.system.name": "postgresql", [OUTCOME_KEY]: OUTCOME.success },
    events: [],
    service: Producers.producers.api.service,
  },
];

const abouts = (rows: ReadonlyArray<SpanRow>, spans: ReadonlyArray<FlatSpan>) =>
  Arr.map(parity(rows, spans).differences, (difference) => difference.about);

/**
 * Whether the second kept span, ended with `outcome`, agrees with its twin exported with `status` and `capxul.outcome`
 * as Core stamps it for that outcome (or `stamped`).
 */
const agreesOn = (outcome: keyof typeof OUTCOME, status: FlatSpan["status"], stamped: string = OUTCOME[outcome]) =>
  parity(
    [{ ...kept[1]!, outcome }],
    [{ ...tapped[1]!, status, attributes: { ...tapped[1]!.attributes, [OUTCOME_KEY]: stamped } }],
  ).agrees;

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
  assert.deepEqual(abouts(kept, [{ ...tapped[0]!, status: "ok" }, tapped[1]!]), ["status"]);
  const stampedAs = (outcome: string) => [
    { ...tapped[0]!, attributes: { ...tapped[0]!.attributes, [OUTCOME_KEY]: outcome } },
    tapped[1]!,
  ];
  assert.deepEqual(abouts(kept, stampedAs(OUTCOME.defect)), ["outcome"]);
});

test("each kept outcome matches the capxul.outcome and the status Core exports for it", () => {
  assert.ok(agreesOn("success", "ok"));
  assert.ok(agreesOn("failure", "unset"));
  assert.ok(agreesOn("defect", "error"));
  assert.ok(agreesOn("interrupted", "unset"));
  assert.ok(!agreesOn("success", "unset"));
  // A refusal and a defect look alike in the status alone; only the outcome tells them apart.
  assert.ok(!agreesOn("failure", "error"));
  assert.ok(!agreesOn("defect", "error", OUTCOME.failure));
});

test("a tapped span with no outcome does not agree", () => {
  const { [OUTCOME_KEY]: _dropped, ...rest } = tapped[1]!.attributes;
  assert.deepEqual(abouts(kept, [tapped[0]!, { ...tapped[1]!, attributes: rest }]), ["outcome"]);
});

/**
 * A clock warp's site span as run 43789356026 kept and tapped it: its declared attributes are arrays, read from
 * `app.spans`' jsonb on one side and from the tap's OTLP on the other, so equal values are never the same object.
 */
const warpSite = (shift: number) => {
  const attributes = {
    "warp.stop_ms": [2264.4, 1294.4, 155.4 + shift],
    "warp.stop_jobs": [95, 100, 18],
    "warp.jobs": ["capxul.clock.daily", "frappe.deferred_insert.save_to_db"],
    "warp.job_runs": [7, 8],
    "warp.job_ms": [429.8, 136.9],
  };
  const row: SpanRow = {
    trace_id: TRACE,
    span_id: "s-warp-site",
    parent_span_id: "s-call",
    name: "world.clock.warp.site",
    outcome: "success",
    duration_ms: 11559,
    ended_ms: 1_800_000_011_559,
    attributes: JSON.parse(JSON.stringify(attributes)),
  };
  const span: FlatSpan = {
    ...tapped[1]!,
    name: "world.clock.warp.site",
    spanId: "s-warp-site",
    parentSpanId: "s-call",
    attributes: {
      ...JSON.parse(JSON.stringify(attributes)),
      "warp.stop_ms": [2264.4, 1294.4, 155.4],
      [OUTCOME_KEY]: OUTCOME.success,
    },
  };
  return { row, span };
};

test("array-valued declared attributes agree when their values are equal, and not when one differs", () => {
  const same = warpSite(0);
  assert.deepEqual(parity([same.row], [same.span]), { agrees: true, differences: [] });
  const moved = warpSite(1);
  assert.deepEqual(
    Arr.map(parity([moved.row], [moved.span]).differences, (each) => [each.about, each.key]),
    [["attribute", "warp.stop_ms"]],
  );
});

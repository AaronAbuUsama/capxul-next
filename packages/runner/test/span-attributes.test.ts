// The call's record carries the attributes of its operation's span (Core's src/telemetry/attributes.ts): recorded,
// never checked, and absent when the span has none.
import { operations } from "@capxul/blueprint";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SPAN_ATTRIBUTES } from "@capxul/core";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import type { Call } from "../src/client.ts";
import { CheckedCall, checkCall } from "../src/checks/checks.ts";
import { SpanRow } from "../src/world/database.ts";

const TRACE = Str.repeat(32)("b");
const RECORD_EXPORT = operations["record.export"].rpc._tag;

const call: Call = {
  operation: RECORD_EXPORT,
  traceId: TRACE,
  at: null,
  outcome: "success",
  refusal: null,
  payload: { from: null, to: null },
  success: Option.none(),
  callerMs: 300,
  resent: 0,
  failure: null,
};

/** A span row as the runner reads it (`SpanRow`), with `attributes` as given. */
const row = (attributes: unknown) =>
  Schema.decodeUnknownEffect(SpanRow)({
    trace_id: TRACE,
    span_id: "s1",
    parent_span_id: null,
    name: RECORD_EXPORT,
    outcome: "success",
    duration_ms: 250,
    ended_ms: 1_000_250,
    attributes,
  });

test("the operation span's attributes land in the call's record, beside its timing", async () => {
  const attributes = {
    [SPAN_ATTRIBUTES.colo]: "LHR",
    [SPAN_ATTRIBUTES.queryMs]: 210.5,
    [SPAN_ATTRIBUTES.queryCount]: 3,
  };
  const checked = checkCall(call, { spans: [await Effect.runPromise(row(attributes))], events: [] });
  assert.deepEqual(checked.attributes, attributes);
  const encoded = await Effect.runPromise(Schema.encodeEffect(CheckedCall)(checked));
  assert.deepEqual(encoded.attributes, attributes);
});

test("a span with no attributes, or a row from before the column, leaves them out of the record", async () => {
  const none = await Effect.runPromise(row(null));
  assert.equal("attributes" in checkCall(call, { spans: [none], events: [] }), false);
  const { attributes: _, ...before } = none;
  assert.equal("attributes" in checkCall(call, { spans: [before], events: [] }), false);
});

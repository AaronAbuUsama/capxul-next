// bun test runner/checks.test.ts
// The generic checks are pure, so what they accept and reject is shown here without a world.
import { describe, expect, test } from "bun:test";
import { checkCall, failuresOf } from "./checks.ts";
import type { Call } from "./client.ts";
import type { EventRow, SpanRow } from "./database.ts";

const call = (outcome: Call["outcome"], operation: Call["operation"] = "record.append"): Call => ({ operation, traceId: "t1", outcome, ms: 40, failure: null });
const span = (outcome: string, more: Partial<SpanRow> = {}): SpanRow => ({ trace_id: "t1", name: "record.append", outcome, duration_ms: 12, ...more });
const appended = (more: Partial<EventRow> = {}): EventRow => ({ trace_id: "t1", operation: "record.append", event: "record_appended", payload: {}, ...more });
const failed = (checked: ReturnType<typeof checkCall>) => checked.checks.filter((check) => !check.passed).map((check) => check.check);

describe("the generic checks", () => {
  test("a successful append with its span and its one declared event passes", () => {
    const checked = checkCall(call("success"), { spans: [span("success")], events: [appended()] });
    expect(failed(checked)).toEqual([]);
    expect(checked.serverMs).toBe(12);
    expect(checked.events).toEqual(["record_appended"]);
    expect(failuresOf([checked])).toEqual([]);
  });

  test("a successful append that emitted nothing fails the events check", () => {
    expect(failed(checkCall(call("success"), { spans: [span("success")], events: [] }))).toEqual(["events"]);
  });

  test("a successful append that emitted its event twice fails the events check", () => {
    expect(failed(checkCall(call("success"), { spans: [span("success")], events: [appended(), appended()] }))).toEqual(["events"]);
  });

  test("a refused append that still emitted an event fails the events check", () => {
    expect(failed(checkCall(call("refusal"), { spans: [span("failure")], events: [appended()] }))).toEqual(["events"]);
  });

  test("a refused append with no event passes", () => {
    expect(failed(checkCall(call("refusal"), { spans: [span("failure")], events: [] }))).toEqual([]);
  });

  test("an event filed under another operation fails the events check", () => {
    expect(failed(checkCall(call("success"), { spans: [span("success")], events: [appended({ operation: "record.export" })] }))).toEqual(["events"]);
  });

  test("a call with no span fails span and outcome, and its budget cannot be measured", () => {
    const checked = checkCall(call("success"), { spans: [], events: [appended()] });
    expect(failed(checked)).toEqual(["span", "outcome", "budget"]);
    expect(checked.serverMs).toBeNull();
  });

  test("another call's span and events are not counted", () => {
    const kept = { spans: [span("success", { trace_id: "t2" })], events: [appended({ trace_id: "t2" })] };
    expect(failed(checkCall(call("success"), kept))).toEqual(["span", "outcome", "events", "budget"]);
  });

  test("a trace id used for two calls fails the span check", () => {
    expect(failed(checkCall(call("success"), { spans: [span("success"), span("success")], events: [appended()] }))).toContain("span");
  });

  test("a span that disagrees with what the caller saw fails the outcome check", () => {
    expect(failed(checkCall(call("success"), { spans: [span("defect")], events: [appended()] }))).toEqual(["outcome"]);
  });

  test("a call over its budget is recorded and does not gate", () => {
    const checked = checkCall(call("success"), { spans: [span("success", { duration_ms: 900 })], events: [appended()] });
    expect(failed(checked)).toEqual(["budget"]);
    expect(failuresOf([checked])).toEqual([]);
  });

  test("an export declares no event, so any event fails it", () => {
    const exported = call("success", "record.export");
    const itsSpan = span("success", { name: "record.export" });
    expect(failed(checkCall(exported, { spans: [itsSpan], events: [] }))).toEqual([]);
    expect(failed(checkCall(exported, { spans: [itsSpan], events: [appended({ operation: "record.export" })] }))).toEqual(["events"]);
  });
});

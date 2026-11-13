// bun test runner/checks.test.ts
// The generic checks are pure, so what they accept and reject is shown here without a world.
import { describe, expect, test } from "bun:test";
import * as Option from "effect/Option";
import { checkCall, failuresOf } from "./checks.ts";
import type { Call } from "./client.ts";
import type { EventRow, SpanRow } from "./database.ts";

/** What the caller of the one append below sent and got back. Its event must carry `{ key: "a", seq: 1 }`. */
const sent = { key: "a", kind: "note", body: null };
const answer = { seq: 1 };

const call = (outcome: Call["outcome"], operation: Call["operation"] = "record.append", more: Partial<Call> = {}): Call => ({
  operation,
  traceId: "t1",
  outcome,
  payload: operation === "record.append" ? sent : undefined,
  success: outcome !== "success" ? Option.none() : Option.some(operation === "record.append" ? answer : { entries: [] }),
  ms: 40,
  failure: null,
  ...more,
});
const span = (outcome: string, more: Partial<SpanRow> = {}): SpanRow => ({ trace_id: "t1", name: "record.append", outcome, duration_ms: 12, ...more });
const appended = (more: Partial<EventRow> = {}): EventRow => ({ trace_id: "t1", operation: "record.append", event: "record_appended", payload: { key: "a", seq: 1 }, ...more });
const failed = (checked: ReturnType<typeof checkCall>) => checked.checks.filter((check) => !check.passed).map((check) => check.check);
/** The events check of a successful append whose one recorded event carries `payload`. */
const carrying = (payload: unknown) => checkCall(call("success"), { spans: [span("success")], events: [appended({ payload })] });
const detailOf = (checked: ReturnType<typeof checkCall>) => checked.checks.find((check) => check.check === "events")?.detail ?? "";

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

describe("what an event carries", () => {
  test("an event carrying the call's key and the answered seq passes, and the record shows both sides", () => {
    const checked = carrying({ key: "a", seq: 1 });
    expect(failed(checked)).toEqual([]);
    expect(detailOf(checked)).toBe('recorded: record_appended {"key":"a","seq":1}; declared for a success: record_appended {"key":"a","seq":1}');
  });

  test("the order of the recorded fields does not count", () => {
    expect(failed(carrying({ seq: 1, key: "a" }))).toEqual([]);
  });

  test("what must be carried follows the call: another call's key and seq are what its event must carry", () => {
    const other = call("success", "record.append", { payload: { key: "b", kind: "note", body: [1] }, success: Option.some({ seq: 7 }) });
    expect(failed(checkCall(other, { spans: [span("success")], events: [appended({ payload: { key: "b", seq: 7 } })] }))).toEqual([]);
    expect(failed(checkCall(other, { spans: [span("success")], events: [appended()] }))).toEqual(["events"]);
  });

  test("a wrong key fails, and the record names the operation, the event and the field", () => {
    const checked = carrying({ key: "", seq: 1 });
    expect(failed(checked)).toEqual(["events"]);
    expect(detailOf(checked)).toContain('record.append\'s record_appended differs in key (recorded "", declared "a")');
    expect(failuresOf([checked])).toEqual([`call 1 (record.append): events: ${detailOf(checked)}`]);
  });

  test("a wrong seq fails", () => {
    const checked = carrying({ key: "a", seq: 0 });
    expect(failed(checked)).toEqual(["events"]);
    expect(detailOf(checked)).toContain("record.append's record_appended differs in seq (recorded 0, declared 1)");
  });

  test("a wrong key and a wrong seq are both named", () => {
    expect(detailOf(carrying({ key: "", seq: 0 }))).toContain('differs in key (recorded "", declared "a"), seq (recorded 0, declared 1)');
  });

  test("a seq of the wrong type fails and does not decode", () => {
    const checked = carrying({ key: "a", seq: "1" });
    expect(failed(checked)).toEqual(["events"]);
    expect(detailOf(checked)).toContain('differs in seq (recorded "1", declared 1)');
    expect(detailOf(checked)).toContain("does not decode as the contract's record_appended");
  });

  test("an extra field fails", () => {
    const checked = carrying({ key: "a", seq: 1, kind: "note" });
    expect(failed(checked)).toEqual(["events"]);
    expect(detailOf(checked)).toContain('record.append\'s record_appended differs in kind (recorded "note", not declared)');
  });

  test("a missing field fails", () => {
    const checked = carrying({ key: "a" });
    expect(failed(checked)).toEqual(["events"]);
    expect(detailOf(checked)).toContain("record.append's record_appended differs in seq (not recorded, declared 1)");
  });

  test("a payload that is not an object fails", () => {
    expect(failed(carrying(null))).toEqual(["events"]);
    expect(failed(carrying('{"key":"a","seq":1}'))).toEqual(["events"]);
    expect(failed(carrying([]))).toEqual(["events"]);
  });

  test("the event twice fails, also when both carry the right payload", () => {
    const checked = checkCall(call("success"), { spans: [span("success")], events: [appended(), appended()] });
    expect(failed(checked)).toEqual(["events"]);
    expect(detailOf(checked)).toContain("record.append recorded record_appended 2 times, declared once");
  });

  test("an event the operation does not declare fails, beside the declared one", () => {
    const checked = checkCall(call("success"), { spans: [span("success")], events: [appended(), appended({ event: "record_exported", payload: {} })] });
    expect(failed(checked)).toEqual(["events"]);
    expect(detailOf(checked)).toContain("record.append recorded record_exported, which it does not declare");
  });

  test("an event on a refused call fails, also when it carries what a success would have", () => {
    const checked = checkCall(call("refusal"), { spans: [span("failure")], events: [appended()] });
    expect(failed(checked)).toEqual(["events"]);
    expect(detailOf(checked)).toBe("recorded: record_appended; declared for a refusal: none");
  });

  test("an event on a call that died fails", () => {
    expect(failed(checkCall(call("defect"), { spans: [span("defect")], events: [appended()] }))).toEqual(["events"]);
  });

  test("a success whose payload or result is not the operation's own fails: nothing can be computed from it", () => {
    const noSeq = call("success", "record.append", { success: Option.some({}) });
    expect(failed(checkCall(noSeq, { spans: [span("success")], events: [appended()] }))).toEqual(["events"]);
    const noKey = call("success", "record.append", { payload: { kind: "note", body: null } });
    expect(failed(checkCall(noKey, { spans: [span("success")], events: [appended()] }))).toEqual(["events"]);
  });
});

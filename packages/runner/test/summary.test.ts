// The summary of a scenarios run on made-up run records: what counts as falling on the empty handlers, the claims a
// run must cover, and the stages it must leave behind. No stage is needed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { allClaims, Errors, type OperationName } from "@capxul/blueprint";
import { ExpectationFailed } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Exit from "effect/Exit";
import { pipe } from "effect/Function";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { endedOf } from "../src/failure.ts";
import type { RunRecord } from "../src/record.ts";
import { ranAsExpected, summarize, type Expectation } from "../src/summary.ts";

const refused = (operation: string, refusal = "NotImplemented"): RunRecord["calls"][number] => ({
  operation,
  traceId: Str.repeat(32)("a"),
  outcome: "refusal",
  refusal,
  failure: null,
  resent: 0,
  timing: { callerMs: 120, serverMs: 0, budgetMs: 1500, provisional: true, enforced: false, overBudget: false },
  steps: [],
  events: [],
  checks: [
    { check: "span", passed: true, detail: "" },
    { check: "outcome", passed: true, detail: "" },
    { check: "events", passed: true, detail: "" },
  ],
});

/** How a run that failed with `error` ended. */
const failedWith = (error: unknown) => pipe(error, Exit.fail, endedOf);

const onNotImplemented = (operation: OperationName) => failedWith(Errors.NotImplemented.make({ operation }));

const record = (operation: OperationName, claim: number, over: Partial<RunRecord> = {}): RunRecord => ({
  kind: "scenario",
  name: `${operation} claim ${claim}`,
  proves: { operation, claim },
  given: "nothing",
  stage: "core-abc123",
  owner: "runner",
  startedAt: "2026-11-13T00:00:00.000Z",
  outcome: "failed",
  failure: "the run failed: NotImplemented",
  ended: onNotImplemented(operation),
  readiness: { probes: 20, relapses: 0, ms: 9000 },
  calls: [refused(operation)],
  afterwards: {
    stage: "destroyed",
    before: { workers: ["capxulcore-core-core-abc123"], hyperdrives: [], neonProjects: [] },
    after: { workers: [], hyperdrives: [], neonProjects: [] },
  },
  ms: { create: 30000, run: 200, checks: 150, destroy: 2500 },
  ...over,
});

/** One record per claim the blueprint declares, each fallen on NotImplemented. */
const everyClaim = (): Array<RunRecord> =>
  Arr.flatMap(Rec.keys(allClaims), (operation) =>
    Arr.makeBy(allClaims[operation].claims.length, (index) => record(operation, index + 1)),
  );

const summary = (records: ReadonlyArray<RunRecord>, expect: Expectation = "not-implemented") =>
  summarize({
    run: "core-abc123",
    mode: "one stage",
    expect,
    owner: "runner",
    startedAt: "2026-11-13T00:00:00.000Z",
    records,
    pathOf: (_record, index) => `core-abc123/scenarios.jsonl:${index + 1}`,
  });

test("a run ended by a refusal failed on its tag; a defect died; a success succeeded", () => {
  assert.deepEqual(onNotImplemented("record.export"), {
    as: "failed",
    tag: "NotImplemented",
    detail: '{"_tag":"NotImplemented","operation":"record.export"}',
  });
  assert.equal(endedOf(Exit.die("boom")).as, "died");
  assert.deepEqual(endedOf(Exit.void), { as: "succeeded", tag: null, detail: null });
});

test("every claim fallen on NotImplemented, with one stage gone, passes", () => {
  const all = everyClaim();
  const result = summary(all);
  assert.equal(result.outcome, "passed", result.failure ?? "");
  assert.equal(result.count.claims, result.count.declaredClaims);
  assert.equal(result.count.asExpected, all.length);
  assert.equal(result.stages.length, 1);
  assert.equal(result.scenarios[0]?.record, "core-abc123/scenarios.jsonl:1");
  assert.ok(ranAsExpected(result));
});

test("an expectation that names the NotImplemented it was answered counts as falling on it", () => {
  const [first, ...others] = everyClaim();
  const expectation = failedWith(
    ExpectationFailed.make({ message: "refused with NotImplemented; it must be refused with WorldExists" }),
  );
  const result = summary([{ ...first!, ended: expectation }, ...others]);
  assert.equal(result.outcome, "passed", result.failure ?? "");
});

test("a scenario that passed, died, failed on something else or called nothing is not as expected", () => {
  const [first, second, third, fourth, ...others] = everyClaim();
  const result = summary([
    { ...first!, ended: endedOf(Exit.void), outcome: "passed", failure: null },
    { ...second!, ended: endedOf(Exit.die("boom")) },
    { ...third!, ended: failedWith(ExpectationFailed.make({ message: "the world was not fresh" })) },
    { ...fourth!, calls: [] },
    ...others,
  ]);
  assert.equal(result.outcome, "failed");
  assert.equal(result.count.asExpected, others.length);
  assert.deepEqual(
    Arr.map(
      Arr.filter(result.scenarios, (line) => !line.asExpected),
      (line) => Arr.headNonEmpty(Str.split(line.why ?? "", ":")),
    ),
    [
      "it passed against the empty handlers",
      "it died",
      "it failed on ExpectationFailed, not on NotImplemented",
      "it made no call",
    ],
  );
  assert.ok(!ranAsExpected(result));
});

test("a call answered other than NotImplemented, or a failed generic check, is not as expected", () => {
  const [first, second, ...others] = everyClaim();
  const failedCheck = refused(first!.proves!.operation);
  const result = summary([
    { ...first!, calls: [{ ...failedCheck, checks: [{ check: "span", passed: false, detail: "0 spans" }] }] },
    { ...second!, calls: [refused(second!.proves!.operation, "NotSignedIn")] },
    ...others,
  ]);
  assert.equal(result.outcome, "failed");
  assert.match(result.failure ?? "", /span: 0 spans/);
  assert.match(result.failure ?? "", /answered other than NotImplemented/);
});

test("a run that leaves a claim out, or leaves a stage behind, does not pass", () => {
  const [, ...others] = everyClaim();
  const missing = summary(others);
  assert.equal(missing.outcome, "failed");
  assert.match(missing.failure ?? "", /1 claims had no scenario in this run: world.create claim 1/);
  assert.ok(ranAsExpected(missing), "every scenario that ran did as expected");
  const left = summary(
    Arr.map(everyClaim(), (each) => ({
      ...each,
      afterwards: {
        ...each.afterwards,
        after: { workers: [], hyperdrives: [], neonProjects: ["core-db-core-abc123"] },
      },
    })),
  );
  assert.equal(left.outcome, "failed");
  assert.match(left.failure ?? "", /stage core-abc123 is not gone: destroyed, left core-db-core-abc123/);
});

test("expecting a pass, a scenario passes only when its run record did", () => {
  const passed = Arr.map(everyClaim(), (each) => ({ ...each, outcome: "passed" as const, failure: null }));
  assert.equal(summary(passed, "pass").outcome, "passed");
  assert.equal(summary(everyClaim(), "pass").outcome, "failed");
});

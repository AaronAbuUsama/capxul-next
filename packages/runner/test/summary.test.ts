// The summary of a run of the journeys on made-up run records: what counts as failing at the first step on the empty
// handlers, the journeys a run must hold, and the stages it must leave behind. No stage is needed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Errors, type OperationName } from "@capxul/blueprint";
import { ExpectationFailed, journeys } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { pipe } from "effect/Function";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import { endedOf } from "../src/failure.ts";
import type { RunRecord } from "../src/record.ts";
import { failedStepOf, stepsOf, type Heard } from "../src/steps.ts";
import { ranAsExpected, summarize, type Expectation } from "../src/summary.ts";
import { makeTimings } from "../src/timings.ts";
import { noteNotMade } from "../src/worlds/ending.ts";

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

/** What the runner heard of a journey whose first step failed on NotImplemented after a look and its own call. */
const heardFirst = (operation: OperationName): ReadonlyArray<Heard> => [
  {
    step: 1,
    outline: { operation, does: "the first step" },
    from: 0,
    to: 2,
    startedMs: 0,
    endedMs: 300,
    tries: [],
    failure: `{"_tag":"NotImplemented","operation":"${operation}"}`,
  },
];

/** One registered journey's record, fallen at its first step on NotImplemented. */
const record = (index: number, over: Partial<RunRecord> = {}): RunRecord => {
  const journey = journeys[index]!;
  const first = journey.outline[0]!.operation;
  const calls = [refused("record.export"), refused(first)];
  const steps = stepsOf(journey.outline, heardFirst(first), calls);
  return {
    kind: "journey",
    name: journey.name,
    proves: null,
    given: journey.given.name,
    stage: "core-abc123",
    owner: "runner",
    startedAt: "2026-11-14T00:00:00.000Z",
    outcome: "failed",
    failure: "the run failed: NotImplemented",
    ended: onNotImplemented(first),
    readiness: { probes: 20, relapses: 0, ms: 9000 },
    calls,
    steps,
    failedStep: failedStepOf(steps),
    afterwards: {
      stage: "destroyed",
      before: { workers: ["capxulcore-core-core-abc123"], hyperdrives: [], neonProjects: [] },
      after: { workers: [], hyperdrives: [], neonProjects: [] },
    },
    ms: { create: 30000, run: 200, checks: 150, destroy: 2500 },
    ...over,
  };
};

const every = (): Array<RunRecord> => Arr.map(journeys, (_, index) => record(index));

const summary = (records: ReadonlyArray<RunRecord>, expect: Expectation = "not-implemented") =>
  summarize({
    run: "core-abc123",
    mode: "one stage",
    expect,
    owner: "runner",
    startedAt: "2026-11-14T00:00:00.000Z",
    records,
    pathOf: (_record, index) => `core-abc123/journeys.jsonl:${index + 1}`,
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

test("a journey's steps: the first failed with its calls, the rest not reached", () => {
  const [first] = every();
  assert.equal(first!.failedStep?.step, 1);
  assert.deepEqual(first!.steps?.[0]?.calls, [1, 2]);
  assert.ok(Arr.every(Arr.drop(first!.steps ?? [], 1), (step) => step.outcome === "not reached"));
});

test("every journey fallen at its first step on NotImplemented, with one stage gone, passes", () => {
  const all = every();
  const result = summary(all);
  assert.equal(result.outcome, "passed", result.failure ?? "");
  assert.equal(result.count.journeys, result.count.registered);
  assert.equal(result.count.asExpected, all.length);
  assert.equal(result.stages.length, 1);
  assert.equal(result.journeys[0]?.record, "core-abc123/journeys.jsonl:1");
  assert.ok(ranAsExpected(result));
});

test("a journey that passed, died, failed on something else, called nothing or failed later is not as expected", () => {
  const [first, second, third] = every();
  const later = record(0, { failedStep: { step: 2, operation: "world.create", does: "", why: "" } });
  const results = [
    summary([{ ...first!, ended: endedOf(Exit.void), outcome: "passed", failure: null }]),
    summary([{ ...second!, ended: endedOf(Exit.die("boom")) }]),
    summary([{ ...third!, ended: failedWith(ExpectationFailed.make({ message: "the world was not fresh" })) }]),
    summary([{ ...first!, calls: [] }]),
    summary([later]),
  ];
  assert.deepEqual(
    Arr.map(results, (result) => Arr.headNonEmpty(Str.split(result.journeys[0]?.why ?? "", ":"))),
    [
      "it passed against the empty handlers",
      "it died",
      "it failed on ExpectationFailed, not on NotImplemented",
      "it made no call",
      "it failed at step 2, not at its first",
    ],
  );
});

test("a call answered other than NotImplemented, or a failed generic check, is not as expected", () => {
  const [first, second, ...others] = every();
  const failedCheck = { ...first!.calls[1]!, checks: [{ check: "span" as const, passed: false, detail: "0 spans" }] };
  const result = summary([
    { ...first!, calls: [first!.calls[0]!, failedCheck] },
    { ...second!, calls: [refused("org.create", "NotSignedIn")] },
    ...others,
  ]);
  assert.equal(result.outcome, "failed");
  assert.match(result.failure ?? "", /span: 0 spans/);
  assert.match(result.failure ?? "", /answered other than NotImplemented/);
});

test("a run that leaves a journey out, or leaves a stage behind, does not pass", () => {
  const [, ...others] = every();
  const missing = summary(others);
  assert.equal(missing.outcome, "failed");
  assert.match(missing.failure ?? "", /1 registered journeys were not in this run: two operators and their worlds/);
  assert.ok(ranAsExpected(missing), "every journey that ran did as expected");
  const left = summary(
    Arr.map(every(), (each) => ({
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

test("expecting a pass, a journey passes only when its run record did", () => {
  const passed = Arr.map(every(), (each) => ({ ...each, outcome: "passed" as const, failure: null }));
  assert.equal(summary(passed, "pass").outcome, "passed");
  assert.equal(summary(every(), "pass").outcome, "failed");
});

test("a run in one world whose starting worlds were not made, or that died, fails and says why", () => {
  const all = every();
  const inOneWorld = (failure: string | null) =>
    summarize({
      run: "run-abc123",
      mode: "a stage each",
      expect: "not-implemented",
      owner: "runner",
      startedAt: "2026-11-14T00:00:00.000Z",
      records: all,
      pathOf: (_record, index) => `run-abc123/${index}.json`,
      oneWorld: { world: null, hub: "fleet", hubBroughtUp: false, left: null, notTakenDown: [], timings: [], failure },
    });
  const why = "the starting worlds were not all made: save payment-drafted (w-tpl-330ea4) failed: HTTP 524";
  const failed = inOneWorld(why);
  assert.equal(failed.outcome, "failed");
  assert.ok(Str.includes(why)(failed.failure ?? ""), failed.failure ?? "");
  assert.equal(failed.oneWorld?.failure, why);
  assert.ok(!ranAsExpected(failed), "a run whose own part failed exits 1 even when its journeys were as expected");
  const died = summarize({
    run: "run-abc123",
    mode: "one world",
    expect: "pass",
    owner: "runner",
    startedAt: "2026-11-14T00:00:00.000Z",
    records: [],
    pathOf: (_record, index) => `run-abc123/${index}.json`,
    oneWorld: {
      world: null,
      hub: "fleet",
      hubBroughtUp: false,
      left: null,
      notTakenDown: [],
      timings: [],
      failure: "the run did not finish: boom",
    },
  });
  assert.equal(died.outcome, "failed");
  assert.ok(!ranAsExpected(died), "a run that died with no journey run is not as expected");
});

test("the starting worlds not made are named by the first part that failed, a defect included", async () => {
  const why = await Effect.runPromise(
    Effect.gen(function* () {
      const timings = yield* makeTimings;
      const into = yield* Ref.make<string | null>(null);
      yield* timings.timed("make payment-drafted", { of: "payment-drafted" }, Effect.void);
      const save = timings.timed("save payment-drafted", { of: "w-tpl-330ea4" }, Effect.die("SiteFailed: HTTP 524"));
      yield* save.pipe(Effect.catchCause(noteNotMade(timings, into)));
      return yield* Ref.get(into);
    }),
  );
  assert.ok(why !== null);
  assert.ok(
    Str.startsWith("the starting worlds were not all made: save payment-drafted (w-tpl-330ea4) failed: ")(why),
    why,
  );
  assert.ok(Str.includes("HTTP 524")(why), why);
});

test("a run in one world whose take-down left a template or a world's sites on the bench does not pass", () => {
  const passed = Arr.map(every(), (each) => ({ ...each, outcome: "passed" as const, failure: null }));
  const oneWorld = (notTakenDown: ReadonlyArray<string>) =>
    summarize({
      run: "run-2166f8",
      mode: "one world",
      expect: "pass",
      owner: "runner",
      startedAt: "2026-11-14T00:00:00.000Z",
      records: passed,
      pathOf: (each) => `run-2166f8/${each.name}.json`,
      oneWorld: {
        world: "tpl-2c652e",
        hub: "rh-1",
        hubBroughtUp: true,
        // The accounts hold nothing of the run's worlds: the bench is not in them.
        left: { workers: [], hyperdrives: [], neonProjects: [], worlds: [] },
        notTakenDown,
        timings: [],
      },
    });
  assert.equal(oneWorld([]).outcome, "passed", oneWorld([]).failure ?? "");
  const left = oneWorld([
    'bench template payment-drafted not dropped: {"_tag":"SiteFailed","step":"door","message":"HTTP 530: error code: 1033"}',
    'world destroy failed: {"_tag":"RunnerFailure","step":"destroy","message":"w-tpl-2c652e: SiteFailed: HTTP 530"}',
  ]);
  assert.equal(left.outcome, "failed");
  assert.match(left.failure ?? "", /the run's take-down failed: bench template payment-drafted not dropped/);
  assert.match(left.failure ?? "", /the run's take-down failed: world destroy failed: .*w-tpl-2c652e/);
});

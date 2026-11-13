// The summary of a scenarios run: one record whose `outcome` says whether every scenario ended as the run expected,
// whether the run covered every claim the blueprint declares, and whether every stage it used is gone. It is the
// file a step's Proof names; each scenario's own run record sits beside it under another name (scenario-runs.ts).
//
// What a run expects is declared when it starts: `pass`, every scenario's run record passes (step 1.6), or
// `not-implemented`, every scenario fails on the `NotImplemented` that Core's empty handlers answer (step 1.5).
import { allClaims, type Errors, type OperationName } from "@capxul/blueprint";
import type { ExpectationFailed } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { failuresOf } from "./checks/checks.ts";
import { CallOutcome } from "./client.ts";
import { Ended } from "./failure.ts";
import { RunRecord } from "./record.ts";
import { Inventory, isEmpty } from "./world/leftovers.ts";
import { Readiness } from "./world/warmup.ts";

export const Expectation = Schema.Literals(["pass", "not-implemented"]);
export type Expectation = typeof Expectation.Type;

/** `a stage each`: every scenario in a fresh stage of its own. `one stage`: all of them in one fresh stage. */
export const Mode = Schema.Literals(["a stage each", "one stage"]);
export type Mode = typeof Mode.Type;

const NOT_IMPLEMENTED: Errors.NotImplemented["_tag"] = "NotImplemented";
const EXPECTATION: ExpectationFailed["_tag"] = "ExpectationFailed";

const ScenarioLine = Schema.Struct({
  name: Schema.String,
  proves: RunRecord.fields.proves,
  stage: Schema.String,
  /** Where its full run record is, under the records folder: a path, with `:<line>` when the file holds a record a line. */
  record: Schema.String,
  /** Whether it ended as the run expected. */
  asExpected: Schema.Boolean,
  /** Why it did not; null when it did. */
  why: Schema.NullOr(Schema.String),
  ended: Schema.NullOr(Ended),
  /** Each call it made: its outcome, its refusal, its caller and server times, and whether every check passed. */
  calls: Schema.Array(
    Schema.Struct({
      operation: Schema.String,
      outcome: CallOutcome,
      refusal: Schema.NullOr(Schema.String),
      callerMs: Schema.Finite,
      serverMs: Schema.NullOr(Schema.Finite),
      checksPassed: Schema.Boolean,
    }),
  ),
});
type ScenarioLine = typeof ScenarioLine.Type;

const StageLine = Schema.Struct({
  name: Schema.String,
  readiness: Schema.NullOr(Readiness),
  createMs: Schema.NullOr(Schema.Finite),
  destroyMs: Schema.NullOr(Schema.Finite),
  afterwards: RunRecord.fields.afterwards.fields.stage,
  /** What the two accounts held of the stage after its destroy: empty when nothing is left. */
  after: Schema.NullOr(Inventory),
});
type StageLine = typeof StageLine.Type;

export const Summary = Schema.Struct({
  kind: Schema.Literal("scenarios"),
  /** The run's id: its one stage's name, or `run-<6 hex>` when each scenario had a stage of its own. */
  run: Schema.String,
  /** What `passed` means for this run, in words. */
  what: Schema.String,
  mode: Mode,
  expect: Expectation,
  owner: Schema.String,
  startedAt: Schema.String,
  /** `passed` exactly when every claim had its scenario in the run, each ended as expected, and no stage is left. */
  outcome: Schema.Literals(["passed", "failed"]),
  failure: Schema.NullOr(Schema.String),
  count: Schema.Struct({
    scenarios: Schema.Finite,
    /** Scenarios that prove a claim; examples prove none. */
    claims: Schema.Finite,
    /** The claims the blueprint declares, every one of which needs its scenario in the run. */
    declaredClaims: Schema.Finite,
    asExpected: Schema.Finite,
  }),
  /** Claim scenarios by operation. */
  byOperation: Schema.Record(Schema.String, Schema.Finite),
  scenarios: Schema.Array(ScenarioLine),
  stages: Schema.Array(StageLine),
});
export type Summary = typeof Summary.Type;

const WHAT: { readonly [E in Expectation]: string } = {
  pass: "The registered scenarios run through the runner against a deployed Core. Passed when every claim the blueprint declares has its scenario in the run, every scenario's run record passed, and every stage was destroyed with nothing of it left in the accounts.",
  "not-implemented":
    "The registered scenarios run through the runner against Core's deployed empty handlers. Passed when every claim the blueprint declares has its scenario in the run, every scenario failed on the NotImplemented it was answered (never passed, never died), every call was answered NotImplemented and passed every generic check, and every stage was destroyed with nothing of it left in the accounts.",
};

/** Why a scenario that should fail on the empty handlers did not, or null when it did. */
const whyNotRefused = (record: RunRecord): string | null => {
  const ended = record.ended;
  if (ended === null) return `it did not run to an end: ${record.failure ?? "no failure recorded"}`;
  if (ended.as === "succeeded") return "it passed against the empty handlers";
  if (ended.as === "died") return `it died: ${ended.detail ?? ""}`;
  const onNotImplemented =
    ended.tag === NOT_IMPLEMENTED || (ended.tag === EXPECTATION && Str.includes(NOT_IMPLEMENTED)(ended.detail ?? ""));
  if (!onNotImplemented) return `it failed on ${ended.tag ?? "an untagged failure"}, not on ${NOT_IMPLEMENTED}`;
  if (record.calls.length === 0) return "it made no call";
  const other = Arr.filter(record.calls, (call) => call.refusal !== NOT_IMPLEMENTED);
  if (other.length > 0)
    return `answered other than ${NOT_IMPLEMENTED}: ${Arr.join(
      Arr.map(other, (call) => `${call.operation} (${call.outcome} ${call.refusal ?? ""})`),
      ", ",
    )}`;
  const failed = failuresOf(record.calls);
  return failed.length === 0 ? null : Arr.join(failed, "; ");
};

const whyNot = (expect: Expectation, record: RunRecord): string | null =>
  expect === "pass" ? (record.outcome === "passed" ? null : (record.failure ?? "failed")) : whyNotRefused(record);

const lineOf = (expect: Expectation, record: RunRecord, path: string): ScenarioLine => {
  const why = whyNot(expect, record);
  return {
    name: record.name,
    proves: record.proves,
    stage: record.stage,
    record: path,
    asExpected: why === null,
    why,
    ended: record.ended,
    calls: Arr.map(record.calls, (call) => ({
      operation: call.operation,
      outcome: call.outcome,
      refusal: call.refusal,
      callerMs: call.timing.callerMs,
      serverMs: call.timing.serverMs,
      checksPassed: Arr.every(call.checks, (check) => check.passed),
    })),
  };
};

const stagesOf = (records: ReadonlyArray<RunRecord>): ReadonlyArray<StageLine> =>
  pipe(
    Arr.dedupeWith(records, (a, b) => a.stage === b.stage),
    Arr.map((record) => ({
      name: record.stage,
      readiness: record.readiness,
      createMs: record.ms.create,
      destroyMs: record.ms.destroy,
      afterwards: record.afterwards.stage,
      after: record.afterwards.after,
    })),
  );

const leftWords = (after: Inventory | null): string =>
  after === null
    ? "the accounts were not read"
    : `left ${Arr.join([...after.workers, ...after.hyperdrives, ...after.neonProjects], ", ")}`;

const isGone = (stage: StageLine): boolean =>
  stage.afterwards === "destroyed" && stage.after !== null && isEmpty(stage.after);

/** True when every scenario ended as expected and every stage is gone, whether or not every claim was run. */
export const ranAsExpected = (summary: Summary): boolean =>
  Arr.every(summary.scenarios, (line) => line.asExpected) && Arr.every(summary.stages, isGone);

/** Every claim the blueprint declares, as `<operation> claim <n>`, that no record of the run proves. */
const notRun = (records: ReadonlyArray<RunRecord>): ReadonlyArray<string> =>
  Arr.flatMap(Rec.keys(allClaims), (operation: OperationName) =>
    pipe(
      Arr.makeBy(allClaims[operation].claims.length, (index) => index + 1),
      Arr.filter((claim) => !Arr.some(records, (r) => r.proves?.operation === operation && r.proves.claim === claim)),
      Arr.map((claim) => `${operation} claim ${claim}`),
    ),
  );

export interface SummaryInput {
  readonly run: string;
  readonly mode: Mode;
  readonly expect: Expectation;
  readonly owner: string;
  readonly startedAt: string;
  readonly records: ReadonlyArray<RunRecord>;
  /** Where each record is, under the records folder. */
  readonly pathOf: (record: RunRecord, index: number) => string;
}

/** The summary of a scenarios run, from its run records. Pure. */
export const summarize = (input: SummaryInput): Summary => {
  const lines = Arr.map(input.records, (record, index) => lineOf(input.expect, record, input.pathOf(record, index)));
  const stages = stagesOf(input.records);
  const missing = notRun(input.records);
  const wrong = Arr.filter(lines, (line) => !line.asExpected);
  const left = Arr.filter(stages, (stage) => !isGone(stage));
  const failures = [
    ...(missing.length === 0
      ? []
      : [`${missing.length} claims had no scenario in this run: ${Arr.join(missing, ", ")}`]),
    ...Arr.map(wrong, (line) => `${line.name}: ${line.why ?? ""}`),
    ...Arr.map(left, (stage) => `stage ${stage.name} is not gone: ${stage.afterwards}, ${leftWords(stage.after)}`),
  ];
  const claims = Arr.filter(input.records, (record) => record.proves !== null);
  return {
    kind: "scenarios",
    run: input.run,
    what: WHAT[input.expect],
    mode: input.mode,
    expect: input.expect,
    owner: input.owner,
    startedAt: input.startedAt,
    outcome: failures.length === 0 ? "passed" : "failed",
    failure: failures.length === 0 ? null : Arr.join(failures, "\n"),
    count: {
      scenarios: input.records.length,
      claims: claims.length,
      declaredClaims: Arr.reduce(Rec.values(allClaims), 0, (n, each) => n + each.claims.length),
      asExpected: lines.length - wrong.length,
    },
    byOperation: Arr.reduce(claims, Rec.empty<string, number>(), (counts, record) => {
      const operation = record.proves?.operation ?? "";
      return { ...counts, [operation]: (counts[operation] ?? 0) + 1 };
    }),
    scenarios: lines,
    stages,
  };
};

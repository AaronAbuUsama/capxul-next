// The summary of a run of the journeys: one record whose `outcome` says whether every journey ended as the run
// expected, whether the run held every registered journey, and whether every stage it used is gone. It is the file a
// step's Proof names; each journey's own run record sits beside it under another name (scenario-runs.ts).
//
// What a run expects is declared when it starts: `pass`, every journey's run record passes (step 1.6), or
// `not-implemented`, every journey fails at its first step on the `NotImplemented` that Core's empty handlers answer
// (step 1.14).
import type { Errors } from "@capxul/blueprint";
import { coverage, journeys, type ExpectationFailed } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { failuresOf } from "./checks/checks.ts";
import { CallOutcome } from "./client.ts";
import { Ended } from "./failure.ts";
import { Outcome, passedOr, RunRecord } from "./record.ts";
import { Inventory, isEmpty } from "./world/leftovers.ts";
import { FailedStep } from "./steps.ts";
import { Timing } from "./timings.ts";
import { Readiness } from "./world/warmup.ts";

export const Expectation = Schema.Literals(["pass", "not-implemented"]);
export type Expectation = typeof Expectation.Type;

/**
 * `a stage each`: every journey in a fresh stage of its own. `one stage`: all of them in one fresh stage. `a world
 * each`: every journey in fresh private worlds, its starting world made for it. `one world`: every journey in the
 * run's one world on its hub, reset in place to its starting world before it (worlds/run.ts, roadmap step 1.18).
 */
export const Mode = Schema.Literals(["a stage each", "one stage", "a world each", "one world"]);
export type Mode = typeof Mode.Type;

const NOT_IMPLEMENTED: Errors.NotImplemented["_tag"] = "NotImplemented";
const EXPECTATION: ExpectationFailed["_tag"] = "ExpectationFailed";

const JourneyLine = Schema.Struct({
  name: Schema.String,
  /** The starting world it began from. */
  given: Schema.NullOr(Schema.String),
  stage: Schema.String,
  /** Where its full run record is, under the records folder: a path, with `:<line>` when the file holds a record a line. */
  record: Schema.String,
  /** Whether it ended as the run expected. */
  asExpected: Schema.Boolean,
  /** Why it did not; null when it did. */
  why: Schema.NullOr(Schema.String),
  ended: Schema.NullOr(Ended),
  /** The first step that failed, and why; null when none did. */
  failedStep: Schema.NullOr(FailedStep),
  /** Each step of its outline: its operation and how it ended. */
  steps: Schema.Array(
    Schema.Struct({
      step: Schema.Finite,
      operation: Schema.String,
      outcome: Schema.String,
      /** Its operation's checks that ran on its calls, and how many held. */
      checks: Schema.Finite,
      checksHeld: Schema.Finite,
    }),
  ),
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
type JourneyLine = typeof JourneyLine.Type;

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

const OneWorld = Schema.Struct({
  world: Schema.NullOr(Schema.String),
  hub: Schema.String,
  /** Whether the run brought the hub up, and so took it down at its end. */
  hubBroughtUp: Schema.Boolean,
  left: Schema.NullOr(Inventory),
  timings: Schema.Array(Timing),
  /**
   * What failed outside the journeys: a starting world that was not made (the part that failed, the world it acted
   * on and why), or the run's own end when it died; null when nothing did. Any of it fails the run.
   */
  failure: Schema.String.pipe(Schema.NullOr, Schema.optional),
});

export const Summary = Schema.Struct({
  kind: Schema.Literal("journeys"),
  /** The run's id: its one stage's name, or `run-<6 hex>` when each journey had a stage or worlds of its own. */
  run: Schema.String,
  /** What `passed` means for this run, in words. */
  what: Schema.String,
  mode: Mode,
  expect: Expectation,
  owner: Schema.String,
  startedAt: Schema.String,
  /** `passed` exactly when every registered journey was in the run, each ended as expected, and no stage is left. */
  outcome: Outcome,
  /** Where Core ran, when not on Cloudflare: a local-Core rehearsal, whose outcome is at best `rehearsed`. */
  core: Schema.optional(Schema.String),
  failure: Schema.NullOr(Schema.String),
  count: Schema.Struct({
    journeys: Schema.Finite,
    /** The journeys @capxul/scenarios registers, every one of which must be in the run. */
    registered: Schema.Finite,
    asExpected: Schema.Finite,
    /** The claims of claims.md the registered journeys and the operations' checks cover between them. */
    claims: Schema.Finite,
  }),
  journeys: Schema.Array(JourneyLine),
  stages: Schema.Array(StageLine),
  /**
   * A run in one world: the world and its hub, what the accounts held afterwards of every world the run made (empty
   * when nothing is left), and every part of the run timed in order (src/timings.ts).
   */
  oneWorld: Schema.optional(OneWorld),
});
export type Summary = typeof Summary.Type;

const ONE_WORLD =
  "The registered journeys run through the runner in one world, made on a fleet hub by the platform this process serves, its starting worlds made in it once and saved, and the world reset in place to each journey's starting world before the journey. Passed when every registered journey was in the run, every journey's run record passed (every step as it expected, every operation check and every generic check on every call), and every world the run made, the one world included, was destroyed with nothing of it left in the accounts.";

const WHAT: { readonly [E in Expectation]: string } = {
  pass: "The registered journeys run through the runner, each in fresh private worlds made by the platform this process serves, its starting world made for it. Passed when every registered journey was in the run, every journey's run record passed (every step as it expected, every operation check and every generic check on every call), and every world it made was destroyed with nothing of it left in the accounts.",
  "not-implemented":
    "The registered journeys run through the runner against Core's deployed empty handlers (a stage deployed with CAPXUL_HANDLERS=empty). Passed when every registered journey was in the run, every journey failed at its first step on the NotImplemented its first step's operation was answered (never passed, never died, no later step reached), every call was answered NotImplemented and passed every generic check, and every stage was destroyed with nothing of it left in the accounts.",
};

/** Why a journey that should fail at its first step on the empty handlers did not, or null when it did. */
const whyNotRefused = (record: RunRecord): string | null => {
  const ended = record.ended;
  if (ended === null) return `it did not run to an end: ${record.failure ?? "no failure recorded"}`;
  if (ended.as === "succeeded") return "it passed against the empty handlers";
  if (ended.as === "died") return `it died: ${ended.detail ?? ""}`;
  const onNotImplemented =
    ended.tag === NOT_IMPLEMENTED || (ended.tag === EXPECTATION && Str.includes(NOT_IMPLEMENTED)(ended.detail ?? ""));
  if (!onNotImplemented) return `it failed on ${ended.tag ?? "an untagged failure"}, not on ${NOT_IMPLEMENTED}`;
  if (record.calls.length === 0) return "it made no call";
  if (record.failedStep?.step !== 1) return `it failed at step ${record.failedStep?.step ?? "none"}, not at its first`;
  const reached = Arr.filter(record.steps ?? [], (step) => step.step > 1 && step.outcome !== "not reached");
  if (reached.length > 0) return `it reached step ${reached[0]?.step ?? ""} after its first failed`;
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
  expect === "pass" ? (record.outcome !== "failed" ? null : (record.failure ?? "failed")) : whyNotRefused(record);

const lineOf = (expect: Expectation, record: RunRecord, path: string): JourneyLine => {
  const why = whyNot(expect, record);
  return {
    name: record.name,
    given: record.given,
    stage: record.stage,
    record: path,
    asExpected: why === null,
    why,
    ended: record.ended,
    failedStep: record.failedStep ?? null,
    steps: Arr.map(record.steps ?? [], (step) => {
      const checks = Arr.flatMap(step.tries, (each) => each.checks);
      return {
        step: step.step,
        operation: step.operation,
        outcome: step.outcome,
        checks: checks.length,
        checksHeld: Arr.filter(checks, (check) => check.passed).length,
      };
    }),
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
    : `left ${Arr.join([...after.workers, ...after.hyperdrives, ...after.neonProjects, ...(after.worlds ?? [])], ", ")}`;

const isGone = (stage: StageLine): boolean =>
  stage.afterwards === "destroyed" && stage.after !== null && isEmpty(stage.after);

/** True when every journey ended as expected and every stage is gone, whether or not every journey was run. */
export const ranAsExpected = (summary: Summary): boolean =>
  Arr.every(summary.journeys, (line) => line.asExpected) &&
  Arr.every(summary.stages, isGone) &&
  (summary.oneWorld?.failure ?? null) === null;

/** Every registered journey that no record of the run is of. */
const notRun = (records: ReadonlyArray<RunRecord>): ReadonlyArray<string> =>
  Arr.filter(
    Arr.map(journeys, (journey) => journey.name),
    (name) => !Arr.some(records, (record) => record.name === name),
  );

/** The claims of claims.md, every one of which coverage.ts places in the operations' checks and the journeys. */
const coveredClaims = Arr.reduce(Rec.values(coverage), 0, (n, each) => n + each.length);

export interface SummaryInput {
  readonly run: string;
  readonly mode: Mode;
  readonly expect: Expectation;
  readonly owner: string;
  readonly startedAt: string;
  readonly records: ReadonlyArray<RunRecord>;
  /** Where Core ran, when not on Cloudflare (src/local/host.ts). */
  readonly core?: string | undefined;
  /** Where each record is, under the records folder. */
  readonly pathOf: (record: RunRecord, index: number) => string;
  /** A run in one world: its world, its hub, what was left and its timings. */
  readonly oneWorld?: typeof OneWorld.Type;
}

/** The summary of a run of the journeys, from their run records. Pure. */
export const summarize = (input: SummaryInput): Summary => {
  const lines = Arr.map(input.records, (record, index) => lineOf(input.expect, record, input.pathOf(record, index)));
  const stages = stagesOf(input.records);
  const missing = notRun(input.records);
  const wrong = Arr.filter(lines, (line) => !line.asExpected);
  const left = Arr.filter(stages, (stage) => !isGone(stage));
  const failures = [
    ...(missing.length === 0
      ? []
      : [`${missing.length} registered journeys were not in this run: ${Arr.join(missing, "; ")}`]),
    ...Arr.map(wrong, (line) => `${line.name}: ${line.why ?? ""}`),
    ...Arr.map(left, (stage) => `stage ${stage.name} is not gone: ${stage.afterwards}, ${leftWords(stage.after)}`),
    ...(input.oneWorld?.failure === undefined || input.oneWorld.failure === null ? [] : [input.oneWorld.failure]),
    ...(input.oneWorld === undefined || (input.oneWorld.left !== null && isEmpty(input.oneWorld.left))
      ? []
      : [`the run's worlds are not all gone: ${leftWords(input.oneWorld.left)}`]),
  ];
  return {
    kind: "journeys",
    run: input.run,
    what: input.mode === "one world" ? ONE_WORLD : WHAT[input.expect],
    mode: input.mode,
    expect: input.expect,
    owner: input.owner,
    startedAt: input.startedAt,
    outcome: failures.length === 0 ? passedOr(input.core) : "failed",
    ...(input.core === undefined ? {} : { core: input.core }),
    failure: failures.length === 0 ? null : Arr.join(failures, "\n"),
    count: {
      journeys: input.records.length,
      registered: journeys.length,
      asExpected: lines.length - wrong.length,
      claims: coveredClaims,
    },
    journeys: lines,
    stages,
    ...(input.oneWorld === undefined ? {} : { oneWorld: input.oneWorld }),
  };
};

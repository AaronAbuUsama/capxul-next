// The summary of a run of the journeys: one record whose `outcome` says whether every journey ended as the run
// expected, whether the run held every registered journey, and whether every stage it used is gone. It is the file a
// step's Proof names; each journey's own run record sits beside it under another name (scenario-runs.ts). What a run
// expects is declared when it starts: `pass`, every journey's run record passes (step 1.6), or `not-implemented`, every
// journey fails at its first step on the `NotImplemented` that Core's empty handlers answer (step 1.14).
import type { Errors } from "@capxul/blueprint";
import { coverage, journeys, type ExpectationFailed } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import { sumCoverage } from "./checks/paths.ts";
import { CallOutcome } from "./client.ts";
import { Ended } from "./failure.ts";
import { Outcome, passedOr, RunRecord } from "./record.ts";
import { butHandedOver, Inventory, isEmpty } from "./world/leftovers.ts";
import { FailedStep } from "./steps.ts";
import { Timing } from "./timings.ts";
import { Readiness } from "./world/warmup.ts";

const NOT_IMPLEMENTED: Errors.NotImplemented["_tag"] = "NotImplemented";
const EXPECTATION: ExpectationFailed["_tag"] = "ExpectationFailed";
import { ONE_WORLD, SHARED_WORLD, sideBySide, WHAT, whyNotRefused } from "./summary-words.ts";

export const Expectation = Schema.Literals(["pass", "not-implemented"]);
export type Expectation = typeof Expectation.Type;

/**
 * `a stage each`: every journey in a fresh stage of its own. `one stage`: all of them in one fresh stage. `a world
 * each`: every journey in fresh private worlds, its starting world made for it. `one world`: every journey in the
 * run's one world on its hub, reset in place to its starting world before it (worlds/run.ts, roadmap step 1.18).
 * `shared world`: each from a shared world's templates (`--shared`). `shared world, side by side`: every journey at
 * once in one shared world (RUNNER_SHAPE=shared), `atOnce` of them.
 */
export const Mode = Schema.Literals([
  "a stage each",
  "one stage",
  "a world each",
  "one world",
  "shared world",
  "shared world, side by side",
]);
export type Mode = typeof Mode.Type;

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
  /** What the run's take-down could not do, a line each with why (worlds/teardown.ts); `left` reads only the accounts. */
  notTakenDown: Schema.Array(Schema.String),
  /** Worlds, by stage, left up on purpose for CI's teardown job (RUNNER_TEARDOWN=job), which destroys them. */
  handedOver: Schema.String.pipe(Schema.Array, Schema.optional),
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
  /** How many journeys ran at once, for a run side by side. */
  atOnce: Schema.optional(Schema.Finite),
  expect: Expectation,
  owner: Schema.String,
  startedAt: Schema.String,
  /** `passed` exactly when every registered journey was in the run, each ended as expected, and no stage is left. */
  outcome: Outcome,
  /** Where Core ran, when not on Cloudflare: a local-Core rehearsal, whose outcome is at best `rehearsed`. */
  core: Schema.optional(Schema.String),
  /** `cli`: the journeys' calls went through the command line (`--via=cli`), not the SDK. */
  via: Schema.optional(Schema.Literal("cli")),
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
  /** What the run's calls reached of each machine of the blueprint, summed over its journeys (checks/paths.ts). */
  coverage: RunRecord.fields.coverage,
  stages: Schema.Array(StageLine),
  /** A run in one world: its world and hub, what the accounts held of its worlds afterwards, every part timed. */
  oneWorld: Schema.optional(OneWorld),
});
export type Summary = typeof Summary.Type;

const whyNot = (expect: Expectation, record: RunRecord): string | null =>
  expect === "pass"
    ? record.outcome !== "failed"
      ? null
      : (record.failure ?? "failed")
    : whyNotRefused(NOT_IMPLEMENTED, EXPECTATION)(record);

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
  (summary.oneWorld?.failure ?? null) === null &&
  (summary.oneWorld?.notTakenDown ?? []).length === 0;

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
  const one = input.oneWorld;
  const leftOver = one?.left === undefined || one.left === null ? null : butHandedOver(one.left, one.handedOver);
  const failures = [
    ...(missing.length === 0
      ? []
      : [`${missing.length} registered journeys were not in this run: ${Arr.join(missing, "; ")}`]),
    ...Arr.map(wrong, (line) => `${line.name}: ${line.why ?? ""}`),
    ...Arr.map(left, (stage) => `stage ${stage.name} is not gone: ${stage.afterwards}, ${leftWords(stage.after)}`),
    ...(input.oneWorld?.failure === undefined || input.oneWorld.failure === null ? [] : [input.oneWorld.failure]),
    ...(input.oneWorld === undefined || (leftOver !== null && isEmpty(leftOver))
      ? []
      : [`the run's worlds are not all gone: ${leftWords(leftOver)}`]),
    ...Arr.map(input.oneWorld?.notTakenDown ?? [], (what) => `the run's take-down failed: ${what}`),
  ];
  return {
    kind: "journeys",
    run: input.run,
    what:
      input.mode === "one world"
        ? ONE_WORLD
        : input.mode === "shared world"
          ? SHARED_WORLD
          : input.mode === "shared world, side by side"
            ? sideBySide(input.records.length)
            : WHAT[input.expect],
    ...(input.mode === "shared world, side by side" ? { atOnce: input.records.length } : {}),
    mode: input.mode,
    expect: input.expect,
    owner: input.owner,
    startedAt: input.startedAt,
    outcome: failures.length === 0 ? passedOr(input.core) : "failed",
    ...(input.core === undefined ? {} : { core: input.core }),
    ...(Arr.some(input.records, (record) => record.via === "cli") ? { via: "cli" as const } : {}),
    failure: failures.length === 0 ? null : Arr.join(failures, "\n"),
    count: {
      journeys: input.records.length,
      registered: journeys.length,
      asExpected: lines.length - wrong.length,
      claims: coveredClaims,
    },
    journeys: lines,
    coverage: sumCoverage(Arr.map(input.records, (record) => record.coverage ?? [])),
    stages,
    ...(input.oneWorld === undefined ? {} : { oneWorld: input.oneWorld }),
  };
};

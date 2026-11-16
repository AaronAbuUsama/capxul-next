// What a run leaves behind once its stage is gone: one JSON file, written by the runner and never by hand, outside
// any world. It is what proves a step (docs/roadmap.md: a run record whose `outcome` is `passed`) and what the speed
// climb reads. JSON text is written here only (with redacted values hidden): this file is an edge in .oxlintrc.json.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Formatter from "effect/Formatter";
import { pipe } from "effect/Function";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { CheckedCall } from "./checks/checks.ts";
import { Ended } from "./failure.ts";
import { Inventory } from "./world/leftovers.ts";
import { FailedStep, failedStepOf, StepResult } from "./steps.ts";
import type { Via } from "./client.ts";
import { Readiness } from "./world/warmup.ts";

/**
 * How a run ended. `rehearsed` is `passed` in a run whose Core ran locally (`--core=local`, src/local/host.ts): every
 * expectation and check held, but Core was not on Cloudflare, so the record proves nothing a step needs (a step's
 * Proof counts only `passed`).
 */
export const Outcome = Schema.Literals(["passed", "rehearsed", "failed"]);
export type Outcome = typeof Outcome.Type;

/** `passed`, or `rehearsed` when Core ran where `core` says, off Cloudflare. */
export const passedOr = (core: string | undefined): Outcome => (core === undefined ? "passed" : "rehearsed");

/**
 * How much of each machine of the blueprint some call reached (checks/paths.ts): how many things it started, how many
 * times each move was made, and how many calls were refused from each state a move cannot start from. The scenario
 * author's target, not a gate (AGENTS.md, "How it is measured").
 */
export const Coverage = Schema.Array(
  Schema.Struct({
    machine: Schema.String,
    started: Schema.Finite,
    moves: Schema.Array(Schema.Struct({ move: Schema.String, reached: Schema.Finite })),
    refused: Schema.Array(
      Schema.Struct({ state: Schema.String, move: Schema.String, refusal: Schema.String, reached: Schema.Finite }),
    ),
  }),
);
export type Coverage = typeof Coverage.Type;

/** One span as each record holds it, for the side-by-side read: `app.spans`' outcome, or the tap's OTLP status. */
export const SpanSummary = Schema.Struct({
  spanId: Schema.String,
  parentSpanId: Schema.NullOr(Schema.String),
  name: Schema.String,
  outcome: Schema.String,
  durationMs: Schema.Finite,
});

/**
 * The tap beside `app.spans` (telemetry/side-by-side.ts, roadmap 4.4): `absent` while the world's Core writes no tap,
 * which fails nothing; `on`, with each call's spans in both records and their parity, a disagreement failing the run
 * as the runner's plumbing; `unreadable` when the tap is on but could not be read, which fails it too.
 */
export const TapReport = Schema.Struct({
  state: Schema.Literals(["absent", "on", "unreadable"]),
  /** Why the tap could not be read. */
  reason: Schema.optional(Schema.String),
  ms: Schema.Finite,
  /**
   * The endpoints calls were made at that no known world answers at: their calls are not compared. Absent on records
   * made before it was kept.
   */
  unknownEndpoints: Schema.String.pipe(Schema.Array, Schema.optional),
  calls: Schema.Array(
    Schema.Struct({
      traceId: Schema.String,
      operation: Schema.String,
      /** Whether the tap held the call's operation span, and so all of it, within the wait. */
      complete: Schema.Boolean,
      agrees: Schema.Boolean,
      kept: Schema.Array(SpanSummary),
      tapped: Schema.Array(SpanSummary),
      differences: Schema.Array(
        Schema.Struct({
          about: Schema.String,
          spanId: Schema.String,
          name: Schema.String,
          key: Schema.optional(Schema.String),
          kept: Schema.Unknown,
          tapped: Schema.Unknown,
        }),
      ),
    }),
  ),
});
export type TapReport = typeof TapReport.Type;

export const RunRecord = Schema.Struct({
  /**
   * `door`: every operation called once with its blueprint example. `journey`: one registered journey. `scenario`:
   * one of the per-claim scenarios that journeys replaced (records before 14 November 2026).
   */
  kind: Schema.Literals(["door", "journey", "scenario"]),
  name: Schema.String,
  /** The claim an old per-claim scenario proved; null for the door and for a journey. */
  proves: Schema.NullOr(Schema.Struct({ operation: Schema.String, claim: Schema.Finite })),
  /** The starting world the journey declares: made for it in a run in private worlds, an empty stage otherwise. */
  given: Schema.NullOr(Schema.String),
  /** The stage of `CapxulCore` the run used: also the name of the world its Core served. */
  stage: Schema.String,
  owner: Schema.String,
  startedAt: Schema.String,
  /**
   * `passed`: the run's own expectations held, every generic check passed on every call, the stage was destroyed,
   * and the accounts held nothing of it afterwards.
   */
  outcome: Outcome,
  /** Where Core ran, when not on Cloudflare: the local-Core rehearsal's label (src/local/host.ts). */
  core: Schema.optional(Schema.String),
  /** `cli`: the journey's calls went through the command line (`--via=cli`); left out, through the SDK. */
  via: Schema.optional(Schema.Literal("cli")),
  failure: Schema.NullOr(Schema.String),
  /** How the run's own program ended, before any check; null when it never ran or did not finish. */
  ended: Schema.NullOr(Ended),
  readiness: Schema.NullOr(Readiness),
  /** Every call the run made, in order, with its timings, its steps and what the generic checks found. */
  calls: Schema.Array(CheckedCall),
  /**
   * A journey's steps, every one of its outline: each with its operation, its tries and their operation checks, the
   * calls it made (places in `calls`, whose timings and generic checks are there) and how long it took.
   */
  steps: StepResult.pipe(Schema.Array, Schema.optional),
  /** A journey's first step that failed, and why; null when none did. */
  failedStep: FailedStep.pipe(Schema.NullOr, Schema.optional),
  /**
   * For a run in private worlds: every call made in making the journey's starting world for it (a restore of its
   * template, or its steps), checked as the scenario's own are. The template's own making is in the run's
   * starting-worlds record.
   */
  making: CheckedCall.pipe(Schema.Array, Schema.optional),
  /** What its calls reached of each machine (checks/paths.ts); absent in records made before step 3.4. */
  coverage: Coverage.pipe(Schema.optional),
  /** The tap beside `app.spans`, call by call; absent in records made before the tap was read. */
  tap: TapReport.pipe(Schema.optional),
  afterwards: Schema.Struct({
    /** `left to its owner`: a world made by `world create`, which the runner neither made nor destroys. */
    stage: Schema.Literals(["destroying", "destroyed", "destroy failed", "left to its owner"]),
    /** What Cloudflare and Neon held of the stage just before its destroy: the search finds it. */
    before: Schema.NullOr(Inventory),
    /** What they held just after it: empty when nothing is left. */
    after: Schema.NullOr(Inventory),
  }),
  ms: Schema.Struct({
    /** Deploy, migrations and the wait for Core's answers. */
    create: Schema.NullOr(Schema.Finite),
    /** The calls themselves. */
    run: Schema.NullOr(Schema.Finite),
    /** Reading back what Core kept and applying the generic checks. */
    checks: Schema.NullOr(Schema.Finite),
    destroy: Schema.NullOr(Schema.Finite),
  }),
});
export type RunRecord = typeof RunRecord.Type;

/** A journey's steps and the first that failed, for its run record; nothing for the door. */
export const stepsFor = (plan: { readonly kind: string }, steps: ReadonlyArray<StepResult>) =>
  plan.kind === "journey" ? { steps, failedStep: failedStepOf(steps) } : {};

/** A run record's `via`: only a run through the command line names it. */
export const viaOf = (via: Via | undefined) => (via === "cli" ? { via: "cli" as const } : {});

/** A name reduced to lower-case letters, digits and dashes, for a file name. */
export const slugOf = (name: string): string =>
  pipe(Str.toLowerCase(name), Str.replace(/[^a-z0-9]+/g, "-"), Str.replace(/^-+|-+$/g, ""));

/** Where a run's own record goes, under the records folder: `<stage>/<door or journey's name>.json`. */
export const recordPath = (record: RunRecord): string =>
  `${record.stage}/${record.kind === "door" ? "door" : slugOf(record.name)}.json`;

const writeText = (file: string, text: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory((yield* Path.Path).dirname(file), { recursive: true });
    yield* fs.writeFileString(file, text);
    return file;
  });

/** Writes `value`, encoded by `schema`, to `file` as indented JSON, and returns the path. */
export const writeJson = <A, I>(file: string, schema: Schema.Codec<A, I>, value: A) =>
  Effect.flatMap(Schema.encodeEffect(schema)(value), (encoded) =>
    writeText(file, `${Formatter.formatJson(encoded, { space: 2 })}\n`),
  );

/** Writes each of `values`, encoded by `schema`, to `file` as one line of JSON (JSON Lines), and returns the path. */
export const writeJsonLines = <A, I>(file: string, schema: Schema.Codec<A, I>, values: ReadonlyArray<A>) =>
  Effect.flatMap(
    Effect.forEach(values, (value) => Schema.encodeEffect(schema)(value)),
    (encoded) =>
      writeText(
        file,
        Arr.join(
          Arr.map(encoded, (each) => `${Formatter.formatJson(each)}\n`),
          "",
        ),
      ),
  );

/** Writes `record` to `<directory>/<stage>/<kind or name>.json` and returns the path. */
export const writeRecord = (directory: string, record: RunRecord) =>
  writeJson(`${directory}/${recordPath(record)}`, RunRecord, record);

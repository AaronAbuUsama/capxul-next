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

export const RunRecord = Schema.Struct({
  /** `door`: every operation called once with its blueprint example. `scenario`: one registered scenario. */
  kind: Schema.Literals(["door", "scenario"]),
  name: Schema.String,
  /** The claim the scenario proves; null for the door and for an example. */
  proves: Schema.NullOr(Schema.Struct({ operation: Schema.String, claim: Schema.Finite })),
  /** The starting world the scenario declares: made for it in a run in private worlds, an empty stage otherwise. */
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
  failure: Schema.NullOr(Schema.String),
  /** How the run's own program ended, before any check; null when it never ran or did not finish. */
  ended: Schema.NullOr(Ended),
  readiness: Schema.NullOr(Readiness),
  /** Every call the run made, in order, with its timings, its steps and what the generic checks found. */
  calls: Schema.Array(CheckedCall),
  /**
   * For a run in private worlds: every call made in making the scenario's starting world for it (a restore of its
   * template, or its steps), checked as the scenario's own are. The template's own making is in the run's
   * starting-worlds record.
   */
  making: CheckedCall.pipe(Schema.Array, Schema.optional),
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

/** A name reduced to lower-case letters, digits and dashes, for a file name. */
export const slugOf = (name: string): string =>
  pipe(Str.toLowerCase(name), Str.replace(/[^a-z0-9]+/g, "-"), Str.replace(/^-+|-+$/g, ""));

/** Where a run's own record goes, under the records folder: `<stage>/<door or scenario's name>.json`. */
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

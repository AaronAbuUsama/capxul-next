// What a run leaves behind once its stage is gone: one JSON file, written by the runner and never by hand, outside
// any world. It is what proves a step (docs/roadmap.md: a run record whose `outcome` is `passed`) and what the speed
// climb reads. JSON text is written here only (with redacted values hidden): this file is an edge in .oxlintrc.json.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Formatter from "effect/Formatter";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { CheckedCall } from "./checks/checks.ts";
import { Inventory } from "./world/leftovers.ts";
import { Readiness } from "./world/warmup.ts";

export const RunRecord = Schema.Struct({
  /** `door`: every operation called once with its blueprint example. `scenario`: one registered scenario. */
  kind: Schema.Literals(["door", "scenario"]),
  name: Schema.String,
  /** The claim the scenario proves; null for the door and for an example. */
  proves: Schema.NullOr(Schema.Struct({ operation: Schema.String, claim: Schema.Finite })),
  /** The starting world the scenario declares. Until step 1.12 every run starts from a fresh, empty stage. */
  given: Schema.NullOr(Schema.String),
  /** The stage of `CapxulCore` the run used: also the name of the world its Core served. */
  stage: Schema.String,
  owner: Schema.String,
  startedAt: Schema.String,
  /**
   * `passed`: the run's own expectations held, every generic check passed on every call, the stage was destroyed,
   * and the accounts held nothing of it afterwards.
   */
  outcome: Schema.Literals(["passed", "failed"]),
  failure: Schema.NullOr(Schema.String),
  readiness: Schema.NullOr(Readiness),
  /** Every call the run made, in order, with its timings, its steps and what the generic checks found. */
  calls: Schema.Array(CheckedCall),
  afterwards: Schema.Struct({
    stage: Schema.Literals(["destroying", "destroyed", "destroy failed"]),
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

/** Writes `record` to `<directory>/<stage>/<kind or name>.json` and returns the path. */
export const writeRecord = (directory: string, record: RunRecord) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const folder = `${directory}/${record.stage}`;
    yield* fs.makeDirectory(folder, { recursive: true });
    const encoded = yield* Schema.encodeEffect(RunRecord)(record);
    const file = `${folder}/${record.kind === "door" ? "door" : slugOf(record.name)}.json`;
    yield* fs.writeFileString(file, `${Formatter.formatJson(encoded, { space: 2 })}\n`);
    return file;
  });

// What a run leaves behind once its world is gone. Written outside the world, before the destroy and again after
// it, so a destroy that fails is itself on record.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

/** The steps of a world's life. Each has a declared timeout, and each one that ran has its duration in the record. */
export const STEPS = ["claim", "deploy", "migrate", "chain", "fund", "index", "core", "use", "park", "destroy", "release"] as const;
export const StepName = Schema.Literals(STEPS);
export type StepName = typeof StepName.Type;

const Ms = Schema.NullOr(Schema.Number);

export const RunRecord = Schema.Struct({
  world: Schema.String,
  owner: Schema.String,
  /** The world this one's database and chain were copied from; "nothing" for a world made from nothing. */
  forkedFrom: Schema.String,
  expiresAt: Schema.String,
  outcome: Schema.Literals(["passed", "failed", "timed out", "interrupted", "not created"]),
  /** Why the run did not pass; null when it did. */
  failure: Schema.NullOr(Schema.String),
  worldAfterwards: Schema.Literals(["destroying", "destroyed", "kept until expiry", "destroy failed", "never existed"]),
  /** How long each step took, in milliseconds; null for a step that did not run or did not finish. */
  ms: Schema.Struct({
    claim: Ms, deploy: Ms, migrate: Ms, chain: Ms, fund: Ms, index: Ms, core: Ms, use: Ms, park: Ms, destroy: Ms, release: Ms,
    /** From the claim to a world that answers. */
    create: Ms,
    /** The whole run. */
    total: Ms,
  }),
  /** The declared timeout of each step, in milliseconds. */
  timeouts: Schema.Struct({
    claim: Schema.Number, deploy: Schema.Number, migrate: Schema.Number, chain: Schema.Number, fund: Schema.Number,
    index: Schema.Number, core: Schema.Number, use: Schema.Number, park: Schema.Number, destroy: Schema.Number, release: Schema.Number,
  }),
});
export type RunRecord = typeof RunRecord.Type;

export const noDurations: RunRecord["ms"] = {
  claim: null, deploy: null, migrate: null, chain: null, fund: null, index: null, core: null, use: null, park: null, destroy: null, release: null,
  create: null, total: null,
};

const encode = Schema.encodeSync(RunRecord);

/** The record as the text of its file. */
export const render = (record: RunRecord): string => `${JSON.stringify(encode(record), null, 2)}\n`;

/** Writes the record to `<directory>/<file>.json`. */
export const writeRecord = Effect.fn("world.record.write")(function* (directory: string, file: string, record: RunRecord) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(directory, { recursive: true });
  yield* fs.writeFileString(`${directory}/${file}.json`, render(record));
});

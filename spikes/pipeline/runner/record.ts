// What a scenario's run leaves behind once its world is gone: one JSON file, written outside the world. This is
// all that scoring and the speed climb read.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { CheckedCall } from "./checks.ts";

export const RunRecord = Schema.Struct({
  scenario: Schema.String,
  world: Schema.String,
  owner: Schema.String,
  expiresAt: Schema.String,
  /** Passed: the scenario's own expectations held and every gating generic check passed on every call. */
  outcome: Schema.Literals(["passed", "failed"]),
  failure: Schema.NullOr(Schema.String),
  /** Every call the scenario made, in order, with what the generic checks found. */
  calls: Schema.Array(CheckedCall),
  worldAfterwards: Schema.Literals(["destroying", "destroyed", "destroy failed"]),
  ms: Schema.Struct({
    /** Creating the world: the Neon branch, Hyperdrive, the Core Worker, the migrations, the first answer. */
    create: Schema.NullOr(Schema.Number),
    /** The scenario itself. */
    scenario: Schema.NullOr(Schema.Number),
    /** Reading back what Core kept and applying the generic checks. */
    checks: Schema.NullOr(Schema.Number),
    destroy: Schema.NullOr(Schema.Number),
  }),
});
export type RunRecord = typeof RunRecord.Type;

/** The file name a scenario's record is written under: its name, reduced to lower-case letters, digits and dashes. */
export const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const writeRecord = (directory: string, record: RunRecord) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(directory, { recursive: true });
    const encoded = yield* Schema.encodeEffect(RunRecord)(record);
    yield* fs.writeFileString(`${directory}/${slugOf(record.scenario)}.json`, `${JSON.stringify(encoded, null, 2)}\n`);
  });

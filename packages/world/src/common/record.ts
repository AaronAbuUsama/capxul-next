// What a run leaves behind once its world is gone, and what a proof saw. Both are JSON files outside the world,
// written by code: a run's record before its destroy and again after it, so a destroy that fails is itself on record.
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

/** Where records go when the caller names no directory: the package's own, which is committed. */
export const DEFAULT_RECORDS = `${import.meta.dirname}/../../records`;

const Ms = Schema.NullOr(Schema.Finite);

export const Outcome = Schema.Literals(["passed", "failed", "timed out", "interrupted", "not created"]);
export type Outcome = typeof Outcome.Type;

export const RunRecord = Schema.Struct({
  world: Schema.String,
  owner: Schema.String,
  /** The world this one's database and chain were copied from; "nothing" for a world made from nothing. */
  forkedFrom: Schema.String,
  expiresAt: Schema.String,
  outcome: Outcome,
  /** Why the run did not pass; null when it did. */
  failure: Schema.NullOr(Schema.String),
  worldAfterwards: Schema.Literals(["destroying", "destroyed", "kept", "destroy failed", "never existed"]),
  /** Until when a kept world stays parked before the sweeper deletes it; null for a world that was not kept. */
  keptUntil: Schema.NullOr(Schema.String),
  /** How long each step took, in milliseconds; null for a step that did not run. */
  ms: Schema.Struct({
    /** The wait for a place on the hub, with the claim of the name (absent in a record made before admission). */
    admit: Schema.optionalKey(Ms),
    claim: Ms,
    /** The world's keys to the bench's site door and the collector (absent in a record made before it was its own step). */
    grant: Schema.optionalKey(Ms),
    register: Ms,
    branch: Ms,
    deploy: Ms,
    migrate: Ms,
    chain: Ms,
    fund: Ms,
    bundler: Ms,
    index: Ms,
    core: Ms,
    site: Ms,
    use: Ms,
    park: Ms,
    unsite: Ms,
    destroy: Ms,
    release: Ms,
    /** From the claim to a world that answers. */
    create: Ms,
    /** The whole run. */
    total: Ms,
  }),
  /** The declared timeout of each step, in milliseconds. */
  timeouts: Schema.Struct({
    admit: Schema.optionalKey(Schema.Finite),
    claim: Schema.Finite,
    grant: Schema.optionalKey(Schema.Finite),
    register: Schema.Finite,
    branch: Schema.Finite,
    deploy: Schema.Finite,
    migrate: Schema.Finite,
    chain: Schema.Finite,
    fund: Schema.Finite,
    bundler: Schema.Finite,
    index: Schema.Finite,
    core: Schema.Finite,
    site: Schema.Finite,
    use: Schema.Finite,
    park: Schema.Finite,
    unsite: Schema.Finite,
    destroy: Schema.Finite,
    release: Schema.Finite,
  }),
});
export type RunRecord = typeof RunRecord.Type;

export const noDurations: RunRecord["ms"] = {
  admit: null,
  claim: null,
  grant: null,
  register: null,
  branch: null,
  deploy: null,
  migrate: null,
  chain: null,
  fund: null,
  bundler: null,
  index: null,
  core: null,
  site: null,
  use: null,
  park: null,
  unsite: null,
  destroy: null,
  release: null,
  create: null,
  total: null,
};

/** The text of a JSON file, as every record is written. */
export const asJsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** JSON text decoded with `schema`: a record file read back, or what the command line printed. */
export const decodeJsonText = <S extends Schema.Constraint>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema));

const writeJson = Effect.fn("world.record.writeJson")(function* (directory: string, file: string, value: unknown) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(directory, { recursive: true });
  yield* fs.writeFileString(`${directory}/${file}.json`, asJsonText(value));
});

/** The record as its file holds it: checked against the schema on the way out. */
export const renderRecord = (record: RunRecord) => Effect.map(Schema.encodeEffect(RunRecord)(record), asJsonText);

/** Writes the run's record to `<directory>/<file>.json`. */
export const writeRecord = Effect.fn("world.record.write")(function* (
  directory: string,
  file: string,
  record: RunRecord,
) {
  yield* writeJson(directory, file, yield* Schema.encodeEffect(RunRecord)(record));
});

/** Reads a run's record back from `<directory>/<file>.json`. */
export const readRecord = Effect.fn("world.record.read")(function* (directory: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* decodeJsonText(RunRecord)(yield* fs.readFileString(`${directory}/${file}.json`));
});

/** One thing a proof insists on, and whether it held. */
export interface Check {
  readonly check: string;
  readonly held: boolean;
}

/**
 * Writes what a proof saw to `records/<name>.proof.json`: what it set out to show, its outcome (passed only when
 * every check held), each check, and its observations. Gives back the outcome and the checks that did not hold.
 */
export const writeProof = Effect.fn("world.record.proof")(function* (
  name: string,
  proof: string,
  checks: ReadonlyArray<Check>,
  observations: unknown,
) {
  const failed = Arr.filter(checks, (check) => !check.held);
  const outcome = Arr.isReadonlyArrayEmpty(failed) ? ("passed" as const) : ("failed" as const);
  const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
  yield* writeJson(DEFAULT_RECORDS, `${name}.proof`, { proof, outcome, at, checks, observations });
  return { outcome, failed };
});

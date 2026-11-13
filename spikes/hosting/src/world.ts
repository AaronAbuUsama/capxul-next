// The life of a world as one unit: create it, use it, copy its record out, destroy it.
//
// The rules this file enforces (docs/roadmap.md, "World lifecycle rules"):
//   1. Destroy runs even when the use fails, times out or is interrupted (Effect.acquireUseRelease).
//   2. Every world has an owner and an expiry; Neon deletes an expired branch on its own.
//   3. Keeping a failed world to debug it is asked for explicitly, and its expiry is its time limit.
//   6. Each step has a declared timeout, and how long each step took is in the record.
import * as Alchemist from "alchemy/Alchemist";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import stack from "../alchemy.run.ts";

export interface WorldSpec {
  readonly name: string;
  readonly owner: string;
  /** How long the world may exist. Past this, Neon deletes its branch whatever happened to the run. */
  readonly lifetime: Duration.Duration;
  /** Fork this world's database from another world; an empty world otherwise. */
  readonly parent?: string;
  /** Leave a failed world in place, until its expiry, so it can be looked into. Never applies to a passing run. */
  readonly keepOnFailure?: boolean;
  readonly timeouts: { readonly create: Duration.Duration; readonly use: Duration.Duration; readonly destroy: Duration.Duration };
}

export interface World {
  readonly name: string;
  readonly owner: string;
  readonly expiresAt: string;
  readonly database: Redacted.Redacted<string>;
}

export class StepTimedOut extends Schema.TaggedError<StepTimedOut>()("StepTimedOut", {
  step: Schema.Literals(["create", "use", "destroy"]),
  afterMs: Schema.Number,
}) {}

/** What a run leaves behind once its world is gone. This is all that scoring reads. */
export const RunRecord = Schema.Struct({
  world: Schema.String,
  owner: Schema.String,
  forkedFrom: Schema.String,
  expiresAt: Schema.String,
  outcome: Schema.Literals(["passed", "failed", "interrupted"]),
  failure: Schema.NullOr(Schema.String),
  worldAfterwards: Schema.Literals(["destroyed", "kept until expiry", "destroy failed"]),
  ms: Schema.Struct({ create: Schema.Number, use: Schema.NullOr(Schema.Number), destroy: Schema.NullOr(Schema.Number) }),
});
export type RunRecord = typeof RunRecord.Type;

type StepName = "create" | "use" | "destroy";

const limited = <A, E, R>(name: StepName, limit: Duration.Duration, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: limit,
      orElse: () => Effect.fail(new StepTimedOut({ step: name, afterMs: Duration.toMillis(limit) })),
    }),
    Effect.withSpan(`world.${name}`),
  );

const millis = (took: Duration.Duration) => Math.round(Duration.toMillis(took));

const step = <A, E, R>(name: StepName, limit: Duration.Duration, effect: Effect.Effect<A, E, R>) =>
  Effect.timed(limited(name, limit, effect)).pipe(Effect.map(([took, value]) => ({ ms: millis(took), value })));

// The stack reads a world's settings from the environment, so they are set here, at the edge, just before planning.
// One world at a time per process: two concurrent deploys in one process would overwrite each other's settings.
const settings = (spec: WorldSpec, expiresAt: string) =>
  Effect.sync(() => {
    process.env.WORLD_OWNER = spec.owner;
    process.env.WORLD_EXPIRES_AT = expiresAt;
    process.env.WORLD_PARENT = spec.parent ?? "";
  });

const deploy = (spec: WorldSpec, expiresAt: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* settings(spec, expiresAt);
      const out = yield* Alchemist.apply(yield* Alchemist.plan({ stack, operation: "deploy", stage: spec.name }));
      const database = (out as { database: unknown }).database;
      return {
        name: spec.name,
        owner: spec.owner,
        expiresAt,
        database: Redacted.isRedacted(database) ? (database as Redacted.Redacted<string>) : Redacted.make(String(database)),
      } satisfies World;
    }),
  );

const destroy = (spec: WorldSpec) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Alchemist.apply(yield* Alchemist.plan({ stack, operation: "destroy", stage: spec.name }));
    }),
  );

const writeRecord = (directory: string, record: RunRecord) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFileString(`${directory}/${record.world}.json`, JSON.stringify(Schema.encodeSync(RunRecord)(record), null, 2) + "\n");
  });

/**
 * Creates the world, runs `use` in it, writes the run's record to `records` (outside the world), and destroys the
 * world. The record is written before the destroy and again after it, so a destroy that fails is itself on record.
 */
export const runInWorld = <A, E, R>(spec: WorldSpec, records: string, use: (world: World) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const expiresAt = new Date((yield* Effect.clockWith((clock) => clock.currentTimeMillis)) + Duration.toMillis(spec.lifetime)).toISOString();
    return yield* Effect.acquireUseRelease(
      step("create", spec.timeouts.create, deploy(spec, expiresAt)),
      // The use step is timed whether it passes or not, so a failure or a timeout still says how long it ran.
      (created) => Effect.timed(Effect.exit(limited("use", spec.timeouts.use, use(created.value)))),
      (created, exit) =>
        Effect.gen(function* () {
          const used = Exit.isSuccess(exit) ? exit.value[1] : undefined;
          const passed = used !== undefined && Exit.isSuccess(used);
          const base = {
            world: spec.name,
            owner: spec.owner,
            forkedFrom: spec.parent ?? "empty",
            expiresAt,
            outcome: used === undefined ? "interrupted" : passed ? "passed" : "failed",
            failure: used !== undefined && Exit.isFailure(used) ? String(used.cause).slice(0, 400) : null,
          } as const;
          const useMs = Exit.isSuccess(exit) ? millis(exit.value[0]) : null;
          const keep = !passed && spec.keepOnFailure === true;
          yield* writeRecord(records, { ...base, worldAfterwards: keep ? "kept until expiry" : "destroyed", ms: { create: created.ms, use: useMs, destroy: null } });
          if (keep) return;
          const gone = yield* Effect.exit(step("destroy", spec.timeouts.destroy, destroy(spec)));
          yield* writeRecord(records, {
            ...base,
            worldAfterwards: Exit.isSuccess(gone) ? "destroyed" : "destroy failed",
            ms: { create: created.ms, use: useMs, destroy: Exit.isSuccess(gone) ? gone.value.ms : null },
          });
        }).pipe(Effect.orDie),
    );
  });

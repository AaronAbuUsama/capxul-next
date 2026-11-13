// The life of a world as one unit: create it, use it, write its record outside it, destroy it.
//
// The rules this file enforces (docs/roadmap.md, "World lifecycle rules"):
//   1. The record is written and the world is destroyed whatever happened: the use failed, timed out, or the run
//      was interrupted, also half-way through the create. Only a world this run claimed is ever taken down.
//   2. Every world records its owner and its expiry in the shared state before anything of it exists.
//   3. Keeping a world whose run did not pass is asked for explicitly (`keepOnFailure`); it is left stopped, it is
//      marked in the shared state, and the sweeper still deletes it at its expiry.
//   6. Every step runs under a declared timeout, and how long each took is in the record.
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { recordedOutput } from "../stack/engine.ts";
import { open, stop } from "./parts.ts";
import { noDurations, type RunRecord, writeRecord } from "./record.ts";
import { Timeouts, type World, type WorldSpec } from "./spec.ts";
import { makeStopwatch, timeoutsInMillis } from "./steps.ts";
import { bringUp, markParked, planOf, takeDown } from "./world.ts";

/** Where records go when the caller names no directory: the package's own, which is committed. */
export const DEFAULT_RECORDS = `${import.meta.dirname}/../../records`;

/** One line that says why something failed, without a stack trace or a secret. */
export const describe = (cause: Cause.Cause<unknown>): string => {
  const first = Cause.squash(cause);
  const tag = typeof first === "object" && first !== null && "_tag" in first ? `${String(first._tag)}: ` : "";
  const message =
    typeof first === "object" && first !== null && "message" in first ? String(first.message) : String(first);
  return `${tag}${message}`.replace(/postgres(ql)?:\/\/\S+/g, "<connection string>").slice(0, 400);
};

const outcomeOf = (created: boolean, used: Option.Option<Exit.Exit<unknown, unknown>>): RunRecord["outcome"] => {
  if (Option.isNone(used)) return created ? "interrupted" : "not created";
  if (Exit.isSuccess(used.value)) return "passed";
  if (Cause.hasInterruptsOnly(used.value.cause)) return "interrupted";
  const failure = Cause.squash(used.value.cause);
  return typeof failure === "object" && failure !== null && "_tag" in failure && failure._tag === "StepTimedOut"
    ? "timed out"
    : "failed";
};

/**
 * Creates the world, runs `use` in it, writes the run's record, and destroys the world. Gives back the record and
 * how the use ended (none when the world was never used).
 */
export const withWorld = <A, E, R>(spec: WorldSpec, use: (world: World) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const timeouts = yield* Timeouts;
    const limits = { ...timeouts, use: spec.useTimeout ?? timeouts.use };
    const plan = yield* planOf(spec);
    const watch = yield* makeStopwatch(limits);
    const began = yield* Clock.currentTimeMillis;
    const held = yield* Ref.make(Option.none<string>());
    const created = yield* Ref.make(Option.none<number>());
    const failure = yield* Ref.make(Option.none<string>());
    const used = yield* Ref.make(Option.none<Exit.Exit<A, unknown>>());

    const run = Effect.gen(function* () {
      const up = yield* Effect.exit(bringUp(spec, plan, watch, held));
      if (Exit.isFailure(up)) {
        yield* Ref.set(failure, Option.some(`the world could not be created: ${describe(up.cause)}`));
        return up;
      }
      yield* Ref.set(created, Option.some((yield* Clock.currentTimeMillis) - began));
      const exit = yield* Effect.exit(watch.step("use", use(up.value)));
      yield* Ref.set(used, Option.some(exit));
      if (Exit.isFailure(exit)) yield* Ref.set(failure, Option.some(describe(exit.cause)));
      return up;
    });

    const recordNow = (worldAfterwards: RunRecord["worldAfterwards"], total: number | null) =>
      Effect.gen(function* () {
        const wasCreated = Option.isSome(yield* Ref.get(created));
        const outcome = outcomeOf(wasCreated, yield* Ref.get(used));
        const why = yield* Ref.get(failure);
        const record: RunRecord = {
          world: plan.stage,
          owner: plan.owner,
          forkedFrom: Option.getOrElse(plan.forkedFrom, () => "nothing"),
          expiresAt: plan.expiresAt,
          outcome,
          failure: outcome === "passed" ? null : Option.getOrElse(why, () => "the run was interrupted"),
          worldAfterwards,
          ms: { ...noDurations, ...(yield* watch.durations), create: Option.getOrNull(yield* Ref.get(created)), total },
          timeouts: timeoutsInMillis(limits),
        };
        yield* writeRecord(spec.records ?? DEFAULT_RECORDS, spec.recordAs ?? spec.name, record);
        return record;
      });

    const leave = Effect.gen(function* () {
      const holder = yield* Ref.get(held);
      // Nothing was claimed, so nothing of this run exists: another run's world of the same name is not touched.
      if (Option.isNone(holder)) return yield* recordNow("never existed", (yield* Clock.currentTimeMillis) - began);
      const before = yield* recordNow("destroying", null);
      const keep = spec.keepOnFailure === true && before.outcome !== "passed" && before.ms.create !== null;
      const after = keep
        ? yield* watch
            .step(
              "park",
              Effect.flatMap(recordedOutput(plan.stage), (output) =>
                Effect.andThen(markParked(output), stopWorld(plan.stage)),
              ),
            )
            .pipe(Effect.exit, Effect.as("kept until expiry" as const))
        : yield* takeDown(plan.stage, watch, holder).pipe(
            Effect.exit,
            Effect.tap((gone) =>
              Exit.isFailure(gone)
                ? Effect.logError(`world ${plan.stage}: destroy failed: ${describe(gone.cause)}`)
                : Effect.void,
            ),
            Effect.map((gone) => (Exit.isSuccess(gone) ? ("destroyed" as const) : ("destroy failed" as const))),
          );
      return yield* recordNow(after, (yield* Clock.currentTimeMillis) - began);
    });

    // `leave` is the release of acquireUseRelease in all but name: it cannot be interrupted, and it runs when `run`
    // fails, dies or is interrupted, whether or not the create had finished.
    const [ran, record] = yield* Effect.uninterruptibleMask((restore) =>
      Effect.flatMap(Effect.exit(restore(run)), (ran) =>
        Effect.map(leave.pipe(Effect.orDie), (record) => [ran, record] as const),
      ),
    );
    // A world that could not be created is the caller's typed failure, once its record is written and whatever
    // the create left behind is gone.
    if (Exit.isSuccess(ran) && Exit.isFailure(ran.value)) return yield* Effect.failCause(ran.value.cause);
    return { record, used: yield* Ref.get(used) };
  }).pipe(Effect.withSpan("world.run", { attributes: { world: spec.name } }));

const stopWorld = (stage: string) => Effect.flatMap(open(stage), stop);

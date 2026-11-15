// The life of a world as one unit: create it, use it, write its record outside it, destroy it.
//
// The rules this file enforces (docs/roadmap.md, "World lifecycle rules"):
//   1. The record is written and the world is destroyed whatever happened: the use failed, timed out, or the run
//      was interrupted, also half-way through the create. Only a world this run claimed is ever taken down.
//   2. Every world records its owner and its expiry in the shared state before anything of it exists.
//   3. Keeping a world whose run did not pass is asked for explicitly, for a duration (`keepOnFailure`), at most the
//      declared `WORLD_MAX_KEEP`: it is left stopped, marked parked, and the sweeper deletes it when the keep ends.
//   6. Every step runs under a declared timeout, and how long each took is in the record.
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type { StepTimedOut } from "../../common/failures.ts";
import { describe, tagOf } from "../../common/describe.ts";
import { DEFAULT_RECORDS, noDurations, type Outcome, type RunRecord, writeRecord } from "../../common/record.ts";
import { Limits, Timeouts, type World, type WorldSpec } from "./values.ts";
import { makeStopwatch, timeoutsInMillis } from "../../common/stopwatch.ts";
import { bringUp } from "./bring-up.ts";
import { keptUntil, park, planOf, takeDown } from "./take-down.ts";

/** How a use ended, as the record says it. */
const outcomeOf = <A, E>(created: boolean, used: Option.Option<Exit.Exit<A, E>>): Outcome => {
  if (Option.isNone(used)) return created ? "interrupted" : "not created";
  if (Exit.isSuccess(used.value)) return "passed";
  if (Cause.hasInterruptsOnly(used.value.cause)) return "interrupted";
  return used.value.cause.pipe(Cause.squash, tagOf) === "StepTimedOut" ? "timed out" : "failed";
};

/**
 * Creates the world, runs `use` in it, writes the run's record, and destroys the world. Gives back the record and
 * how the use ended (none when the world was never used).
 */
export const withWorld = <A, E, R>(spec: WorldSpec, use: (world: World) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const timeouts = yield* Timeouts;
    const { maxKeep } = yield* Limits;
    const limits = { ...timeouts, use: spec.useTimeout ?? timeouts.use };
    const plan = yield* planOf(spec);
    const watch = yield* makeStopwatch(limits);
    const began = yield* Clock.currentTimeMillis;
    const elapsed = Effect.map(Clock.currentTimeMillis, (now) => now - began);
    const held = yield* Ref.make(Option.none<string>());
    const created = yield* Ref.make(Option.none<number>());
    const failure = yield* Ref.make(Option.none<string>());
    const used = yield* Ref.make(Option.none<Exit.Exit<A, E | StepTimedOut>>());

    const run = Effect.gen(function* () {
      const up = yield* Effect.exit(bringUp(spec, plan, watch, held));
      if (Exit.isFailure(up)) {
        yield* Ref.set(failure, Option.some(`the world could not be created: ${describe(up.cause)}`));
        return up;
      }
      yield* Ref.set(created, Option.some(yield* elapsed));
      const exit = yield* Effect.exit(watch.step("use", use(up.value)));
      yield* Ref.set(used, Option.some(exit));
      if (Exit.isFailure(exit)) yield* Ref.set(failure, exit.cause.pipe(describe, Option.some));
      return up;
    });

    const recordNow = (worldAfterwards: RunRecord["worldAfterwards"], until: string | null, total: number | null) =>
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
          keptUntil: until,
          ms: { ...noDurations, ...(yield* watch.durations), create: Option.getOrNull(yield* Ref.get(created)), total },
          timeouts: timeoutsInMillis(limits),
        };
        yield* writeRecord(spec.records ?? DEFAULT_RECORDS, spec.recordAs ?? spec.name, record);
        return record;
      });

    const destroyed = (holder: Option.Option<string>) =>
      takeDown(plan.stage, watch, holder).pipe(
        Effect.exit,
        Effect.tap((gone) =>
          Exit.isFailure(gone)
            ? Effect.logError(`world ${plan.stage}: destroy failed: ${describe(gone.cause)}`)
            : Effect.void,
        ),
        Effect.map((gone) => (Exit.isSuccess(gone) ? ("destroyed" as const) : ("destroy failed" as const))),
      );

    const leave = Effect.gen(function* () {
      const holder = yield* Ref.get(held);
      // Nothing was claimed, so nothing of this run exists: another run's world of the same name is not touched.
      if (Option.isNone(holder)) return yield* recordNow("never existed", null, yield* elapsed);
      const before = yield* recordNow("destroying", null, null);
      const keep = Option.fromUndefinedOr(spec.keepOnFailure);
      if (Option.isNone(keep) || before.outcome === "passed" || before.ms.create === null)
        return yield* recordNow(yield* destroyed(holder), null, yield* elapsed);
      const until = keptUntil(yield* DateTime.now, plan.expiresAt, keep.value, maxKeep);
      const parked = yield* Effect.exit(watch.step("park", park(plan.stage, until)));
      if (Exit.isSuccess(parked)) return yield* recordNow("kept", until, yield* elapsed);
      // A world that could not be parked is not left running: it is destroyed like any other.
      yield* Effect.logError(`world ${plan.stage}: could not be parked (${describe(parked.cause)}); destroying it`);
      return yield* recordNow(yield* destroyed(holder), null, yield* elapsed);
    });

    // `leave` is the release of acquireUseRelease in all but name: it cannot be interrupted, and it runs when `run`
    // fails, dies or is interrupted, whether or not the create had finished.
    const [ran, record] = yield* Effect.uninterruptibleMask((restore) =>
      Effect.flatMap(Effect.exit(restore(run)), (ended) =>
        Effect.map(leave.pipe(Effect.orDie), (written) => [ended, written] as const),
      ),
    );
    // A world that could not be created is the caller's typed failure, once its record is written and whatever
    // the create left behind is gone. An interrupted run is interrupted again, once its world is gone.
    if (Exit.isFailure(ran)) return yield* Effect.failCause(ran.cause);
    if (Exit.isFailure(ran.value)) return yield* Effect.failCause(ran.value.cause);
    return { record, used: yield* Ref.get(used) };
  }).pipe(Effect.withSpan("world.run", { attributes: { world: spec.name } }));

// What a run in private worlds takes down, and what it reads of the accounts afterwards: the worlds it made, destroyed
// the newest first. The bench templates it kept are not its to take down: they are the bench's, never dropped by a run,
// and the sweep removes them by age (docs/roadmap.md, "Bench templates never change"). A take-down that fails is never
// ignored: it is timed `ok: false` with why, and its failures are handed back for the run's record to fail on.
import { Pipeline } from "@capxul/blueprint";
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import { describe, RunnerFailure } from "../failure.ts";
import { stepOptions } from "../telemetry/step.ts";
import type { Timings } from "../timings.ts";
import type { Inventory } from "../world/leftovers.ts";

/** What the accounts hold of `stages`, by name, or null when they could not be read. */
export const leftOf = (stages: ReadonlyArray<string>) =>
  World.inventory.pipe(
    Effect.map((listing): Inventory | null => ({
      workers: [],
      hyperdrives: [],
      neonProjects: [],
      worlds: World.namesOfWorlds(World.ofThisStackOnly(listing), stages),
    })),
    Effect.catchCause((cause) => Effect.as(Effect.logWarning(`inventory not read: ${describe(cause)}`), null)),
  );

/** How often an after-read is made again, and how long apart: Cloudflare's script list lags a delete by seconds. */
export const SETTLE = { reads: 5, every: Duration.seconds(2) };

/** True when `left` still lists some world, or could not be read. */
const listsSome = (left: Inventory | null) => left === null || (left.worlds ?? []).length > 0;

/**
 * What the accounts hold of a journey's worlds once their destroy has settled: `read` now and, while it still lists a
 * world, again up to `settle.reads` more times, `settle.every` apart (run 43812161831: a world its destroy had taken
 * down was still in Cloudflare's script list right after, and gone a minute later). The last read, and how many
 * re-reads it took; what is then still listed fails the journey, by name, as before. A wait, `journey.run.wait`.
 */
export const settledLeft = Effect.fn(
  Pipeline.journeyRun.spans.wait.name,
  stepOptions(Pipeline.journeyRun.spans.wait),
)(function* <E, R>(read: Effect.Effect<Inventory | null, E, R>, settle: typeof SETTLE = SETTLE) {
  let left = yield* read;
  let rereads = 0;
  while (listsSome(left) && rereads < settle.reads) {
    yield* Effect.sleep(settle.every);
    left = yield* read;
    rereads += 1;
  }
  return { left, rereads };
});

/** Why a journey fails on what the accounts still hold once settled, naming each world; nothing when they hold none. */
export const stillHeld = (left: Inventory | null): ReadonlyArray<string> =>
  left === null
    ? ["the accounts could not be read after its destroy"]
    : (left.worlds ?? []).length > 0
      ? [`the accounts still hold some of its worlds: ${Arr.join(left.worlds ?? [], ", ")}`]
      : [];

/** What the accounts hold of a journey's `stages` once settled, the wait and its re-reads a part of the record. */
export const leftAfterDestroy = (stages: ReadonlyArray<string>, timings: Timings, journey: string) =>
  leftOf(stages).pipe(
    settledLeft,
    Effect.timed,
    Effect.tap(([took, { rereads }]) =>
      timings.record("settle after destroy", Math.round(Duration.toMillis(took)), {
        journey,
        note: `${String(rereads)} re-read${rereads === 1 ? "" : "s"}`,
      }),
    ),
    Effect.map(([, { left }]) => left),
  );

/**
 * Destroys `stages`, the newest first, so a world restored from a snapshot goes before the world it came from. Every
 * one is tried; then it fails, when any was not destroyed, with each such world and why.
 */
export const destroyEach = (stages: ReadonlyArray<string>) =>
  Effect.forEach(Arr.reverse(stages), (stage) =>
    World.destroy(stage).pipe(
      Effect.exit,
      Effect.flatMap((gone) =>
        Exit.isSuccess(gone)
          ? Effect.succeed<ReadonlyArray<string>>([])
          : Effect.as(Effect.logError(`world ${stage}: destroy failed: ${describe(gone.cause)}`), [
              `${stage}: ${describe(gone.cause)}`,
            ]),
      ),
    ),
  ).pipe(
    Effect.map(Arr.flatten),
    Effect.flatMap((failed) =>
      Arr.isReadonlyArrayEmpty(failed)
        ? Effect.void
        : Effect.fail(RunnerFailure.make({ step: "destroy", message: Arr.join(failed, "; ") })),
    ),
  );

/** Destroys `stages` as `destroyEach` does; true when every one is gone. */
export const destroyAll = (stages: ReadonlyArray<string>) =>
  destroyEach(stages).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

/**
 * Destroys what is left of the worlds the platform tried to make but never handed over: a create that failed after
 * its claim takes its world down itself, and when that take-down fails too the world is left. Only a world one of the
 * run's operators owns (`owns`, operators.ts) is touched; one already gone is no failure.
 */
export const destroyStrays = (stages: ReadonlyArray<string>, owns: (owner: string) => boolean) =>
  Effect.forEach(stages, (stage) =>
    World.open(stage).pipe(
      Effect.flatMap((world) => (owns(world.owner) ? destroyAll([stage]) : Effect.succeed(true))),
      Effect.orElseSucceed(() => true),
    ),
  ).pipe(Effect.map(Arr.every((gone) => gone)));

/** A timed part that ended badly, as one line of the run's failure; nothing when it went. */
const failedAs = <A, E, R>(what: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.as<ReadonlyArray<string>>([]),
    Effect.catchCause((cause) => Effect.succeed([`${what}: ${describe(cause)}`])),
  );

/**
 * Destroys `stages` (the one world among them), timed. Never fails: what could not be done (a world not destroyed, its
 * sites' removal included) is handed back, one line each, with how long the destroy took.
 */
export const takeDownWorlds = (stages: ReadonlyArray<string>, timings: Timings) =>
  Effect.gen(function* () {
    const began = yield* Clock.currentTimeMillis;
    const failed = Arr.isReadonlyArrayEmpty(stages)
      ? []
      : yield* failedAs(
          "world destroy failed",
          timings.timed("world destroy", { of: Arr.join(stages, ", ") }, destroyEach(stages)),
        );
    return { failed, destroyMs: (yield* Clock.currentTimeMillis) - began };
  });

/**
 * Destroys the run's one world, timed; what could not be done, one line each. Whatever ends the run, this runs. The
 * bench templates the run kept stay: they are the bench's, never dropped by a run, and the sweep removes them by age
 * (docs/roadmap.md, "Bench templates never change"). With RUNNER_TEARDOWN=job the one world is left, and kept in
 * `handedOver`, for CI's teardown job to destroy (settings.ts, `teardown`).
 */
export const takeDown = (
  settings: { readonly teardown: "run" | "job" },
  templateWorlds: Effect.Effect<ReadonlyArray<string>>,
  timings: Timings,
  handedOver: Ref.Ref<ReadonlyArray<string>>,
) =>
  Effect.flatMap(templateWorlds, (ones) =>
    settings.teardown === "job"
      ? Ref.set(handedOver, ones).pipe(
          Effect.andThen(Effect.log(`left for the teardown job: ${Arr.join(ones, ", ") || "no world"}`)),
          Effect.as<ReadonlyArray<string>>([]),
        )
      : Effect.map(takeDownWorlds(ones, timings), (done) => done.failed),
  );

/** A world the run takes down, and the world it was restored from, when it was restored (`world.snapshot.restore`). */
export interface Doomed {
  readonly stage: string;
  readonly from: string | null;
}

/**
 * Destroys `worlds` with `destroy` (roadmap 4.8, the own-world track's teardown): a world restored from another goes
 * before its source, whose branch it forks; worlds unrelated to each other go together, at most `atOnce` at a time.
 * Every one is tried; answers each that was not destroyed, with why.
 *
 * The seam test/teardown-order.test.ts drives, written first. What is here is today's order, a stand-in: one at a
 * time, the newest first. The runner's builder replaces it, and the run's take-down uses it.
 */
export const destroyInOrder = (
  worlds: ReadonlyArray<Doomed>,
  destroy: (stage: string) => Effect.Effect<void, RunnerFailure>,
  _atOnce: number,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.map(
    Effect.forEach(Arr.reverse(worlds), (world) =>
      Effect.map(Effect.exit(destroy(world.stage)), (gone) =>
        Exit.isSuccess(gone) ? [] : [`${world.stage}: ${describe(gone.cause)}`],
      ),
    ),
    Arr.flatten,
  );

// What a run in private worlds takes down, and what it reads of the accounts afterwards: the worlds it made, destroyed
// in layers, a world restored from another before its source and unrelated ones together (`destroyInOrder`). The
// bench templates it kept are not its to take down: they are the bench's, never dropped by a run, and the sweep
// removes them by age (docs/roadmap.md, "Bench templates never change"). A take-down that fails is never
// ignored: it is timed `ok: false` with why, and its failures are handed back for the run's record to fail on.
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import type { MadeWorld } from "./restored.ts";
import { describe, RunnerFailure } from "../failure.ts";
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

/** The stages of the worlds a journey's calls made. */
export const stagesOf = (made: ReadonlyArray<MadeWorld>): ReadonlyArray<string> => Arr.map(made, (each) => each.stage);

/** The world each of `made` was restored from, as `destroyEach` asks it: null for one not restored, or not made here. */
export const sourcesIn =
  (made: ReadonlyArray<MadeWorld>) =>
  (stage: string): string | null =>
    Option.getOrNull(
      Option.flatMap(
        Arr.findFirst(made, (each) => each.stage === stage),
        (each) => Option.fromNullishOr(each.from),
      ),
    );

/**
 * A journey's own worlds destroyed, a restored one before its source (as its calls made them: `made`), beside the
 * strays the platform tried for it, of those only the ones the run's operators own (`owns`); true when all are gone.
 */
export const ownWorldsDown = (
  mine: ReadonlyArray<string>,
  made: ReadonlyArray<MadeWorld>,
  strays: ReadonlyArray<string>,
  owns: (owner: string) => boolean,
) => Effect.zipWith(destroyAll(mine, sourcesIn(made)), destroyStrays(strays, owns), (a, b) => a && b);

/** How many worlds a take-down destroys at once. */
export const DESTROYS_AT_ONCE = 4;

/** `stage` destroyed by the world, any failure a RunnerFailure that says why. */
const destroyOne = (stage: string) =>
  World.destroy(stage).pipe(
    Effect.asVoid,
    Effect.catchCause((cause) => Effect.fail(RunnerFailure.make({ step: "destroy", message: describe(cause) }))),
  );

/**
 * Destroys `stages` in order (`destroyInOrder`), `DESTROYS_AT_ONCE` at a time, a world restored from another before its
 * source when `restoredFrom` says which (a journey's own calls say: `sourcesIn`; none by default). Then each that failed is tried again, one at a time,
 * the newest first: a source the order did not know refuses while a world restored from it remains, and passes once it
 * is gone. Every one is tried; then it fails, when any was still not destroyed, with each such world and why.
 */
export const destroyEach = (
  stages: ReadonlyArray<string>,
  restoredFrom: (stage: string) => string | null = () => null,
) =>
  destroyInOrder(
    Arr.map(stages, (stage) => ({ stage, from: restoredFrom(stage) })),
    destroyOne,
    DESTROYS_AT_ONCE,
  ).pipe(
    Effect.flatMap((first) =>
      Effect.forEach(
        // The failures again, the newest first, as `stages` lists them oldest first.
        Arr.filter(Arr.reverse(stages), (stage) => Arr.some(first, Str.startsWith(`${stage}: `))),
        (stage) =>
          Effect.map(Effect.exit(destroyOne(stage)), (gone) =>
            Exit.isSuccess(gone) ? [] : [`${stage}: ${describe(gone.cause)}`],
          ),
      ),
    ),
    Effect.map(Arr.flatten),
    Effect.tap((failed) => Effect.forEach(failed, (each) => Effect.logError(`world ${each}`))),
    Effect.flatMap((failed) =>
      Arr.isReadonlyArrayEmpty(failed)
        ? Effect.void
        : Effect.fail(RunnerFailure.make({ step: "destroy", message: Arr.join(failed, "; ") })),
    ),
  );

/** Destroys `stages` as `destroyEach` does, restored worlds before their sources; true when every one is gone. */
export const destroyAll = (
  stages: ReadonlyArray<string>,
  restoredFrom: (stage: string) => string | null = () => null,
) =>
  destroyEach(stages, restoredFrom).pipe(
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
 * `worlds` in the order they can go: each layer holds every world no other world left was restored from, so a world
 * restored from another goes in a layer before its source's; worlds unrelated to each other share a layer. A layer
 * lists its worlds the newest first. (A world restored from itself, which cannot be, would end the layers: the rest go
 * together.)
 */
export const layersOf = (worlds: ReadonlyArray<Doomed>): ReadonlyArray<ReadonlyArray<Doomed>> => {
  const layers: Array<ReadonlyArray<Doomed>> = [];
  let left = worlds;
  while (Arr.isReadonlyArrayNonEmpty(left)) {
    const leaves = Arr.filter(left, (each) => !Arr.some(left, (other) => other.from === each.stage));
    const layer = Arr.isReadonlyArrayNonEmpty(leaves) ? leaves : left;
    layers.push(Arr.reverse(layer));
    left = Arr.filter(left, (each) => !Arr.contains(layer, each));
  }
  return layers;
};

/**
 * Destroys `worlds` with `destroy` (roadmap 4.8, the own-world track's teardown): a world restored from another goes
 * before its source, whose branch it forks; worlds unrelated to each other go together, at most `atOnce` at a time
 * (`layersOf`). Every one is tried; answers each that was not destroyed, with why.
 */
export const destroyInOrder = <R>(
  worlds: ReadonlyArray<Doomed>,
  destroy: (stage: string) => Effect.Effect<void, RunnerFailure, R>,
  atOnce: number,
): Effect.Effect<ReadonlyArray<string>, never, R> =>
  Effect.map(
    Effect.forEach(layersOf(worlds), (layer) =>
      Effect.forEach(
        layer,
        (world) =>
          Effect.map(Effect.exit(destroy(world.stage)), (gone) =>
            Exit.isSuccess(gone) ? [] : [`${world.stage}: ${describe(gone.cause)}`],
          ),
        { concurrency: Math.max(1, atOnce) },
      ),
    ),
    (layers) => Arr.flatten(Arr.flatten(layers)),
  );

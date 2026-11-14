// What a run in private worlds takes down, and what it reads of the accounts afterwards: the worlds it made, destroyed
// the newest first, and the bench templates it kept, dropped before its one world goes. A take-down that fails is never
// ignored: each part is timed `ok: false` with why, and its failures are handed back for the run's record to fail on.
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
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
 * run's operators owns is touched; one already gone is no failure.
 */
export const destroyStrays = (stages: ReadonlyArray<string>, owners: ReadonlyArray<string>) =>
  Effect.forEach(stages, (stage) =>
    World.open(stage).pipe(
      Effect.flatMap((world) => (Arr.contains(owners, world.owner) ? destroyAll([stage]) : Effect.succeed(true))),
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
 * Drops the bench templates `templates` as world `one`, then destroys `stages` (the one world among them), each part
 * timed. Never fails: what could not be done (a template still on the bench, a world not destroyed, its sites'
 * removal included) is handed back, one line each, with how long the destroy took.
 */
export const takeDownWorlds = (
  one: Option.Option<string>,
  templates: ReadonlyArray<string>,
  stages: ReadonlyArray<string>,
  timings: Timings,
) =>
  Effect.gen(function* () {
    const dropped = Option.isNone(one)
      ? []
      : yield* Effect.forEach(templates, (template) =>
          failedAs(
            `bench template ${template} not dropped`,
            timings.timed(
              `drop bench template ${template}`,
              { of: one.value },
              World.dropSitesTemplate(one.value, template),
            ),
          ),
        );
    const began = yield* Clock.currentTimeMillis;
    const destroyed = Arr.isReadonlyArrayEmpty(stages)
      ? []
      : yield* failedAs(
          "world destroy failed",
          timings.timed("world destroy", { of: Arr.join(stages, ", ") }, destroyEach(stages)),
        );
    return { failed: [...Arr.flatten(dropped), ...destroyed], destroyMs: (yield* Clock.currentTimeMillis) - began };
  });

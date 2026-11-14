// What a run reads and removes of the stages it made: where Core ran, what the accounts still hold of them, and their
// destroy, newest first (src/worlds/run.ts, timing.ts and src/shared/make.ts use these).
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { describe } from "../failure.ts";
import type { Inventory } from "../world/leftovers.ts";

/** The label of where Core ran, when a host runs it off Cloudflare (src/local/host.ts); undefined on Cloudflare. */
export const coreLabel = Effect.map(World.CoreHost, (host) => Option.getOrUndefined(Option.map(host, (h) => h.label)));

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

/** Destroys `stages`, the newest first, so a world restored from a snapshot goes before the world it came from. */
export const destroyAll = (stages: ReadonlyArray<string>) =>
  Effect.forEach(Arr.reverse(stages), (stage) =>
    World.destroy(stage).pipe(
      Effect.exit,
      Effect.tap((gone) =>
        Exit.isFailure(gone) ? Effect.logError(`world ${stage}: destroy failed: ${describe(gone.cause)}`) : Effect.void,
      ),
      Effect.map(Exit.isSuccess),
    ),
  ).pipe(Effect.map(Arr.every((gone) => gone)));

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

// How many worlds and company sites a run in one shared world has at once (roadmap 4.8 b; RUNNER_SHAPE=shared). Every
// journey starts at once; these two bounds are what hold the run back. Worlds: the run's own shared world and each
// world-level journey's worlds, under the smaller of `RUNNER_WORLDS_AT_ONCE` (Neon's concurrently active computes,
// shared by every run; its documented default is 20) and the cluster's capacity (not its free places: the cluster's
// ledger is not read). Sites: the companies being founded
// at once, under `RUNNER_SITES_AT_ONCE`, the bench's ready blank copies (packages/platform, DOOR_BLANK_POOL_SIZE).
//
// A journey takes everything it needs at once, before it starts, and gives it back when its worlds are destroyed: two
// journeys each holding part of what they need and waiting for the rest would wait for ever. A journey that needs more
// than the bound can ever give fails at once, by name. Each wait is a timed part (`world place`, `site slot`), so the
// record shows whether it is on the run's critical path.
//
// Each journey with worlds of its own has two operators of its own, named for it (owners.ts), so its worlds fill quotas
// of 5 no other journey's do (two operators and inventory each fill one): the bound (15, less the shared world) holds
// every such journey at once. Before, they shared the run's operators, the bound kept them one after another, and the
// first operator's quota also held the shared world (world run 43782964738: inventory's WorldQuotaReached at 5 of 5).
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { RunnerFailure } from "../failure.ts";
import type { Timings } from "../timings.ts";

/** What one bound gives: `held(n)` runs an effect holding `n` places, waiting for them as one. */
export interface Bound {
  readonly size: number;
  readonly held: (
    journey: string,
    n: number,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | RunnerFailure, R>;
}

/** The two bounds of a run in one shared world. */
export interface Places {
  readonly worlds: Bound;
  readonly sites: Bound;
}

/** A bound of `size` places, its waits timed as `part`; `what` names a place in a failure. */
const boundOf = (size: number, part: string, what: string, timings: Timings) =>
  Effect.map(Semaphore.make(size), (semaphore): Bound => ({
    size,
    held: (journey, n) => (effect) =>
      n === 0
        ? effect
        : n > size
          ? Effect.fail(
              RunnerFailure.make({
                step: "places",
                message: `${journey} needs ${String(n)} ${what} at once, more than the run's ${String(size)}`,
              }),
            )
          : Effect.acquireUseRelease(
              timings.timed(part, { journey, note: `${String(n)} of ${String(size)}` }, semaphore.take(n)),
              () => effect,
              () => semaphore.release(n),
            ),
  }));

/**
 * The run's places: worlds under the smaller of `worldsAtOnce` and the cluster's `capacity`, sites under
 * `sitesAtOnce`. The shared world is one of the worlds, so it is taken first by whoever makes it.
 */
export const placesOf = (
  settings: { readonly worldsAtOnce: number; readonly sitesAtOnce: number },
  capacity: number,
  timings: Timings,
) =>
  Effect.all({
    worlds: boundOf(Math.max(0, Math.min(settings.worldsAtOnce, capacity)), "world place", "worlds", timings),
    sites: boundOf(Math.max(0, settings.sitesAtOnce), "site slot", "company sites", timings),
  }).pipe(Effect.map((bounds): Places => bounds));

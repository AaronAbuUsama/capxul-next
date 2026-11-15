// Destroys one world by name, from the shared state alone.
import * as Effect from "effect/Effect";
import { Timeouts } from "./values.ts";
import { makeStopwatch } from "../../common/stopwatch.ts";
import { mustExist, takeDown } from "./take-down.ts";

/** Destroys a world by name, from the shared state alone, and gives its name back. */
export const destroy = (name: string) =>
  Effect.gen(function* () {
    const stage = yield* mustExist(name);
    const watch = yield* makeStopwatch(yield* Timeouts);
    const resourcesDestroyed = yield* takeDown(stage, watch);
    return { world: stage, resourcesDestroyed, ms: yield* watch.durations };
  }).pipe(Effect.withSpan("world.destroy", { attributes: { world: name } }));

// What a scenario is handed as its starting world's facts (`Given`). The runner does not make starting worlds yet
// (roadmap step 1.12): every scenario runs in a fresh, empty stage. So it hands the facts it truly has, those of
// `nothing` (the two operators' names), and otherwise one of two things, as the run asks: the starting world's
// declared example facts, for a run that expects Core's empty handlers, where a scenario must only reach its first
// call; or a defect naming what is missing, for a run that expects to pass, where invented facts would mislead.
import { startingWorlds, type StartingWorld } from "@capxul/blueprint";
import { Given } from "@capxul/scenarios";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** How the runner hands facts it did not make: the declared examples, or not at all. */
export type Handing = "examples" | "made only";

/** The two operators the run signs in as, by the names the platform gives them. */
export interface Operators {
  readonly first: string;
  readonly second: string;
}

/** `Given` for a scenario of `world`. */
export const givenFor = (world: StartingWorld, operators: Operators, handing: Handing): Layer.Layer<Given> =>
  Layer.succeed(Given, {
    world,
    facts:
      world === startingWorlds.nothing
        ? Effect.succeed({ operators, calls: [] })
        : handing === "examples"
          ? Effect.succeed(world.example)
          : Effect.die(
              `the runner has no facts of the starting world ${world.name}: it makes no starting world before roadmap step 1.12`,
            ),
  });

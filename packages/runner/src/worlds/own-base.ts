// The starting world of a journey in a world of its own (roadmap 4.8, the own-world track): made by its steps from
// what it needs, and no more. A starting world made from `nothing` (`quota-full`: the operator's own live worlds) needs
// no world to begin with, so none is made for it: a fresh world made first would take one of the owner's places, and
// the quota would be filled one short. One made from `fresh` or after it begins in a fresh world of its own.
//
// The seam test/own-base.test.ts drives, written first. What is here is today's behaviour, a stand-in: every own
// journey begins in a fresh world. The runner's builder replaces it, and side-by-side.ts builds own journeys with it.
import { startingWorlds, type StartingWorld } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import type { RunnerFailure } from "../failure.ts";
import type { Making, Steps } from "./makers.ts";
import { stepsOf } from "./starting.ts";

/** One making of `world` from `from` by its steps, recorded as the run records each (making.ts, `recorder`). */
export type RunSteps<R> = (world: StartingWorld, steps: Steps, from: Making) => Effect.Effect<Making, RunnerFailure, R>;

/** The chain of starting worlds `world` is made from, `nothing` and `fresh` left out, the first first. */
const chainOf = (world: StartingWorld): ReadonlyArray<StartingWorld> =>
  world === startingWorlds.nothing || world === startingWorlds.fresh
    ? []
    : [...(world.from === null ? [] : chainOf(world.from)), world];

/** `world` made by its steps for a journey in a world of its own, from `nothing` (the run's operators, no world). */
export const ownBeginning = <R>(
  world: StartingWorld,
  nothing: Making,
  run: RunSteps<R>,
): Effect.Effect<Making, RunnerFailure, R> =>
  Effect.flatMap(stepsOf(startingWorlds.fresh), (fresh) =>
    Effect.flatMap(run(startingWorlds.fresh, fresh, nothing), (base) =>
      Effect.reduce(
        chainOf(world),
        () => base,
        (from, each) => Effect.flatMap(stepsOf(each), (steps) => run(each, steps, from)),
      ),
    ),
  );

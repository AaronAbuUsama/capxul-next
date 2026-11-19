// How a run starts its journeys around the shared world's preparation (roadmap 4.8, the own-world track's A-1): a
// journey in a world of its own needs nothing of the shared world, so it starts at once; a journey of the shared world
// waits for it to be made and to answer steadily, and that wait is a timed part of its own (`shared world`, the span
// `journey.run.shared`). A preparation that failed fails only the shared world's journeys, each by name.
//
// The seam test/own-world-start.test.ts drives, written first. What is here is today's behaviour, a stand-in: every
// journey waits for the preparation, and none is timed waiting. The runner's builder replaces it and runs the run's
// journeys through it (worlds/run.ts).
import type { Journey } from "@capxul/scenarios";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, type RunnerFailure } from "../failure.ts";
import type { Timings } from "../timings.ts";

export interface JourneysOf<A, R> {
  /** The shared world made and answering steadily: the run's preparation. */
  readonly prepare: Effect.Effect<void, RunnerFailure, R>;
  readonly journeys: ReadonlyArray<Journey>;
  readonly timings: Timings;
  /** One journey run to its record. */
  readonly run: (journey: Journey) => Effect.Effect<A, never, R>;
  /** The record of a shared world's journey that could not start because the preparation failed, and why. */
  readonly notMade: (journey: Journey, why: string) => A;
}

/** Every journey's record, in the order given, each journey started as its world allows. */
export const journeysOf = <A, R>(of: JourneysOf<A, R>): Effect.Effect<ReadonlyArray<A>, never, R> =>
  Effect.flatMap(Effect.exit(of.prepare), (prepared) =>
    Effect.forEach(
      of.journeys,
      (journey) =>
        Exit.isFailure(prepared) && journey.world === "shared"
          ? Effect.succeed(of.notMade(journey, describe(prepared.cause)))
          : of.run(journey),
      { concurrency: "unbounded" },
    ),
  );

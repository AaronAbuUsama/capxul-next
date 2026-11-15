// The fleet hub a run's one world lives on (packages/world, src/things/cluster; roadmap 1.15 and 1.18). The hub is the one
// `WORLD_HUB` names, which run.sh sets to a fresh name for each run unless it is given: a hub that does not exist yet
// is brought up for the run, with the run's owner and `RUNNER_HUB_LIFETIME`, and taken down when the run ends,
// whatever happened, once every world on it is gone. A hub that already exists is used as it is and left up. With
// RUNNER_TEARDOWN=job a hub the run brought up is left up too, for CI's teardown job to take down after the worlds.
import * as World from "@capxul/world";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { RunnerFailure, describe } from "../failure.ts";
import type { Settings } from "../settings.ts";
import type { Timings } from "../timings.ts";

/** What the run did with its hub: its stage, and whether the run brought it up (and so takes it down). */
export interface HubUse {
  readonly stage: string;
  readonly broughtUp: boolean;
}

/** Runs `use` on the run's hub, bringing it up first and taking it down after when it did not exist. */
export const onHub = <A, E, R>(settings: Settings, timings: Timings, use: (hub: HubUse) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const stage = yield* World.HubStage.pipe(Effect.orDie);
    const there = Option.isSome(yield* Effect.option(World.openHub(stage)));
    const hub: HubUse = { stage, broughtUp: !there };
    const up = there
      ? Effect.void
      : timings.timed(
          "hub up",
          { of: stage },
          World.hubUp({ stage, owner: settings.owner, lifetime: settings.hubLifetime }).pipe(
            Effect.mapError((error) => RunnerFailure.make({ step: "hub", message: describe(Cause.fail(error)) })),
          ),
        );
    const down = there
      ? Effect.void
      : settings.teardown === "job"
        ? Effect.log(`hub ${stage}: left up for the teardown job`)
        : timings
            .timed(
              "hub down",
              { of: stage },
              World.hubDown(stage).pipe(
                Effect.mapError((error) => RunnerFailure.make({ step: "hub", message: describe(Cause.fail(error)) })),
              ),
            )
            .pipe(Effect.catchCause((cause) => Effect.logError(`hub ${stage}: down failed: ${describe(cause)}`)));
    return yield* Effect.andThen(up, use(hub)).pipe(Effect.ensuring(down));
  });

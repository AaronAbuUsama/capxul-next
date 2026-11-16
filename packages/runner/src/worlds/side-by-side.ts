// A run with every journey at once in one shared world (RUNNER_SHAPE=shared; roadmap 4.8, decision D8). It is the
// serial run's loop (worlds/run.ts) with these starting worlds in place of the reset ones (starting.ts):
//
// - one shared world, made once by `fresh`'s maker in the run's preparation, and never reset or saved;
// - a journey of the shared world (`world: "shared"`) builds its starting world by its steps in it, from `fresh` on;
// - a journey about worlds (`world: "own"`) builds its starting world in a fresh world of its own, made for it;
// - a company founded on the way holds one of the bench's site slots while it is built, and a journey holds its
//   worlds' places for as long as it runs (places.ts): the shared world's place is taken off the bound at the start.
//
// Until each journey has its own cast (4.11, scenarios' `Casting`), two journeys of the shared world found the same
// company and meet each other; RUNNER_SHAPE stays `serial` by default until then.
import { startingWorlds, type OperationName, type StartingWorld } from "@capxul/blueprint";
import type { Journey } from "@capxul/scenarios";
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import type { Call } from "../client.ts";
import { describe, RunnerFailure } from "../failure.ts";
import type { Settings } from "../settings.ts";
import type { Timings } from "../timings.ts";
import { companyMakers } from "./company.ts";
import type { Making } from "./makers.ts";
import { JourneyMaking, nothingOf, recorder, targetOf, type MakingCall, type Needs } from "./making.ts";
import { placesOf, type Places } from "./places.ts";
import { Platform } from "./platform.ts";
import { destroyStrays } from "./teardown.ts";
import { stepsOf } from "./starting.ts";

/** The worlds a journey holds at its peak beside the shared one, as it declares them (0 until it does). */
export const worldsOf = (journey: Journey): number =>
  Predicate.hasProperty(journey, "worlds") && Predicate.isNumber(journey.worlds) ? journey.worlds : 0;

/** The chain of starting worlds `world` is made from, `nothing` and `fresh` left out, the first first. */
const chainOf = (world: StartingWorld): ReadonlyArray<StartingWorld> =>
  world === startingWorlds.nothing || world === startingWorlds.fresh
    ? []
    : [...(world.from === null ? [] : chainOf(world.from)), world];

/** True when making `world` founds a company, which takes one of the bench's ready sites. */
const foundsCompany = (world: StartingWorld): boolean =>
  Arr.some(chainOf(world), (each) => Rec.has(companyMakers, each.name));

/** The places a journey holds for as long as it runs: its own world, when it has one, and the worlds it declares. */
export const aroundJourney =
  (places: Places, journey: Journey) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(places.worlds.held(journey.name, (journey.world === "own" ? 1 : 0) + worldsOf(journey)));

/** The starting worlds of a run in one shared world; `places` bound the worlds and sites it holds at once. */
export const sideBySideOf = (settings: Settings, platformUrl: string, places: Places) =>
  Effect.flatMap(Ref.make<ReadonlyArray<MakingCall>>([]), (made) =>
    Effect.flatMap(Ref.make<Option.Option<string>>(Option.none()), (one) => {
      const run = recorder(targetOf(settings, platformUrl), made);
      const nothing = nothingOf(settings);
      /** `world` made by its steps on `base`, the chain from `fresh` on, its company's site slot held. */
      const build = (world: StartingWorld, base: Making, journey: string) =>
        Effect.reduce(
          chainOf(world),
          () => base,
          (from, each) => Effect.flatMap(stepsOf(each), (steps) => run(each, steps, from)),
        ).pipe(foundsCompany(world) ? places.sites.held(journey, 1) : (effect) => effect);
      const freshWorld = Effect.flatMap(stepsOf(startingWorlds.fresh), (steps) =>
        run(startingWorlds.fresh, steps, nothing),
      );
      return Effect.map(
        Effect.cached(Effect.tap(freshWorld, (making) => Ref.set(one, Option.fromNullishOr(making.own?.world)))),
        (sharedWorld) => {
          /** A journey's starting world: in the shared world, or in a fresh world of its own for one about worlds. */
          const forScenario = (world: StartingWorld): Effect.Effect<Making, RunnerFailure, Needs> =>
            world === startingWorlds.nothing
              ? Effect.succeed(nothing)
              : Effect.flatMap(Effect.serviceOption(JourneyMaking), (making) => {
                  const journey = Option.flatMap(making, (each) => Option.fromNullishOr(each.journey));
                  const own = Option.exists(journey, (each) => each.world === "own");
                  const name = Option.match(journey, { onNone: () => world.name, onSome: (each) => each.name });
                  return Effect.flatMap(own ? freshWorld : sharedWorld, (base) => build(world, base, name));
                });

          return {
            around: (journey: Journey) => aroundJourney(places, journey),
            /** The shared world, made once before any journey. */
            prepare: (_worlds: ReadonlyArray<StartingWorld>) => Effect.asVoid(sharedWorld),
            /** Nothing is reset: each journey builds its own starting world. */
            resetFor: (_world: StartingWorld, _journey: string) => Effect.void,
            forScenario,
            oneWorld: Effect.flatMap(Ref.get(one), Effect.fromOption).pipe(
              Effect.mapError(() =>
                RunnerFailure.make({ step: "starting world", message: "the shared world was not made" }),
              ),
            ),
            templateWorlds: Effect.map(Ref.get(one), (name) =>
              Option.isSome(name) ? [World.stageOf(name.value)] : [],
            ),
            kept: Effect.succeed<ReadonlyArray<string>>([]),
            made: Ref.get(made),
          };
        },
      );
    }),
  );

export type SideBySide = Effect.Success<ReturnType<typeof sideBySideOf>>;

/** The operations that make a world: their answers name it. */
const MAKES_A_WORLD: Partial<Record<OperationName, true>> = { "world.create": true, "world.snapshot.restore": true };

/** The worlds, by stage, that `calls` made: every world.create and world.snapshot.restore that answered one. */
export const madeWorldsOf = (calls: ReadonlyArray<Call>): ReadonlyArray<string> =>
  Arr.flatMap(calls, (call) =>
    MAKES_A_WORLD[call.operation] === true
      ? Option.match(call.success, {
          onNone: () => [],
          onSome: (answer) =>
            Predicate.hasProperty(answer, "world") && Predicate.isString(answer.world)
              ? [World.stageOf(answer.world)]
              : [],
        })
      : [],
  );

/**
 * The places of a run in one shared world: worlds under the smaller of the setting and the cluster's capacity, less
 * the shared world's own place, held for the whole run; sites under the setting (places.ts).
 */
export const placesForRun = (settings: Settings, cluster: string, timings: Timings) =>
  World.openHub(cluster).pipe(
    Effect.map((hub) => hub.capacity),
    Effect.orElseSucceed(() => settings.worldsAtOnce),
    Effect.flatMap((capacity) =>
      placesOf({ ...settings, worldsAtOnce: settings.worldsAtOnce - 1 }, capacity - 1, timings),
    ),
  );

/**
 * Side by side, the worlds the journeys made by their own steps (not their starting worlds, which each journey
 * destroys) are destroyed once every journey has ended: every world the platform made or tried this run but the
 * shared world, when one of the run's operators owns it. One after another, each journey destroys its own: nothing.
 */
export const sweepOf = (settings: Settings, templateWorlds: Effect.Effect<ReadonlyArray<string>>) =>
  settings.shape === "shared"
    ? Effect.flatMap(Effect.service(Platform), (platform) =>
        Effect.all([platform.made, platform.tried, templateWorlds]).pipe(
          Effect.flatMap(([made, tried, shared]) =>
            destroyStrays(
              Arr.filter(Arr.dedupe([...made, ...tried]), (stage) => !Arr.contains(shared, stage)),
              [settings.owner, settings.secondOwner],
            ),
          ),
          Effect.asVoid,
          Effect.catchCause((cause) => Effect.logError(`the side-by-side sweep did not finish: ${describe(cause)}`)),
        ),
      )
    : Effect.void;

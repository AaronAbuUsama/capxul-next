// A run with every journey at once in one shared world (RUNNER_SHAPE=shared; roadmap 4.8, decision D8). It is the
// serial run's loop (worlds/run.ts) with these starting worlds in place of the reset ones (starting.ts):
//
// - one shared world, made once by `fresh`'s maker in the run's preparation, and never reset or saved;
// - a journey of the shared world (`world: "shared"`) builds its starting world by its steps in it, from `fresh` on;
// - a journey about worlds (`world: "own"`) builds its starting world in a fresh world of its own, made for it, through
//   a platform of its own whose two operators are named for it (owners.ts), so its worlds fill quotas of their own;
// - a company founded on the way holds one of the bench's site slots while it is built, and a journey holds its
//   worlds' places for as long as it runs (places.ts): the shared world's place is taken off the bound at the start.
//
// Each journey is played by its own cast (4.11): the people every world makes for its key, and its own company handle,
// so journeys side by side never found the same company or share a person's Safe. RUNNER_SHAPE stays `serial` by
// default until a world run proves `shared`.
import { startingWorlds, type StartingWorld } from "@capxul/blueprint";
import { Casting, declaredCast, type Journey, type JourneyKey } from "@capxul/scenarios";
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import { describe, RunnerFailure } from "../failure.ts";
import type { Settings } from "../settings.ts";
import type { Timings } from "../timings.ts";
import { companyMakers } from "./company.ts";
import type { Making } from "./makers.ts";
import { JourneyMaking, nothingOf, recorder, targetOf, type MakingCall, type Needs } from "./making.ts";
import { ownersOf, runOwns } from "./owners.ts";
import { placesOf, type Places } from "./places.ts";
import { Platform, platformOfJourney } from "./platform.ts";
import { destroyStrays } from "./teardown.ts";
import { stepsOf } from "./starting.ts";
import { answersSteadily, type Readiness } from "../world/warmup.ts";

/** The chain of starting worlds `world` is made from, `nothing` and `fresh` left out, the first first. */
const chainOf = (world: StartingWorld): ReadonlyArray<StartingWorld> =>
  world === startingWorlds.nothing || world === startingWorlds.fresh
    ? []
    : [...(world.from === null ? [] : chainOf(world.from)), world];

/** True when making `world` founds a company, which takes one of the bench's ready sites. */
const foundsCompany = (world: StartingWorld): boolean =>
  Arr.some(chainOf(world), (each) => Rec.has(companyMakers, each.name));

/** The places a journey holds from its start until its worlds are destroyed: the worlds it declares (`worlds`). */
export const aroundJourney =
  (places: Places, journey: Journey, settings: Settings) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      // A journey with worlds of its own calls a platform of its own, its operators named for it, for as long as it runs.
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the journey's own platform is built for its one journey and closed with it
      Effect.provide(platformOfJourney(journey.world === "own", ownersOf(settings, journey.key))),
      // A journey that needs more than the run can ever hold takes nothing: it fails into its own record (`tooMany`).
      journey.worlds > places.worlds.size ? (each) => each : places.worlds.held(journey.name, journey.worlds),
      // Each journey is played by its own cast, as the blueprint declares it and the world makes it (4.11): its
      // starting world's makers (company.ts) and its steps (scenarios' cast.ts) read it.
      Effect.provideService(Casting, CAST_AS_DECLARED),
    );

/** Every journey cast as the blueprint declares it: the people every world makes for it, and its company's handle. */
const CAST_AS_DECLARED = { castOf: (key: JourneyKey) => Effect.succeed(declaredCast(key)) };

/** The starting worlds of a run in one shared world; `places` bound the worlds and sites it holds at once. */
export const sideBySideOf = (settings: Settings, platformUrl: string, places: Places) =>
  Effect.flatMap(Ref.make<ReadonlyArray<MakingCall>>([]), (made) =>
    Effect.flatMap(Ref.make<Option.Option<string>>(Option.none()), (one) =>
      Effect.flatMap(Ref.make<Option.Option<Readiness>>(Option.none()), (ready) => {
        const run = recorder(targetOf(settings, platformUrl), made);
        const nothing = nothingOf(settings);
        /** `world` made by its steps on `base`, the chain from `fresh` on, its company's site slot held. */
        const build = (by: typeof run, world: StartingWorld, base: Making, journey: string) =>
          Effect.reduce(
            chainOf(world),
            () => base,
            (from, each) => Effect.flatMap(stepsOf(each), (steps) => by(each, steps, from)),
          ).pipe(foundsCompany(world) ? places.sites.held(journey, 1) : (effect) => effect);
        const freshWorld = Effect.flatMap(stepsOf(startingWorlds.fresh), (steps) =>
          run(startingWorlds.fresh, steps, nothing),
        );
        return Effect.map(
          Effect.cached(Effect.tap(freshWorld, (making) => Ref.set(one, Option.fromNullishOr(making.own?.world)))),
          (sharedWorld) => {
            /** A journey's starting world: in the shared world, or in a fresh world of its own for one about worlds. */
            const forScenario = (world: StartingWorld): Effect.Effect<Making, RunnerFailure, Needs | Platform> =>
              world === startingWorlds.nothing
                ? Effect.succeed(nothing)
                : Effect.flatMap(Effect.serviceOption(JourneyMaking), (making) => {
                    const journey = Option.flatMap(making, (each) => Option.fromNullishOr(each.journey));
                    const name = Option.match(journey, { onNone: () => world.name, onSome: (each) => each.name });
                    const own = Option.filter(journey, (each) => each.world === "own");
                    return Option.match(own, {
                      onNone: () => Effect.flatMap(sharedWorld, (base) => build(run, world, base, name)),
                      // Through the journey's own platform (`around`), from `nothing` as its own operators see it.
                      onSome: (each) =>
                        Effect.flatMap(Effect.service(Platform), (platform) => {
                          const by = recorder(targetOf(settings, platform.url), made);
                          const mine = nothingOf(ownersOf(settings, each.key));
                          return Effect.flatMap(stepsOf(startingWorlds.fresh), (steps) =>
                            by(startingWorlds.fresh, steps, mine),
                          ).pipe(Effect.flatMap((base) => build(by, world, base, name)));
                        }),
                    });
                  });

            return {
              around: (journey: Journey) => aroundJourney(places, journey, settings),
              /** The settings a journey runs with: a journey with worlds of its own, its own operators (owners.ts). */
              settingsFor: (journey: Journey): Settings =>
                journey.world === "own" ? ownersOf(settings, journey.key) : settings,
              /** Why `journey` cannot run here: it needs more worlds at once than the run holds; null when it fits. */
              tooMany: (journey: Journey): string | null =>
                journey.worlds > places.worlds.size
                  ? `${journey.name} needs ${String(journey.worlds)} worlds at once, more than the run's ${String(places.worlds.size)}`
                  : null,
              /** The shared world, made once before any journey, and waited for until it answers steadily, once. */
              prepare: (_worlds: ReadonlyArray<StartingWorld>) =>
                Effect.flatMap(sharedWorld, (making) =>
                  Option.match(Option.fromNullishOr(making.own), {
                    onNone: () => Effect.void,
                    onSome: (own) =>
                      World.open(own.world).pipe(
                        Effect.orDie,
                        Effect.flatMap((world) =>
                          answersSteadily(world.coreUrl, {
                            answers: settings.readyAnswers,
                            every: settings.probeEvery,
                            warmUp: settings.warmUp,
                          }),
                        ),
                        Effect.flatMap((readiness) => Ref.set(ready, Option.some(readiness))),
                      ),
                  }),
                ),
              /** The shared world's readiness, measured once in the run's preparation; none for any other world. */
              readyOf: (stage: string) =>
                Effect.map(Effect.all([Ref.get(one), Ref.get(ready)]), ([name, readiness]) =>
                  Option.isSome(name) && World.stageOf(name.value) === stage ? readiness : Option.none<Readiness>(),
                ),
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
    ),
  );

export type SideBySide = Effect.Success<ReturnType<typeof sideBySideOf>>;

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
              runOwns(settings),
            ),
          ),
          Effect.asVoid,
          Effect.catchCause((cause) => Effect.logError(`the side-by-side sweep did not finish: ${describe(cause)}`)),
        ),
      )
    : Effect.void;

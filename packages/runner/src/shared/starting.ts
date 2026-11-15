// Starting worlds for a run on a shared world (roadmap steps 2.3 and 2.4): the same answers as the run's one world
// gives (worlds/starting.ts), but nothing is made in the shared world and it is never reset, because other callers
// use it. The shared world holds a template snapshot of each starting world its journeys start from, made once by its
// steps when the shared world was made (shared/make.ts), with the facts its maker answered kept beside it
// (shared/facts.ts). Before each journey whose starting world is made from a template, that snapshot is restored into
// a new private world of the run (`world.snapshot.restore`, decisions.md 17, 18 and 27), which the run destroys after
// the journey as it destroys every world a journey makes. A starting world made by its steps from nothing
// (`quota-full`) needs no template, and is made by its steps as in the one world.
import { startingWorlds, type StartingWorld } from "@capxul/blueprint";
import { Capxul } from "@capxul/scenarios";
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { describe, RunnerFailure } from "../failure.ts";
import { freshName } from "../run.ts";
import type { Settings } from "../settings.ts";
import type { Timings } from "../timings.ts";
import { encodeAnswer } from "../worlds/encode.ts";
import { SCENARIO_MINUTES, type Making, type Steps } from "../worlds/makers.ts";
import { callsOf, nothingOf, recorder, targetOf, type MakingCall, type Needs } from "../worlds/making.ts";
import { stepsOf } from "../worlds/starting.ts";
import { factsIn, keptNames } from "./facts.ts";

const failed = (message: string) => RunnerFailure.make({ step: "starting world", message });
const asFailure = (error: unknown) => failed(Cause.fail(error).pipe(describe));

/** Whether a journey of `world` starts in a world made from a template: it or a world it is made from is. */
export const needsTemplate = (world: StartingWorld): boolean =>
  world.made === "from its template" || (world.from !== null && needsTemplate(world.from));

/** The nearest starting world `world` is made from, itself included, that is made from its template. */
export const templateOf = (world: StartingWorld): Option.Option<StartingWorld> =>
  world.made === "from its template"
    ? Option.some(world)
    : world.from === null
      ? Option.none()
      : templateOf(world.from);

const MINUTE = 60_000;
/** Room left between a restored world's expiry and the shared world's, which a restore may not pass. */
const ROOM_MINUTES = 5;

/** The steps of a restore of `shared`'s snapshot `template` into a new world of the run. */
const restoreOf =
  (shared: string, template: StartingWorld, minutes: number): Steps =>
  (making) =>
    Effect.gen(function* () {
      const capxul = yield* Capxul;
      const as = yield* freshName("sj");
      const made = yield* capxul["world.snapshot.restore"]({
        world: shared,
        snapshot: template.name,
        as,
        lifetimeMinutes: minutes,
      }).pipe(
        Effect.mapError((error) => failed(`the restore of ${shared}'s ${template.name} was refused: ${error._tag}`)),
      );
      return {
        facts: { ...making.facts, world: yield* encodeAnswer("world.snapshot.restore", made) },
        own: { world: made.world, door: made.door },
      };
    });

/**
 * What hands the starting worlds of a run on the shared world `shared`. It makes nothing in the shared world:
 * `templateWorlds` and `kept` are empty, so the run destroys only the worlds it restored and made.
 */
export const sharedStartingWorldsOf = Effect.fn("runner.sharedStartingWorlds")(function* (
  settings: Settings,
  platformUrl: string,
  timings: Timings,
  shared: string,
) {
  const made = yield* Ref.make<ReadonlyArray<MakingCall>>([]);
  const held = yield* Ref.make<ReadonlyArray<string>>([]);
  const restored = yield* Ref.make(new Map<string, Making>());
  const run = recorder(targetOf(settings, platformUrl), made);
  const nothing = nothingOf(settings);

  /** Reads which templates the shared world holds; a journey of one it lacks fails at its restore, naming it. */
  const prepare = (_worlds: ReadonlyArray<StartingWorld>) =>
    Effect.gen(function* () {
      const world = yield* World.open(shared).pipe(Effect.mapError(asFailure));
      yield* Ref.set(held, yield* keptNames(world));
    });

  /** A journey's starting world restored from the shared world's template of it, with the facts its maker kept. */
  const restore = (template: StartingWorld) =>
    Effect.gen(function* () {
      if (!Arr.contains(yield* Ref.get(held), template.name))
        return yield* failed(`the shared world ${shared} holds no template of ${template.name}`);
      const source = yield* World.open(shared).pipe(Effect.mapError(asFailure));
      const left =
        DateTime.toEpochMillis(DateTime.makeUnsafe(source.expiresAt)) - DateTime.toEpochMillis(yield* DateTime.now);
      const minutes = Math.min(SCENARIO_MINUTES, Math.floor(left / MINUTE) - ROOM_MINUTES);
      if (minutes < 1)
        return yield* failed(`the shared world ${shared} expires at ${source.expiresAt}: renew it first`);
      const making = yield* run(template, restoreOf(shared, template, minutes), nothing);
      const own = yield* Effect.fromOption(Option.fromNullishOr(making.own)).pipe(
        Effect.mapError(() => failed("the restore made no world")),
      );
      const world = yield* World.open(own.world).pipe(Effect.mapError(asFailure));
      const kept = yield* factsIn(world, template.name);
      if (Option.isNone(kept)) return yield* failed(`${own.world} holds no facts of ${template.name}`);
      // The maker's facts as the template holds them, with the run's operators, the restore's answer as the world
      // the journey runs in (decisions.md, 39), and the restore after the calls that made the template.
      const facts = {
        ...kept.value,
        operators: nothing.facts["operators"],
        world: making.facts["world"],
        calls: [...callsOf(kept.value), ...callsOf(making.facts)],
      };
      return { facts, own } satisfies Making;
    });

  /** Before a journey: its starting world's template restored into a world of the run, when it starts from one. */
  const resetFor = (world: StartingWorld, journey: string) =>
    Option.match(templateOf(world), {
      onNone: () => Effect.void,
      onSome: (template) =>
        timings
          .timed("restore", { journey, of: `${shared}/${template.name}` }, restore(template), (making) => ({
            note: `into ${making.own.world}`,
          }))
          .pipe(Effect.flatMap((making) => Ref.update(restored, (all) => new Map([...all, [template.name, making]])))),
    });

  /** The starting world of one journey: the restored template's facts, or made by its steps from it. */
  const forScenario = (world: StartingWorld): Effect.Effect<Making, RunnerFailure, Needs> =>
    Effect.gen(function* () {
      if (world === startingWorlds.nothing) return nothing;
      if (world.made === "from its template") {
        const found = (yield* Ref.get(restored)).get(world.name);
        if (found === undefined) return yield* failed(`${world.name} was not restored from ${shared}`);
        return found;
      }
      const from = world.from === null ? nothing : yield* forScenario(world.from);
      return yield* run(world, yield* stepsOf(world), from);
    });

  return {
    prepare,
    resetFor,
    forScenario,
    oneWorld: Effect.succeed(shared),
    templateWorlds: Effect.succeed<ReadonlyArray<string>>([]),
    kept: Effect.succeed<ReadonlyArray<string>>([]),
    made: Ref.get(made),
  };
});

export type SharedStartingWorlds = Effect.Success<ReturnType<typeof sharedStartingWorldsOf>>;

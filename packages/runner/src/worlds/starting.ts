// Starting worlds for a run in one world (roadmap step 1.18; docs/roadmap.md, "One runner, one world"; decisions.md,
// 27 as amended by 39). The run's one world is the kept template world: `fresh`'s maker creates it, and every starting
// world made "from its template" is made once in it, by its steps, from the one before, in the blueprint's order.
// Each one a journey starts from is saved there as a snapshot of its own name, and a world with a company also keeps
// its sites as a bench template (with a pool of ready copies), so a reset whose point lost its sites claims them
// instead of building them. The template is named by the starting world, the code that made it (`CODE`) and the one
// world, whose company facts it holds (packages/world, src/things/site-template/sweep.ts): no other run asks for it, the bench
// never changes it, and no run drops it; the sweep removes it by age (docs/roadmap.md, "Bench templates never
// change"). Before each journey the world is reset in place to its starting world's snapshot (`resetFor`), and a
// starting world made "by its steps" (`quota-full`, `with-snapshot`, `restored`) is then made from there. Every call
// made on the way is a fact of the world (`calls`) and is kept for the checks.
import { holdsFactsOf, startingWorlds, type StartingWorld } from "@capxul/blueprint";
import { Capxul } from "@capxul/scenarios";
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { describe, RunnerFailure } from "../failure.ts";
import type { Settings } from "../settings.ts";
import type { Timings } from "../timings.ts";
import { nothingOf, recorder, targetOf, type MakingCall, type Needs } from "./making.ts";
import { makers, waitsOn, type Making } from "./makers.ts";

/** Where the packages are, from this file (src/worlds). */
const PACKAGES = `${import.meta.dirname}/../../..`;

/**
 * The code that makes a starting world's sites, fingerprinted into its template's name: the starting worlds' definitions
 * (the blueprint), Core, which founds the company and writes it to its site, the world, and these makers. The bench's
 * apps are read from its door.
 */
export const CODE = ["blueprint/src", "core/src", "world/src", "runner/src/worlds"] as const;

const fromNothing = (world: StartingWorld) => world.from === null || world.from === startingWorlds.nothing;

/** A starting world's steps, or why the runner cannot make it yet: the operations its steps wait on. */
export const stepsOf = (world: StartingWorld) =>
  Effect.fromOption(Option.fromNullishOr(makers[world.name])).pipe(
    Effect.mapError(() =>
      RunnerFailure.make({
        step: "starting world",
        message: `the runner has no maker for ${world.name} yet; its steps, and its ancestors', call ${Arr.join(waitsOn(world), ", ")}`,
      }),
    ),
  );

/**
 * The snapshot of the one world a journey of `world` starts from: the nearest starting world it is made from, itself
 * included, that is made "from its template"; `fresh`, the world as created, for one made from nothing by its steps
 * (`quota-full`, whose operator's worlds are made by its steps beside the one world).
 */
export const anchorOf = (world: StartingWorld): StartingWorld =>
  world.made === "from its template"
    ? world
    : world.from === null || world.from === startingWorlds.nothing
      ? startingWorlds.fresh
      : anchorOf(world.from);

/**
 * What makes the starting worlds of one run in its one world. `templateWorlds` is the one world, by stage, which the
 * run destroys at its end; `kept` the bench template it kept of each starting world, which outlives the run.
 */
export const startingWorldsOf = Effect.fn("runner.startingWorlds")(function* (
  settings: Settings,
  platformUrl: string,
  timings: Timings,
) {
  const templates = yield* Ref.make(new Map<string, Making>());
  // What a journey of a saved starting world is handed: the world as its snapshot holds it, so without the save's own
  // call, whose event is written after the snapshot is taken and is gone once the world is reset to it. The world
  // made on from it (`templates`) keeps that call, as its record keeps the event.
  const handed = yield* Ref.make(new Map<string, Making>());
  // A template whose making failed is not made again: its steps may have run half-way in the one world, so a second
  // try would meet what the first left there. Every later journey of it fails with the first failure.
  const unmade = yield* Ref.make(new Map<string, RunnerFailure>());
  const one = yield* Ref.make<Option.Option<string>>(Option.none());
  const kept = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  // Fingerprinted once a run, when the first template is kept.
  const code = yield* Effect.cached(
    World.templateCode(PACKAGES, CODE).pipe(
      Effect.mapError((error) => RunnerFailure.make({ step: "template", message: describe(Cause.fail(error)) })),
    ),
  );
  const toSave = yield* Ref.make<ReadonlyArray<string>>([]);
  const made = yield* Ref.make<ReadonlyArray<MakingCall>>([]);
  const run = recorder(targetOf(settings, platformUrl), made);
  const nothing = nothingOf(settings);

  /** Saves the one world as the snapshot `world.name`, and keeps its sites as a bench template of that starting world. */
  const save = (world: StartingWorld, after: Making) =>
    Effect.gen(function* () {
      const name = after.own?.world ?? "";
      const saved = yield* timings.timed(
        `save ${world.name}`,
        { of: name },
        run(
          world,
          (making) =>
            Effect.gen(function* () {
              const capxul = yield* Capxul;
              yield* capxul["world.snapshot.save"]({
                world: name,
                snapshot: world.name,
                replace: false,
                template: true,
              }).pipe(Effect.mapError((error) => RunnerFailure.make({ step: "template", message: error._tag })));
              return making;
            }),
          after,
        ),
      );
      if (holdsFactsOf(world, startingWorlds.founded)) {
        const fingerprint = yield* code;
        const template = yield* timings.timed(
          `bench template ${world.name}`,
          { of: name },
          World.keepSitesAsTemplate(name, world.name, fingerprint).pipe(
            Effect.mapError((error) => RunnerFailure.make({ step: "template", message: describe(Cause.fail(error)) })),
          ),
          (answer) =>
            Option.isSome(answer)
              ? {
                  parts: { door: answer.value.ms },
                  note: `${answer.value.template}${answer.value.made ? "" : " (kept already)"}`,
                }
              : {},
        );
        if (Option.isSome(template))
          yield* Ref.update(kept, (all) => new Map([...all, [world.name, template.value.template]]));
      }
      return saved;
    });

  /** `world` as made in the one world, and saved there when a journey starts from it. */
  const templateOf = (world: StartingWorld): Effect.Effect<Making, RunnerFailure, Needs> =>
    Effect.gen(function* () {
      const cached = (yield* Ref.get(templates)).get(world.name);
      if (cached !== undefined) return cached;
      const failed = (yield* Ref.get(unmade)).get(world.name);
      if (failed !== undefined)
        return yield* RunnerFailure.make({
          step: failed.step,
          message: `${world.name}'s template was not made earlier in this run: ${failed.message}`,
        });
      const from = fromNothing(world) ? nothing : yield* templateOf(world.from ?? startingWorlds.nothing);
      const steps = yield* stepsOf(world);
      const after = yield* timings.timed(
        fromNothing(world) ? "world create" : `make ${world.name}`,
        { of: world.name },
        run(world, steps, from),
      );
      if (fromNothing(world) && after.own !== null) yield* Ref.set(one, Option.some(after.own.world));
      const saving = Arr.contains(yield* Ref.get(toSave), world.name);
      const done = saving ? yield* save(world, after) : after;
      if (saving) yield* Ref.update(handed, (all) => new Map([...all, [world.name, after]]));
      yield* Ref.update(templates, (all) => new Map([...all, [world.name, done]]));
      return done;
    }).pipe(
      Effect.tapCause((cause) =>
        Ref.update(
          unmade,
          (all) => new Map([...all, [world.name, RunnerFailure.make({ step: "template", message: describe(cause) })]]),
        ),
      ),
    );

  /**
   * Makes, once and in order, every starting world `worlds` start from in the one world, and saves those they reset
   * to. The first made from nothing creates the one world.
   */
  const prepare = (worlds: ReadonlyArray<StartingWorld>) =>
    Effect.gen(function* () {
      const anchors = Arr.dedupeWith(
        Arr.map(worlds, anchorOf),
        (a: StartingWorld, b: StartingWorld) => a.name === b.name,
      );
      yield* Ref.set(
        toSave,
        Arr.map(anchors, (world) => world.name),
      );
      yield* Effect.forEach(anchors, templateOf, { discard: true });
    });

  /** The one world's name, once it is made. */
  const oneWorld = Effect.flatMap(Ref.get(one), (name) =>
    Effect.fromOption(name).pipe(
      Effect.mapError(() =>
        RunnerFailure.make({ step: "starting world", message: "the run's one world was not made" }),
      ),
    ),
  );

  /** Resets the one world in place to the snapshot a journey of `world` starts from; answers the reset's account. */
  const resetFor = (world: StartingWorld, journey: string) =>
    Effect.gen(function* () {
      const to = anchorOf(world).name;
      const name = yield* oneWorld;
      const template = (yield* Ref.get(kept)).get(to);
      return yield* timings.timed(
        "reset",
        { journey, of: to },
        World.reset(name, to, template).pipe(
          Effect.mapError((error) => RunnerFailure.make({ step: "reset", message: describe(Cause.fail(error)) })),
        ),
        (answer) => ({
          parts: answer.ms,
          note:
            answer.sites === null
              ? "no bench"
              : `sites ${answer.sites.how}${answer.sites.removed.length > 0 ? `; removed ${Arr.join(answer.sites.removed, ", ")}` : ""}${answer.sites.claimed.length > 0 ? `; claimed ${Arr.join(answer.sites.claimed, ", ")}` : ""}`,
        }),
      );
    });

  /** The starting world of one journey, once the one world is reset: its template's facts, or made by its steps. */
  const forScenario = (world: StartingWorld): Effect.Effect<Making, RunnerFailure, Needs> =>
    Effect.gen(function* () {
      if (world === startingWorlds.nothing) return nothing;
      if (world.made === "from its template") {
        const template = yield* templateOf(world);
        return (yield* Ref.get(handed)).get(world.name) ?? template;
      }
      const from = world.from === null ? nothing : yield* forScenario(world.from);
      return yield* run(world, yield* stepsOf(world), from);
    });

  return {
    prepare,
    resetFor,
    forScenario,
    oneWorld,
    templateWorlds: Effect.map(Ref.get(one), (name) => (Option.isSome(name) ? [World.stageOf(name.value)] : [])),
    kept: Ref.get(kept),
    made: Ref.get(made),
  };
});

export type StartingWorlds = Effect.Success<ReturnType<typeof startingWorldsOf>>;

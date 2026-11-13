// Starting worlds for a run in private worlds (decisions.md, 27 as amended by 39). `fresh` to `paid` are made once per
// run, one after another in one kept template world, each saved there as a template snapshot named after itself; a
// scenario gets a restore of its world's template into a fresh private world of its own, whose `world` fact is the
// restore's answer. `quota-full`, `with-snapshot` and `restored` are made by their steps for each scenario, from a
// world got the same way. Every call made on the way is a fact of the world (`calls`) and is kept for the checks.
import { startingWorlds, type StartingWorld } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import type * as HttpClient from "effect/http/HttpClient";
import { capxulFor, type Call, type Target } from "../client.ts";
import { RunnerFailure } from "../failure.ts";
import { freshName } from "../run.ts";
import type { Settings } from "../settings.ts";
import { encodeAnswer, madeCallOf, makers, SCENARIO_MINUTES, waitsOn, type Facts, type Making } from "./makers.ts";
import { Capxul } from "@capxul/scenarios";

/** One call made in making a starting world, with the world it was made for: what the starting worlds' record keeps. */
export interface MakingCall {
  readonly world: string;
  readonly call: Call;
}

const callsOf = (facts: Facts): ReadonlyArray<unknown> => {
  const calls = facts["calls"];
  return Arr.isArray(calls) ? calls : [];
};

/** A starting world's steps, or why the runner cannot make it yet: the operations its steps wait on. */
const stepsOf = (world: StartingWorld) =>
  Effect.fromOption(Option.fromNullishOr(makers[world.name])).pipe(
    Effect.mapError(() =>
      RunnerFailure.make({
        step: "starting world",
        message: `the runner cannot make ${world.name} yet: its steps wait on ${Arr.join(waitsOn(world), ", ")}`,
      }),
    ),
  );

/**
 * What makes the starting worlds of one run: its platform's address and the operators' tokens, and what it has made
 * so far. `templates` is every template world it made, which the run destroys at its end.
 */
export const startingWorldsOf = Effect.fn("runner.startingWorlds")(function* (settings: Settings, platformUrl: string) {
  const templates = yield* Ref.make(new Map<string, Making>());
  const templateWorlds = yield* Ref.make<ReadonlyArray<string>>([]);
  const made = yield* Ref.make<ReadonlyArray<MakingCall>>([]);
  const target: Target = {
    // A maker calls a world's operations `at` that world's door; this client's own world is never called.
    url: "http://127.0.0.1:9",
    platformUrl,
    doorToken: Redacted.make("none"),
    platformToken: settings.platformToken,
    secondPlatformToken: Option.getOrNull(settings.secondPlatformToken),
    warmUntil: 0,
    every: settings.probeEvery,
  };

  /** Runs `steps` of `world` from `making`, recording each call, and appends them to the world's `calls`. */
  const run = (
    world: StartingWorld,
    steps: (making: Making) => Effect.Effect<Making, RunnerFailure, Capxul>,
    making: Making,
  ) =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<Call>>([]);
      // Each making is its own program, handed a client of its own, so its calls are recorded apart from any other's.
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- a maker's client is built for its one making and closed with it
      const exit = yield* Effect.exit(steps(making).pipe(Effect.provide(capxulFor(target, log))));
      const calls = yield* Ref.get(log);
      yield* Ref.update(made, (all) => [...all, ...Arr.map(calls, (call) => ({ world: world.name, call }))]);
      const after = yield* exit;
      const entries = yield* Effect.forEach(calls, (call) => madeCallOf(call, making.own ?? after.own));
      const facts: Facts = { ...after.facts, calls: [...callsOf(after.facts), ...entries] };
      return { own: after.own, facts } satisfies Making;
    });

  const nothing: Making = {
    facts: { operators: { first: settings.owner, second: settings.secondOwner }, calls: [] },
    own: null,
  };

  /** `world` as made in the template world and saved there as a template snapshot of its own name. */
  const templateOf = (world: StartingWorld): Effect.Effect<Making, RunnerFailure, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const cached = (yield* Ref.get(templates)).get(world.name);
      if (cached !== undefined) return cached;
      const from = world.from === null ? nothing : yield* templateOf(world.from);
      const steps = yield* stepsOf(world);
      const after = yield* run(world, steps, from);
      if (world.from === null && after.own !== null)
        yield* Ref.update(templateWorlds, (all) => [...all, after.own?.world ?? ""]);
      const saved = yield* run(
        world,
        (making) =>
          Effect.gen(function* () {
            const capxul = yield* Capxul;
            yield* capxul["world.snapshot.save"]({
              world: making.own?.world ?? "",
              snapshot: world.name,
              replace: false,
              template: true,
            }).pipe(Effect.mapError((error) => RunnerFailure.make({ step: "template", message: error._tag })));
            return making;
          }),
        after,
      );
      yield* Ref.update(templates, (all) => new Map([...all, [world.name, saved]]));
      return saved;
    });

  /** The starting world of one scenario, made for it: restored from its template, or made by its steps. */
  const forScenario = (world: StartingWorld): Effect.Effect<Making, RunnerFailure, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      if (world === startingWorlds.nothing) return nothing;
      if (world.made === "by its steps") {
        const from = world.from === null ? nothing : yield* forScenario(world.from);
        return yield* run(world, yield* stepsOf(world), from);
      }
      const template = yield* templateOf(world);
      return yield* run(
        world,
        (making) =>
          Effect.gen(function* () {
            const capxul = yield* Capxul;
            const as = yield* freshName("s");
            const view = yield* capxul["world.snapshot.restore"]({
              world: making.own?.world ?? "",
              snapshot: world.name,
              as,
              lifetimeMinutes: SCENARIO_MINUTES,
            }).pipe(Effect.mapError((error) => RunnerFailure.make({ step: "restore", message: error._tag })));
            return {
              facts: { ...making.facts, world: yield* encodeAnswer("world.snapshot.restore", view) },
              own: { world: view.world, door: view.door },
            };
          }),
        template,
      );
    });

  return {
    forScenario,
    templateWorlds: Ref.get(templateWorlds),
    made: Ref.get(made),
  };
});

export type StartingWorlds = Effect.Success<ReturnType<typeof startingWorldsOf>>;

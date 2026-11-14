// `./run.sh shared`: makes the shared world, or renews it (roadmap step 2.3). A shared world is a world of grade
// `shared` on the shared platform (its sites on the staging bench, made with the world's own site token), owned by
// one operator, kept for many callers and many runs, and never reset by a run. It lives on a hub of its own, which
// this command brings up, or up again, so that the hub outlives the world (no world may outlive its hub).
//
// Missing, it is made through the platform's operations, as the run's one world is (worlds/starting.ts): `world.create`
// with grade `shared` and the most a world may live, then every starting world the registered journeys start from a
// template of, by its steps, in the blueprint's order, each saved as a template snapshot (`world.snapshot.save`,
// template: true, so any operator may restore it) with its maker's facts kept beside it (shared/facts.ts). A making
// that fails takes the half-made world down, so the next run makes it anew.
//
// Made or found, it is then renewed (packages/world, `renew`): its expiry moved to its lifetime from now and Core
// deployed again with the code that runs now, accepting the world's own operator token from then on. Every call made
// gets the generic checks, and the record (`<run>/shared.json`) holds them, the world as `world.show` answers it, the
// templates it holds and every part's time.
import { startingWorlds, type StartingWorld } from "@capxul/blueprint";
import type { Journey } from "@capxul/scenarios";
import { Capxul } from "@capxul/scenarios";
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { checkCall, CheckedCall, failuresOf } from "../checks/checks.ts";
import { describe, RunnerFailure } from "../failure.ts";
import { Outcome, writeJson } from "../record.ts";
import { freshName, keptFor } from "../run.ts";
import type { Settings } from "../settings.ts";
import { makeTimings, Timing } from "../timings.ts";
import { encodeAnswer } from "../worlds/encode.ts";
import type { Making, Steps } from "../worlds/makers.ts";
import { nothingOf, recorder, targetOf, type MakingCall } from "../worlds/making.ts";
import { Platform } from "../worlds/platform.ts";
import { destroyAll } from "../worlds/run.ts";
import { stepsOf } from "../worlds/starting.ts";
import { keepFacts, keptNames } from "./facts.ts";
import { templateOf } from "./starting.ts";

export const SharedRecord = Schema.Struct({
  kind: Schema.Literal("shared world"),
  run: Schema.String,
  startedAt: Schema.String,
  /** `passed` when the world was made or found, renewed, answers `world.show`, and every call passed every check. */
  outcome: Outcome,
  failure: Schema.NullOr(Schema.String),
  world: Schema.String,
  owner: Schema.String,
  /** `made` when this run made it, `renewed` when it was there already. */
  how: Schema.Literals(["made", "renewed"]),
  hub: Schema.Struct({ stage: Schema.String, expiresAt: Schema.String, broughtUp: Schema.Boolean }),
  /** Its expiry before the renewal (null when this run made it) and after. */
  was: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
  /** The starting worlds it holds a template snapshot and facts of, oldest first. */
  templates: Schema.Array(Schema.String),
  /** `world.show` of it after the renewal, as the blueprint encodes it. */
  shown: Schema.Unknown,
  calls: Schema.Array(CheckedCall),
  timings: Schema.Array(Timing),
});
export type SharedRecord = typeof SharedRecord.Type;

const failed = (message: string) => RunnerFailure.make({ step: "starting world", message });
const asFailure = (error: unknown) => failed(Cause.fail(error).pipe(describe));
const MINUTE = 60_000;

/** The starting worlds the journeys start from a template of, and the templates those are made from, in order. */
export const templatesFor = (journeys: ReadonlyArray<Journey>): ReadonlyArray<StartingWorld> => {
  const chain = (world: StartingWorld): ReadonlyArray<StartingWorld> =>
    world.made !== "from its template" ? [] : [...(world.from === null ? [] : chain(world.from)), world];
  const wanted = Arr.flatMap(journeys, (journey) =>
    Option.match(templateOf(journey.given), { onNone: () => [], onSome: chain }),
  );
  return Arr.filter(Rec.values(startingWorlds), (world) => Arr.some(wanted, (each) => each.name === world.name));
};

/** `fresh`, as a shared world: grade `shared`, a frozen clock, named `name`, living `minutes`. */
const sharedFresh =
  (name: string, minutes: number): Steps =>
  (making) =>
    Effect.gen(function* () {
      const capxul = yield* Capxul;
      const made = yield* capxul["world.create"]({
        world: name,
        grade: "shared",
        lifetimeMinutes: minutes,
        clock: { mode: "frozen", startAt: null },
      }).pipe(Effect.mapError((error) => failed(`world.create of the shared world was refused: ${error._tag}`)));
      return {
        facts: { ...making.facts, world: yield* encodeAnswer("world.create", made) },
        own: { world: made.world, door: made.door },
      };
    });

/** Saves the world the steps run in as the template snapshot `world.name`. */
const saveAs =
  (world: StartingWorld): Steps =>
  (making) =>
    Effect.gen(function* () {
      const capxul = yield* Capxul;
      yield* capxul["world.snapshot.save"]({
        world: making.own?.world ?? "",
        snapshot: world.name,
        replace: false,
        template: true,
      }).pipe(Effect.mapError((error) => failed(`the save of ${world.name} was refused: ${error._tag}`)));
      return making;
    });

/** `world.show` of `name`, recorded with the rest; its answer is kept in the making's facts as `shown`. */
const showOf =
  (name: string): Steps =>
  (making) =>
    Effect.gen(function* () {
      const capxul = yield* Capxul;
      const shown = yield* capxul["world.show"]({ world: name }).pipe(
        Effect.mapError((error) => failed(`world.show of ${name} was refused: ${error._tag}`)),
      );
      return { facts: { ...making.facts, shown: yield* encodeAnswer("world.show", shown) }, own: making.own };
    });

/** Makes the shared world, or renews it, and writes its record. */
export const makeOrRenew = (settings: Settings, journeys: ReadonlyArray<Journey>) =>
  Effect.gen(function* () {
    const platform = yield* Platform;
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const run = yield* freshName("shared");
    const timings = yield* makeTimings;
    const made = yield* Ref.make<ReadonlyArray<MakingCall>>([]);
    const record = recorder(targetOf(settings, platform.url), made);
    const nothing = nothingOf(settings);
    const name = settings.shared;

    // Its hub, of its own: brought up, or up again, unless it outlives the world's renewed expiry by a day.
    const hubStage = yield* World.HubStage.pipe(Effect.orDie);
    const before = yield* Effect.option(World.openHub(hubStage));
    const needed =
      DateTime.toEpochMillis(yield* DateTime.now) + Duration.toMillis(settings.sharedLifetime) + 1440 * MINUTE;
    const lasts = Option.isSome(before) && DateTime.toEpochMillis(DateTime.makeUnsafe(before.value.expiresAt)) > needed;
    if (Option.isSome(before) && before.value.owner !== settings.owner)
      return yield* failed(`hub ${hubStage} belongs to ${before.value.owner}, not ${settings.owner}`);
    if (!lasts)
      yield* timings.timed(
        "hub up",
        { of: hubStage },
        World.hubUp({ stage: hubStage, owner: settings.owner, lifetime: settings.sharedHubLifetime }).pipe(
          Effect.mapError(asFailure),
        ),
      );
    const hub = yield* World.openHub(hubStage).pipe(Effect.mapError(asFailure));

    // The world: found, or made with its templates.
    const found = yield* Effect.option(World.open(name));
    if (Option.isSome(found) && found.value.owner !== settings.owner)
      return yield* failed(`${name} belongs to ${found.value.owner}, not ${settings.owner}`);
    const wanted = templatesFor(journeys);
    if (Option.isNone(found)) {
      // Each template is made from the one before, saved, and the next made from the saved world.
      const making = Effect.reduce(
        wanted,
        (): Making => nothing,
        (from: Making, world) =>
          Effect.gen(function* () {
            const steps =
              world === startingWorlds.fresh
                ? sharedFresh(name, Math.floor(Duration.toMillis(settings.sharedLifetime) / MINUTE))
                : yield* stepsOf(world);
            const after = yield* timings.timed(`make ${world.name}`, { of: name }, record(world, steps, from));
            const own = yield* World.open(name).pipe(Effect.mapError(asFailure));
            yield* timings.timed(`keep facts ${world.name}`, { of: name }, keepFacts(own, world.name, after.facts));
            return yield* timings.timed(`save ${world.name}`, { of: name }, record(world, saveAs(world), after));
          }),
      );
      const exit = yield* Effect.exit(making);
      if (Exit.isFailure(exit)) {
        yield* Effect.logError(`the shared world was not made: ${describe(exit.cause)}; what was made goes`);
        yield* destroyAll(yield* platform.made);
        return yield* Effect.failCause(exit.cause);
      }
    }
    const held = Option.isSome(found) ? yield* keptNames(found.value) : Arr.map(wanted, (world) => world.name);
    const missing = Arr.filter(wanted, (world) => !Arr.contains(held, world.name));

    // Renewed either way: a later expiry, and Core deployed again with the running code.
    const renewed = yield* timings
      .timed(
        "renew",
        { of: name },
        World.renew(name, settings.sharedLifetime).pipe(Effect.mapError(asFailure)),
        (answer) => ({ parts: answer.ms }),
      )
      .pipe(Effect.exit);
    const shown = yield* Effect.exit(
      timings.timed("world.show", { of: name }, record(startingWorlds.nothing, showOf(name), nothing)),
    );

    const calls = Arr.map(yield* Ref.get(made), (each) => each.call);
    const kept = yield* Effect.orElseSucceed(keptFor(Option.none(), calls), () => ({ spans: [], events: [] }));
    const checked = Arr.map(calls, (call) => checkCall(call, kept));
    const templates = yield* World.open(name).pipe(
      Effect.flatMap(keptNames),
      Effect.orElseSucceed(() => []),
    );
    const all = [
      ...(missing.length === 0
        ? []
        : [
            `${name} holds no template of ${Arr.join(
              Arr.map(missing, (world) => world.name),
              ", ",
            )}; a journey of it cannot run on it until the world is made again`,
          ]),
      ...(Exit.isFailure(renewed) ? [`the renewal failed: ${describe(renewed.cause)}`] : []),
      ...(Exit.isFailure(shown) ? [`world.show failed: ${describe(shown.cause)}`] : []),
      ...failuresOf(checked),
    ];
    const done: SharedRecord = {
      kind: "shared world",
      run,
      startedAt,
      outcome: all.length === 0 ? "passed" : "failed",
      failure: all.length === 0 ? null : Arr.join(all, "\n"),
      world: name,
      owner: settings.owner,
      how: Option.isSome(found) ? "renewed" : "made",
      hub: { stage: hub.stage, expiresAt: hub.expiresAt, broughtUp: !lasts },
      was: Option.isSome(found) ? found.value.expiresAt : null,
      expiresAt: Exit.isSuccess(renewed) ? renewed.value.expiresAt : null,
      templates,
      shown: Exit.isSuccess(shown) ? (shown.value.facts["shown"] ?? null) : null,
      calls: checked,
      timings: yield* timings.all,
    };
    yield* Effect.orDie(writeJson(`${settings.records}/${run}/shared.json`, SharedRecord, done));
    return done;
  });

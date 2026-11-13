// How the runner makes each starting world: by the steps its declaration names (packages/blueprint,
// src/starting-worlds.ts), each an operation through the door, from the world before it (decisions.md, 27, 38, 39).
// A maker is handed the facts of the world it starts from and the world its steps run in, makes its calls through
// the scenarios' own client (recorded, so the generic checks see them too), and answers the facts its steps add, each
// encoded as the blueprint's own schema encodes that answer. Every call it makes becomes one entry of `calls`.
//
// A starting world with no maker here names the operations its steps need: those are not built yet.
import { MadeCall, operations, servedBy, startingWorlds, World, type StartingWorld } from "@capxul/blueprint";
import { Capxul } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { Call } from "../client.ts";
import { RunnerFailure } from "../failure.ts";
import { freshName } from "../run.ts";

/** Facts as a world's maker keeps them: encoded, as `Given` hands them and `given` decodes them. */
export type Facts = Readonly<Record<string, unknown>>;

/** Where a maker starts: the facts of the world it is made from, and the world its steps run in, if any. */
export interface Making {
  readonly facts: Facts;
  /** The name of the world the steps run in, and the door it answers at; null before any world exists. */
  readonly own: { readonly world: string; readonly door: string } | null;
}

/** A starting world's own steps, as an Effect of the scenarios' client. */
export type Steps = (making: Making) => Effect.Effect<Making, RunnerFailure, Capxul>;

/** How long a world made for a scenario, or by its steps, may live: an hour and a half. */
export const SCENARIO_MINUTES = 90;

type Codec = Schema.Codec<unknown, unknown>;
const schemasOf = (name: keyof typeof operations) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an operation's schemas need no services: they are the blueprint's plain Schemas, which Rpc's generic type leaves open.
  operations[name].rpc as unknown as {
    readonly payloadSchema: Codec;
    readonly successSchema: Codec;
    readonly errorSchema: Codec;
  };

const encoded = (schema: Codec, value: unknown) =>
  Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(
    Effect.mapError((error) => RunnerFailure.make({ step: "starting world", message: error.message })),
  );

/** An answer of `operation`, encoded as the blueprint encodes it: what a fact holds. */
export const encodeAnswer = (operation: keyof typeof operations, answer: unknown) =>
  encoded(schemasOf(operation).successSchema, answer);

/** One recorded call as the `calls` fact holds it (the blueprint's `MadeCall`), encoded. */
export const madeCallOf = (call: Call, own: Making["own"]) =>
  Effect.gen(function* () {
    const schemas = schemasOf(call.operation);
    const named =
      Predicate.hasProperty(call.payload, "world") && Predicate.isString(call.payload.world) ? call.payload.world : "";
    const world = servedBy(call.operation) === "platform" ? named : (own?.world ?? named);
    const answer =
      call.outcome === "success"
        ? yield* encoded(schemas.successSchema, Option.getOrNull(call.success))
        : yield* encoded(schemas.errorSchema, Option.getOrNull(call.error ?? Option.none()));
    return yield* encoded(MadeCall, {
      operation: call.operation,
      world,
      operator: call.operator ?? "first",
      as: call.as ?? null,
      trace: call.traceId,
      payload: yield* encoded(schemas.payloadSchema, call.payload),
      outcome: call.outcome === "success" ? "success" : "refusal",
      answer,
    });
  });

const failed = (message: string) => RunnerFailure.make({ step: "starting world", message });

/** A call of a maker that must succeed; any refusal or defect fails the making with what came back. */
const must = <A, E, R>(what: string, call: Effect.Effect<A, E, R>) =>
  Effect.mapError(call, (error) =>
    failed(`${what} was refused: ${Predicate.hasProperty(error, "_tag") ? String(error._tag) : "?"}`),
  );

const frozenNow = { mode: "frozen", startAt: null } as const;

/** `quota-full`: the operator creates private worlds until the platform refuses one for the quota. */
/** A create that died, not refused: a fault of the infrastructure under the world, tried again a few times. */
const DEATHS_ALLOWED = 3;

const refused = (exits: ReadonlyArray<Exit.Exit<unknown, unknown>>) =>
  Arr.some(exits, (exit) => Exit.isFailure(exit) && Exit.hasFails(exit));
const died = (exits: ReadonlyArray<Exit.Exit<unknown, unknown>>) =>
  Arr.filter(exits, (exit) => Exit.isFailure(exit) && !Exit.hasFails(exit)).length;

/**
 * `quota-full`: the operator creates private worlds until the platform refuses one for the quota. As many as the
 * limit are asked for at once, three at a time; then, unless one was refused, one more at a time until one is. A
 * create that dies is tried again, up to `DEATHS_ALLOWED` times in all.
 */
const quotaFull: Steps = (making) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const once = Effect.flatMap(freshName("qf"), (world) =>
      Effect.exit(
        capxul["world.create"]({ world, grade: "private", lifetimeMinutes: SCENARIO_MINUTES, clock: frozenNow }),
      ),
    );
    const first = yield* Effect.forEach(
      Arr.makeBy(World.WORLD_LIMITS.liveWorldsPerOwner, () => null),
      () => once,
      {
        concurrency: 3,
      },
    );
    let tried = first;
    while (!refused(tried) && died(tried) <= DEATHS_ALLOWED) tried = [...tried, yield* once];
    if (!refused(tried)) return yield* failed(`no create was refused for the quota; ${died(tried)} of them died`);
    const filled = Arr.flatMap(tried, (exit) => (Exit.isSuccess(exit) ? [exit.value] : []));
    const views = yield* Effect.forEach(filled, (view) => encodeAnswer("world.create", view));
    return { facts: { ...making.facts, filled: views }, own: null };
  });

/** `fresh`: a private world with a frozen clock and a lifetime of `minutes`. */
const fresh =
  (minutes: number): Steps =>
  (making) =>
    Effect.gen(function* () {
      const capxul = yield* Capxul;
      const world = yield* freshName("tpl");
      const made = yield* must(
        "world.create of the template world",
        capxul["world.create"]({ world, grade: "private", lifetimeMinutes: minutes, clock: frozenNow }),
      );
      return {
        facts: { ...making.facts, world: yield* encodeAnswer("world.create", made) },
        own: { world: made.world, door: made.door },
      };
    });

/** `with-snapshot`: the operator saves `m3` as a template and `draft` as not, in the world the steps run in. */
const withSnapshot: Steps = (making) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = making.own?.world ?? "";
    const save = (snapshot: string, template: boolean) =>
      must(
        `world.snapshot.save of ${snapshot}`,
        capxul["world.snapshot.save"]({ world, snapshot, replace: false, template }),
      ).pipe(Effect.flatMap((answer) => encodeAnswer("world.snapshot.save", answer)));
    const m3 = yield* save("m3", true);
    const draft = yield* save("draft", false);
    return { facts: { ...making.facts, m3, draft }, own: making.own };
  });

/** `restored`: the operator restores `m3` into a new world with a lifetime of 60 minutes; the scenario runs there. */
const restored: Steps = (making) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const as = yield* freshName("rst");
    const made = yield* must(
      "world.snapshot.restore of m3",
      capxul["world.snapshot.restore"]({ world: making.own?.world ?? "", snapshot: "m3", as, lifetimeMinutes: 60 }),
    );
    return {
      facts: { ...making.facts, restored: yield* encodeAnswer("world.snapshot.restore", made) },
      own: { world: made.world, door: made.door },
    };
  });

/** How long the template world lives: long enough for every scenario of a run to restore from it. */
export const TEMPLATE_MINUTES = 6 * 60;

/** Every starting world the runner can make, by its name, with its steps. */
export const makers: Readonly<Record<string, Steps>> = {
  [startingWorlds.nothing.name]: (making) => Effect.succeed(making),
  [startingWorlds.quotaFull.name]: quotaFull,
  [startingWorlds.fresh.name]: fresh(TEMPLATE_MINUTES),
  [startingWorlds.withSnapshot.name]: withSnapshot,
  [startingWorlds.restored.name]: restored,
};

/** The operations a starting world's steps, and its ancestors', call that no maker here makes yet. */
export const waitsOn = (world: StartingWorld): ReadonlyArray<string> => {
  const own = makers[world.name] === undefined ? Arr.map(world.steps, (step) => step.operation) : [];
  const before = world.from === null ? [] : waitsOn(world.from);
  return Arr.dedupe(Arr.filter([...before, ...own], (operation) => operation !== "wait"));
};

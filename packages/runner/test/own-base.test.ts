// The starting world of a journey in a world of its own (worlds/own-base.ts; roadmap 4.8, the own-world track): a
// `quota-full` journey needs no world to begin with, so none is made for it, and the owner's quota is filled to the
// limit by its own steps. Against a stand-in client whose world.create answers until the owner holds the limit, then
// refuses with WorldQuotaReached. Structural only, never about speed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Errors, startingWorlds, World, type StartingWorld } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import { Capxul, type CapxulClient } from "@capxul/scenarios";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import { ownBeginning } from "../src/worlds/own-base.ts";
import type { Making } from "../src/worlds/makers.ts";

const LIMIT = World.WORLD_LIMITS.liveWorldsPerOwner;
const QUOTA = Errors.WorldQuotaReached.make({ owner: "op-first", live: LIMIT, limit: LIMIT });
const NOTHING: Making = { facts: { operators: { first: "op-first", second: "op-second" }, calls: [] }, own: null };

/** A client whose world.create makes worlds until the owner holds the limit, then refuses; every create kept. */
const quotaClient = (answered: Array<string>): CapxulClient => {
  const example = World.create.examples[0]?.success;
  const answer = Predicate.isObject(example) ? example : {};
  let live = 0;
  const create = (payload: unknown) =>
    Effect.suspend(() => {
      if (live >= LIMIT) {
        answered.push(QUOTA._tag);
        return Effect.fail(QUOTA);
      }
      live += 1;
      answered.push("success");
      const world = Predicate.hasProperty(payload, "world") ? String(payload.world) : "made";
      return Effect.succeed({ ...answer, world });
    });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in client for one test: only world.create is called, and it answers as the blueprint declares it
  return { "world.create": create } as unknown as CapxulClient;
};

/** `world` made for a journey of its own world through the stand-in: the starting worlds whose steps ran, and the creates. */
const madeOwn = (world: StartingWorld) =>
  Effect.gen(function* () {
    const answered: Array<string> = [];
    const ran: Array<string> = [];
    const client = quotaClient(answered);
    const made = yield* ownBeginning(world, NOTHING, (each, steps, from) => {
      ran.push(each.name);
      return Effect.provideService(steps(from), Capxul, client);
    });
    return { made, ran, answered };
  });

test("a quota-full journey of its own world makes no fresh world", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { ran } = yield* madeOwn(startingWorlds.quotaFull);
      assert.deepEqual(ran, [startingWorlds.quotaFull.name], "only quota-full's own steps ran: no fresh world first");
    }),
  ));

test("its making calls are the limit's successful world.create and one WorldQuotaReached, and `filled` is the limit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { made, answered } = yield* madeOwn(startingWorlds.quotaFull);
      assert.deepEqual(answered, [...Arr.makeBy(LIMIT, () => "success"), QUOTA._tag]);
      const filled = made.facts["filled"];
      assert.ok(Arr.isArray(filled), "quota-full's facts name the worlds it filled");
      assert.equal(filled.length, LIMIT, "filled equals the limit");
      assert.equal(made.own, null, "it runs in no world of its own");
    }),
  ));

test("a starting world made from fresh still begins in a fresh world of its own", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { ran, made } = yield* madeOwn(startingWorlds.fresh);
      assert.deepEqual(ran, [startingWorlds.fresh.name]);
      assert.notEqual(made.own, null, "the fresh world is the journey's own");
    }),
  ));

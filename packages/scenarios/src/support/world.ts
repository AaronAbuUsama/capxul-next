// Reading a world through the operations: its view, its record, its cast and its company. What the steps that made a
// starting world answered is not read back here: a scenario takes it from the world's facts (`given`).
import { startingWorlds, World, type Record as RecordOps, type Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import type * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { Capxul, type CallOptions } from "../client.ts";
import { expect, given } from "../scenario.ts";
import { present, refusal, same, show } from "./expect.ts";

export type View = typeof Values.WorldView.Type;
export type Entry = typeof RecordOps.Entry.Type;
export type Approval = typeof Values.Approval.Type;
export type Json = typeof Values.Json.Type;

/** The platform's limits, as the blueprint declares them. */
export const LIMITS = World.WORLD_LIMITS;

/** Where a world operation goes and as whom: the client's own world unless `at` names another door. */
export type Who = CallOptions;

/** The whole record of a world, read as its owner: the client's own, or `at` another door. */
export const recordOf = (who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["record.export"]({ from: null, to: null }, who);
  });

/** The whole record of the world the client's door serves. */
export const record = recordOf();

/** The record's entries after position `after`, read as the owner. */
export const entriesAfter = (after: number, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const answer = yield* capxul["record.export"]({ from: after + 1, to: null }, who);
    return answer.entries;
  });

/** A record's head now. */
export const headOf = (who: Who = {}) => Effect.map(recordOf(who), (answer) => answer.head);

/** The head of the client's own world's record. */
export const head = headOf();

/** The record gained no entry since `before`: what every refusal and every read must leave behind. */
export const unchangedRecord = (what: string, before: number, who: Who = {}) =>
  Effect.flatMap(headOf(who), (now) =>
    expect(now === before, `after ${what} the record's head is ${now}; it was ${before}`),
  );

/** world.show of a world. */
export const view = (world: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["world.show"]({ world });
  });

/**
 * world.show of the world the scenario runs in, named by its `world` fact: for every starting world from `fresh` to
 * `with-snapshot`. In `restored` the `world` fact is the first world, not the scenario's.
 */
export const thisView = Effect.flatMap(given(startingWorlds.fresh), (facts) => view(facts.world.world));

/** Northwind's org id and the world it was founded in, from the facts of any starting world from `founded` on. */
export const northwind = Effect.map(given(startingWorlds.founded), (facts) => ({
  world: facts.world,
  org: facts.founded.org,
}));

/** A person of the world's cast, by name. */
export const castMember = (world: View, person: string) =>
  present(
    `${person} in ${world.world}'s cast`,
    Arr.findFirst(world.cast, (each) => each.person === person).pipe(Option.getOrNull),
  );

/** The company of the starting worlds from `founded` on. */
export const NORTHWIND = "northwind";

/** A company the world shows, by handle. */
export const company = (world: View, handle: string) =>
  present(
    `${handle} in ${world.world}'s companies (${show(Arr.map(world.companies, (each) => each.handle))})`,
    Arr.findFirst(world.companies, (each) => each.handle === handle).pipe(Option.getOrNull),
  );

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A world name no world has: `prefix` and eight random letters and digits, within the blueprint's rule for names.
 * The starting world `nothing` promises only that no world has the name the scenario uses, so each run picks its own.
 */
export const freshName = (prefix: string) =>
  Effect.map(
    Effect.forEach(Arr.range(1, 8), () => Random.nextIntBetween(0, ALPHABET.length)),
    (picks) =>
      `${prefix}-${Arr.join(
        Arr.map(picks, (pick) => Option.getOrElse(Str.charAt(pick)(ALPHABET), () => "a")),
        "",
      )}`,
  );

/** A JSON value's field, when the value is an object. */
export const fieldOf = (value: Json | undefined, key: string): Json | undefined =>
  isObject(value) ? value[key] : undefined;

const isObject = (value: Json | undefined): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Arr.isArray(value);

/** A JSON value as an object: its fields, or none when it is not an object. */
export const objectOf = (value: Json | undefined): Schema.JsonObject => (isObject(value) ? value : {});

/** A JSON value's field as text, or "" when it is not text. */
export const textOf = (value: Json | undefined, key: string): string => {
  const field = fieldOf(value, key);
  return typeof field === "string" ? field : "";
};

/** The entries naming `event`. */
export const entriesOf = (entries: ReadonlyArray<Entry>, event: string) =>
  Arr.filter(entries, (entry) => entry.event === event);

/** world.show of a name must be refused with WorldNotFound: nothing was made under it. */
export const noWorld = (world: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const refused = yield* refusal(`world.show of ${world}`, "WorldNotFound", capxul["world.show"]({ world }));
    yield* same("the WorldNotFound's world", refused.world, world);
  });

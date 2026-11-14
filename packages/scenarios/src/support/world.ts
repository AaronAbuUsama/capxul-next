// Reading a world through the operations: its view, its record, its cast and its companies. These are looks: calls a
// check or a step makes to read the world, never a step's own calls. A look at a world goes where the call it judges
// went (`at` its door, signed in as its operator) and acts as the world's owner, never as a person.
import { startingWorlds, World, type CallOptions, type Record as RecordOps, type Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import type * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { expect, failWith, given } from "../expectation.ts";
import { present, refusal, same, show } from "./expect.ts";

export type View = typeof Values.WorldView.Type;
export type Entry = typeof RecordOps.Entry.Type;
export type Approval = typeof Values.Approval.Type;
export type Json = typeof Values.Json.Type;
export type Operator = "first" | "second";

/** The platform's limits, as the blueprint declares them. */
export const LIMITS = World.WORLD_LIMITS;

/** Where a call goes and as whom: the client's own world unless `at` names another door. */
export type Who = CallOptions;

/** Where a look at the world of a call goes: the call's door and operator, as the world's owner. */
export const whereOf = (options: CallOptions): Who => ({
  ...(options.at === undefined ? {} : { at: options.at }),
  ...(options.operator === undefined ? {} : { operator: options.operator }),
});

/** The operator a call signs in as. */
export const operatorOf = (options: CallOptions): Operator => options.operator ?? "first";

/** The run's two operators, by the names the platform gives them (`nothing`'s facts). */
export const operators = Effect.map(given(startingWorlds.nothing), (facts) => facts.operators);

/** The name of the operator a call signs in as. */
export const operatorName = (options: CallOptions) => Effect.map(operators, (named) => named[operatorOf(options)]);

/** Where a look goes to read the world `view` as its owner: its door, signed in as whichever operator owns it. */
export const ownerOf = (view: View) =>
  Effect.gen(function* () {
    const named = yield* operators;
    if (view.owner === named.first) return { at: view.door, operator: "first" } satisfies Who;
    if (view.owner === named.second) return { at: view.door, operator: "second" } satisfies Who;
    return yield* failWith(`${view.world} is owned by ${view.owner}, neither of the run's operators`);
  });

/** The whole record of a world, read as its owner: the client's own, or `at` another door. */
export const recordOf = (who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["record.export"]({ from: null, to: null }, whereOf(who));
  });

/** The record's entries after position `after`, read as the owner. */
export const entriesAfter = (after: number, who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const answer = yield* capxul["record.export"]({ from: after + 1, to: null }, whereOf(who));
    return answer.entries;
  });

/** A record's head now. */
export const headOf = (who: Who = {}) => Effect.map(recordOf(who), (answer) => answer.head);

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

/** world.show of the world a call at `who` acts on: named by its own record. */
export const viewAt = (who: Who = {}) => Effect.flatMap(recordOf(who), (record) => view(record.world));

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

/** The companies a world shows, as what identifies each. */
export const companiesOf = (world: View) =>
  Arr.map(world.companies, (each) => ({ org: each.org, handle: each.handle, name: each.name }));

/** Every personal Safe of the world's cast. */
export const personalSafes = (world: View): ReadonlyArray<string> =>
  Arr.flatMap(world.cast, (each) => (each.safe === null ? [] : [each.safe]));

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A world name no world has: `prefix` and eight random letters and digits, within the blueprint's rule for names.
 * The starting world `nothing` promises only that no world has the name the journey uses, so each run picks its own.
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

/** world.show of a name must be refused with WorldNotFound naming it: nothing was made under it. */
export const noWorld = (world: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const refused = yield* refusal(`world.show of ${world}`, "WorldNotFound", capxul["world.show"]({ world }));
    yield* same("the WorldNotFound's world", refused.world, world);
  });

/** world.show of a name, or none when it is refused with WorldNotFound. */
export const viewOrNone = (world: string) =>
  view(world).pipe(
    Effect.asSome,
    Effect.catchTag("WorldNotFound", () => Effect.succeedNone),
  );

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
import { Capxul, ThisCall } from "../client.ts";
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

/** The entries of a world's history from position `from` (null: the first), read as its owner, at `who`'s door. */
const exported = (from: number | null, who: Who) =>
  Effect.flatMap(Capxul, (capxul) => capxul["record.export"]({ from, to: null }, whereOf(who)));

/** The whole record of a world, read as its owner: the client's own, or `at` another door. */
export const recordOf = (who: Who = {}) => exported(null, who);

/** The record's entries after position `after`, read as the owner. */
export const entriesAfter = (after: number, who: Who = {}) =>
  Effect.map(exported(after + 1, who), (answer) => answer.entries);

/**
 * The name of the world `who` reaches and its record's head now, read as its owner with one entry: what a check reads
 * before a call, without reading the whole record back.
 */
export const headAt = (who: Who = {}) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const answer = yield* capxul["record.export"]({ from: 1, to: 1 }, whereOf(who));
    return { world: answer.world, head: answer.head };
  });

/** A record's head now. */
export const headOf = (who: Who = {}) => Effect.map(headAt(who), (answer) => answer.head);

/** An entry of the record a call wrote, as a check judges it. */
export interface CallEntry {
  readonly seq: number;
  readonly event: string;
  readonly carried: Json;
}

/**
 * The entries the call a check judges wrote: those carrying the call's trace. Other journeys' calls, made at the same
 * time in the same world, write under traces of their own and are not the call's. Read from what the run observed
 * under the trace when it offers that (`ThisCall.observed`), else from the record after position `after`; when the
 * client did not tell the call's trace either, every entry after `after` is taken as the call's, as when one journey
 * ran alone in its world.
 */
export const entriesOfCall = (after: number, who: Who = {}) =>
  Effect.gen(function* () {
    const call = yield* ThisCall;
    if (call.observed !== null) {
      if (!call.observed.complete) return yield* failWith(`the call's trace ${call.trace} was not observed whole`);
      return call.observed.events satisfies ReadonlyArray<CallEntry>;
    }
    const added = yield* entriesAfter(after, who);
    const ofCall = call.trace === null ? added : Arr.filter(added, (each) => each.trace === call.trace);
    return ofCall satisfies ReadonlyArray<CallEntry>;
  });

/** The call wrote no entry: what every refusal and every read must leave behind. `before` is the head before it. */
export const unchangedRecord = (what: string, before: number, who: Who = {}) =>
  Effect.flatMap(entriesOfCall(before, who), (added) =>
    expect(
      added.length === 0,
      `after ${what} the record gained ${show(Arr.map(added, (each) => each.event))} under the call's trace`,
    ),
  );

/** world.show of a world. */
export const view = (world: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["world.show"]({ world });
  });

/** world.show of the world a call at `who` acts on: named by its own record. */
export const viewAt = (who: Who = {}) => Effect.flatMap(headAt(who), (record) => view(record.world));

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

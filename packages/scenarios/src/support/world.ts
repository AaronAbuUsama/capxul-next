// Reading the world a scenario runs in, through the operations alone: its name and view, its record, its cast and
// its company. A starting world hands a scenario nothing but the door, so everything it needs is read back here.
import { World, type Record as RecordOps, type Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import type * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { expect } from "../scenario.ts";
import { present, refusal, same, show } from "./expect.ts";

export type View = typeof Values.WorldView.Type;
export type Entry = typeof RecordOps.Entry.Type;
export type Approval = typeof Values.Approval.Type;
export type Json = typeof Values.Json.Type;

/** The platform's limits, as the blueprint declares them. */
export const LIMITS = World.WORLD_LIMITS;

/** The whole record of the world the client's door serves, read as its owner. */
export const record = Effect.gen(function* () {
  const capxul = yield* Capxul;
  return yield* capxul["record.export"]({ from: null, to: null });
});

/** The record's entries after position `after`, read as the owner. */
export const entriesAfter = (after: number) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const answer = yield* capxul["record.export"]({ from: after + 1, to: null });
    return answer.entries;
  });

/** The record's head now. */
export const head = Effect.map(record, (answer) => answer.head);

/** The record gained no entry since `before`: what every refusal and every read must leave behind. */
export const unchangedRecord = (what: string, before: number) =>
  Effect.flatMap(head, (now) => expect(now === before, `after ${what} the record's head is ${now}; it was ${before}`));

/** The name of the world the client's door serves, as its record names it. */
export const thisWorld = Effect.map(record, (answer) => answer.world);

/** world.show of a world. */
export const view = (world: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["world.show"]({ world });
  });

/** world.show of the world the client's door serves. */
export const thisView = Effect.flatMap(thisWorld, view);

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

/** Northwind's org id, read from world.show of the client's world. */
export const northwind = Effect.gen(function* () {
  const world = yield* thisView;
  const found = yield* company(world, NORTHWIND);
  return { world, org: found.org };
});

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

/** The name of the last document of `doctype` the record says was created. */
export const lastCreated = (entries: ReadonlyArray<Entry>, doctype: string) =>
  present(
    `a doc_created entry for a ${doctype} in the record`,
    Arr.last(
      Arr.filter(entriesOf(entries, "doc_created"), (entry) => textOf(entry.carried, "doctype") === doctype),
    ).pipe(
      Option.map((found) => textOf(found.carried, "name")),
      Option.getOrNull,
    ),
  );

/** The snapshot_saved entry of a snapshot, which carries the record position the snapshot holds. */
export const savedSnapshot = (entries: ReadonlyArray<Entry>, snapshot: string) =>
  Effect.gen(function* () {
    const saved = yield* present(
      `a snapshot_saved entry for ${snapshot} in the record`,
      Arr.last(
        Arr.filter(entriesOf(entries, "snapshot_saved"), (e) => textOf(e.carried, "snapshot") === snapshot),
      ).pipe(Option.getOrNull),
    );
    const position = fieldOf(saved.carried, "recordSeq");
    yield* expect(typeof position === "number", `${snapshot}'s snapshot_saved carries no recordSeq: ${show(saved)}`);
    return typeof position === "number" ? position : 0;
  });

/** world.show of a name must be refused with WorldNotFound: nothing was made under it. */
export const noWorld = (world: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const refused = yield* refusal(`world.show of ${world}`, "WorldNotFound", capxul["world.show"]({ world }));
    yield* same("the WorldNotFound's world", refused.world, world);
  });

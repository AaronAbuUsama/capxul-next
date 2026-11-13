// Reading a world's record against the blueprint: every entry names a declared event and carries exactly that
// event's fields, and the positions run from 1 to the head, each once, in order.
import { operations, type EventClass, type Operation } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import { expect } from "../scenario.ts";
import { same, show } from "./expect.ts";
import { objectOf, type Entry, type Json } from "./world.ts";

/** Every event the blueprint declares, by name. */
const declared: ReadonlyArray<EventClass> = Arr.dedupe(
  Arr.flatMap(Rec.values<string, Operation>(operations), (each) => each.emits),
);

const sorted = (keys: ReadonlyArray<string>) => Arr.sort(keys, Order.String);

/** The entry names a declared event and carries exactly its fields, each of its declared shape. */
export const carriesExactly = (entry: Entry) =>
  Effect.gen(function* () {
    const event = Arr.findFirst(declared, (each) => each.identifier === entry.event);
    yield* expect(
      event._tag === "Some",
      `entry ${entry.seq} names ${entry.event}, which the blueprint does not declare`,
    );
    if (event._tag === "None") return;
    const carried = objectOf(entry.carried);
    const fields = Arr.filter(Rec.keys(event.value.fields), (field) => field !== "_tag");
    yield* same(
      `the fields entry ${entry.seq} (${entry.event}) carries`,
      sorted(Rec.keys<string, Json>(carried)),
      sorted(fields),
    );
    const shape = Schema.Struct(Rec.remove(event.value.fields, "_tag"));
    const decoded = Schema.decodeUnknownExit(shape)(carried);
    yield* expect(
      Exit.isSuccess(decoded),
      `entry ${entry.seq} does not carry a ${entry.event}: ${show(entry.carried)}`,
    );
  });

/** The entries hold positions `from` to `from + length - 1`, in order, each once. */
export const inOrder = (entries: ReadonlyArray<Entry>, from: number) =>
  same(
    "the entries' positions",
    Arr.map(entries, (entry) => entry.seq),
    Arr.makeBy(entries.length, (index) => from + index),
  );

/** `names` occur in `entries` in this order, other entries between them allowed. */
export const holdsInOrder = (entries: ReadonlyArray<Entry>, names: ReadonlyArray<string>) => {
  const left = Arr.reduce(entries, names, (wanted, entry) =>
    Arr.isReadonlyArrayNonEmpty(wanted) && wanted[0] === entry.event ? Arr.drop(wanted, 1) : wanted,
  );
  return expect(
    left.length === 0,
    `the record does not hold, in order, ${show(names)}; missing from ${show(left[0])}: ${show(Arr.map(entries, (e) => e.event))}`,
  );
};

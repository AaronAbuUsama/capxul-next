// Reading a world's record against the blueprint: every entry names a declared event and carries exactly that
// event's fields, and the entries a call must have left are what its declaration computes from its payload and answer.
import { MadeCall, operations, type EventClass, type Expected, type Operation } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import { ExpectationFailed, expect } from "../expectation.ts";
import type { Made } from "../journal.ts";
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

/** One entry as a call's declaration says it must be: its event and what it carries, encoded as the record keeps it. */
export interface Due {
  readonly event: string;
  readonly carried: unknown;
}

/** `wanted` occur in `entries` in this order, other entries between them allowed. */
export const holdsInOrder = (entries: ReadonlyArray<Due>, wanted: ReadonlyArray<Due>) => {
  const left = Arr.reduce(entries, wanted, (rest, entry) =>
    Arr.isReadonlyArrayNonEmpty(rest) && Equal.equals(rest[0], entry) ? Arr.drop(rest, 1) : rest,
  );
  return expect(
    left.length === 0,
    `the record does not hold, in order, ${show(wanted)}; missing from ${show(left[0])}: ${show(Arr.map(entries, (e) => e.event))}`,
  );
};

type MadeCall = typeof MadeCall.Type;
type Codec = Schema.Codec<unknown, unknown>;

const failed = (message: string) => ExpectationFailed.make({ message });

/**
 * The entries a call made in making a starting world must have left in the record, under its trace: for a
 * successful call, exactly the events its declaration computes from its payload and answer, each carrying that,
 * encoded as the record keeps it; for a refused call, none.
 */
export const entriesOfCall = (call: MadeCall) =>
  Effect.gen(function* () {
    if (call.outcome === "refusal") return [];
    const byName: Readonly<Record<string, Operation>> = operations;
    const operation = yield* Effect.fromNullishOr(Rec.get(byName, call.operation).pipe(Option.getOrNull)).pipe(
      Effect.mapError(() => failed(`the calls fact names ${call.operation}, which the blueprint does not declare`)),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an operation's schemas need no services: they are the blueprint's plain Schemas, which Rpc's generic type leaves open.
    const schemas = operation.rpc as unknown as { readonly payloadSchema: Codec; readonly successSchema: Codec };
    const payload = yield* Schema.decodeEffect(schemas.payloadSchema)(call.payload).pipe(
      Effect.mapError(() => failed(`the ${call.operation} call ${call.trace}'s payload is not of its schema`)),
    );
    const success = yield* Schema.decodeEffect(schemas.successSchema)(call.answer).pipe(
      Effect.mapError(() => failed(`the ${call.operation} call ${call.trace}'s answer is not of its schema`)),
    );
    const expected = yield* Effect.fromOption(operation.expected({ payload, success })).pipe(
      Effect.mapError(() => failed(`the ${call.operation} call ${call.trace} is no successful call of it`)),
    );
    return yield* encodedAll(`${call.operation} ${call.trace}`, expected);
  });

const encodedAll = (operation: string, expected: ReadonlyArray<Expected>) =>
  Effect.forEach(expected, (each) =>
    Schema.encodeUnknownEffect(Schema.Struct(Rec.remove(each.event.fields, "_tag")))(each.carried).pipe(
      Effect.mapBoth({
        onSuccess: (carried): Due => ({ event: each.event.identifier, carried }),
        onFailure: () => failed(`${each.event.identifier} of ${operation} cannot be encoded`),
      }),
    ),
  );

/** The entries a successful call of a journey's step must have left in its world's record, encoded as it keeps them. */
export const expectedOf = (made: Made) =>
  Effect.gen(function* () {
    const operation: Operation = operations[made.operation];
    const expected = yield* Effect.fromOption(
      operation.expected({ payload: made.payload, success: made.success }),
    ).pipe(Effect.mapError(() => failed(`the journey's ${made.operation} call is no successful call of it`)));
    return yield* encodedAll(made.operation, expected);
  });

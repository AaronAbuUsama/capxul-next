// What the scenarios share: three ways of using the world's record through the door, and how an entry is shown
// and compared. Nothing here reads the database, and nothing here asserts a claim: the scenarios do that.
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import type * as Schema from "effect/Schema";
import { Core, ExpectationFailed } from "../runner/scenario.ts";

/** What a caller appends. */
export interface Draft {
  readonly key: string;
  readonly kind: string;
  readonly body: Schema.Json;
}

/** An entry of the record, as plain data: a draft with the seq it was given. */
export interface Plain extends Draft {
  readonly seq: number;
}

/** A value in a failure message: JSON on one line. */
export const show = (value: unknown): string => JSON.stringify(value);

/**
 * Deep equality of plain JSON data. The order of an object's keys does not count (a stored body may come back with
 * its keys in another order); the order of an array's items does.
 */
export const same = (seen: unknown, expected: unknown): boolean => Equal.equals(seen, expected);

/** Appends `draft`, which must be accepted, and returns it with the seq Core answered. */
export const append = (draft: Draft) =>
  Effect.gen(function* () {
    const core = yield* Core;
    const { seq } = yield* core["record.append"](draft);
    return { seq, ...draft } satisfies Plain;
  });

/**
 * Appends `draft`, which must be refused, and returns the `DuplicateEntry` refusal. An append that is accepted
 * instead fails the scenario; so does any other failure of the call.
 */
export const appendRefused = (draft: Draft) =>
  Effect.gen(function* () {
    const core = yield* Core;
    return yield* core["record.append"](draft).pipe(
      Effect.flatMap(({ seq }) =>
        Effect.fail(new ExpectationFailed({ message: `appending key ${show(draft.key)} a second time was accepted with seq ${seq}; expected the refusal DuplicateEntry` })),
      ),
      Effect.catchTag("DuplicateEntry", (refusal) => Effect.succeed(refusal)),
    );
  });

/** The whole record as `record.export` returns it, in the order it returned it, as plain data. */
export const exported = Effect.gen(function* () {
  const core = yield* Core;
  const { entries } = yield* core["record.export"]();
  return entries.map((entry): Plain => ({ seq: entry.seq, key: entry.key, kind: entry.kind, body: entry.body }));
});

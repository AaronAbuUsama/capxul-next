// What the checks of the world's operations share: the world a call acts on, read before the call, and that a refused
// call or a read leaves the record as it was.
import type { CallOptions } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { castMember, recordOf, unchangedRecord, view, whereOf, type View, type Who } from "../support/world.ts";
import { same } from "../support/expect.ts";
import { check, type Check } from "./format.ts";

/** The world a world operation acts on, read before the call: where a look at it goes, its view and its head. */
export interface Before {
  readonly where: Who;
  readonly world: View;
  readonly head: number;
}

/** Reads the world a call with `options` acts on, as its owner. */
export const worldBefore = (options: CallOptions) =>
  Effect.gen(function* () {
    const where = whereOf(options);
    const record = yield* recordOf(where);
    const world = yield* view(record.world);
    return { where, world, head: record.head } satisfies Before;
  });

/** The call left the record as it was. */
export const nothingRecorded = (what: string, before: Before): Check =>
  check(`${what} leaves the record as it was`, unchangedRecord(what, before.head, before.where));

/** The person a world call acts as: its `as`, which every call of a person names. */
export const callerOf = (options: CallOptions): string => options.as ?? "";

/** A refusal names the person who called. */
export const namesCaller = (what: string, named: string, options: CallOptions): Check =>
  check(`${what} names the caller`, same(`${what}'s person`, named, callerOf(options)));

/** The caller's signer address and personal Safe, from the world's cast. */
export const callerIn = (before: Before, options: CallOptions) => castMember(before.world, callerOf(options));

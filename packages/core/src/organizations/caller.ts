// Who a call through the world's door acts as, by the name its refusals use, and world time as the blueprint writes
// it. A call without the `capxul-person` header acts as the world's owner, who is no person of the cast.
import { CurrentCaller } from "@capxul/blueprint";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

/** The caller's name and whether it is a person of the world (otherwise it is the world's owner). */
export const caller = Effect.gen(function* () {
  const who = yield* CurrentCaller;
  return who._tag === "person" ? { name: who.person, person: true } : { name: who.owner, person: false };
});

/** The caller's name: a person's, or the owner's, which names no person of the cast. */
export const callerPerson = Effect.map(caller, (who) => who.name);

/** An instant in the blueprint's form (RFC 3339 in UTC, to the millisecond). */
export const instant = (ms: number): string => DateTime.formatIso(DateTime.makeUnsafe(ms));

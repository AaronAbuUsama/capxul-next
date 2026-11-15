// What the world's Durable Objects keep about their containers' starts and stops: when, as ISO text, and the latest
// few of each.
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";

/** How many starts and stops a part remembers. */
export const REMEMBERED = 20;

/** A moment, in milliseconds since the epoch, as ISO text. */
export const stamp = (ms: number): string => DateTime.formatIso(DateTime.makeUnsafe(ms));

/** `list` with `next` at its end, keeping the latest `keep`. */
export const remembered = <A>(list: ReadonlyArray<A>, next: A, keep: number = REMEMBERED): ReadonlyArray<A> =>
  Arr.takeRight(Arr.append(list, next), keep);

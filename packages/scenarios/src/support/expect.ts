// How a scenario reads an answer: the refusal a call must fail with, the kind of success it must answer, and
// comparisons whose failures say what was seen. Every helper fails with `ExpectationFailed`, never with a defect.
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Formatter from "effect/Formatter";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { ExpectationFailed, expect } from "../scenario.ts";

type Tagged = { readonly _tag: string };

const hasTag = <A extends Tagged, T extends string>(value: A, tag: T): value is Extract<A, { readonly _tag: T }> =>
  value._tag === tag;

const failed = (message: string) => Effect.fail(ExpectationFailed.make({ message }));

/** Shows a value in a failure's message. */
export const show = (value: unknown): string => Formatter.format(value);

/**
 * The refusal `call` must fail with, narrowed to its class. A success, or any other refusal (`NotImplemented`
 * included), fails the scenario and says what came instead.
 */
export const refusal = <A, E extends Tagged, R, const T extends E["_tag"]>(
  what: string,
  tag: T,
  call: Effect.Effect<A, E, R>,
): Effect.Effect<Extract<E, { readonly _tag: T }>, ExpectationFailed, R> =>
  Effect.matchEffect(call, {
    onSuccess: (answer) => failed(`${what} answered ${show(answer)}; it must be refused with ${tag}`),
    onFailure: (error) =>
      hasTag(error, tag)
        ? Effect.succeed(error)
        : failed(`${what} was refused with ${error._tag}; it must be refused with ${tag}`),
  });

/** The kind of success `call` must answer, narrowed to its class. Another kind fails the scenario. */
export const answers = <A extends Tagged, E, R, const T extends A["_tag"]>(
  what: string,
  tag: T,
  call: Effect.Effect<A, E, R>,
): Effect.Effect<Extract<A, { readonly _tag: T }>, E | ExpectationFailed, R> =>
  Effect.filterOrElse(
    call,
    (answer): answer is Extract<A, { readonly _tag: T }> => hasTag(answer, tag),
    (answer) => failed(`${what} answered ${answer._tag} ${show(answer)}; it must answer ${tag}`),
  );

/** `actual` and `expected` are structurally equal. */
export const same = (what: string, actual: unknown, expected: unknown): Effect.Effect<void, ExpectationFailed> =>
  expect(Equal.equals(actual, expected), `${what} is ${show(actual)}; it must be ${show(expected)}`);

/** The value is present; fails with `what` otherwise. */
export const present = <A>(what: string, value: A | null | undefined): Effect.Effect<A, ExpectationFailed> =>
  value === null || value === undefined ? failed(`${what} is missing`) : Effect.succeed(value);

/** An instant's milliseconds since the epoch, so that two spellings of one instant compare equal. */
export const millis = (instant: string): number => DateTime.toEpochMillis(DateTime.makeUnsafe(instant));

/** `instant` moved by `seconds`, as an RFC 3339 instant in UTC. */
export const addSeconds = (instant: string, seconds: number): string =>
  DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(instant), { seconds }));

/** The two instants are the same instant. */
export const sameInstant = (what: string, actual: string, expected: string): Effect.Effect<void, ExpectationFailed> =>
  expect(millis(actual) === millis(expected), `${what} is ${actual}; it must be ${expected}`);

/** Host time now, as an RFC 3339 instant. */
export const hostNow: Effect.Effect<string> = Effect.map(DateTime.now, DateTime.formatIso);

/** An amount as a number; amounts are decimal strings of at most 6 places, so this is exact for the line's sums. */
export const amountOf = (amount: string): number => Number(amount);

/** Two amounts, or an amount and a number, are the same quantity, however each is spelled. */
export const sameAmount = (
  what: string,
  actual: string | number,
  expected: string | number,
): Effect.Effect<void, ExpectationFailed> =>
  expect(Math.abs(Number(actual) - Number(expected)) < 1e-9, `${what} is ${actual}; it must be ${expected}`);

/** The first of `items` that `holds`; fails with `what` when none does. */
export const findIn = <A>(
  what: string,
  items: ReadonlyArray<A>,
  holds: (item: A) => boolean,
): Effect.Effect<A, ExpectationFailed> => present(what, Option.getOrNull(Arr.findFirst(items, holds)));

/** Two addresses are the same, whatever their letters' case. */
export const sameAddress = (
  what: string,
  actual: string | null,
  expected: string | null,
): Effect.Effect<void, ExpectationFailed> =>
  expect(
    actual !== null && expected !== null && Str.toLowerCase(actual) === Str.toLowerCase(expected),
    `${what} is ${actual}; it must be ${expected}`,
  );

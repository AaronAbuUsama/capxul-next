// The format of an operation's checks. Each operation has one set, written once (one file of this folder), which runs
// on every call of that operation that a journey's step makes, against the call's answer and the world's state: what
// was read before the call (`before`), what it answered, and what the world reads after it. A refusal's check lives
// with the operation that refuses. A journey's step says only what it expects of the call (a kind of success, or a
// refusal by its tag) and what the story alone knows; everything that holds of every such call is here.
//
// A check reads the world through the same client as the step (`Capxul`): those reads are looks, not steps. The runner
// applies its generic checks (events, spans, timings) to them as to every call, but no operation's checks run on a
// look, so checks never check themselves.
import type { CallOptions, OperationName } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import type { Capxul, Failure, Given, Payload, Refusal, Success } from "../client.ts";
import type { ExpectationFailed } from "../expectation.ts";
import type { Journal } from "../journal.ts";
import { same } from "../support/expect.ts";

/** What a check may read: the client, the starting world's facts, and the journey's own memory. */
export type Looks = Capxul | Given | Journal;

/** What a check, or a read before the call, may fail with. */
export type Failed = ExpectationFailed | Failure;

/** One check of one call: what it says, and the Effect that fails when it does not hold. */
export interface Check {
  readonly says: string;
  readonly holds: Effect.Effect<void, Failed, Looks>;
}

/** One call of an operation as a step made it. */
export interface Asked<N extends OperationName> {
  readonly operation: N;
  readonly payload: Payload<N>;
  readonly options: CallOptions;
}

/** What the call answered: a success, or a refusal. */
export type Answer<N extends OperationName> =
  | { readonly _tag: "success"; readonly value: Success<N> }
  | { readonly _tag: "refusal"; readonly error: Refusal<N> };

type RefusalTag<N extends OperationName> = Refusal<N>["_tag"];
type RefusalOf<N extends OperationName, T> = Extract<Refusal<N>, { readonly _tag: T }>;

/** An operation's checks, as its file declares them. `B` is what it reads before each call. */
export interface CheckSet<N extends OperationName, B> {
  readonly before: (asked: Asked<N>) => Effect.Effect<B, Failed, Looks>;
  readonly success: (asked: Asked<N>, answer: Success<N>, before: B) => ReadonlyArray<Check>;
  readonly refusals: {
    readonly [T in RefusalTag<N>]?: (asked: Asked<N>, refusal: RefusalOf<N, T>, before: B) => ReadonlyArray<Check>;
  };
}

/** An operation's checks, ready to run: read what they need before a call, then judge its answer. */
export interface Checks<N extends OperationName> {
  readonly prepare: (asked: Asked<N>) => Effect.Effect<(answer: Answer<N>) => ReadonlyArray<Check>, Failed, Looks>;
}

/** Every refusal of every operation: PayloadRejected names the operation whose payload its schema rejected. */
const everyRefusal = <N extends OperationName>(asked: Asked<N>, refusal: Refusal<N>): ReadonlyArray<Check> =>
  refusal._tag === "PayloadRejected"
    ? [
        {
          says: "PayloadRejected names the operation",
          holds: same("PayloadRejected's operation", refusal.operation, asked.operation),
        },
      ]
    : [];

/** Declares an operation's checks. */
export const checks = <N extends OperationName, B>(set: CheckSet<N, B>): Checks<N> => ({
  prepare: (asked) =>
    Effect.map(set.before(asked), (before) => (answer: Answer<N>) => {
      if (answer._tag === "success") return set.success(asked, answer.value, before);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the check of a refusal is looked up by that refusal's own tag, so it takes that refusal; the compiler cannot narrow a union by a looked-up key
      const byTag = set.refusals as Readonly<
        Record<string, ((asked: Asked<N>, refusal: Refusal<N>, before: B) => ReadonlyArray<Check>) | undefined>
      >;
      const own = byTag[answer.error._tag];
      return [...everyRefusal(asked, answer.error), ...(own === undefined ? [] : own(asked, answer.error, before))];
    }),
});

/** A check: `says` holds when `holds` succeeds. */
export const check = (says: string, holds: Effect.Effect<void, Failed, Looks>): Check => ({ says, holds });

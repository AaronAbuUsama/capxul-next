// What a journey keeps while it runs, and what it tells the runner. `Steps` is the runner's: it hears each step begin,
// each try of its operation with its checks' outcomes, and each step end, so its run record can say which step failed
// and why. `Journal` is the journey's own: which step is due, and every successful call its steps made, which the
// operations' checks read (a payment's document hash, the events a record must end with).
import type { CallOptions, OperationName } from "@capxul/blueprint";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Ref from "effect/Ref";

/** One step of a journey: the one operation it calls, and what it does, in words. */
export interface StepOutline {
  readonly operation: OperationName;
  readonly does: string;
}

/** One check of an operation, run on one call's answer: what it says, whether it held, and what was seen. */
export interface CheckOutcome {
  readonly says: string;
  readonly passed: boolean;
  readonly detail: string;
}

/** One try of a step's operation: who called it, what the step expected, what came back, and its checks. */
export interface Tried {
  readonly operation: OperationName;
  readonly as: string | null;
  readonly operator: "first" | "second";
  /** Another world's door the call went to; null for the journey's own world, or a platform operation. */
  readonly at: string | null;
  /** What the step expected: a kind of success (`Founded`), `a success`, or `refused <tag>`. */
  readonly expected: string;
  /** What came back: the kind of success, `a success`, `refused <tag>`, or `died`. */
  readonly answered: string;
  /** Every check of the operation that ran on the answer; none when the answer was not what the step expected. */
  readonly checks: ReadonlyArray<CheckOutcome>;
}

/** The runner's ear: a journey tells it each step's beginning, each try and each end, numbered from 1. */
export class Steps extends Context.Service<
  Steps,
  {
    readonly begin: (step: number, outline: StepOutline) => Effect.Effect<void>;
    readonly tried: (step: number, tried: Tried) => Effect.Effect<void>;
    /** `failure` is why the step failed, in words; null when it did not. */
    readonly end: (step: number, failure: string | null) => Effect.Effect<void>;
  }
>()("@capxul/scenarios/journal/Steps") {}

/** One successful call a step made: what was sent, what came back, and where. */
export interface Made {
  readonly operation: OperationName;
  readonly payload: unknown;
  readonly success: unknown;
  readonly options: CallOptions;
}

/** The journey's own memory while it runs. */
export class Journal extends Context.Service<
  Journal,
  {
    /** The number of the step that is due next, from 1. */
    readonly next: Ref.Ref<number>;
    /** Every successful call of every step, in order. */
    readonly made: Ref.Ref<ReadonlyArray<Made>>;
  }
>()("@capxul/scenarios/journal") {}

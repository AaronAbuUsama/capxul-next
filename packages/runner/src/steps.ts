// What the runner hears of a journey's steps, and how it records them. A journey tells the runner (`Steps`, from
// @capxul/scenarios) when each step begins and ends and how each try of its operation went with its operation's
// checks; the runner adds which of the run's calls each step made, how long it took, and whether every generic check
// passed on those calls. The run record keeps every step of the journey's outline, those never reached included, and
// names the first step that failed.
import { Steps, type StepOutline, type Tried } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { pipe } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Tracer from "effect/Tracer";
import type { CheckedCall } from "./checks/checks.ts";
import type { Call } from "./client.ts";
import { RUN_SPANS } from "./timings.ts";

/** One step as the runner heard it while the journey ran. */
export interface Heard {
  readonly step: number;
  readonly outline: StepOutline;
  /** How many calls the run had made when the step began, and when it ended. */
  readonly from: number;
  readonly to: number | null;
  readonly startedMs: number;
  readonly endedMs: number | null;
  readonly tries: ReadonlyArray<Tried>;
  /** Why it failed, in the journey's words; null while it runs and when it did not. */
  readonly failure: string | null;
}

/** The span of the step a journey is in, while it is in one: each call it makes is linked to it (client.ts). */
export type OpenStep = Ref.Ref<Option.Option<Tracer.Span>>;

/**
 * `Steps` for one run: every step heard into `heard`, its calls counted from `log`. Each step is also a span of the
 * journey's (`runner.journey.step`), open from its beginning to its end and failed when the step failed; `open`
 * holds it meanwhile.
 */
export const hearing = (heard: Ref.Ref<ReadonlyArray<Heard>>, log: Ref.Ref<ReadonlyArray<Call>>, open: OpenStep) =>
  Layer.succeed(Steps, {
    begin: (step, outline) =>
      Effect.gen(function* () {
        const from = (yield* Ref.get(log)).length;
        const startedMs = yield* Clock.currentTimeMillis;
        const span = yield* Effect.makeSpan(RUN_SPANS.step, {
          attributes: { step, operation: outline.operation, does: outline.does },
        });
        yield* Ref.set(open, Option.some(span));
        yield* Ref.update(heard, (all) => [
          ...all,
          { step, outline, from, to: null, startedMs, endedMs: null, tries: [], failure: null },
        ]);
      }),
    tried: (step, tried) =>
      Ref.update(heard, (all) =>
        Arr.map(all, (each) => (each.step === step ? { ...each, tries: [...each.tries, tried] } : each)),
      ),
    end: (step, failure) =>
      Effect.gen(function* () {
        const to = (yield* Ref.get(log)).length;
        const endedMs = yield* Clock.currentTimeMillis;
        const span = yield* Ref.getAndSet(open, Option.none());
        if (Option.isSome(span)) {
          const endedNanos = yield* Clock.currentTimeNanos;
          span.value.end(endedNanos, failure === null ? Exit.void : Exit.fail(failure));
        }
        yield* Ref.update(heard, (all) =>
          Arr.map(all, (each) => (each.step === step ? { ...each, to, endedMs, failure } : each)),
        );
      }),
  });

const CheckOutcome = Schema.Struct({ says: Schema.String, passed: Schema.Boolean, detail: Schema.String });

const Try = Schema.Struct({
  operation: Schema.String,
  as: Schema.NullOr(Schema.String),
  operator: Schema.Literals(["first", "second"]),
  at: Schema.NullOr(Schema.String),
  /** What the step expected of the call: a kind of success, `a success`, or `refused <tag>`. */
  expected: Schema.String,
  /** What came back. */
  answered: Schema.String,
  /** The operation's checks (packages/scenarios, src/checks/), each with how it went. */
  checks: Schema.Array(CheckOutcome),
});

export const StepRecord = Schema.Struct({
  /** Its place in the journey, from 1. */
  step: Schema.Finite,
  operation: Schema.String,
  does: Schema.String,
  /**
   * `passed`: it ended as the journey expected, every check of its operation held, and every generic check passed
   * on every call it made. `not reached`: an earlier step failed.
   */
  outcome: Schema.Literals(["passed", "failed", "not reached"]),
  failure: Schema.NullOr(Schema.String),
  /** Each call of its operation the step made, with what it expected and what its operation's checks found. */
  tries: Schema.Array(Try),
  /** Every call it made (its tries, its waits and what it and its checks read), by place in the record's `calls`, from 1. */
  calls: Schema.Array(Schema.Finite),
  /** How long it took, from its beginning to its end. */
  ms: Schema.NullOr(Schema.Finite),
});
export type StepRecord = typeof StepRecord.Type;

/** The first step that failed, and why. */
export const FailedStep = Schema.Struct({
  step: Schema.Finite,
  operation: Schema.String,
  does: Schema.String,
  why: Schema.String,
});
export type FailedStep = typeof FailedStep.Type;

const callFailures = (calls: ReadonlyArray<CheckedCall>, indexes: ReadonlyArray<number>) =>
  pipe(
    indexes,
    Arr.flatMap((index) => {
      const call = calls[index - 1];
      if (call === undefined) return [];
      return Arr.map(
        Arr.filter(call.checks, (check) => !check.passed),
        (check) => `call ${index} (${call.operation}): ${check.check}: ${check.detail}`,
      );
    }),
  );

/** Every step of `outline` as the run record keeps it, from what was heard and the run's checked calls. */
export const stepsOf = (
  outline: ReadonlyArray<StepOutline>,
  heard: ReadonlyArray<Heard>,
  calls: ReadonlyArray<CheckedCall>,
): ReadonlyArray<StepRecord> =>
  Arr.map(outline, (step, index) => {
    const found = Arr.findFirst(heard, (each) => each.step === index + 1);
    if (Option.isNone(found))
      return {
        step: index + 1,
        operation: step.operation,
        does: step.does,
        outcome: "not reached",
        failure: null,
        tries: [],
        calls: [],
        ms: null,
      };
    const it = found.value;
    const last = Math.min(it.to ?? calls.length, calls.length);
    const indexes = last > it.from ? Arr.range(it.from + 1, last) : [];
    const generic = callFailures(calls, indexes);
    const failures = [...(it.failure === null ? [] : [it.failure]), ...generic];
    return {
      step: index + 1,
      operation: step.operation,
      does: step.does,
      outcome: failures.length === 0 && it.to !== null ? "passed" : "failed",
      failure: failures.length === 0 ? (it.to === null ? "it did not end" : null) : Arr.join(failures, "\n"),
      tries: it.tries,
      calls: indexes,
      ms: it.endedMs === null ? null : it.endedMs - it.startedMs,
    };
  });

/** The first step that failed, or null when none did. */
export const failedStepOf = (steps: ReadonlyArray<StepRecord>): FailedStep | null =>
  pipe(
    Arr.findFirst(steps, (step) => step.outcome === "failed"),
    Option.map((step) => ({
      step: step.step,
      operation: step.operation,
      does: step.does,
      why: step.failure ?? "",
    })),
    Option.getOrNull,
  );

// How a step calls its operation. Each try: the operation's checks read what they need, the call goes through
// `Capxul`, its answer is held against what the step expects (a kind of success, or a refusal by its tag), and then
// every check of the operation runs on the answer. The runner hears each try with its checks' outcomes (`Steps`).
//
// An answer the step did not expect fails the step. A `NotImplemented` fails it with that very refusal, so a journey
// against Core's empty handlers ends on what they answered; any other fails it with `ExpectationFailed`. A check that
// does not hold fails the step too, after every check has run and been heard.
import type { CallOptions, OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import { OperationChecks, type AllChecks, type Answer, type Asked, type Check } from "./checks/format.ts";
import {
  CallTraces,
  Capxul,
  ThisCall,
  type CapxulClient,
  type Failure,
  type Payload,
  type Refusal,
  type Success,
} from "./client.ts";
import { ExpectationFailed } from "./expectation.ts";
import { Journal, Steps, type CheckOutcome } from "./journal.ts";
import { said, shown } from "./said.ts";
import { WAIT } from "./support/wait.ts";

type Needs = Capxul | import("./client.ts").Given | Steps | Journal | OperationChecks;
type Failed = ExpectationFailed | Failure;
type KindOf<N extends OperationName> = Success<N> extends { readonly _tag: infer T extends string } ? T : never;

/** How a step calls its one operation. Each method is one try (a wait is one try of several calls). */
export interface Tries<N extends OperationName> {
  /** A call that must succeed. */
  readonly succeeds: (payload: Payload<N>, options?: CallOptions) => Effect.Effect<Success<N>, Failed, Needs>;
  /** A call that must answer this kind of success. */
  readonly answers: <const K extends KindOf<N>>(
    kind: K,
    payload: Payload<N>,
    options?: CallOptions,
  ) => Effect.Effect<Extract<Success<N>, { readonly _tag: K }>, Failed, Needs>;
  /** A call that must be refused with this refusal. */
  readonly refused: <const T extends Refusal<N>["_tag"]>(
    tag: T,
    payload: Payload<N>,
    options?: CallOptions,
  ) => Effect.Effect<Extract<Refusal<N>, { readonly _tag: T }>, Failed, Needs>;
  /** The call made again until its success holds what `done` asks (`what`); the checks run on the last answer. */
  readonly until: (
    what: string,
    payload: Payload<N>,
    options: CallOptions,
    done: (answer: Success<N>) => boolean,
  ) => Effect.Effect<Success<N>, Failed, Needs>;
  /** The call made again while it is refused with `tag`; then it must succeed, and the checks run on that. */
  readonly whileRefused: (
    tag: Refusal<N>["_tag"],
    payload: Payload<N>,
    options?: CallOptions,
  ) => Effect.Effect<Success<N>, Failed, Needs>;
}

type Expected =
  | { readonly _tag: "success"; readonly kind: string | null }
  | { readonly _tag: "refusal"; readonly tag: string };

/** How a try calls again: never, until a success holds, or while it is refused with a tag. */
type Again =
  | { readonly _tag: "once" }
  | { readonly _tag: "until"; readonly what: string; readonly done: (answer: unknown) => boolean }
  | { readonly _tag: "while refused"; readonly tag: string };

const tagOf = (value: unknown): string | null =>
  Predicate.hasProperty(value, "_tag") && Predicate.isString(value._tag) ? value._tag : null;

const expectedWords = (expected: Expected): string =>
  expected._tag === "refusal" ? `refused ${expected.tag}` : (expected.kind ?? "a success");

const answeredWords = (exit: Exit.Exit<unknown, Failure>): string => {
  if (Exit.isSuccess(exit)) return tagOf(exit.value) ?? "a success";
  const error = Cause.findErrorOption(exit.cause);
  return Option.isSome(error) ? `refused ${error.value._tag}` : "died";
};

const matches = (expected: Expected, exit: Exit.Exit<unknown, Failure>): boolean => {
  if (Exit.isSuccess(exit))
    return expected._tag === "success" && (expected.kind ?? tagOf(exit.value)) === tagOf(exit.value);
  const error = Cause.findErrorOption(exit.cause);
  return expected._tag === "refusal" && Option.isSome(error) && error.value._tag === expected.tag;
};

/** The client's function for `name`, typed loosely: a try sends what its step built for that operation. */
const callOf = (capxul: CapxulClient, name: OperationName) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each operation's function takes its own payload; a try holds the payload its step built for exactly that operation, which the compiler cannot follow through a name
  capxul[name] as unknown as (payload: unknown, options?: CallOptions) => Effect.Effect<unknown, Failure>;

/** The checks of `name`, typed loosely, as `callOf`. */
const checksOf = (all: AllChecks, name: OperationName) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the checks of an operation judge that operation's calls only; a try hands them the call it made of it
  all[name] as unknown as {
    readonly prepare: (
      asked: Asked<OperationName>,
    ) => Effect.Effect<(answer: Answer<OperationName>) => ReadonlyArray<Check>, Failed, Needs>;
  };

/** Runs every check of the call traced `trace`, each to its end, and says how each went. */
const judge = (checks: ReadonlyArray<Check>, trace: string | null) =>
  Effect.forEach(checks, (each) =>
    Effect.map(Effect.exit(Effect.provideService(each.holds, ThisCall, { trace })), (exit): CheckOutcome => ({
      says: each.says,
      passed: Exit.isSuccess(exit),
      detail: Exit.isSuccess(exit) ? "" : said(exit.cause),
    })),
  );

/** One try of `operation` in step `step`. */
const attempt = (step: number, asked: Asked<OperationName>, expected: Expected, again: Again) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const steps = yield* Steps;
    const journal = yield* Journal;
    const checks = yield* OperationChecks;
    const prepared = yield* Effect.exit(checksOf(checks, asked.operation).prepare(asked));
    // The trace of the try's last call, as the client tells it: the checks judge what that call caused.
    const trace = yield* Ref.make<string | null>(null);
    const call = callOf(capxul, asked.operation)(asked.payload, asked.options).pipe(
      Effect.provideService(CallTraces, { heard: (heard) => Ref.set(trace, heard) }),
    );
    let exit = yield* Effect.exit(call);
    for (let left = WAIT.attempts; left > 1 && repeats(again, exit); left -= 1) {
      yield* Effect.sleep(WAIT.every);
      exit = yield* Effect.exit(call);
    }
    const tried = {
      operation: asked.operation,
      as: asked.options.as ?? null,
      operator: asked.options.operator ?? "first",
      at: asked.options.at ?? null,
      expected: again._tag === "until" ? `${expectedWords(expected)} with ${again.what}` : expectedWords(expected),
      answered: answeredWords(exit),
    } as const;
    const error = Exit.isFailure(exit) ? exit.cause.pipe(Cause.findErrorOption) : Option.none();
    if (Exit.isFailure(exit) && Option.isNone(error)) {
      yield* steps.tried(step, { ...tried, checks: [] });
      return yield* Effect.failCause(exit.cause);
    }
    if (!matches(expected, exit) || (again._tag === "until" && Exit.isSuccess(exit) && !again.done(exit.value))) {
      yield* steps.tried(step, { ...tried, checks: [] });
      if (Option.isSome(error) && error.value._tag === "NotImplemented") return yield* error.value;
      const seen = Exit.isSuccess(exit) ? shown(exit.value) : said(exit.cause);
      return yield* ExpectationFailed.make({
        message: `${asked.operation}${asked.options.as === undefined ? "" : ` as ${asked.options.as}`} answered ${tried.answered} (${seen}); the step expects ${tried.expected}`,
      });
    }
    const answer = answerOf(exit, error);
    const outcomes = Exit.isSuccess(prepared)
      ? yield* judge(prepared.value(answer), yield* Ref.get(trace))
      : [{ says: "what the checks read before the call", passed: false, detail: said(prepared.cause) }];
    yield* steps.tried(step, { ...tried, checks: outcomes });
    if (Exit.isSuccess(exit))
      yield* Ref.update(journal.made, (all) => [
        ...all,
        { operation: asked.operation, payload: asked.payload, success: exit.value, options: asked.options },
      ]);
    const failed = Arr.filter(outcomes, (each) => !each.passed);
    if (failed.length > 0)
      return yield* ExpectationFailed.make({
        message: Arr.join(
          Arr.map(failed, (each) => `${asked.operation}: ${each.says}: ${each.detail}`),
          "\n",
        ),
      });
    return Exit.isSuccess(exit) ? exit.value : Option.getOrUndefined(error);
  });

/** The answer the checks judge: the success, or the refusal the call failed with. */
const answerOf = (exit: Exit.Exit<unknown, Failure>, error: Option.Option<Failure>): Answer<OperationName> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the call was of this operation, so its success and its refusal are that operation's own
  (Exit.isSuccess(exit)
    ? { _tag: "success", value: exit.value }
    : { _tag: "refusal", error: Option.getOrUndefined(error) }) as Answer<OperationName>;

/** Whether a wait calls again after this answer. */
const repeats = (again: Again, exit: Exit.Exit<unknown, Failure>): boolean => {
  if (again._tag === "until") return Exit.isSuccess(exit) && !again.done(exit.value);
  if (again._tag === "while refused")
    return Exit.isFailure(exit) && tagOf(exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined)) === again.tag;
  return false;
};

/** A success of a wait's call, as `done` takes it. */
const successOf = <N extends OperationName>(answer: unknown): Success<N> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the answers a wait sees are successes of its operation's own calls
  answer as Success<N>;

/** The tries of `operation` in step `step`. */
export const triesOf = <N extends OperationName>(step: number, operation: N): Tries<N> => {
  const once = { _tag: "once" } as const;
  const run = (payload: unknown, options: CallOptions | undefined, expected: Expected, again: Again) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a try answers what its operation answered, narrowed to what the step expected and checked to be so
    attempt(step, { operation, payload, options: options ?? {} } as Asked<OperationName>, expected, again) as never;
  return {
    succeeds: (payload, options) => run(payload, options, { _tag: "success", kind: null }, once),
    answers: (kind, payload, options) => run(payload, options, { _tag: "success", kind }, once),
    refused: (tag, payload, options) => run(payload, options, { _tag: "refusal", tag }, once),
    until: (what, payload, options, done) =>
      run(
        payload,
        options,
        { _tag: "success", kind: null },
        { _tag: "until", what, done: (answer) => done(successOf(answer)) },
      ),
    whileRefused: (tag, payload, options) =>
      run(payload, options, { _tag: "success", kind: null }, { _tag: "while refused", tag }),
  };
};

// How a journey is declared. A journey is a story of operations in order, from one of the blueprint's starting
// worlds: found a company and give a member the books, pay a bill and branch the books (docs/roadmap.md, "Scenarios
// are journeys"). It is 5 to 10 steps; each step calls one operation, once or a few times, and says what it expects of
// each call. Every call a step makes is judged by its operation's checks (src/checks/), written once, which run on
// every call of that operation in every journey. The runner adds its generic checks (events, spans, timings).
//
//   const steps = outline({
//     found: ["org.create", "dana founds Northwind"],
//     sign: ["approval.sign", "dana and eli sign its setup"],
//   });
//   export const founding = journey({ name, story, given: startingWorlds.fresh, steps }, Effect.gen(function* () {
//     const founded = yield* steps.found.run((op) => op.answers("Founded", NORTHWIND, { as: "dana" }));
//     ...
//   }));
//
// Steps run in the order the outline lists them, each once; a journey that skips one, or ends before its last, dies.
import type { OperationName, StartingWorld } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import type { OperationChecks } from "./checks/format.ts";
import type { Capxul, Failure, Given } from "./client.ts";
import type { ExpectationFailed } from "./expectation.ts";
import { Journal, Steps, type Made, type StepOutline } from "./journal.ts";
import { said } from "./said.ts";
import { triesOf, type Tries } from "./tries.ts";

/** What a journey's steps may fail with: a declared refusal it did not expect, or an expectation that did not hold. */
export type Failed = ExpectationFailed | Failure;

/** What a journey needs: the client, its starting world's facts, and the runner's ear. */
export type Needs = Capxul | Given | Steps;

export interface Journey {
  /** Unique among all journeys; it names the run record. */
  readonly name: string;
  /** The story it tells, in one sentence. */
  readonly story: string;
  /** The starting world it begins from: one of the blueprint's. */
  readonly given: StartingWorld;
  /** Its steps, in order. */
  readonly outline: ReadonlyArray<StepOutline>;
  readonly run: Effect.Effect<void, Failed, Needs>;
}

/**
 * A journey as its file declares it: its run still needs every operation's checks, which the registry gives it
 * (registry.ts). A domain's file (domains/) lists it, and the registry runs it as a `Journey`.
 */
export interface Declared extends Omit<Journey, "run"> {
  readonly run: Effect.Effect<void, Failed, Needs | OperationChecks>;
}

/** One step: its place in the journey (from 1), its operation and its words, and how to run it. */
export interface Step<N extends OperationName> extends StepOutline {
  readonly operation: N;
  readonly index: number;
  /** Runs the step: `body` calls the step's operation through `op`, and may read the world to observe what it did. */
  readonly run: <A, E, R>(body: (op: Tries<N>) => Effect.Effect<A, E, R>) => Effect.Effect<A, E, R | Steps | Journal>;
}

/** One step, from its operation, its words and its place. */
const stepOf = <N extends OperationName>(operation: N, does: string, index: number): Step<N> => ({
  operation,
  does,
  index,
  run: (body) =>
    Effect.gen(function* () {
      const journal = yield* Journal;
      const steps = yield* Steps;
      const due = yield* Ref.get(journal.next);
      if (due !== index) return yield* Effect.die(`step ${index} (${does}) began where step ${due} was due`);
      yield* Ref.set(journal.next, index + 1);
      yield* steps.begin(index, { operation, does });
      return yield* body(triesOf(index, operation)).pipe(
        Effect.onExit((exit) => steps.end(index, Exit.isSuccess(exit) ? null : said(exit.cause))),
      );
    }),
});

/** A journey's steps, by name, each `[operation, what it does]`. Their order is the journey's. */
export const outline = <const D extends Readonly<Record<string, readonly [OperationName, string]>>>(
  declared: D,
): { readonly [K in keyof D]: Step<D[K][0]> } => {
  const entries = Rec.toEntries<string, readonly [OperationName, string]>(declared);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one step per declared key, each built from that key's own operation; the compiler cannot follow a mapped object built from its entries
  return Rec.fromEntries(
    Arr.map(entries, ([name, [operation, does]], index) => [name, stepOf(operation, does, index + 1)] as const),
  ) as unknown as { readonly [K in keyof D]: Step<D[K][0]> };
};

/** Declares a journey: its steps run by `run`, in their order, each once. */
export const journey = (
  declared: {
    readonly name: string;
    readonly story: string;
    readonly given: StartingWorld;
    readonly steps: Readonly<Record<string, StepOutline & { readonly index: number }>>;
  },
  run: Effect.Effect<void, Failed, Needs | OperationChecks | Journal>,
): Declared => {
  const steps = Arr.sort(
    Rec.values(declared.steps),
    Order.mapInput(Order.Number, (each: { readonly index: number }) => each.index),
  );
  return {
    name: declared.name,
    story: declared.story,
    given: declared.given,
    outline: Arr.map(steps, (each) => ({ operation: each.operation, does: each.does })),
    run: Effect.gen(function* () {
      const journal = yield* Journal;
      yield* run;
      const due = yield* Ref.get(journal.next);
      return yield* due === steps.length + 1 ? Effect.void : Effect.die(`the journey ended before step ${due}`);
    }).pipe(
      Effect.provideServiceEffect(Journal, Effect.all({ next: Ref.make(1), made: Ref.make<ReadonlyArray<Made>>([]) })),
    ),
  };
};

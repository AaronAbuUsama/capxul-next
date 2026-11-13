// What one operation declares beyond its Rpc: the events each kind of success emits, what each event must carry,
// how fast the call must be and what that number measures, and one worked example per kind of success. A generic
// runner reads these, so no scenario restates them. Nothing here reaches outside itself.
//
// This is the format of the pipeline spike (`spikes/pipeline/contract/operation.ts`), extended in three ways that
// decisions.md explains: an operation may have several kinds of success, each with its own events (`outcomes`);
// the budget says what it measures and whether a measurement is behind it (`budget`); and every declaration
// carries examples, which the tests run through `carries`.
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Rpc from "effect/rpc/Rpc";

/** An event or an outcome is a Schema class with a literal `_tag`; the tag is its name wherever it is recorded. */
export interface EventClass<Tag extends string = string> extends Schema.Codec<unknown, unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: a class constructor's arguments are not ours to name
  new (...args: any): { readonly _tag: Tag };
  readonly identifier: Tag;
  readonly fields: { readonly [field: string]: Schema.Codec<unknown, unknown> };
}

/** What an event carries: its fields without the `_tag` that names it. It is recorded as exactly this. */
export type Carried<E extends EventClass> = Omit<Schema.Struct.Type<E["fields"]>, "_tag">;

type PayloadOf<R extends Rpc.AnyWithProps> = R["payloadSchema"]["Type"];
type SuccessOf<R extends Rpc.AnyWithProps> = R["successSchema"]["Type"];

/** One successful call as its caller knows it: what was sent and what came back. */
export interface Answered<R extends Rpc.AnyWithProps, S = SuccessOf<R>> {
  readonly payload: PayloadOf<R>;
  readonly success: S;
}

/** One event a successful call emits, exactly once, and what it must carry: a pure function of that call. */
export interface Emitted<R extends Rpc.AnyWithProps, E extends EventClass, S = SuccessOf<R>> {
  readonly event: E;
  readonly carries: (call: Answered<R, S>) => Carried<E>;
}

/** The waits a budget can leave out. A call that never waits for one of these has nothing to leave out. */
export type Wait = "waking a parked world" | "a person signing" | "chain confirmation on a public chain";

/**
 * The one speed budget of an operation, declared here and nowhere else. It bounds the p95 of the server's own span
 * for the call (from the request decoded to the answer encoded) over warm runs, less the waits it names. Internal
 * steps have no budget: they are spans, reported as a breakdown of this time.
 */
export interface Budget {
  readonly ms: number;
  readonly excludes: ReadonlyArray<Wait>;
  /** True until a green run has measured the operation; that run's measurement then replaces `ms` and `basis`. */
  readonly provisional: boolean;
  /** Where the number comes from: a measurement and its run, or the reasoning behind a first guess. */
  readonly basis: string;
}

type OutcomeTag<R extends Rpc.AnyWithProps> = SuccessOf<R> extends { readonly _tag: infer T extends string } ? T : never;
type OutcomeOf<R extends Rpc.AnyWithProps, T> = Extract<SuccessOf<R>, { readonly _tag: T }>;

/** An operation with one kind of success: the spike's form. */
export interface Single<R extends Rpc.AnyWithProps, Events extends ReadonlyArray<EventClass>> {
  readonly rpc: R;
  readonly emits: { readonly [I in keyof Events]: Emitted<R, Events[I]> };
  readonly budget: Budget;
  readonly examples: ReadonlyArray<Answered<R>>;
}

/** One kind of success of an operation, by its tag, and the events it emits. Made with `outcome`. */
export interface Outcome<T extends string, Ev extends EventClass> {
  readonly tag: T;
  readonly emits: ReadonlyArray<{ readonly event: Ev; readonly carries: (call: never) => unknown }>;
}

/**
 * Declares one outcome of `rpc`: `carries` is typed by that outcome's own success, so an event can only read what
 * that kind of success holds.
 */
export const outcome = <
  R extends Rpc.AnyWithProps,
  const T extends OutcomeTag<R>,
  const Events extends ReadonlyArray<EventClass>,
>(_rpc: R, tag: T, emits: { readonly [I in keyof Events]: Emitted<R, Events[I], OutcomeOf<R, T>> }): Outcome<T, Events[number]> => ({
  tag,
  emits: emits as never,
});

/** An operation whose success is a union of tagged outcomes: every outcome is declared, each with its own events. */
export interface Several<R extends Rpc.AnyWithProps, Outs extends { readonly [T in OutcomeTag<R>]: Outcome<T, EventClass> }> {
  readonly rpc: R;
  readonly outcomes: Outs;
  readonly budget: Budget;
  readonly examples: ReadonlyArray<Answered<R>>;
}

/** A declared event of one successful call, and what that call's event must carry. */
export interface Expected {
  readonly event: EventClass;
  readonly carried: unknown;
}

export interface Unchecked {
  readonly payload: unknown;
  readonly success: unknown;
}

export interface Operation<R extends Rpc.AnyWithProps = Rpc.AnyWithProps, Ev extends EventClass = EventClass> {
  readonly rpc: R;
  /** Every event any successful call may emit. Which ones a given call emits depends on its outcome. */
  readonly emits: ReadonlyArray<Ev>;
  /** Each kind of success by its tag (null for an operation with one kind) and the events it emits, in order. */
  readonly outcomes: ReadonlyArray<{ readonly tag: string | null; readonly emits: ReadonlyArray<EventClass> }>;
  readonly budget: Budget;
  /** `budget.ms`, under the name the spike's runner reads. */
  readonly budgetMs: number;
  readonly examples: ReadonlyArray<Unchecked>;
  /**
   * What each event of one successful call must carry. `None` when `payload` or `success` is not of the Rpc's own
   * schemas, so the call cannot have been a successful call of this operation.
   */
  readonly expected: (call: Unchecked) => Option.Option<ReadonlyArray<Expected>>;
}

/** An instance of any event the operation declares. Core's `emit` accepts nothing else for that operation. */
export type EventOf<O extends Operation> = InstanceType<O["emits"][number]>;

const build = <R extends Rpc.AnyWithProps>(
  rpc: R,
  outcomes: ReadonlyArray<{ readonly tag: string | null; readonly emits: ReadonlyArray<Emitted<R, EventClass, never>> }>,
  budget: Budget,
  examples: ReadonlyArray<Unchecked>,
): Operation<R> => {
  const isPayload = Schema.is(rpc.payloadSchema);
  const isSuccess = Schema.is(rpc.successSchema);
  const tagOf = (success: unknown): string | null =>
    typeof success === "object" && success !== null && "_tag" in success && typeof success._tag === "string" ? success._tag : null;
  return {
    rpc,
    emits: [...new Set(outcomes.flatMap((outcome) => outcome.emits.map((emitted) => emitted.event)))],
    outcomes: outcomes.map((outcome) => ({ tag: outcome.tag, emits: outcome.emits.map((emitted) => emitted.event) })),
    budget,
    budgetMs: budget.ms,
    examples,
    expected: ({ payload, success }) => {
      if (!isPayload(payload) || !isSuccess(success)) return Option.none();
      const tag = outcomes.length === 1 && outcomes[0]?.tag === null ? null : tagOf(success);
      const outcome = outcomes.find((candidate) => candidate.tag === tag);
      if (outcome === undefined) return Option.none();
      return Option.some(outcome.emits.map((emitted) => ({ event: emitted.event, carried: emitted.carries({ payload, success: success as never }) })));
    },
  };
};

/** Declares an operation with one kind of success. */
export const declare = <R extends Rpc.AnyWithProps, const Events extends ReadonlyArray<EventClass>>(
  declaration: Single<R, Events>,
): Operation<R, Events[number]> =>
  build(declaration.rpc, [{ tag: null, emits: declaration.emits as never }], declaration.budget, declaration.examples) as never;

/** Declares an operation whose success is one of several tagged outcomes, each with its own events. */
export const declareOutcomes = <
  R extends Rpc.AnyWithProps,
  const Outs extends { readonly [T in OutcomeTag<R>]: Outcome<T, EventClass> },
>(declaration: Several<R, Outs>): Operation<R, Outs[keyof Outs]["emits"][number]["event"]> =>
  build(
    declaration.rpc,
    Object.values<Outcome<string, EventClass>>(declaration.outcomes).map((each) => ({ tag: each.tag, emits: each.emits as never })),
    declaration.budget,
    declaration.examples,
  ) as never;

/** The names of the events the operation declares. */
export const eventNamesOf = (operation: Operation): ReadonlyArray<string> => operation.emits.map((event) => event.identifier);

/** The refusals the operation's Rpc declares, as classes. */
export const refusalsOf = (operation: Operation): ReadonlyArray<EventClass> => {
  const schema = operation.rpc.errorSchema as unknown as { readonly members?: ReadonlyArray<EventClass> } & EventClass;
  return schema.members ?? ("identifier" in schema ? [schema] : []);
};

/** True when `error` is one of the typed refusals the operation's Rpc declares. */
export const isRefusal = (operation: Operation, error: unknown): boolean => Schema.is(operation.rpc.errorSchema)(error);

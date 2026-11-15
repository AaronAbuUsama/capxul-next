// What one operation declares beyond its Rpc: the events each kind of success emits, what each event must carry,
// how fast the call must be and what that number measures, and one worked example per kind of success. A generic
// runner reads these, so no scenario restates them. Nothing here reaches outside itself.
//
// This is the format of the pipeline spike (`spikes/pipeline/contract/operation.ts`), extended in three ways: an
// operation may have several kinds of success, each with its own events (`outcomes`, see `Several`); the budget says
// what it measures and whether a measurement is behind it (`budget`); and every declaration carries examples, one
// valid call per kind of success, which the tests run through `carries`.
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import type * as Rpc from "effect/rpc/Rpc";
import { KIND } from "./kinds.ts";
import type { Log, Span } from "./work.ts";

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

/**
 * One event a successful call emits, exactly once, and what it must carry: a pure function of that call, so the
 * runner computes it from what the caller saw. Where an event needs a value, the answer carries it too. Events are
 * named for what happened, not for a machine's move. Work that finishes after the call has answered (a payment
 * settling, a site becoming ready) is never a declared event: "exactly once per call" is decided when it answers.
 */
export interface Emitted<R extends Rpc.AnyWithProps, E extends EventClass, S = SuccessOf<R>> {
  readonly event: E;
  readonly carries: (call: Answered<R, S>) => Carried<E>;
}

/**
 * The waits a budget can leave out. A call that never waits for one of these has nothing to leave out: operations
 * through a world's door are measured warm, so they leave out waking a parked world; no operation waits for a person
 * signing; chain confirmation arises only on a public chain.
 */
export type Wait = "waking a parked world" | "a person signing" | "chain confirmation on a public chain";

/**
 * The one speed budget of an operation, declared here and nowhere else. It is the target for the p95 of the server's
 * own span for the call (from the request decoded to the answer encoded) over warm runs, less the waits it names.
 * Internal steps have no budget: they are spans, reported as a breakdown of this time. A budget is recorded next to
 * every measured time and is not enforced: nothing fails on speed until it is set from measured runs.
 */
export interface Budget {
  readonly ms: number;
  readonly excludes: ReadonlyArray<Wait>;
  /** True until a green run has measured the operation; that run's measurement then replaces `ms` and `basis`. */
  readonly provisional: boolean;
  /** Where the number comes from: a measurement and its run, or the reasoning behind a first guess. */
  readonly basis: string;
}

type OutcomeTag<R extends Rpc.AnyWithProps> =
  SuccessOf<R> extends { readonly _tag: infer T extends string } ? T : never;
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
>(
  _rpc: R,
  tag: T,
  emits: { readonly [I in keyof Events]: Emitted<R, Events[I], OutcomeOf<R, T>> },
): Outcome<T, Events[number]> => ({
  tag,
  emits: emits,
});

/**
 * An operation whose success is a union of tagged outcomes: every outcome is declared, each with its own events, and
 * leaving one out is a compile error. A union, not two operations, because the caller cannot choose the path (the
 * document decides), and not one shape with optional fields, which would let an event read a field its path lacks.
 */
export interface Several<
  R extends Rpc.AnyWithProps,
  Outs extends { readonly [T in OutcomeTag<R>]: Outcome<T, EventClass> },
> {
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

export interface Operation<
  R extends Rpc.AnyWithProps = Rpc.AnyWithProps,
  Ev extends EventClass = EventClass,
> extends Omit<Formats<Rpc.AnyWithProps>, "refusals"> {
  readonly rpc: R;
  /** The log written where each refusal it decides is decided, by the refusal's tag. */
  readonly refusals?: { readonly [tag: string]: Log | undefined };
  /** Marks it as a verb's operation (`kindOf`). */
  readonly [KIND]?: "verb";
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

/** The `_tag` of a tagged success, or null for a success that has none. */
const tagOf = (success: unknown): string | null =>
  typeof success === "object" && success !== null && "_tag" in success && typeof success._tag === "string"
    ? success._tag
    : null;

const build = <R extends Rpc.AnyWithProps>(
  rpc: R,
  outcomes: ReadonlyArray<{
    readonly tag: string | null;
    readonly emits: ReadonlyArray<Emitted<R, EventClass, never>>;
  }>,
  budget: Budget,
  examples: ReadonlyArray<Unchecked>,
): Operation<R> => {
  const isPayload = Schema.is(rpc.payloadSchema);
  const isSuccess = Schema.is(rpc.successSchema);
  return {
    rpc,
    emits: Arr.dedupe(Arr.flatMap(outcomes, (each) => Arr.map(each.emits, (emitted) => emitted.event))),
    outcomes: Arr.map(outcomes, (each) => ({ tag: each.tag, emits: Arr.map(each.emits, (emitted) => emitted.event) })),
    budget,
    budgetMs: budget.ms,
    examples,
    expected: ({ payload, success }) => {
      if (!isPayload(payload) || !isSuccess(success)) return Option.none();
      const tag = outcomes.length === 1 && outcomes[0]?.tag === null ? null : tagOf(success);
      return Option.map(
        Arr.findFirst(outcomes, (candidate) => candidate.tag === tag),
        (matched) =>
          Arr.map(matched.emits, (emitted) => ({
            event: emitted.event,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each `carries` is typed by its own outcome's success; it is called only after the success's tag matched that outcome, which the compiler cannot follow.
            carried: emitted.carries({ payload, success: success as never }),
          })),
      );
    },
  };
};

/** The tag of each refusal an Rpc declares. */
type RefusalTag<R extends Rpc.AnyWithProps> = R["errorSchema"]["Type"] extends infer E
  ? E extends { readonly _tag: infer T extends string }
    ? T
    : never
  : never;

/**
 * What a verb declares beyond its Rpc, events, budget and examples, once it is in each format (docs/design/blueprint.md,
 * parts 9 and 10): who may call it and how anyone else is refused, its spans and logs, and which log is written where
 * each refusal it decides is decided. Each is optional until every verb has it; the delta check lists those that lack
 * one on that format's `unmigrated` list.
 */
export interface Formats<R extends Rpc.AnyWithProps> {
  /** The roles that may call it, each one of the blueprint's declared roles. */
  readonly allowed?: ReadonlyArray<string>;
  /** The refusal a caller of no allowed role gets, one the Rpc declares; null when no caller is refused for that. */
  readonly refusesOthers?: EventClass | null;
  /** Its spans, by a short name, in the order it runs them; each named `<operation>.<short>`. */
  readonly spans?: { readonly [short: string]: Span };
  /** Its logs, by a short name; each named `<operation>.<short>`. */
  readonly logs?: { readonly [short: string]: Log };
  /** The log written where each refusal it decides is decided, by the refusal's tag; one of its own logs. */
  readonly refusals?: { readonly [T in RefusalTag<R>]?: Log };
}

/** What a verb's operation carries of its formats, exactly as declared: its spans and logs by their short names. */
type Declares<F> = Pick<F, Extract<keyof F, "allowed" | "refusesOthers" | "spans" | "logs" | "refusals">>;

/** The formats of a declaration, as the operation carries them: only those it declares. */
type Declared = Pick<Operation, "allowed" | "refusesOthers" | "spans" | "logs" | "refusals">;

const formatsOf = (declared: Declared): Declared => ({
  ...(declared.allowed === undefined ? {} : { allowed: declared.allowed }),
  ...(declared.refusesOthers === undefined ? {} : { refusesOthers: declared.refusesOthers }),
  ...(declared.spans === undefined ? {} : { spans: declared.spans }),
  ...(declared.logs === undefined ? {} : { logs: declared.logs }),
  ...(declared.refusals === undefined ? {} : { refusals: declared.refusals }),
});

/** The shape every declaration `verb` takes has, as the implementation reads it. */
interface Loose extends Declared {
  readonly rpc: Rpc.AnyWithProps;
  readonly budget: Budget;
  readonly examples: ReadonlyArray<Unchecked>;
  readonly emits?: Outcome<string, EventClass>["emits"];
  readonly outcomes?: { readonly [tag: string]: Outcome<string, EventClass> };
}

/**
 * Declares a verb's operation: one kind of success with its events (`emits`), or several tagged outcomes, each with
 * its own (`outcomes`). It replaces `declare` and `declareOutcomes`, and marks what it makes as a verb (`kindOf`).
 */
export function verb<
  R extends Rpc.AnyWithProps,
  const Events extends ReadonlyArray<EventClass>,
  const F extends Formats<R> = {},
>(declaration: Single<R, Events> & F): Operation<R, Events[number]> & Declares<F>;
export function verb<
  R extends Rpc.AnyWithProps,
  const Outs extends { readonly [T in OutcomeTag<R>]: Outcome<T, EventClass> },
  const F extends Formats<R> = {},
>(declaration: Several<R, Outs> & F): Operation<R, Outs[keyof Outs]["emits"][number]["event"]> & Declares<F>;
export function verb(declaration: Loose): Operation {
  const outcomes =
    declaration.outcomes === undefined
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each `carries` is typed by the Rpc's own success in the overload above, which the implementation's signature cannot carry.
        [{ tag: null, emits: (declaration.emits ?? []) as never }]
      : Arr.map(Rec.values(declaration.outcomes), (each) => ({
          tag: each.tag,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an outcome's events read only that outcome's success; `build` matches the tag before it calls them, which the compiler cannot follow.
          emits: each.emits as never,
        }));
  return {
    ...build(declaration.rpc, outcomes, declaration.budget, declaration.examples),
    ...formatsOf(declaration),
    [KIND]: "verb",
  };
}

/** The names of the events the operation declares. */
export const eventNamesOf = (operation: Operation): ReadonlyArray<string> =>
  Arr.map(operation.emits, (event) => event.identifier);

const isEventClass = (value: unknown): value is EventClass =>
  typeof value === "function" && "identifier" in value && typeof value.identifier === "string" && "fields" in value;

/** The refusals the operation's Rpc declares, as classes. */
export const refusalsOf = (operation: Operation): ReadonlyArray<EventClass> => {
  const schema: unknown = operation.rpc.errorSchema;
  // A union of refusals is a schema with `members`; like a single refusal's class, it is a function.
  if (
    (typeof schema === "function" || typeof schema === "object") &&
    schema !== null &&
    "members" in schema &&
    Arr.isArray(schema.members)
  )
    return Arr.filter(schema.members, isEventClass);
  return isEventClass(schema) ? [schema] : [];
};

/** True when `error` is one of the typed refusals the operation's Rpc declares. */
export const isRefusal = (operation: Operation, error: unknown): boolean => Schema.is(operation.rpc.errorSchema)(error);

// What one operation declares beyond its Rpc: the events a successful call emits, what each of them must carry,
// and how fast the call must be. A generic runner reads these, so no scenario has to restate them. Nothing here
// reaches outside itself: declarations, and pure functions of them.
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Rpc from "effect/rpc/Rpc";

/** An event is a Schema class with a literal `_tag`; the tag is the event's name wherever it is recorded. */
export interface EventClass<Tag extends string = string> extends Schema.Codec<unknown, unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: a class constructor's arguments are not ours to name
  new (...args: any): { readonly _tag: Tag };
  readonly identifier: Tag;
  /** The event's fields: the `_tag` that names it and everything it carries. None needs a service to encode or decode. */
  readonly fields: { readonly [field: string]: Schema.Codec<unknown, unknown> };
}

/** What an event carries: its fields without the `_tag` that names it. It is recorded as exactly this. */
export type Carried<E extends EventClass> = Omit<Schema.Struct.Type<E["fields"]>, "_tag">;

/** One successful call as its caller knows it: what was sent and what came back, typed by the Rpc's own schemas. */
export interface Answered<R extends Rpc.AnyWithProps> {
  readonly payload: R["payloadSchema"]["Type"];
  readonly success: R["successSchema"]["Type"];
}

/** One event a successful call emits, exactly once, and what it must carry: a pure function of that call. */
export interface Emitted<R extends Rpc.AnyWithProps, E extends EventClass> {
  readonly event: E;
  readonly carries: (call: Answered<R>) => Carried<E>;
}

/** What is written down for one operation. `declare` turns it into an `Operation`. */
export interface Declaration<R extends Rpc.AnyWithProps, Events extends ReadonlyArray<EventClass>> {
  /** The Rpc: the operation's name, payload, success and typed refusals. */
  readonly rpc: R;
  /** Every event one successful call emits, each exactly once, with what it carries. A refused call emits none. */
  readonly emits: { readonly [Index in keyof Events]: Emitted<R, Events[Index]> };
  /** The speed budget for one call, in milliseconds, measured on the server. */
  readonly budgetMs: number;
}

/** A declared event of one successful call, and what the declaration says that call's event carries. */
export interface Expected {
  readonly event: EventClass;
  readonly carried: unknown;
}

/** A call as a generic reader holds it, before it is known to be of any one operation. */
export interface Unchecked {
  readonly payload: unknown;
  readonly success: unknown;
}

export interface Operation<
  R extends Rpc.AnyWithProps = Rpc.AnyWithProps,
  Events extends ReadonlyArray<EventClass> = ReadonlyArray<EventClass>,
> {
  readonly rpc: R;
  /** Every event one successful call emits, each exactly once, in declaration order. A refused call emits none. */
  readonly emits: ReadonlyArray<Events[number]>;
  readonly budgetMs: number;
  /**
   * What each declared event of one successful call must carry, computed by the declaration's `carries` from what
   * the caller sent and got back. `None` when `payload` or `success` is not of the Rpc's own schemas: such a call
   * cannot have been a successful call of this operation.
   */
  readonly expected: (call: Unchecked) => Option.Option<ReadonlyArray<Expected>>;
}

/** An instance of any event the operation declares. Core's `emit` accepts nothing else for that operation. */
export type EventOf<O extends Operation> = InstanceType<O["emits"][number]>;

export const declare = <R extends Rpc.AnyWithProps, const Events extends ReadonlyArray<EventClass>>(
  declaration: Declaration<R, Events>,
): Operation<R, Events> => {
  const isPayload = Schema.is(declaration.rpc.payloadSchema);
  const isSuccess = Schema.is(declaration.rpc.successSchema);
  return {
    rpc: declaration.rpc,
    emits: declaration.emits.map((emitted) => emitted.event),
    budgetMs: declaration.budgetMs,
    expected: ({ payload, success }) =>
      isPayload(payload) && isSuccess(success)
        ? Option.some(declaration.emits.map((emitted) => ({ event: emitted.event, carried: emitted.carries({ payload, success }) })))
        : Option.none(),
  };
};

/** The names of the events the operation declares, in declaration order. */
export const eventNamesOf = (operation: Operation): ReadonlyArray<string> => operation.emits.map((event) => event.identifier);

/** True when `error` is one of the typed refusals the operation's Rpc declares (and not a defect or a transport failure). */
export const isRefusal = (operation: Operation, error: unknown): boolean => Schema.is(operation.rpc.errorSchema)(error);

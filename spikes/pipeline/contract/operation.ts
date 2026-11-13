// What one operation declares beyond its Rpc: the events a successful call emits and how fast it must be.
// A generic runner reads these, so no scenario has to restate them. Pure declarations: nothing here runs.
import * as Schema from "effect/Schema";
import type * as Rpc from "effect/rpc/Rpc";

/** An event is a Schema class with a literal `_tag`; the tag is the event's name wherever it is recorded. */
export interface EventClass<Tag extends string = string> extends Schema.Codec<unknown, unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: a class constructor's arguments are not ours to name
  new (...args: any): { readonly _tag: Tag };
  readonly identifier: Tag;
}

export interface Operation<
  R extends Rpc.AnyWithProps = Rpc.AnyWithProps,
  Events extends ReadonlyArray<EventClass> = ReadonlyArray<EventClass>,
> {
  /** The Rpc: the operation's name, payload, success and typed refusals. */
  readonly rpc: R;
  /** Every event one successful call emits, each exactly once. A refused call emits none. */
  readonly emits: Events;
  /** The speed budget for one call, in milliseconds, measured on the server. */
  readonly budgetMs: number;
}

/** An instance of any event the operation declares. Core's `emit` accepts nothing else for that operation. */
export type EventOf<O extends Operation> = InstanceType<O["emits"][number]>;

export const declare = <R extends Rpc.AnyWithProps, const Events extends ReadonlyArray<EventClass>>(
  operation: Operation<R, Events>,
): Operation<R, Events> => operation;

/** The names of the events the operation declares, in declaration order. */
export const eventNamesOf = (operation: Operation): ReadonlyArray<string> => operation.emits.map((event) => event.identifier);

/** True when `error` is one of the typed refusals the operation's Rpc declares (and not a defect or a transport failure). */
export const isRefusal = (operation: Operation, error: unknown): boolean => Schema.is(operation.rpc.errorSchema)(error);

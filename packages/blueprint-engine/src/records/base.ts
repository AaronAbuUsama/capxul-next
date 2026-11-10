// What every record shares: its kind, its id, and how one record points at another.
//
// A record links to another by holding it (an import), never by a string the author types.
// The compiler checks the kind of every link; the build checks that every linked record is in
// the blueprint. Links point down the layers in ../layers.md, so a blueprint is a graph without cycles.

import { Schema } from "effect";

export const KINDS = [
  "system",
  "component",
  "concept",
  "error",
  "event",
  "table",
  "machine",
  "transition",
  "integration",
  "call",
  "contract",
  "function",
  "chainEvent",
  "procedure",
  "rpc",
  "flow",
  "operation",
  "workflow",
  "journey",
  "invariant",
  "environment",
  "decision",
] as const;
export type Kind = (typeof KINDS)[number];

/** What a link holds: the linked record's kind and id. Any record of that kind satisfies it. */
export interface Ref<K extends Kind> {
  readonly _kind: K;
  readonly id: string;
}

/** The schema of a link: checked structurally, so the whole linked record passes. */
export const Ref = <K extends Kind>(kind: K) =>
  Schema.Struct({ _kind: Schema.Literal(kind), id: Schema.String });

/** A string of 1 to `max` characters. */
const Text = (max: number) => Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(max)));

/** `payments`, `payment.send`, `org.books.accounts.add`: lowercase words joined by dots, dashes or underscores. */
export const Id = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/)));
/** An error code: `INSUFFICIENT_FUNDS`. */
export const Code = Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/)));

export const Title = Text(80);
/** A sentence or a short paragraph. */
export const Line = Text(300);
export const Prose = Text(2000);
export const Ms = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));

/** An Effect Schema held as a value: an operation's input, a table's fields, an event's properties. */
export const AnySchema = Schema.declare((u: unknown): u is Schema.Top => Schema.isSchema(u));

/** Where a record came from in the old system, for an as-is book and for reviewers. */
export const Was = Schema.Array(Schema.String);

/** Fields every record has. */
export const Common = {
  id: Id,
  title: Title,
  about: Prose,
  was: Schema.optionalKey(Was),
};

export const Priority = Schema.Literals(["critical", "normal", "low"]);
export type Priority = typeof Priority.Type;

export const Retry = Schema.Struct({
  max: Schema.Int,
  backoff: Schema.Literals(["none", "fixed", "exponential"]),
});

export const BudgetClass = Schema.Literals([
  "read",
  "live-read",
  "write",
  "chain-read",
  "chain-submit",
  "chain-settle",
  "vendor",
  "background",
]);

/** System time only. A person's wait and chain confirmation are excluded by span name. */
export const Budget = Schema.Struct({
  class: BudgetClass,
  p50Ms: Ms,
  p95Ms: Ms,
  excludes: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Required in a blueprint when the numbers differ from the class default (policy P5). */
  why: Schema.optionalKey(Line),
});

/** Validate a record's fields, then return the record with its kind stamped on. */
export const make =
  <K extends Kind>(kind: K) =>
  <S extends Schema.Top>(schema: S) =>
  <const T extends S["Type"]>(spec: T): T & Ref<K> => {
    Schema.decodeUnknownSync(schema as never)(spec);
    return { ...(spec as object), _kind: kind } as T & Ref<K>;
  };

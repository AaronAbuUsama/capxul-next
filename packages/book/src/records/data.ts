// What is stored and how it changes: tables, and the state machines that live on them.

import { Schema } from "effect";
import { AnySchema, Common, Id, Line, make, Ref } from "./base.ts";

// ── table ───────────────────────────────────────────────────────────────────────────────────

export const TableSpec = Schema.Struct({
  ...Common,
  concept: Ref("concept"),
  /** Whose data each row is (policy P8): one Organization's, one person's, an owner that is either,
   * everyone's, or the chain's (indexed facts, scoped by Safe). */
  tenancy: Schema.Literals(["organization", "person", "owner", "global", "chain"]),
  /** The column that names the tenant. In a target book it leads the key and every index. */
  tenantField: Schema.optionalKey(Schema.String),
  /** When the tenant is reached through a join rather than a column on the row: how. */
  scope: Schema.optionalKey(Line),
  /** The row's columns, as an Effect Schema Struct. Migrations are generated from it. */
  fields: AnySchema,
  key: Schema.Array(Schema.String),
  indexes: Schema.Array(
    Schema.Struct({
      name: Id,
      fields: Schema.Array(Schema.String),
      unique: Schema.optionalKey(Schema.Boolean),
      /** A deliberate lookup across tenants (by hash, by address); exempt from tenant-first. */
      crossTenant: Schema.optionalKey(Schema.Boolean),
      /** The query it serves; an index with no query is a gap. */
      for: Line,
    }),
  ),
  retention: Schema.optionalKey(Line),
});
export const defineTable = make("table")(TableSpec);
export type Table = ReturnType<typeof defineTable>;

// ── state machine ───────────────────────────────────────────────────────────────────────────

const TransitionSpec = Schema.Struct({
  from: Schema.Array(Schema.String),
  to: Schema.String,
  about: Schema.optionalKey(Line),
  /** A condition in words; the operation or workflow that drives it enforces it. */
  guard: Schema.optionalKey(Line),
  emits: Schema.Array(Ref("event")),
});

export const MachineSpec = Schema.Struct({
  ...Common,
  table: Ref("table"),
  /** The column that holds the state. */
  field: Schema.String,
  initial: Schema.String,
  states: Schema.Array(Schema.Struct({ id: Schema.String, about: Line, terminal: Schema.optionalKey(Schema.Boolean) })),
  transitions: Schema.Record(Schema.String, TransitionSpec),
});

export interface TransitionRef extends Ref<"transition"> {
  readonly machine: string;
  readonly name: string;
}

const machine = make("machine")(MachineSpec);

/**
 * A state machine on a table. Its transitions become linkable records:
 * `paymentLifecycle.t.settle` is what an operation or workflow names in `drives`.
 */
export const defineMachine = <const T extends typeof MachineSpec.Type>(spec: T) => {
  const record = machine(spec);
  const t = Object.fromEntries(
    Object.keys(spec.transitions).map((name) => [
      name,
      { _kind: "transition", id: `${spec.id}.${name}`, machine: spec.id, name } satisfies TransitionRef,
    ]),
  ) as { readonly [N in keyof T["transitions"] & string]: TransitionRef };
  return { ...record, t };
};
export type Machine = ReturnType<typeof defineMachine>;

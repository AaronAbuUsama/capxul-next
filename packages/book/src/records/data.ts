// What is stored and how it changes: tables, and the state machines that live on them.

import { Schema } from "effect";
import { AnySchema, Common, Id, Line, make, Ref } from "./base.ts";

// ── table ───────────────────────────────────────────────────────────────────────────────────

/**
 * A party the generated row-level policy admits to a table's rows besides the tenant its `tenantField` names; for a
 * `chain` table, the parties it admits at all (decision rules.admissions-and-wait-keys). One admission is one policy clause.
 */
export const Admission = Schema.Struct({
  /** How the session is matched to the column:
   * - `tenant`: the column names a tenant (with `kindField`, an owner pair), matched as the tenant column is;
   * - `safe`: the column holds a Safe, or a list of Safes: the Safe of a Party in parties' directory whose owner
   *   (`owner_kind`, `owner_id`) is matched as the tenant column is (P8's chain-read scope);
   * - `own-safe`: the column holds a Safe, or a list: the session's principal's own Safe (a person's or an agent's), or
   *   the company Safe of an Organization its principal holds an active Seat in now;
   * - `email`: the column holds a mailbox: the session's signed-in email;
   * - `anyone`: no column: every caller, signed in or not, for the rows `where` names. */
  match: Schema.Literals(["tenant", "safe", "own-safe", "email", "anyone"]),
  /** The row's column that names the admitted party; absent only for `anyone`. With `via`, the column that joins. */
  field: Schema.optionalKey(Schema.String),
  /** With `tenant`: the column that names the tenant's kind (`payee_kind` for the pair `payee_kind`, `payee_id`). */
  kindField: Schema.optionalKey(Schema.String),
  /** When the admitted party is named on another row: the table whose column `on` equals this row's `field`, and that
   * row's column `field` (with `kindField`) that `match` applies to. */
  via: Schema.optionalKey(
    Schema.Struct({ table: Ref("table"), on: Schema.String, field: Schema.String, kindField: Schema.optionalKey(Schema.String) }),
  ),
  /** Only the rows whose columns hold these values (`{ purpose: "image", state: "kept" }`); absent: every row. */
  where: Schema.optionalKey(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean, Schema.Number]))),
  /** What the clause lets the admitted party's session do: read the rows, and write (insert or update) them. */
  reads: Schema.Boolean,
  writes: Schema.Boolean,
  /** Who it admits and why, with the decision that chose it. */
  about: Line,
});

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
  /** Who else the row-level policy admits, beyond the tenant: a payee, an addressed payer, a holder by their Safe, anyone
   * for a public row. A `chain` table's admissions are its whole policy. Absent: the tenant alone. */
  admits: Schema.optionalKey(Schema.Array(Admission).pipe(Schema.check(Schema.isMinLength(1)))),
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

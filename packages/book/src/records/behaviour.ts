// What the system does: operations (called by someone) and workflows (started by something).
// Both name exactly what they touch, so the book can check boundaries and derive gaps.

import { Schema } from "effect";
import { AnySchema, Budget, Common, Line, make, Ms, Priority, Prose, Ref, Retry } from "./base.ts";

/** What a piece of behaviour touches. The same shape for operations and workflows. */
const Touches = {
  reads: Schema.Array(Ref("table")),
  writes: Schema.Array(Ref("table")),
  drives: Schema.Array(Ref("transition")),
  calls: Schema.Array(Ref("call")),
  chain: Schema.Array(Ref("function")),
  /** Events beyond those its transitions emit. */
  emits: Schema.Array(Ref("event")),
};

// ── operation ───────────────────────────────────────────────────────────────────────────────

export const OperationSpec = Schema.Struct({
  ...Common,
  concept: Ref("concept"),
  kind: Schema.Literals(["query", "live", "mutation", "action"]),
  /** Frozen, from the old book: `payment send`. */
  command: Schema.String,
  sdk: Schema.optionalKey(Schema.String),
  priority: Priority,

  // the book's frozen text
  who: Prose,
  changes: Schema.optionalKey(Prose),
  notes: Schema.optionalKey(Schema.Array(Line)),
  mistakes: Schema.optionalKey(Schema.Array(Schema.Struct({ what: Line, fix: Line }))),
  /** Numbered from 1. A retired line stays as `null`, so numbers never move. */
  acceptance: Schema.Array(Schema.NullOr(Line)),

  // the contract
  input: AnySchema,
  output: AnySchema,
  errors: Schema.Array(Ref("error")),
  refusals: Schema.Array(
    Schema.Struct({
      error: Ref("error"),
      /** The world (a named devnet snapshot) the refusal is reached from. */
      given: Schema.String,
      when: Line,
    }),
  ),

  ...Touches,

  // measurement
  /** Child spans beyond the operation span; each a boundary or a possible wait. */
  spans: Schema.Array(Schema.String),
  budget: Budget,
});
export const defineOperation = make("operation")(OperationSpec);
export type Operation = ReturnType<typeof defineOperation>;

// ── workflow: durable, background work ──────────────────────────────────────────────────────

const Trigger = Schema.Union([
  Schema.Struct({ after: Ref("operation") }),
  Schema.Struct({ transition: Ref("transition") }),
  Schema.Struct({ chainEvent: Ref("chainEvent") }),
  Schema.Struct({ cron: Schema.String }),
]);

export const WorkflowSpec = Schema.Struct({
  ...Common,
  concept: Ref("concept"),
  priority: Priority,
  trigger: Trigger,
  steps: Schema.Array(Schema.Struct({ name: Schema.String, about: Line })),
  ...Touches,
  /** What makes a second run a no-op: `fct_<kind>_<paymentId>`. */
  idempotency: Line,
  timeoutMs: Ms,
  retries: Retry,
  compensation: Schema.optionalKey(Prose),
  budget: Budget,
});
export const defineWorkflow = make("workflow")(WorkflowSpec);
export type Workflow = ReturnType<typeof defineWorkflow>;

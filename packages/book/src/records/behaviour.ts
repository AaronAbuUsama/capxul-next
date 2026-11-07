// What the system does, in four layers:
//
//   operation  the frozen, user-facing unit: one CLI command from the old book
//   flow       a Core SDK composition: rpcs and local steps (sign, wait, build a UserOperation)
//   rpc        one server endpoint: the redesignable internals, generated into the RpcGroup
//   procedure  a concept's in-transaction entry point, listed on its door, invoked by others
//   workflow   durable background work, started by a trigger
//
// An operation is implemented by exactly one rpc or one flow. Everything below the operation
// may change; the operation may not.

import { Schema } from "effect";
import { AnySchema, Budget, Common, Line, make, Ms, Priority, Prose, Ref, Retry } from "./base.ts";

/** What server-side behaviour touches. A concept writes only its own tables; it reaches
 * another concept's tables by invoking that concept's procedures. */
const Touches = {
  reads: Schema.Array(Ref("table")),
  writes: Schema.Array(Ref("table")),
  drives: Schema.Array(Ref("transition")),
  invokes: Schema.Array(Ref("procedure")),
  /** Events beyond those its transitions emit. */
  emits: Schema.Array(Ref("event")),
};

/** Outside calls. Never inside a transaction, so procedures cannot have them. */
const Calls = {
  calls: Schema.Array(Ref("call")),
  chain: Schema.Array(Ref("function")),
};

// ── procedure ───────────────────────────────────────────────────────────────────────────────

export const ProcedureSpec = Schema.Struct({
  ...Common,
  concept: Ref("concept"),
  /** Runs inside the invoker's transaction: all of its writes commit with the invoker's, or none do. */
  input: AnySchema,
  output: AnySchema,
  errors: Schema.Array(Ref("error")),
  ...Touches,
});
export const defineProcedure = make("procedure")(ProcedureSpec);
export type Procedure = ReturnType<typeof defineProcedure>;

// ── rpc: one server endpoint ────────────────────────────────────────────────────────────────

export const RpcSpec = Schema.Struct({
  ...Common,
  concept: Ref("concept"),
  /** `live` is a query a client subscribes to; `action` may call outside systems. */
  kind: Schema.Literals(["query", "live", "mutation", "action"]),
  /** Who may call it, in words; the guard in code enforces it. */
  who: Prose,
  input: AnySchema,
  output: AnySchema,
  errors: Schema.Array(Ref("error")),
  ...Touches,
  ...Calls,
  /** Server child spans beyond the rpc span. */
  spans: Schema.Array(Schema.String),
  /** Server time. Absent in an as-is book when nothing measured it: a gap. */
  budget: Schema.optionalKey(Budget),
});
export const defineRpc = make("rpc")(RpcSpec);
export type Rpc = ReturnType<typeof defineRpc>;

// ── flow: a Core SDK composition ────────────────────────────────────────────────────────────

const Step = Schema.Union([
  Schema.Struct({ name: Schema.String, rpc: Ref("rpc"), about: Schema.optionalKey(Line) }),
  Schema.Struct({
    name: Schema.String,
    /** Work the SDK does itself. `wait` is a person or the chain; it is its own span and never system time. */
    local: Schema.Literals(["sign", "build", "encrypt", "wait", "poll", "prompt", "cache"]),
    about: Line,
  }),
]);

export const FlowSpec = Schema.Struct({
  ...Common,
  /** The client component it runs in: the Core SDK. */
  component: Ref("component"),
  /** The SDK method: `client.payments.send`. */
  sdk: Schema.String,
  input: AnySchema,
  output: AnySchema,
  steps: Schema.Array(Step),
  /** Errors the flow itself produces, beyond those of its rpcs. */
  errors: Schema.Array(Ref("error")),
  /** Outside systems the client calls directly: the signer, the bundler. */
  calls: Schema.Array(Ref("call")),
  spans: Schema.Array(Schema.String),
  /** Client time, excluding `wait` steps. */
  budget: Schema.optionalKey(Budget),
});
export const defineFlow = make("flow")(FlowSpec);
export type Flow = ReturnType<typeof defineFlow>;

// ── operation: the frozen, user-facing unit ─────────────────────────────────────────────────

export const OperationSpec = Schema.Struct({
  ...Common,
  /** The old book's area: `payments`, `books`. Not a concept: an area is how people find it. */
  area: Schema.String,
  /** Frozen, from the old book: `payment send`. */
  command: Schema.String,
  priority: Priority,
  implementedBy: Schema.Union([Ref("rpc"), Ref("flow")]),

  // the book's frozen text
  who: Prose,
  changes: Schema.optionalKey(Prose),
  notes: Schema.optionalKey(Schema.Array(Line)),
  mistakes: Schema.optionalKey(Schema.Array(Schema.Struct({ what: Line, fix: Line }))),
  /** Numbered from 1. A retired line stays as `null`, so numbers never move. In a target book each
   * line is a claim (policy P1): the frozen claim, what a black-box run observes to check it, and the
   * old book's test citation moved into `was`. */
  acceptance: Schema.Array(
    Schema.Union([
      Schema.NullOr(Line),
      Schema.Struct({ claim: Line, observes: Line, was: Schema.optionalKey(Schema.Array(Schema.String)) }),
    ]),
  ),
  /** What it prints with `--json`. */
  returns: AnySchema,
  /** Errors the CLI command produces itself, before or after its implementation: usage, confirmation. */
  errors: Schema.optionalKey(Schema.Array(Ref("error"))),
  refusals: Schema.Array(
    Schema.Struct({
      error: Ref("error"),
      /** The world (a named devnet snapshot) the refusal is reached from; `?` when none exists yet (a gap). */
      given: Schema.String,
      when: Line,
    }),
  ),

  /** End to end: the CLI command, excluding a person's wait and chain confirmation. */
  budget: Schema.optionalKey(Budget),
});
export const defineOperation = make("operation")(OperationSpec);
export type Operation = ReturnType<typeof defineOperation>;

// ── workflow: durable, background work ──────────────────────────────────────────────────────

const Trigger = Schema.Union([
  Schema.Struct({ after: Ref("rpc") }),
  Schema.Struct({ transition: Ref("transition") }),
  Schema.Struct({ chainEvent: Ref("chainEvent") }),
  Schema.Struct({ indexer: Schema.String }),
  Schema.Struct({ cron: Schema.String }),
]);

export const WorkflowSpec = Schema.Struct({
  ...Common,
  concept: Ref("concept"),
  priority: Priority,
  trigger: Trigger,
  /** One process per row of a table (a Payment's lifecycle), or one for the system (a sweep). */
  instance: Schema.optionalKey(Schema.Union([Schema.Literal("singleton"), Schema.Struct({ per: Ref("table") })])),
  /** Rpcs that resume a waiting instance: the signature arrived, the person approved. */
  signals: Schema.optionalKey(Schema.Array(Ref("rpc"))),
  /** What an instance waits on. A wait is its own span and never counts as system time. */
  waits: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        for: Schema.Literals(["signal", "timer", "chain", "person", "indexer"]),
        timeoutMs: Schema.optionalKey(Ms),
        about: Line,
      }),
    ),
  ),
  steps: Schema.Array(Schema.Struct({ name: Schema.String, about: Line })),
  ...Touches,
  ...Calls,
  /** What makes a second run a no-op: `fct_<kind>_<paymentId>`. */
  idempotency: Line,
  timeoutMs: Ms,
  retries: Retry,
  compensation: Schema.optionalKey(Prose),
  budget: Schema.optionalKey(Budget),
});
export const defineWorkflow = make("workflow")(WorkflowSpec);
export type Workflow = ReturnType<typeof defineWorkflow>;

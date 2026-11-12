// What the system does, in four layers:
//
//   operation  the user-facing unit: one CLI command, one of the 215 the old book kept or a new one
//              booked under rules.new-operations
//   flow       a Core SDK composition: rpcs and local steps (sign, wait, build a UserOperation)
//   rpc        one server endpoint: the redesignable internals, generated into the RpcGroup
//   procedure  a concept's in-transaction entry point, listed on its door, invoked by others
//   workflow   durable background work, started by a trigger
//
// An operation is implemented by exactly one rpc or one flow. Everything below the operation
// may change; the operation may not.

import { Schema } from "effect";
import { AnySchema, Budget, Common, Id, Line, make, Ms, Priority, Prose, Ref, Retry } from "./base.ts";

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
  /** The surfaces that call the method, from the system's surfaces. Absent: the CLI, through the operation the
   * flow implements. A flow only another surface calls (the approval page, checkout or the web app on `react`, an
   * agent's SDK host on `sdk`, MCP) names them, and then no operation implementing it is not a gap. */
  surfaces: Schema.optionalKey(Schema.Array(Schema.Literals(["cli", "sdk", "react", "mcp", "http"]))),
  /** Client time, excluding `wait` steps. */
  budget: Schema.optionalKey(Budget),
});
export const defineFlow = make("flow")(FlowSpec);
export type Flow = ReturnType<typeof defineFlow>;

// ── operation: one of the kept capabilities, the user-facing unit ───────────────────────────

/** One run of the command, as a terminal shows it. The build checks `output` against `returns` (exit 0) or against the
 * declared refusal it names (any other exit): a wrong example is worse than none. */
export const Example = Schema.Struct({
  title: Line,
  /** The command line, as typed: it names the operation's command. */
  input: Prose,
  /** The JSON it prints with `--json`: the `returns` shape on exit 0, else `{ error: { code, message } }`. */
  output: Schema.Unknown,
  /** The process exit code: 0, or the exit code of the refusal's error. */
  exit: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 255 }))),
});
export type Example = typeof Example.Type;

export const OperationSpec = Schema.Struct({
  ...Common,
  /** The old book's area: `payments`, `books`; a new operation's old area or owning concept. Not a concept: an area is how people find it. */
  area: Schema.String,
  /** The CLI command: a frozen operation's from the old book's text unless renamed with a decision (system.frozen-behaviour); a new one's its own. */
  command: Schema.String,
  priority: Priority,
  implementedBy: Schema.Union([Ref("rpc"), Ref("flow")]),

  // the blueprint's frozen text
  who: Prose,
  changes: Schema.optionalKey(Prose),
  notes: Schema.optionalKey(Schema.Array(Prose)),
  mistakes: Schema.optionalKey(Schema.Array(Schema.Struct({ what: Line, fix: Line }))),
  /** A claim (P1), its observation and optional stable key. Without a key its claim determines identity.
   * Keep an explicit key when rewording should retain the ID; the old verdict still becomes stale. */
  acceptance: Schema.Array(
    Schema.Union([
      Schema.NullOr(Prose),
      Schema.Struct({ key: Schema.optionalKey(Id), claim: Prose, observes: Schema.optionalKey(Prose), was: Schema.optionalKey(Schema.Array(Schema.String)) }),
    ]),
  ),
  /** What it prints with `--json`. */
  returns: AnySchema,
  /** Errors the CLI command produces itself, before or after its implementation: usage, confirmation. */
  errors: Schema.optionalKey(Schema.Array(Ref("error"))),
  refusals: Schema.Array(
    Schema.Struct({
      key: Schema.optionalKey(Id),
      error: Ref("error"),
      /** The world (a named devnet snapshot) the refusal is reached from; `?` when none exists yet (a gap). */
      given: Schema.String,
      when: Prose,
    }),
  ),

  /** End to end: the CLI command, excluding a person's wait and chain confirmation. */
  budget: Schema.optionalKey(Budget),
  /** Real runs, written as the terminal shows them. Absent: a gap (`no-example`). */
  examples: Schema.optionalKey(Schema.Array(Example)),
});
export const defineOperation = make("operation")(OperationSpec);
export type Operation = ReturnType<typeof defineOperation>;

// ── workflow: durable, background work ──────────────────────────────────────────────────────

/**
 * What routes a waking event to the one instance waiting for it (decision rules.process-wakeups): when an instance
 * begins a wait it names its values for `props`, and the runtime delivers it the event or row whose `props` equal them.
 */
export const WaitKey = Schema.Struct({
  /** What wakes it, each carrying every prop:
   * - an event: a transition's product event, delivered by the outbox relay; its props;
   * - a chain event: a log Ponder indexed, delivered at the finality depth; its signature's arguments, or the log's own
   *   `chain_id`, `contract_address`, `block_number`, `block_hash`, `tx_hash` and `log_index`;
   * - a table: a row as it is written: Ponder's progress (`indexer-progress`) or a typed fact a log's own arguments do
   *   not carry (a Safe nonce), or a stored webhook event; its columns;
   * - an rpc: one of the workflow's `signals`; the input fields that name the instance or the row it finds it by, or the
   *   instance's own columns it resolves from its session (the owner it acts for);
   * - a call: an outside call the instance makes and awaits itself (a receipt, one of its `calls`): nothing routes it, and
   *   `props` name what it is given. */
  on: Schema.Array(Schema.Union([Ref("event"), Ref("chainEvent"), Ref("table"), Ref("rpc"), Ref("call")])).pipe(
    Schema.check(Schema.isMinLength(1)),
  ),
  /** The properties, by name, whose values equal the waiting instance's. */
  props: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
  /** A property that must reach the instance's value rather than equal it: Ponder's `indexed_block` passing the block
   * the instance waits for. */
  reaches: Schema.optionalKey(Schema.String),
});

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
        /** The chain events (Ponder's, `contract_x.e.<Event>`) whose arrival ends a `chain` or `indexer` wait. */
        events: Schema.optionalKey(Schema.Array(Ref("chainEvent"))),
        /** What wakes it and by which properties, one entry per way it is woken. A timer needs none: it is the
         * instance's own. In a blueprint every other wait names it (rule wait-without-key). */
        key: Schema.optionalKey(Schema.Array(WaitKey).pipe(Schema.check(Schema.isMinLength(1)))),
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

// The values the envelope's own attributes carry (./envelope.ts), each a named schema, and the places an attribute is
// stamped. The values a thing owns are in that thing's `values.ts`; these are telemetry's alone. `Envelope`
// re-exports them.
import * as Schema from "effect/Schema";

const pattern = (regex: RegExp) => Schema.String.check(Schema.isPattern(regex));

/** What caused the work: an agent's session, a CI run's or a person's sign-in. Opaque, as its producer writes it. */
export const SessionId = pattern(/^[A-Za-z0-9_.:-]{1,128}$/);
/** A commit, as its full hash. */
export const Revision = pattern(/^[0-9a-f]{40}$/);
/** A branch or tag's name. */
export const RefName = pattern(/^[A-Za-z0-9._/-]{1,255}$/);
/** A CI run, by its provider's id. */
export const PipelineRunId = pattern(/^[0-9]{1,20}$/);
/** An operation's or a piece of work's name, as the blueprint declares it. */
export const OperationName = pattern(/^[a-z][a-z-]*(\.[a-z][a-z-]*)+$/);
/** An operation's version; 1 until operations carry versions (roadmap item 6.1). */
export const OperationVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
/**
 * How a span's work ended: `ok` (a declared success), `refused` (a typed failure: a declared refusal), `error` (a
 * defect, or anything nobody declared) or `interrupted`. OTLP's status cannot tell a refusal from a defect, so every
 * span Core keeps carries this.
 */
export const Outcome = Schema.Literals(["ok", "refused", "error", "interrupted"]);
/** A refusal, by its tag. */
export const RefusalTag = pattern(/^[A-Z][A-Za-z]+$/);
/** The caller's role, as the blueprint's roles name it (roadmap item 5.1). */
export const CallerRole = pattern(/^[a-z][a-z-]*(\.[a-z][a-zA-Z-]*)?$/);
/** A declared budget, in milliseconds. */
export const BudgetMs = Schema.Int.check(Schema.isGreaterThan(0));
/** How long a piece of work took, in milliseconds, as its caller measured it. */
export const TookMs = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
/** What a cost is for. */
export const CostSource = Schema.Literals(["cloudflare", "neon", "ci", "model"]);
/** An OpenTelemetry signal, or the typed events dataset. */
export const Signal = Schema.Literals(["traces", "logs", "metrics", "events"]);
/** The remote procedure call protocol of a request: a world's chain speaks JSON-RPC. */
export const RpcSystem = Schema.Literals(["jsonrpc"]);
/** A JSON-RPC method, as the request names it, such as `eth_getLogs`. */
export const RpcMethod = pattern(/^[a-z][A-Za-z0-9_]{0,63}$/);
/** A block, as a JSON-RPC request names it: a hex quantity, or a tag such as `latest`. */
export const BlockRef = pattern(/^(0x[0-9a-fA-F]{1,16}|earliest|latest|pending|safe|finalized)$/);

/** Where an attribute is stamped. */
export type Where =
  | "every record"
  | "a run's records"
  | "an operation's span"
  | "a step's span"
  | "an operation's or a step's span"
  | "a check's span"
  | "the chain read's span"
  | "a metric";

// The measurement half of the contract: how a caller names a call, and what every handler is given about it.
// Declarations only. Core implements `Telemetry`; the runner sets the header.
import * as Context from "effect/Context";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";

/**
 * The header in which a caller supplies the trace id of one call: W3C trace context,
 * `00-<32 hex trace id>-<16 hex parent span id>-01`. Core records the call's spans and events under that trace id.
 */
export const TRACE_HEADER = "traceparent";

/** What Core knows about the call a handler is serving. Events are recorded against it. */
export class CurrentCall extends Context.Service<CurrentCall, { readonly traceId: string; readonly operation: string }>()(
  "capxul/contract/CurrentCall",
) {}

/**
 * Wraps every operation: runs the handler in a span named after the operation, under the caller's trace id, keeps
 * the spans of the call, and gives the handler its `CurrentCall`. Callers need no client half.
 */
export class Telemetry extends RpcMiddleware.Service<Telemetry, { provides: CurrentCall }>()("capxul/contract/Telemetry") {}

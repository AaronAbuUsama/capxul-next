// The trace every call carries, and the middleware that spans it. Declarations only: the servers implement the
// middleware; the runner and the CLI set the header.
import * as Context from "effect/Context";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";

/**
 * The header in which a caller supplies the trace id of one call: W3C trace context,
 * `00-<32 hex trace id>-<16 hex parent span id>-01`. The server records the call's spans and events under it.
 */
export const TRACE_HEADER = "traceparent";

/** What the server knows about the call a handler is serving. Events are recorded against it. */
// oxlint-disable effecttsgo/deterministic-keys -- the key is shared with spikes/pipeline/contract/telemetry.ts; renaming it is the blueprint owner's call, not a lint fix.
export class CurrentCall extends Context.Service<
  CurrentCall,
  { readonly traceId: string; readonly operation: string }
>()("capxul/contract/CurrentCall") {}
// oxlint-enable effecttsgo/deterministic-keys

/**
 * Wraps every operation: runs the handler in a span named after the operation, under the caller's trace id, keeps
 * the spans of the call, and gives the handler its `CurrentCall`.
 */
export class Telemetry extends RpcMiddleware.Service<Telemetry, { provides: CurrentCall }>()(
  "capxul/contract/Telemetry",
) {}

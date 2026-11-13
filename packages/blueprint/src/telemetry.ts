// What every call runs under: how a caller names the call (its trace), and who the caller is. Declarations only.
// The servers implement the middleware; the runner and the CLI set the headers.
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import { NotSignedIn } from "./errors.ts";
import { OperatorName, PersonId, WorldName } from "./values.ts";

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

/**
 * The header that carries a call's credential, as `Bearer <token>`: the world's door token for a call through a
 * world's door, or the operator's token for a call to the platform. The sign-in middlewares read it. The SDK sends
 * it on every call; nothing logs it.
 */
export const CREDENTIAL_HEADER = "authorization";

/**
 * The header naming the person a call acts as, inside one world. In private and shared worlds it is honoured only
 * with the world's door token, and only for a person of the world's cast. Without it, a call with the door token acts
 * as the world's owner. Real worlds use real sign-in, which is not designed yet (roadmap phase 4).
 */
export const PERSON_HEADER = "capxul-person";

/** Who a call through a world's door acts as. */
export const Caller = Schema.Union([
  Schema.TaggedStruct("owner", { owner: OperatorName, world: WorldName }),
  Schema.TaggedStruct("person", { person: PersonId, world: WorldName }),
]);

export class CurrentCaller extends Context.Service<CurrentCaller, typeof Caller.Type>()(
  // oxlint-disable-next-line effecttsgo/deterministic-keys -- the key is shared with spikes/pipeline/contract/telemetry.ts; renaming it is the blueprint owner's call, not a lint fix.
  "capxul/contract/CurrentCaller",
) {}

/** Establishes the caller of every operation served through a world's door, or refuses with `NotSignedIn`. */
export class WorldSignIn extends RpcMiddleware.Service<WorldSignIn, { provides: CurrentCaller }>()(
  "capxul/contract/WorldSignIn",
  {
    error: NotSignedIn,
  },
) {}

/** Who a call to the platform's world service acts as: always an operator. */
export class CurrentOperator extends Context.Service<
  CurrentOperator,
  { readonly operator: typeof OperatorName.Type }
>()(
  // oxlint-disable-next-line effecttsgo/deterministic-keys -- the key is shared with spikes/pipeline/contract/telemetry.ts; renaming it is the blueprint owner's call, not a lint fix.
  "capxul/contract/CurrentOperator",
) {}

/** Establishes the operator of every platform operation, or refuses with `NotSignedIn`. */
export class PlatformSignIn extends RpcMiddleware.Service<PlatformSignIn, { provides: CurrentOperator }>()(
  "capxul/contract/PlatformSignIn",
  {
    error: NotSignedIn,
  },
) {}

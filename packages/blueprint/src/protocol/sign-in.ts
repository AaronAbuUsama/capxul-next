// Who a call acts as: the world's owner or a person of the world through a world's door, an operator at the
// platform. Declarations only: the servers implement the middlewares.
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import { NotSignedIn } from "../common/refusals.ts";
import { OperatorName, PersonId, WorldName } from "../common/values.ts";

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

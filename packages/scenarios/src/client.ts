// The one thing a scenario is handed: a typed client of Capxul, one function per blueprint operation, which calls
// a world's Core through its door. It is a placeholder for the SDK's client (roadmap step 1.9): the SDK will supply
// this service, and until it lands the runner does. A scenario never calls Core over HTTP itself, and never sees a
// trace id, a span or a timing: the runner keeps and checks those for every call.
import type { Errors, OperationName, operations, Values } from "@capxul/blueprint";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Rpc from "effect/rpc/Rpc";

type RpcOf<Name extends OperationName> = (typeof operations)[Name]["rpc"];

/** How one call is made. */
export interface CallOptions {
  /**
   * The person of the world's cast the call acts as (the blueprint's `capxul-person` header). Left out, the call acts
   * as the world's owner.
   */
  readonly as?: typeof Values.PersonId.Type;
}

/**
 * One function per operation, named as the blueprint names it. A call answers the operation's success, or fails with
 * one of its declared refusals or with `NotSignedIn` from sign-in. A call that got no answer, or that the server died
 * in, is a defect: the scenario cannot act on it, and the runner records the call as unanswered or as a defect.
 */
export type CapxulClient = {
  readonly [Name in OperationName]: (
    payload: Rpc.PayloadConstructor<RpcOf<Name>>,
    options?: CallOptions,
  ) => Effect.Effect<Rpc.Success<RpcOf<Name>>, Rpc.Error<RpcOf<Name>> | Errors.NotSignedIn>;
};

/** Anything a call through the door fails with: one of the blueprint's declared refusals. */
export type Failure = InstanceType<(typeof Errors.refusals)[Errors.RefusalTag]>;

/** Capxul, through the door of the world the scenario runs in. */
export class Capxul extends Context.Service<Capxul, CapxulClient>()("@capxul/scenarios/client/Capxul") {}

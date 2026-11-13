// The one thing a scenario is handed: a typed client of Capxul, one function per blueprint operation, which calls
// a world's Core through its door. It is a placeholder for the SDK's client (roadmap step 1.9): the SDK will supply
// this service, and until it lands the runner does. A scenario never calls Core over HTTP itself, and never sees a
// trace id, a span or a timing: the runner keeps and checks those for every call.
import type { CallOptions, Chain, Errors, OperationName, operations, StartingWorld } from "@capxul/blueprint";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Rpc from "effect/rpc/Rpc";

type RpcOf<Name extends OperationName> = (typeof operations)[Name]["rpc"];

/**
 * How one call is made: the blueprint's `CallOptions`. `{ as: "dana" }` acts as a person of the world's cast;
 * `{ operator: "second" }` signs in as the second operator; `{ at: view.door }` calls another world's door.
 */
export type { CallOptions };

/**
 * One function per operation, named as the blueprint names it, and the chain reads under `chain`. A call answers the
 * operation's success, or fails with one of its declared refusals, with `NotSignedIn` from sign-in, or with
 * `PayloadRejected` when its payload is not of its schema and so was never sent. A call that got no answer, or that
 * the server died in, is a defect: the scenario cannot act on it, and the runner records the call as unanswered or
 * as a defect. A chain read answers its declared type or dies.
 */
export type CapxulClient = {
  readonly [Name in OperationName]: (
    payload: Rpc.PayloadConstructor<RpcOf<Name>>,
    options?: CallOptions,
  ) => Effect.Effect<Rpc.Success<RpcOf<Name>>, Rpc.Error<RpcOf<Name>> | Errors.NotSignedIn | Errors.PayloadRejected>;
} & {
  /** Reads of a world's chain through its door's chain JSON-RPC: the scenario's own world, or `at` another's. */
  readonly chain: Chain.Reader;
};

/** Anything a call through the door fails with: one of the blueprint's declared refusals. */
export type Failure = InstanceType<(typeof Errors.refusals)[Errors.RefusalTag]>;

/** Capxul, through the door of the world the scenario runs in. */
export class Capxul extends Context.Service<Capxul, CapxulClient>()("@capxul/scenarios/client/Capxul") {}

/**
 * The starting world a scenario was handed and its facts, as its maker kept them (encoded). A scenario reads them
 * with `given` (scenario.ts), which decodes them with the starting world's own schema.
 */
export class Given extends Context.Service<
  Given,
  { readonly world: StartingWorld; readonly facts: Effect.Effect<unknown> }
>()("@capxul/scenarios/client/Given") {}

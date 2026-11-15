// What a journey is handed: a typed client of Capxul, one function per blueprint operation, which calls a world's
// Core through its door. The SDK supplies it (`Sdk.layer(Capxul)`, roadmap step 1.9) and the runner records every call
// it makes. A journey never calls Core over HTTP itself, and never sees a trace id, a span or a timing: the runner
// keeps and checks those for every call.
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
 * the server died in, is a defect: the journey cannot act on it, and the runner records the call as unanswered or
 * as a defect. A chain read answers its declared type or dies.
 */
export type CapxulClient = {
  readonly [Name in OperationName]: (
    payload: Rpc.PayloadConstructor<RpcOf<Name>>,
    options?: CallOptions,
  ) => Effect.Effect<Rpc.Success<RpcOf<Name>>, Rpc.Error<RpcOf<Name>> | Errors.NotSignedIn | Errors.PayloadRejected>;
} & {
  /** Reads of a world's chain through its door's chain JSON-RPC: the journey's own world, or `at` another's. */
  readonly chain: Chain.Reader;
};

/** What `name` takes: its payload, as its client builds it. */
export type Payload<Name extends OperationName> = Rpc.PayloadConstructor<RpcOf<Name>>;

/** What a successful call of `name` answers. */
export type Success<Name extends OperationName> = Rpc.Success<RpcOf<Name>>;

/** What a call of `name` is refused with: one of its declared refusals, `NotSignedIn` or `PayloadRejected`. */
export type Refusal<Name extends OperationName> = Rpc.Error<RpcOf<Name>> | Errors.NotSignedIn | Errors.PayloadRejected;

/** Anything a call through the door fails with: one of the blueprint's declared refusals. */
export type Failure = InstanceType<(typeof Errors.refusals)[Errors.RefusalTag]>;

/** Capxul, through the door of the world the journey runs in. */
export class Capxul extends Context.Service<Capxul, CapxulClient>()("@capxul/scenarios/client/Capxul") {}

/**
 * The starting world a journey was handed and its facts, as its maker kept them (encoded). A journey reads them with
 * `given` (expectation.ts), which decodes them with the starting world's own schema.
 */
export class Given extends Context.Service<
  Given,
  { readonly world: StartingWorld; readonly facts: Effect.Effect<unknown> }
>()("@capxul/scenarios/client/Given") {}

/**
 * Where a try hears the trace id of the call it makes. The client that records calls (the runner's) tells it, when a
 * try provides it, the trace id each operation call ran under: the trace Core writes the call's record entries,
 * spans and logs under. A client that does not leaves the try without one, and its checks judge as before (`ThisCall`).
 */
export class CallTraces extends Context.Service<
  CallTraces,
  { readonly heard: (trace: string) => Effect.Effect<void> }
>()("@capxul/scenarios/client/CallTraces") {}

/**
 * The call an operation's check judges: its trace id, as the client told the try, or null when it did not. A check
 * judges what this call caused by it (`support/world.ts`, `entriesOfCall`), so calls of other journeys made at the
 * same time in the same world are not its business.
 */
export class ThisCall extends Context.Service<ThisCall, { readonly trace: string | null }>()(
  "@capxul/scenarios/client/ThisCall",
) {}

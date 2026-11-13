// The SDK's operations, derived from the blueprint and never listed here: their names are the blueprint's Rpc
// groups' own, and each call's types are its operation's Rpc. An operation added to the blueprint appears here with
// no change to this package; test/operations.test.ts proves the two sets are equal.
import {
  operations,
  PlatformRpcs,
  WorldRpcs,
  type CallOptions,
  type Chain,
  type Errors,
  type OperationName,
} from "@capxul/blueprint";
import * as Arr from "effect/Array";
import type * as Effect from "effect/Effect";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

type RpcOf<Name extends OperationName> = (typeof operations)[Name]["rpc"];

/** What a call of the operation sends. */
export type Payload<Name extends OperationName> = Rpc.PayloadConstructor<RpcOf<Name>>;
/** What a call of the operation answers: its declared success. */
export type Success<Name extends OperationName> = Rpc.Success<RpcOf<Name>>;
/**
 * What a call of the operation fails with: one of its declared refusals, `NotSignedIn` from sign-in, or
 * `PayloadRejected` when its payload is not of its schema and so was never sent.
 */
export type Refusal<Name extends OperationName> = Rpc.Error<RpcOf<Name>> | Errors.NotSignedIn | Errors.PayloadRejected;

/** How one call is made: the blueprint's `CallOptions` (as a person, as an operator, at another world's door). */
export type { CallOptions };

/**
 * One operation's call. It answers the operation's success or fails with one of its refusals. A call that got no
 * answer, or that the server died in, is a defect: nothing a caller can act on.
 */
export type Call<Name extends OperationName> = (
  payload: Payload<Name>,
  options?: CallOptions,
) => Effect.Effect<Success<Name>, Refusal<Name>>;

/** One function per operation, named as the blueprint names it. */
export type Client<Names extends OperationName = OperationName> = { readonly [Name in Names]: Call<Name> };

/** Every operation and the chain reads (`chain`): what `make` answers, and the scenarios' `Capxul`. */
export type Full = Client & { readonly chain: Chain.Reader };

/** The operations the platform's world service serves. */
export type PlatformName = RpcGroup.Rpcs<typeof PlatformRpcs>["_tag"];
/** The operations a world's Core serves through the world's door. */
export type WorldName = RpcGroup.Rpcs<typeof WorldRpcs>["_tag"];

/** True when the platform serves `name`. */
export const isPlatformName = (name: string): name is PlatformName => PlatformRpcs.requests.has(name);
/** True when a world's Core serves `name`. */
export const isWorldName = (name: string): name is WorldName => WorldRpcs.requests.has(name);

/** Every operation the platform serves, read from the blueprint's platform group. */
export const platformNames: ReadonlyArray<PlatformName> = Arr.filter(
  Arr.fromIterable(PlatformRpcs.requests.keys()),
  isPlatformName,
);
/** Every operation a world's Core serves, read from the blueprint's world group. */
export const worldNames: ReadonlyArray<WorldName> = Arr.filter(
  Arr.fromIterable(WorldRpcs.requests.keys()),
  isWorldName,
);
/** Every operation the SDK calls: both groups. */
export const names: ReadonlyArray<OperationName> = [...platformNames, ...worldNames];

/** True when `name` names a blueprint operation. */
export const isOperationName = (name: string): name is OperationName => name in operations;

// The SDK's operations, derived from the blueprint and never listed here: their names are the blueprint's Rpc
// groups' own, and each call's types are its operation's Rpc. An operation added to the blueprint appears here with
// no change to this package; test/operations.test.ts proves the two sets are equal.
import { operations, PlatformRpcs, WorldRpcs, type Errors, type OperationName, type Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import type * as Effect from "effect/Effect";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

type RpcOf<Name extends OperationName> = (typeof operations)[Name]["rpc"];

/** What a call of the operation sends. */
export type Payload<Name extends OperationName> = Rpc.PayloadConstructor<RpcOf<Name>>;
/** What a call of the operation answers: its declared success. */
export type Success<Name extends OperationName> = Rpc.Success<RpcOf<Name>>;
/** What a call of the operation fails with: one of its declared refusals, or `NotSignedIn` from sign-in. */
export type Refusal<Name extends OperationName> = Rpc.Error<RpcOf<Name>> | Errors.NotSignedIn;

/** How one call is made. */
export interface CallOptions {
  /**
   * The person of the world's cast the call acts as (the blueprint's `capxul-person` header). Left out, a call
   * through a world's door acts as the world's owner. A platform call always acts as its operator.
   */
  readonly as?: typeof Values.PersonId.Type;
}

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

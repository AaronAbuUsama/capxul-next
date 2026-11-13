// How the SDK reaches a door: one Effect Rpc client per blueprint group, over HTTP with JSON, carrying the
// credential on every request. Where each door is and its credential come from Effect Config or a layer argument.
import { CREDENTIAL_HEADER, PlatformRpcs, WorldRpcs, type OperationName } from "@capxul/blueprint";
import type { Refusal } from "./operations.ts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import type * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as Rpc from "effect/rpc/Rpc";
import * as RpcClient from "effect/rpc/RpcClient";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcSerialization from "effect/rpc/RpcSerialization";

/** Where a door answers and the credential its sign-in accepts. */
export interface Target {
  /** The door's address. Every call is an HTTP POST to it. */
  readonly url: string;
  /** Sent as `Bearer <token>` in the blueprint's credential header. */
  readonly token: Redacted.Redacted;
}

/**
 * One door, typed loosely: it sends any operation of its group and answers what came back, a refusal of some
 * operation, or `RpcClientError` when no answer came. `client.ts` puts each operation's own types back.
 */
export interface Door {
  readonly send: (
    name: OperationName,
    payload: unknown,
    headers: Headers.Input,
  ) => Effect.Effect<unknown, Refusal<OperationName> | RpcClientError>;
}

type Send = Door["send"] extends (...args: infer A) => infer R
  ? (tag: A[0], payload: A[1], options: { readonly headers: A[2] }) => R
  : never;

/** The platform's world service, which serves the blueprint's platform group. */
export class PlatformDoor extends Context.Service<PlatformDoor, Door>()("@capxul/sdk/transport/PlatformDoor") {}

/** A world's door, which serves the blueprint's world group from the world's Core. */
export class WorldDoor extends Context.Service<WorldDoor, Door>()("@capxul/sdk/transport/WorldDoor") {}

const doorOf = <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>) =>
  Effect.gen(function* () {
    // The SDK opens the call's span itself (client.ts), named after the operation, so the Rpc client's own is off.
    const client = yield* RpcClient.make(group, { flatten: true, disableTracing: true });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the flat client is typed tag by tag; this door is the seam that client.ts retypes per operation from the same blueprint groups.
    const send = client as unknown as Send;
    const door: Door = { send: (name, payload, headers) => send(name, payload, { headers }) };
    return door;
  });

/** Rpc over HTTP with JSON to `target`, its credential on every request. */
const protocol = (target: Target): Layer.Layer<RpcClient.Protocol, never, HttpClient.HttpClient> =>
  RpcClient.layerProtocolHttp({
    url: target.url,
    transformClient: HttpClient.mapRequest(
      HttpClientRequest.setHeader(CREDENTIAL_HEADER, `Bearer ${Redacted.value(target.token)}`),
    ),
  }).pipe(Layer.provide(RpcSerialization.layerJson));

/** The platform's door at `target`. */
export const platformDoor = (target: Target): Layer.Layer<PlatformDoor, never, HttpClient.HttpClient> =>
  Layer.effect(PlatformDoor, doorOf(PlatformRpcs)).pipe(Layer.provide(protocol(target)));

/** A world's door at `target`. */
export const worldDoor = (target: Target): Layer.Layer<WorldDoor, never, HttpClient.HttpClient> =>
  Layer.effect(WorldDoor, doorOf(WorldRpcs)).pipe(Layer.provide(protocol(target)));

/** The platform's address and the operator's token: `CAPXUL_PLATFORM_URL` and `CAPXUL_PLATFORM_TOKEN`. */
export const platformTarget: Config.Config<Target> = Config.all({
  url: Config.String("CAPXUL_PLATFORM_URL"),
  token: Config.Redacted("CAPXUL_PLATFORM_TOKEN"),
});

/** A world's door and its door token: `CAPXUL_DOOR_URL` and `CAPXUL_DOOR_TOKEN`. */
export const worldTarget: Config.Config<Target> = Config.all({
  url: Config.String("CAPXUL_DOOR_URL"),
  token: Config.Redacted("CAPXUL_DOOR_TOKEN"),
});

/** The platform's door, from `platformTarget`. */
export const platformDoorFromConfig: Layer.Layer<PlatformDoor, Config.ConfigError, HttpClient.HttpClient> =
  Layer.unwrap(Effect.map(platformTarget, platformDoor));

/** A world's door, from `worldTarget`. */
export const worldDoorFromConfig: Layer.Layer<WorldDoor, Config.ConfigError, HttpClient.HttpClient> = Layer.unwrap(
  Effect.map(worldTarget, worldDoor),
);

// How the SDK reaches a door: one Effect Rpc client per blueprint group, over HTTP with JSON, carrying the
// credential on every request. Where each door is and its credential come from Effect Config or a layer argument.
import {
  CHAIN_PATH,
  CREDENTIAL_HEADER,
  Errors,
  PlatformRpcs,
  WORLD_PATH,
  WorldRpcs,
  type OperationName,
  type Values,
} from "@capxul/blueprint";
import type { Refusal } from "./operations.ts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import type * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
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

/** Which operator signs a call: the blueprint's two. */
export type Operator = typeof Values.OperatorRole.Type;

/**
 * One chain JSON-RPC endpoint: a world's chain through its door, at `CHAIN_PATH`. It answers a method's `result`; an
 * error, or no answer, is a defect, as an unanswered call is.
 */
export type JsonRpc = (method: string, params: ReadonlyArray<unknown>) => Effect.Effect<unknown>;

/** What reaches every door the client was not handed a layer for: another operator, another world, a chain. */
export interface Reach {
  /** The platform's door, signed in as `operator`. */
  readonly platform: (operator: Operator) => Door;
  /** The world group at another world's door (a `WorldView.door`), signed in with `operator`'s credential. */
  readonly world: (door: string, operator: Operator) => Door;
  /** The chain JSON-RPC of the client's own world (null), or of the world at `door` as `operator`. */
  readonly chain: (door: string | null, operator: Operator) => JsonRpc;
}

export class ReachDoors extends Context.Service<ReachDoors, Reach>()("@capxul/sdk/transport/ReachDoors") {}

/** Where the platform answers, the client's own world's chain, and each operator's credential. */
export interface ReachSpec {
  /** The platform group's address (its `PLATFORM_PATH` URL). */
  readonly platform: string;
  /** The chain JSON-RPC of the client's own world (its `CHAIN_PATH` URL) and that world's door token. */
  readonly chain: Target;
  /** Each operator's token. A call as an operator with none is refused `NotSignedIn` for `no_credential`. */
  readonly operators: { readonly first: Redacted.Redacted; readonly second: Redacted.Redacted | null };
}

/** A door made for each call, at `target`, through `http`. Every Rpc client is closed when its call ends. */
const doorAt = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  target: Target | null,
  http: HttpClient.HttpClient,
): Door => ({
  send: (name, payload, headers) =>
    target === null
      ? Effect.fail(Errors.NotSignedIn.make({ reason: "no_credential" }))
      : doorOf(group).pipe(
          Effect.flatMap((door) => door.send(name, payload, headers)),
          Effect.scoped,
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- one Rpc client per call to a door named only at run time; its protocol layer is built for the call and closed with it.
          Effect.provide(protocol(target)),
          Effect.provideService(HttpClient.HttpClient, http),
        ),
});

const RpcAnswer = Schema.Union([
  Schema.Struct({ result: Schema.Unknown }),
  Schema.Struct({ error: Schema.Struct({ code: Schema.Int, message: Schema.String }) }),
]);

/** JSON-RPC 2.0 over HTTP to `target`, its credential on every request. */
const jsonRpcAt =
  (target: Target | null, http: HttpClient.HttpClient): JsonRpc =>
  (method, params) =>
    Effect.gen(function* () {
      if (target === null) return yield* Effect.die(`no credential to read the chain with (${method})`);
      const request = HttpClientRequest.post(target.url).pipe(
        HttpClientRequest.setHeader(CREDENTIAL_HEADER, `Bearer ${Redacted.value(target.token)}`),
        HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", id: 1, method, params }),
      );
      const response = yield* HttpClient.filterStatusOk(http).execute(request);
      const answer = yield* HttpClientResponse.schemaBodyJson(RpcAnswer)(response);
      return "result" in answer
        ? answer.result
        : yield* Effect.die(`the chain refused ${method}: ${answer.error.code} ${answer.error.message}`);
    }).pipe(Effect.orDie, Effect.withSpan(`chain ${method}`, { kind: "client" }));

/** `door` (a base address) with `path` under it. */
const under = (door: string, path: string) => `${Str.replace(/\/+$/, "")(door)}${path}`;

/** Reaches the doors `spec` names, and any world's door by its address. */
export const reach = (spec: ReachSpec): Layer.Layer<ReachDoors, never, HttpClient.HttpClient> => {
  const at = (url: string, operator: Operator): Target | null => {
    const credential = operator === "first" ? spec.operators.first : spec.operators.second;
    return credential === null ? null : { url, token: credential };
  };
  return Layer.effect(
    ReachDoors,
    Effect.map(Effect.service(HttpClient.HttpClient), (http) =>
      ReachDoors.of({
        platform: (operator) => doorAt(PlatformRpcs, at(spec.platform, operator), http),
        world: (door, operator) => doorAt(WorldRpcs, at(under(door, WORLD_PATH), operator), http),
        chain: (door, operator) => jsonRpcAt(door === null ? spec.chain : at(under(door, CHAIN_PATH), operator), http),
      }),
    ),
  );
};

/**
 * What reaches other doors, from Config: `CAPXUL_PLATFORM_URL` and `CAPXUL_PLATFORM_TOKEN` (the first operator),
 * `CAPXUL_SECOND_PLATFORM_TOKEN` (the second, optional), and the client's own world's chain at `CAPXUL_CHAIN_URL`
 * (by default `CAPXUL_DOOR_URL` with `CHAIN_PATH` in place of `WORLD_PATH`) with `CAPXUL_DOOR_TOKEN`.
 */
export const reachFromConfig: Layer.Layer<ReachDoors, Config.ConfigError, HttpClient.HttpClient> = Layer.unwrap(
  Effect.map(
    Config.all({
      platform: platformTarget,
      world: worldTarget,
      second: Config.option(Config.Redacted("CAPXUL_SECOND_PLATFORM_TOKEN")),
      chainUrl: Config.option(Config.String("CAPXUL_CHAIN_URL")),
    }),
    ({ platform, world, second, chainUrl }) =>
      reach({
        platform: platform.url,
        chain: {
          url: Option.getOrElse(chainUrl, () => Str.replace(new RegExp(`${WORLD_PATH}/?$`), CHAIN_PATH)(world.url)),
          token: world.token,
        },
        operators: { first: platform.token, second: Option.getOrNull(second) },
      }),
  ),
);

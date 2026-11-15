// A door served in this process, for tests: both blueprint groups over HTTP with JSON, as Core and the platform
// serve them, each at its own path. Its sign-in accepts one token; every handler either refuses with
// `NotImplemented`, as Core's empty handlers do, or answers its operation's first blueprint example. It keeps what
// it saw of each call (`Calls`), so a test can check what the SDK sent. When asked, it also serves a chain JSON-RPC
// at `CHAIN_PATH` behind the same token. It is built from the blueprint's groups, so it serves every operation with
// no change here. It is not a server of Capxul.
import {
  CHAIN_PATH,
  CREDENTIAL_HEADER,
  CurrentCall,
  CurrentCaller,
  CurrentOperator,
  Errors,
  operations,
  PERSON_HEADER,
  PLATFORM_PATH,
  PlatformRpcs,
  PlatformSignIn,
  Telemetry,
  TRACE_HEADER,
  WORLD_PATH,
  WorldRpcs,
  WorldSignIn,
  type OperationName,
} from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import * as Headers from "effect/http/Headers";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Schema from "effect/Schema";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
import { platformNames, worldNames } from "./operations.ts";

/** How every handler answers: `NotImplemented`, or its operation's first example's success. */
export type Answer = "not-implemented" | "examples";

export interface Options {
  /** The one token sign-in accepts, for both groups. */
  readonly token: string;
  readonly answer: Answer;
  /** How the door's chain JSON-RPC answers each method; left out, the door serves no chain. */
  readonly chain?: (method: string, params: ReadonlyArray<unknown>) => unknown;
}

/** One call as the door saw it, after sign-in let it through. */
export interface Seen {
  readonly operation: string;
  readonly traceparent: string | null;
  readonly person: string | null;
}

/** Every call the door has seen, in order. */
export class Calls extends Context.Service<Calls, Ref.Ref<ReadonlyArray<Seen>>>()("@capxul/sdk/test-door/Calls") {}

export { CHAIN_PATH, PLATFORM_PATH, WORLD_PATH };

/** The test world's name and owner, which sign-in gives every call. */
export const WORLD = "town";
export const OPERATOR = "ci";

const answerOf = (name: OperationName, answer: Answer) => () =>
  answer === "not-implemented"
    ? Effect.fail(Errors.NotImplemented.make({ operation: name }))
    : Option.match(Arr.head(operations[name].examples), {
        onNone: () => Effect.die(`${name} declares no example`),
        onSome: (example) => Effect.succeed(example.success),
      });

const handlersOf = (names: ReadonlyArray<OperationName>, answer: Answer) =>
  Rec.fromEntries(Arr.map(names, (name) => [name, answerOf(name, answer)]));

const header = (headers: Headers.Headers, name: string): string | null => Option.getOrNull(Headers.get(headers, name));

const signedIn = (token: string, headers: Headers.Headers): Effect.Effect<void, Errors.NotSignedIn> => {
  const credential = header(headers, CREDENTIAL_HEADER);
  if (credential === null) return Effect.fail(Errors.NotSignedIn.make({ reason: "no_credential" }));
  return credential === `Bearer ${token}`
    ? Effect.void
    : Effect.fail(Errors.NotSignedIn.make({ reason: "unknown_caller" }));
};

const telemetry = Layer.effect(
  Telemetry,
  Effect.map(Effect.service(Calls), (calls) =>
    Telemetry.of((effect, { rpc, headers }) => {
      const trace = header(headers, TRACE_HEADER);
      const seen: Seen = { operation: rpc._tag, traceparent: trace, person: header(headers, PERSON_HEADER) };
      const traceId = trace === null ? "" : (Str.split(trace, "-")[1] ?? "");
      return Effect.andThen(
        Ref.update(calls, (all) => Arr.append(all, seen)),
        Effect.provideService(effect, CurrentCall, { traceId, operation: rpc._tag }),
      );
    }),
  ),
);

const worldSignIn = (token: string) =>
  Layer.succeed(
    WorldSignIn,
    WorldSignIn.of((effect, { headers }) => {
      const person = header(headers, PERSON_HEADER);
      const caller =
        person === null
          ? { _tag: "owner" as const, owner: OPERATOR, world: WORLD }
          : { _tag: "person" as const, person, world: WORLD };
      return Effect.andThen(signedIn(token, headers), Effect.provideService(effect, CurrentCaller, caller));
    }),
  );

const platformSignIn = (token: string) =>
  Layer.succeed(
    PlatformSignIn,
    PlatformSignIn.of((effect, { headers }) =>
      Effect.andThen(signedIn(token, headers), Effect.provideService(effect, CurrentOperator, { operator: OPERATOR })),
    ),
  );

/** Both groups' routes, at `PLATFORM_PATH` and `WORLD_PATH`. */
export const routes = (options: Options): Layer.Layer<never, never, HttpRouter.HttpRouter | Calls> => {
  const platform = RpcServer.layerHttp({ group: PlatformRpcs, path: PLATFORM_PATH, protocol: "http" }).pipe(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one handler per name of the group, read from the group itself; a record built from a list of names cannot carry each handler's own type.
    Layer.provide(PlatformRpcs.toLayer(handlersOf(platformNames, options.answer) as never)),
    Layer.provide(platformSignIn(options.token)),
  );
  const world = RpcServer.layerHttp({ group: WorldRpcs, path: WORLD_PATH, protocol: "http" }).pipe(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above, for the world group.
    Layer.provide(WorldRpcs.toLayer(handlersOf(worldNames, options.answer) as never)),
    Layer.provide(worldSignIn(options.token)),
  );
  const groups = Layer.merge(platform, world).pipe(Layer.provide(telemetry), Layer.provide(RpcSerialization.layerJson));
  const answerChain = options.chain;
  return answerChain === undefined ? groups : Layer.merge(groups, chainRoute(options.token, answerChain));
};

const RpcRequest = Schema.Struct({ id: Schema.Int, method: Schema.String, params: Schema.Array(Schema.Unknown) });

/** The chain JSON-RPC at `CHAIN_PATH`, behind the same token: each method answered by `answer`. */
const chainRoute = (token: string, answer: (method: string, params: ReadonlyArray<unknown>) => unknown) =>
  HttpRouter.add(
    "POST",
    CHAIN_PATH,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      yield* signedIn(token, request.headers);
      const { id, method, params } = yield* HttpServerRequest.schemaBodyJson(RpcRequest);
      return HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id, result: answer(method, params) });
    }).pipe(Effect.orElseSucceed(() => HttpServerResponse.jsonUnsafe({ error: "refused" }, { status: 401 }))),
  );

/** The door, served by the `HttpServer` it is given, with the log of what it saw. */
export const serve = (options: Options): Layer.Layer<Calls, never, HttpServer.HttpServer> =>
  HttpRouter.serve(routes(options), { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provideMerge(Layer.effect(Calls, Ref.make<ReadonlyArray<Seen>>([]))),
  );

/** Where the served door answers: its base address (a `WorldView.door`), its two groups and its chain. */
export const urls: Effect.Effect<
  { readonly door: string; readonly platform: string; readonly world: string; readonly chain: string },
  never,
  HttpServer.HttpServer
> = HttpServer.addressFormattedWith((address) =>
  Effect.succeed({
    door: address,
    platform: `${address}${PLATFORM_PATH}`,
    world: `${address}${WORLD_PATH}`,
    chain: `${address}${CHAIN_PATH}`,
  }),
);

// The world's chain and bundler as Core writes to them. Both are JSON-RPC behind the world's door (packages/world):
// the chain at `/<token>/rpc`, the bundler beside it at `/<token>/bundler`. A deployed Core reaches them over its
// service binding to the door, with the door's token (src/env.ts, `CHAIN` and `CAPXUL_CHAIN_TOKEN`); a test reaches a
// local Anvil and alto by their addresses. Every call is an HttpClient request either way.
//
// This is not the door's read-only `/chain` (src/chain.ts), which callers use: operations send transactions, and
// only through here.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ENV, secretOf } from "../env.ts";
import { ChainFailed } from "../failures.ts";

export { ChainFailed };

/** One JSON-RPC call: its method and its parameters, as JSON values. */
export type JsonRpc = (method: string, params?: ReadonlyArray<unknown>) => Effect.Effect<unknown, ChainFailed>;

export class WorldChain extends Context.Service<
  WorldChain,
  {
    /** The world's chain: any method, writes included. */
    readonly rpc: JsonRpc;
    /** The world's bundler: ERC-4337's methods and alto's own (`pimlico_*`). */
    readonly bundler: JsonRpc;
  }
>()("@capxul/core/chain/WorldChain") {
  /** The chain and bundler at these addresses, over `HttpClient`. */
  static readonly at = (urls: { readonly rpc: Redacted.Redacted; readonly bundler: Redacted.Redacted }) =>
    Layer.effect(
      WorldChain,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        return WorldChain.of({ rpc: jsonRpc(http, urls.rpc, "rpc"), bundler: jsonRpc(http, urls.bundler, "bundler") });
      }),
    );

  /**
   * The chain and bundler this Core was deployed with: the service binding to the world's door, carrying the door's
   * token. A Core deployed without them dies on the first call that needs the chain.
   */
  static readonly fromEnv = (env: Record<string, unknown>) => {
    const binding = env[ENV.chain];
    const token = secretOf(env, ENV.chainToken);
    if (!isFetcher(binding) || Option.isNone(token))
      return Layer.succeed(WorldChain, WorldChain.of({ rpc: unbound("rpc"), bundler: unbound("bundler") }));
    const base = `https://chain/${Redacted.value(token.value)}`;
    // Every request goes over the binding: an HttpClient whose transport is the bound Worker's own fetch.
    const through = HttpClient.make((request) =>
      HttpClientRequest.toWeb(request).pipe(
        Effect.flatMap((web) => Effect.tryPromise(() => binding.fetch(web))),
        Effect.mapBoth({
          onSuccess: (response) => HttpClientResponse.fromWeb(request, response),
          onFailure: (cause) =>
            new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, cause }) }),
        }),
      ),
    );
    return WorldChain.at({ rpc: Redacted.make(`${base}/rpc`), bundler: Redacted.make(`${base}/bundler`) }).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, through)),
    );
  };
}

/** What a Worker's service binding offers: Cloudflare's `fetch`, on the bound Worker. */
interface Fetcher {
  readonly fetch: (request: Request) => Promise<Response>;
}

const isFetcher = (value: unknown): value is Fetcher =>
  Predicate.hasProperty(value, "fetch") && Predicate.isFunction(value.fetch);

const unbound =
  (reach: "rpc" | "bundler"): JsonRpc =>
  (method) =>
    Effect.fail(ChainFailed.make({ reach, method, message: "this Core was deployed with no chain" }));

const Answer = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.Finite), message: Schema.String })),
});

const jsonRpc =
  (http: HttpClient.HttpClient, url: Redacted.Redacted, reach: "rpc" | "bundler"): JsonRpc =>
  (method, params = []) =>
    Effect.gen(function* () {
      const request = url.pipe(
        Redacted.value,
        HttpClientRequest.post,
        HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", id: 1, method, params }),
      );
      const response = yield* http.execute(request);
      if (response.status !== 200) {
        const text = yield* response.text;
        return yield* ChainFailed.make({
          reach,
          method,
          message: `HTTP ${response.status}: ${Str.slice(0, 200)(text)}`,
        });
      }
      const answer = yield* HttpClientResponse.schemaBodyJson(Answer)(response);
      if (answer.error !== undefined)
        return yield* ChainFailed.make({ reach, method, message: Str.slice(0, 600)(answer.error.message) });
      return answer.result ?? null;
    }).pipe(
      Effect.scoped,
      Effect.mapError((error) =>
        Schema.is(ChainFailed)(error) ? error : ChainFailed.make({ reach, method, message: error.message }),
      ),
      Effect.withSpan(`${reach} ${method}`),
    );

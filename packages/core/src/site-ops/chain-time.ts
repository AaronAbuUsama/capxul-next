// Moving the world's chain with its clock: the next block is set to the warp's instant and mined, so the chain's head
// is at or after the world's new time (claims.md, world.clock.warp 1). Core reaches the chain over the service
// binding to the world's door (src/env.ts, `CHAIN`, with the chain's token), the same way its read-only `/chain` does;
// these two Anvil methods are Core's own, never a caller's.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Formatter from "effect/Formatter";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ENV, secretOf } from "../env.ts";

export class ChainTime extends Context.Service<
  ChainTime,
  {
    /** Mines a block at `seconds` (Unix), or one second after the head when that is later. False with no chain. */
    readonly mineAt: (seconds: number) => Effect.Effect<boolean>;
  }
>()("@capxul/core/site-ops/chain-time/ChainTime") {}

/** What a Worker's service binding offers: Cloudflare's `fetch`, on the bound Worker. */
interface Fetcher {
  readonly fetch: (request: Request) => Promise<Response>;
}

/** Effect's HttpClient over a service binding: each request is the bound Worker's. A failure to answer is a defect. */
const overBinding = (chain: Fetcher) =>
  HttpClient.make((request) =>
    HttpClientRequest.toWeb(request).pipe(
      Effect.flatMap((web) => Effect.tryPromise(() => chain.fetch(web))),
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      Effect.orDie,
    ),
  );

const isFetcher = (value: unknown): value is Fetcher =>
  Predicate.hasProperty(value, "fetch") && Predicate.isFunction(value.fetch);

const Answer = Schema.Struct({ result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Unknown) });
const Block = Schema.Struct({ timestamp: Schema.String });

/** Core's own calls to the chain: two Anvil methods and a read of the head, over Effect's HttpClient. */
const overHttp = (url: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const rpc = (method: string, params: ReadonlyArray<unknown>) =>
      http
        .execute(
          HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", id: 1, method, params })),
        )
        .pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Answer)),
          Effect.flatMap((answer) =>
            answer.error === undefined
              ? Effect.succeed(answer.result)
              : Effect.die(`${method}: ${Formatter.format(answer.error)}`),
          ),
          Effect.scoped,
          Effect.orDie,
        );
    return ChainTime.of({
      mineAt: (seconds) =>
        Effect.gen(function* () {
          const head = yield* Effect.flatMap(
            rpc("eth_getBlockByNumber", ["latest", false]),
            Schema.decodeUnknownEffect(Block),
          );
          const next = Math.max(seconds, Number(BigInt(head.timestamp)) + 1);
          yield* rpc("evm_setNextBlockTimestamp", [next]);
          yield* rpc("evm_mine", []);
          return true;
        }).pipe(Effect.orDie),
    });
  });

/** The chain the world's door serves at `/<token>/rpc`, through the binding `ENV.chain`; nothing when unbound. */
export const chainTimeFromEnv = (env: Record<string, unknown>): Layer.Layer<ChainTime> => {
  const chain = env[ENV.chain];
  const token = secretOf(env, ENV.chainToken);
  if (!isFetcher(chain) || Option.isNone(token))
    return Layer.succeed(ChainTime, ChainTime.of({ mineAt: () => Effect.succeed(false) }));
  return Layer.effect(ChainTime, overHttp(`https://chain/${Redacted.value(token.value)}/rpc`)).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, overBinding(chain))),
  );
};

/** A chain in memory whose head starts at `seconds`: for a test. Its head is readable through `head`. */
export const memoryChainTime = (seconds: number) =>
  Effect.map(Ref.make(seconds), (head) => ({
    head,
    layer: Layer.succeed(
      ChainTime,
      ChainTime.of({
        mineAt: (at) =>
          Effect.as(
            Ref.update(head, (now) => Math.max(at, now + 1)),
            true,
          ),
      }),
    ),
  }));

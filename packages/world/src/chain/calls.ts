// How the chain's Durable Object talks to its anvil: one JSON-RPC body forwarded as it is, or one of anvil's methods
// called for the chain's own needs, over the container's port.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ChainFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";

/** anvil's answer to one call. A result that is a string is all the chain itself ever asks for. */
const RpcAnswer = Schema.Struct({ result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Unknown) });
/** A block as the chain reads its time from it. */
const Pending = Schema.Struct({ timestamp: Schema.String });

export const failed =
  (step: ChainFailed["step"]) =>
  (cause: unknown): ChainFailed =>
    ChainFailed.make({ step, message: describeFailure(cause) });

/** What the chain needs of anvil's port: Cloudflare's fetch to the container. */
export interface Port<R> {
  readonly fetch: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, { readonly message: string }, R>;
}

export const anvilCalls = <R>(port: Port<R>) => {
  /** Sends one JSON-RPC body to anvil as it is and gives back anvil's answer as it is: the door's traffic. */
  const forward = (body: string) =>
    port
      .fetch(HttpClientRequest.post("http://container/").pipe(HttpClientRequest.bodyText(body, "application/json")))
      .pipe(
        Effect.flatMap((response) => response.text),
        Effect.mapError(failed("rpc")),
      );

  /** Calls one of anvil's methods for the chain's own needs and gives back its result, whatever it is. */
  const ask = (step: ChainFailed["step"], method: string, params: ReadonlyArray<unknown> = []) =>
    port
      .fetch(
        HttpClientRequest.post("http://container/").pipe(
          HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", id: 1, method, params }),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(RpcAnswer)),
        Effect.mapError(failed(step)),
        Effect.flatMap((answer) =>
          answer.error === undefined ? Effect.succeed(answer.result) : Effect.fail(failed(step)(answer.error)),
        ),
      );

  /** The same, insisting on a string result. */
  const call = (step: ChainFailed["step"], method: string, params: ReadonlyArray<unknown> = []) =>
    ask(step, method, params).pipe(
      Effect.flatMap((result) =>
        Predicate.isString(result) || result === true
          ? Effect.succeed(Predicate.isString(result) ? result : "true")
          : Effect.fail(failed(step)(`${method} gave no result`)),
      ),
    );

  /**
   * How many seconds anvil's clock runs ahead of the host's (behind, when negative): anvil gives its pending block
   * its own time now. A warp, a world's start block or a restore moves that clock (evm_setNextBlockTimestamp).
   */
  const clockOffset = Effect.gen(function* () {
    const pending = yield* Effect.flatMap(
      ask("save", "eth_getBlockByNumber", ["pending", false]),
      Schema.decodeUnknownEffect(Pending),
    ).pipe(Effect.mapError(failed("save")));
    return Number(BigInt(pending.timestamp)) - Math.floor((yield* Clock.currentTimeMillis) / 1000);
  });

  return { forward, ask, call, clockOffset };
};

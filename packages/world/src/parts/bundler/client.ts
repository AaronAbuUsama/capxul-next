// The world's bundler, reached from outside: one ERC-4337 JSON-RPC call through the world's door, and what the
// bundler says about its own starts and stops. This is how a world's Core, a scenario or a proof reaches it.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { BundlerFailed } from "../../common/failures.ts";
import { describeFailure } from "../../common/describe.ts";
import type { World } from "../../things/world/values.ts";
import { ENTRY_POINT } from "./Keys.ts";

type Reach = Pick<World, "bundlerUrl">;

const RpcAnswer = Schema.Struct({ result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Unknown) });

const isBundlerFailed = Schema.is(BundlerFailed);
const callFailed = (message: string) => BundlerFailed.make({ step: "call", message });
/** Any failure on the way, as the bundler call's own failure. */
const asCallFailed = (error: unknown): BundlerFailed =>
  isBundlerFailed(error) ? error : callFailed(describeFailure(error));

/** One request to the bundler's door path; a 200 answer is decoded with `schema`, anything else is a failure. */
const send = <S extends Schema.Constraint>(request: HttpClientRequest.HttpClientRequest, schema: S) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(request);
    if (response.status !== 200) {
      const body = yield* response.text;
      return yield* callFailed(`HTTP ${response.status}: ${Str.slice(0, 160)(body)}`);
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response);
  }).pipe(Effect.mapError(asCallFailed), Effect.scoped);

/**
 * One JSON-RPC call to the world's bundler. Its result may be null (a UserOperation receipt that is not there yet);
 * an answer with an error fails with that error.
 */
export const bundlerCall = (world: Reach, method: string, params: ReadonlyArray<unknown> = []) =>
  send(
    world.bundlerUrl.pipe(
      Redacted.value,
      HttpClientRequest.post,
      HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", id: 1, method, params }),
    ),
    RpcAnswer,
  ).pipe(
    Effect.flatMap((answer) =>
      answer.error === undefined
        ? Effect.succeed(answer.result ?? null)
        : Effect.fail(callFailed(`${method}: ${describeFailure(answer.error)}`)),
    ),
  );

export const BundlerStatus = Schema.Struct({
  running: Schema.Boolean,
  record: Schema.Struct({
    starts: Schema.Array(Schema.Struct({ at: Schema.String, readyMs: Schema.Finite, startCalls: Schema.Finite })),
    stops: Schema.Array(Schema.Struct({ at: Schema.String, ms: Schema.Finite })),
  }),
});
export type BundlerStatus = typeof BundlerStatus.Type;

/** Whether alto is running, and every start and stop it has made. Never starts it. */
export const bundlerStatus = (world: Reach) =>
  send(HttpClientRequest.get(`${Redacted.value(world.bundlerUrl)}/status`), BundlerStatus);

const EntryPoints = Schema.Array(Schema.String);

/** The bundler's own answer to eth_supportedEntryPoints: it must name the seeded EntryPoint. */
export const servesEntryPoint = Effect.fn("world.bundler.servesEntryPoint")(function* (world: Reach) {
  return yield* bundlerCall(world, "eth_supportedEntryPoints").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(EntryPoints)),
    Effect.mapError(asCallFailed),
    Effect.filterOrFail(
      (served) => Arr.some(served, (address) => Str.toLowerCase(address) === Str.toLowerCase(ENTRY_POINT)),
      (served) => callFailed(`the bundler serves [${Arr.join(served, ", ")}], not ${ENTRY_POINT}`),
    ),
  );
});

/**
 * Waits until the bundler serves the EntryPoint. The first call starts alto; a new container application can refuse
 * the start for a while, which the bundler's Durable Object waits out, so a call that fails is made again.
 */
export const bundlerAnswers = Effect.fn("world.bundler.answers")(function* (world: Reach) {
  return yield* servesEntryPoint(world).pipe(
    Effect.tapError((error) => Effect.logDebug(`bundler not ready: ${describeFailure(error)}`)),
    Effect.retry(Schedule.spaced("2 seconds")),
  );
});

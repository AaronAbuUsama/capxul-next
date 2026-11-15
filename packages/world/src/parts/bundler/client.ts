// The world's bundler, reached from outside: one ERC-4337 JSON-RPC call through the world's door, and what the
// bundler says about its own starts and stops. This is how a world's Core, a scenario or a proof reaches it.
//
// It is reached exactly as the chain is, through the world's door under the world's token: the chain at
// `<door>/<token>/rpc`, the bundler beside it at `<door>/<token>/bundler` (BUNDLER_PATH). The world's handle carries
// it as `world.bundlerUrl`, Redacted like `world.rpcUrl`, with `world.entryPoint` and `world.paymaster`; `show` and
// `create` print all three, the token hidden unless `--reveal`. Core reaches it over the same service binding and
// token as the chain: no new binding or secret. The EntryPoint and the test paymaster are the same in every world
// (Keys.ts); a UserOperation the paymaster sponsors names it in `paymaster` with `paymasterData` `0x`. A call wakes a
// stopped chain and starts alto if it is stopped (about 8 s, records/spike-bundler).
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

/** The EntryPoints the bundler says it serves (eth_supportedEntryPoints), whichever they are. */
const supportedEntryPoints = (world: Reach) =>
  bundlerCall(world, "eth_supportedEntryPoints").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(EntryPoints)),
    Effect.mapError(asCallFailed),
  );

/** An answer that names the seeded EntryPoint passes; one that names others is a wrong bundler, not a slow one. */
const mustServe = (served: ReadonlyArray<string>) =>
  Arr.some(served, (address) => Str.toLowerCase(address) === Str.toLowerCase(ENTRY_POINT))
    ? Effect.succeed(served)
    : Effect.fail(callFailed(`the bundler serves [${Arr.join(served, ", ")}], not ${ENTRY_POINT}`));

/** The bundler's own answer to eth_supportedEntryPoints: it must name the seeded EntryPoint. One look. */
export const servesEntryPoint = Effect.fn("world.bundler.servesEntryPoint")(function* (world: Reach) {
  return yield* mustServe(yield* supportedEntryPoints(world));
});

/** How long a world's creation waits for alto's first start: every 2 s, for as long as the create's step allows. */
export const UntilStarted: Schedule.Schedule<unknown, BundlerFailed> = Schedule.spaced("2 seconds");

/**
 * How long a reset waits for the bundler it kept up: every second, 61 looks at most (the first and 60 more, as
 * `Schedule.recurs(60)` under `Effect.retry` allows), well inside the reset's own
 * timeout (WORLD_TIMEOUT_RESET, 5 minutes). Its first look normally passes; the rest ride out a dropped connection
 * through the shared hub's door.
 */
export const AfterReset: Schedule.Schedule<unknown, BundlerFailed> = Schedule.max([
  Schedule.spaced("1 second"),
  Schedule.recurs(60),
]);

/**
 * Waits until the bundler serves the EntryPoint, looking again on `patience` while it cannot be reached or does not
 * answer yet (a transport error, an HTTP error, an RPC error). The first call starts alto; a new container application
 * can refuse the start for a while, which the bundler's Durable Object waits out. An answer naming another EntryPoint
 * fails at once: asking again would not change it.
 */
export const bundlerAnswers = Effect.fn("world.bundler.answers")(function* (
  world: Reach,
  patience: Schedule.Schedule<unknown, BundlerFailed> = UntilStarted,
  // The declared span each look runs in, when the caller has one (a reset's `world.reset.bundler.serving`).
  look?: string,
) {
  const once = supportedEntryPoints(world);
  const served = yield* (look === undefined ? once : once.pipe(Effect.withSpan(look))).pipe(
    Effect.tapError((error) => Effect.logDebug(`bundler not ready: ${describeFailure(error)}`)),
    Effect.retry(patience),
  );
  return yield* mustServe(served);
});

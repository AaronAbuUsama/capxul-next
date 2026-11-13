// One world's bundler. The Durable Object is the only thing that starts and stops the alto container. It starts alto
// on a bundler call when alto is stopped (the door has already woken the chain), waits until alto names the
// EntryPoint in eth_supportedEntryPoints, and forwards the call. The chain stops it before the chain is saved.
//
// Nothing is saved on stop: alto keeps its mempool in memory, and everything else it needs (its simulation
// contracts, its executor's nonce, the paymaster's deposit) is on the chain, which is saved.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Str from "effect/String";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { BundlerFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { ALTO_PORT, Alto } from "./Alto.ts";
import { BUNDLER_KEYS, ENTRY_POINT } from "./Keys.ts";

/** How long a start may take before the call that caused it gives up. */
const READY_WITHIN = "240 seconds";
/** Cloudflare's own stop of an idle container, put far enough out that the world's idle stop always comes first. */
const ALTO_INACTIVITY_MS = 3600 * 1000;
/** Where the chain's address alto is started with is kept. */
const RPC_URL_KEY = "rpcUrl";
/** How many starts and stops the bundler remembers. */
const REMEMBERED = 20;

/** What the bundler remembers about its own starts and stops. */
export interface BundlerRecord {
  readonly starts: ReadonlyArray<{ readonly at: string; readonly readyMs: number; readonly startCalls: number }>;
  readonly stops: ReadonlyArray<{ readonly at: string; readonly ms: number }>;
}

const empty: BundlerRecord = { starts: [], stops: [] };

const failed =
  (step: BundlerFailed["step"]) =>
  (cause: unknown): BundlerFailed =>
    BundlerFailed.make({ step, message: describeFailure(cause) });

const stamp = (ms: number): string => DateTime.formatIso(DateTime.makeUnsafe(ms));
const remembered = <A>(list: ReadonlyArray<A>, next: A): ReadonlyArray<A> =>
  Arr.takeRight(Arr.append(list, next), REMEMBERED);

/** alto's settings. ALTO_RPC_URL holds the door's token, so it is only ever a variable of the running container. */
const settings = (rpcUrl: string) => ({
  ALTO_RPC_URL: rpcUrl,
  ALTO_ENTRYPOINTS: ENTRY_POINT,
  ALTO_EXECUTOR_PRIVATE_KEYS: BUNDLER_KEYS.executor,
  ALTO_UTILITY_PRIVATE_KEY: BUNDLER_KEYS.utility,
  ALTO_PORT: String(ALTO_PORT),
  // Unsafe mode: no debug_traceCall validation of the ERC-7562 rules (anvil's tracer is not geth's), no stake checks.
  ALTO_SAFE_MODE: "false",
  // anvil mines a block per transaction; alto polls for new blocks every half block time.
  ALTO_BLOCK_TIME: "2000",
  ALTO_LOG_LEVEL: "info",
  ALTO_PUBLIC_CLIENT_LOG_LEVEL: "error",
  ALTO_WALLET_CLIENT_LOG_LEVEL: "error",
});

const SUPPORTED_ENTRY_POINTS = { jsonrpc: "2.0", id: 1, method: "eth_supportedEntryPoints", params: [] };

export default class Bundler extends Cloudflare.DurableObject<Bundler>()(
  "Bundler",
  Effect.gen(function* () {
    const alto = yield* Alto;
    const state = yield* Cloudflare.DurableObjectState;

    // Alchemy builds a Durable Object in two phases: this Effect binds, and the Effect it returns runs once for
    // each instance.
    // @effect-diagnostics-next-line returnEffectInGen:off
    return Effect.gen(function* () {
      const port = yield* alto.getTcpPort(ALTO_PORT);
      const lock = yield* Semaphore.make(1);
      const running = alto.running.pipe(Effect.mapError(failed("status")));
      const record = state.storage.get<BundlerRecord>("record").pipe(Effect.map((found) => found ?? empty));
      const remember = (change: (old: BundlerRecord) => BundlerRecord) =>
        record.pipe(Effect.flatMap((old) => state.storage.put("record", change(old))));

      const send = (request: HttpClientRequest.HttpClientRequest) =>
        port.fetch(request).pipe(
          Effect.flatMap((response) => response.text),
          Effect.mapError(failed("rpc")),
        );
      /** One JSON-RPC body to alto as it is, and alto's answer as it is. */
      const forward = (body: string) =>
        send(HttpClientRequest.post("http://container/").pipe(HttpClientRequest.bodyText(body, "application/json")));

      /** alto is ready when it names the seeded EntryPoint, not when its port first answers. */
      const answersEntryPoint = send(
        HttpClientRequest.post("http://container/").pipe(HttpClientRequest.bodyJsonUnsafe(SUPPORTED_ENTRY_POINTS)),
      ).pipe(
        Effect.map((text) => Str.includes(Str.toLowerCase(ENTRY_POINT))(Str.toLowerCase(text))),
        Effect.orElseSucceed(() => false),
      );

      // A new container application refuses starts for a while ("There is no container instance that can be
      // provided to this Durable Object, try again later"), from the start or from the call after it, and a start
      // made before its first instance has the image can be lost. So while alto is awaited, it is started again
      // whenever it is seen not running, and a refusal is "not yet", not a failure.
      const begin = (offered: string) =>
        Effect.gen(function* () {
          if ((yield* running) && (yield* answersEntryPoint)) return;
          // The chain's address alto was first started with is kept and used again: a later call may come over a
          // service binding, whose host is not the door's public address. It holds the door's token, so it is kept
          // apart from the record, which `status` gives out.
          const kept = yield* state.storage.get<string>(RPC_URL_KEY);
          const rpcUrl = kept ?? offered;
          if (kept === undefined) yield* state.storage.put(RPC_URL_KEY, rpcUrl);
          const began = yield* Clock.currentTimeMillis;
          const startCalls = yield* Ref.make(0);
          const attempt = Effect.gen(function* () {
            if (!(yield* running)) {
              yield* Ref.update(startCalls, (n) => n + 1);
              const started = yield* alto.start({ enableInternet: true, env: settings(rpcUrl) }).pipe(
                // The world's idle stop, which is recorded, must be the stop that happens.
                Effect.andThen(alto.setInactivityTimeout(ALTO_INACTIVITY_MS)),
                Effect.as(true),
                Effect.catch((error) =>
                  Effect.as(Effect.logWarning(`alto start refused: ${describeFailure(error)}`), false),
                ),
              );
              if (!started) return false;
            }
            return yield* answersEntryPoint;
          });
          yield* attempt.pipe(
            Effect.repeat({ until: (ready) => ready, schedule: Schedule.spaced("1 second") }),
            Effect.timeoutOrElse({
              duration: READY_WITHIN,
              orElse: () =>
                Effect.fail(BundlerFailed.make({ step: "ready", message: `alto not ready in ${READY_WITHIN}` })),
            }),
          );
          const readyMs = (yield* Clock.currentTimeMillis) - began;
          const start = { at: stamp(began), readyMs, startCalls: yield* Ref.get(startCalls) };
          yield* remember((old) => ({ ...old, starts: remembered(old.starts, start) }));
        }).pipe(lock.withPermits(1));

      return {
        /**
         * One bundler JSON-RPC body in, alto's answer out. Starts alto when it is stopped, against the chain address
         * of its first start, or this one if it never started.
         */
        rpc: (body: string, rpcUrl: string) => begin(rpcUrl).pipe(Effect.andThen(forward(body))),
        /** Stops alto. What it held in memory is gone; everything it needs again is on the chain. */
        stop: () =>
          Effect.gen(function* () {
            if (!(yield* running)) return { stopped: false as const };
            const began = yield* Clock.currentTimeMillis;
            yield* alto.destroy().pipe(Effect.mapError(failed("stop")));
            const stop = { at: stamp(began), ms: (yield* Clock.currentTimeMillis) - began };
            yield* remember((old) => ({ ...old, stops: remembered(old.stops, stop) }));
            return { stopped: true as const, ...stop };
          }).pipe(lock.withPermits(1)),
        /** Whether the container is up, and every start and stop so far. Never starts alto. */
        status: () => Effect.all({ running, record }),
      };
    });
  }),
) {}

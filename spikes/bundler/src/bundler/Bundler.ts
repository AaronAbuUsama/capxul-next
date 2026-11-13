// One world's bundler. The Durable Object is the only thing that starts and stops the alto container. It starts alto
// on the first bundler call (the door has already woken the chain), waits until alto answers
// eth_supportedEntryPoints with the EntryPoint, and forwards the call. The chain stops it before the chain is saved.
// Nothing is saved on stop: alto's mempool lives in memory, and everything else it needs (its simulation contracts,
// its executor's nonce, the paymaster's deposit) is on the chain, which is saved.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import { ALTO_PORT, Alto } from "./Alto.ts";
import { BUNDLER_KEYS, ENTRY_POINT } from "./Keys.ts";

export class BundlerFailed extends Data.TaggedError("BundlerFailed")<{
  readonly step: "start" | "ready" | "rpc" | "stop" | "status";
  readonly message: string;
}> {}

/** What the bundler remembers about its own starts and stops; the README's bundler timings come from here. */
export interface BundlerRecord {
  readonly starts: ReadonlyArray<{ readonly at: string; readonly readyMs: number; readonly startCalls: number }>;
  readonly stops: ReadonlyArray<{ readonly at: string; readonly ms: number }>;
}

const failed = (step: BundlerFailed["step"]) => (cause: unknown) =>
  new BundlerFailed({ step, message: cause instanceof Error ? cause.message : JSON.stringify(cause) });

/** How long a start may take before the call that caused it gives up. */
const READY_WITHIN = "240 seconds";

/** alto's settings. ALTO_RPC_URL holds the door's token, so it is only ever an environment variable. */
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

export default class Bundler extends Cloudflare.DurableObject<Bundler>()(
  "Bundler",
  Effect.gen(function* () {
    const alto = yield* Alto;
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      const port = yield* alto.getTcpPort(ALTO_PORT);
      const lock = yield* Semaphore.make(1);
      const running = alto.running.pipe(Effect.mapError(failed("status")));
      const record = state.storage
        .get<BundlerRecord>("record")
        .pipe(Effect.map((found) => found ?? { starts: [], stops: [] }));
      const remember = (change: (old: BundlerRecord) => BundlerRecord) =>
        record.pipe(Effect.flatMap((old) => state.storage.put("record", change(old))));

      const forward = (body: string) =>
        port
          .fetch(HttpClientRequest.post("http://container/").pipe(HttpClientRequest.bodyText(body, "application/json")))
          .pipe(Effect.flatMap((response) => response.text), Effect.mapError(failed("rpc")));

      /** alto is ready when it names the seeded EntryPoint, not when its port first answers. */
      const answersEntryPoint = forward(
        '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}',
      ).pipe(
        Effect.map((text) => text.toLowerCase().includes(ENTRY_POINT.toLowerCase())),
        Effect.catch(() => Effect.succeed(false)),
      );

      // A new container application loses a start made before its first instance has the image (spikes/containers),
      // so the start is made again whenever the container is seen not running while it is awaited.
      const begin = (rpcUrl: string) =>
        Effect.gen(function* () {
          if ((yield* running) && (yield* answersEntryPoint)) return;
          const began = yield* Clock.currentTimeMillis;
          let startCalls = 0;
          const attempt = Effect.gen(function* () {
            if (!(yield* running)) {
              startCalls++;
              // On a new application the start itself can be refused for a while ("There is no container instance
              // that can be provided to this Durable Object, try again later"): it is tried again, not given up on.
              // The refusal can come from the start or from the call after it, so both are tried again.
              const started = yield* alto.start({ enableInternet: true, env: settings(rpcUrl) }).pipe(
                // The world's idle stop, which is recorded, must be the stop that happens.
                Effect.andThen(alto.setInactivityTimeout(3600 * 1000)),
                Effect.as(true),
                Effect.catch((error) => Effect.as(Effect.logWarning("alto start refused", error), false)),
              );
              if (!started) return false;
            }
            return yield* answersEntryPoint;
          });
          yield* attempt.pipe(
            Effect.repeat({ until: (ready) => ready, schedule: Schedule.spaced("1 second") }),
            Effect.timeoutOrElse({
              duration: READY_WITHIN,
              orElse: () => Effect.fail(new BundlerFailed({ step: "ready", message: `alto not ready in ${READY_WITHIN}` })),
            }),
          );
          const readyMs = (yield* Clock.currentTimeMillis) - began;
          const start = { at: new Date(began).toISOString(), readyMs, startCalls };
          yield* remember((old) => ({ ...old, starts: [...old.starts, start] }));
        }).pipe(lock.withPermits(1));

      return {
        /** One bundler JSON-RPC body in, alto's answer out. Starts alto, against this chain address, when it is stopped. */
        rpc: (body: string, rpcUrl: string) => begin(rpcUrl).pipe(Effect.andThen(forward(body))),
        stop: () =>
          Effect.gen(function* () {
            if (!(yield* running)) return { stopped: false as const };
            const began = yield* Clock.currentTimeMillis;
            yield* alto.destroy().pipe(Effect.mapError(failed("stop")));
            const stop = { at: new Date(began).toISOString(), ms: (yield* Clock.currentTimeMillis) - began };
            yield* remember((old) => ({ ...old, stops: [...old.stops, stop] }));
            return { stopped: true as const, ...stop };
          }).pipe(lock.withPermits(1)),
        /** Whether the container is up, and every start and stop so far. Never starts alto. */
        status: () => Effect.all({ running, record }),
      };
    });
  }),
) {}

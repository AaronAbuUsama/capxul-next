// One world's bundler. The Durable Object is the only thing that starts and stops the alto container. It starts alto
// on a bundler call when alto is stopped (the door has already woken the chain), waits until alto names the
// EntryPoint in eth_supportedEntryPoints, and forwards the call. The chain stops it before the chain is saved.
//
// Nothing is saved on stop: alto keeps its mempool in memory, and everything else it needs (its simulation
// contracts, its executor's nonce, the paymaster's deposit) is on the chain, which is saved.
//
// When the chain is rewound in place (a world's reset), alto is kept running: what it holds of the chain as it was,
// its mempool and its reputation counts, is cleared (`debug_bundler_clearState`), and it reads everything else from
// the chain again at its next bundle (its executor's nonce is read at every bundle; it watches blocks only while a
// bundle is pending, from the head it finds then). A new container took 6 to 29 s to answer after each reset
// (docs/design/run-time.md, option 6f). An alto that will not clear is stopped, as before, and starts on its next call.
// alto's debug methods are its own: a call from outside that names one is refused.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import * as Str from "effect/String";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { BUNDLER_START, gaveUpMessage, type StartReport, startPatiently } from "../containers/patience.ts";
import { remembered, stamp } from "../containers/record.ts";
import { BundlerFailed } from "../../common/failures.ts";
import { describeFailure } from "../../common/describe.ts";
import { ALTO_PORT, Alto } from "./Alto.ts";
import { BUNDLER_KEYS, ENTRY_POINT } from "./Keys.ts";

/** Cloudflare's own stop of an idle container, put far enough out that the world's idle stop always comes first. */
const ALTO_INACTIVITY_MS = 3600 * 1000;
/** Where the chain's address alto is started with is kept. */
const RPC_URL_KEY = "rpcUrl";
/** What the bundler remembers about its own starts and stops: each start with every try (src/parts/containers). */
export interface BundlerRecord {
  readonly starts: ReadonlyArray<StartReport & { readonly at: string; readonly readyMs: number }>;
  readonly stops: ReadonlyArray<{ readonly at: string; readonly ms: number }>;
  /** Each time the chain was rewound under a running alto and alto was kept, its state cleared. */
  readonly clears?: ReadonlyArray<{ readonly at: string; readonly ms: number }>;
}

const empty: BundlerRecord = { starts: [], stops: [] };

const failed =
  (step: BundlerFailed["step"]) =>
  (cause: unknown): BundlerFailed =>
    BundlerFailed.make({ step, message: describeFailure(cause) });

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
const CLEAR_STATE = { jsonrpc: "2.0", id: 1, method: "debug_bundler_clearState", params: [] };
/** alto's own debug methods, never forwarded from outside. */
const DEBUG_METHOD = '"debug_';

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
      // whenever it is seen not running, within BUNDLER_START (src/parts/containers/patience.ts), and a refusal is "not
      // yet", not a failure.
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
          const report = yield* startPatiently({
            running: alto.running,
            // The world's idle stop, which is recorded, must be the stop that happens.
            start: alto
              .start({ enableInternet: true, env: settings(rpcUrl) })
              .pipe(Effect.andThen(alto.setInactivityTimeout(ALTO_INACTIVITY_MS))),
            ready: Effect.filterOrFail(
              answersEntryPoint,
              (ready) => ready,
              () => "alto does not name the EntryPoint yet",
            ),
            patience: BUNDLER_START,
            gaveUp: (tried) =>
              BundlerFailed.make({ step: "ready", message: gaveUpMessage("alto", BUNDLER_START, tried) }),
          });
          const readyMs = (yield* Clock.currentTimeMillis) - began;
          const start = { at: stamp(began), readyMs, ...report };
          yield* remember((old) => ({ ...old, starts: remembered(old.starts, start) }));
        }).pipe(lock.withPermits(1));

      const stopAlto = Effect.gen(function* () {
        if (!(yield* running)) return { stopped: false as const };
        const began = yield* Clock.currentTimeMillis;
        yield* alto.destroy().pipe(Effect.mapError(failed("stop")));
        const stop = { at: stamp(began), ms: (yield* Clock.currentTimeMillis) - began };
        yield* remember((old) => ({ ...old, stops: remembered(old.stops, stop) }));
        return { stopped: true as const, ...stop };
      });

      /** alto's answer to `debug_bundler_clearState` is "ok" when it cleared; an alto started without its debug methods refuses. */
      const clearState = Effect.fn("world.bundler.clearState")(function* () {
        const text = yield* send(
          HttpClientRequest.post("http://container/").pipe(HttpClientRequest.bodyJsonUnsafe(CLEAR_STATE)),
        ).pipe(Effect.orElseSucceed(() => ""));
        return Str.includes('"result":"ok"')(Str.replaceAll(" ", "")(text));
      });

      return {
        /**
         * One bundler JSON-RPC body in, alto's answer out. Starts alto when it is stopped, against the chain address
         * of its first start, or this one if it never started. alto's debug methods are refused.
         */
        rpc: (body: string, rpcUrl: string) =>
          Str.includes(DEBUG_METHOD)(body)
            ? Effect.fail(BundlerFailed.make({ step: "rpc", message: "alto's debug methods are not served" }))
            : begin(rpcUrl).pipe(Effect.andThen(forward(body))),
        /** Stops alto. What it held in memory is gone; everything it needs again is on the chain. */
        stop: () => stopAlto.pipe(lock.withPermits(1)),
        /**
         * The chain was rewound under alto (a world's reset): a running alto is kept and its state cleared, so the
         * next call needs no start; one that will not clear is stopped, and starts on its next call.
         */
        reset: Effect.fn("world.bundler.reset")(function* () {
          if (!(yield* running)) return { kept: false as const, stopped: false as const };
          const began = yield* Clock.currentTimeMillis;
          if (yield* clearState()) {
            const clear = { at: stamp(began), ms: (yield* Clock.currentTimeMillis) - began };
            yield* remember((old) => ({ ...old, clears: remembered(old.clears ?? [], clear) }));
            yield* Effect.logInfo(`alto kept across the chain's reset, its state cleared in ${clear.ms} ms`);
            return { kept: true as const, ...clear };
          }
          yield* Effect.logInfo("alto would not clear its state (no debug methods): stopped, as before");
          return { kept: false as const, ...(yield* stopAlto) };
        }, lock.withPermits(1)),
        /** Removes the container and everything this object keeps: the world is being forgotten (src/things/cluster). */
        forget: () =>
          Effect.gen(function* () {
            if (yield* running) yield* alto.destroy().pipe(Effect.mapError(failed("forget")));
            yield* state.storage.deleteAll();
            return { forgot: true as const };
          }).pipe(lock.withPermits(1)),
        /** Whether the container is up, and every start and stop so far. Never starts alto. */
        status: () => Effect.all({ running, record }),
      };
    });
  }),
) {}

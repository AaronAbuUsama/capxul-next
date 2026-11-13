// One world's index. The Durable Object starts the Ponder container with the chain's address, answers for it, and
// stops it. Nothing is saved on stop: everything Ponder knows is in the world's database, and a start with the same
// schema carries on from there.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Schema from "effect/Schema";
import { PONDER_PORT, Ponder } from "./Ponder.ts";

/** How many starts and stops the index remembers. */
const REMEMBERED = 20;

export class IndexerFailed extends Schema.TaggedError<IndexerFailed>()("IndexerFailed", {
  step: Schema.Literals(["start", "stop", "status"]),
  message: Schema.String,
}) {}

export interface IndexerRecord {
  /** Where the chain is, as the index was last told; kept for the next resume. */
  readonly rpcUrl: string | null;
  readonly starts: ReadonlyArray<{ readonly at: string; readonly atMs: number; readonly readyMs: number | null }>;
  readonly stops: ReadonlyArray<{ readonly at: string; readonly ms: number }>;
}

const failed = (step: IndexerFailed["step"]) => (cause: unknown) =>
  new IndexerFailed({ step, message: cause instanceof Error ? cause.message : JSON.stringify(cause) });

const stamp = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

export default class Indexer extends Cloudflare.DurableObject<Indexer>()(
  "Indexer",
  Effect.gen(function* () {
    const ponder = yield* Ponder;
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      const port = yield* ponder.getTcpPort(PONDER_PORT);
      const record = state.storage
        .get<IndexerRecord>("record")
        .pipe(Effect.map((found) => found ?? { rpcUrl: null, starts: [], stops: [] }));
      const running = ponder.running.pipe(Effect.mapError(failed("status")));

      /** One of Ponder's own endpoints; null while its server is not answering yet. */
      const probe = (path: string) =>
        port.fetch(HttpClientRequest.get(`http://container${path}`)).pipe(
          Effect.flatMap((response) => response.text.pipe(Effect.map((body) => ({ status: response.status, body })))),
          Effect.catch(() => Effect.succeed(null)),
        );

      const begin = (rpcUrl: string) =>
        Effect.gen(function* () {
          if (yield* running) return { started: false as const };
          const atMs = yield* Clock.currentTimeMillis;
          yield* ponder
            .start({ enableInternet: true, env: { RPC_URL: rpcUrl } })
            .pipe(Effect.mapError(failed("start")));
          // Not for Ponder's sake (it loses nothing by being stopped) but so that the world's own idle stop, which
          // is the one that is recorded, is the stop that happens.
          yield* ponder.setInactivityTimeout(3600 * 1000).pipe(Effect.mapError(failed("start")));
          const old = yield* record;
          const start = { at: stamp(atMs), atMs, readyMs: null };
          yield* state.storage.put("record", { ...old, rpcUrl, starts: [...old.starts, start].slice(-REMEMBERED) });
          return { started: true as const, at: start.at };
        });

      /** Writes down, once, how long after the last start Ponder was first seen ready. */
      const noteReady = Effect.gen(function* () {
        const old = yield* record;
        const last = old.starts.at(-1);
        if (!last || last.readyMs !== null) return;
        const seen = { ...last, readyMs: (yield* Clock.currentTimeMillis) - last.atMs };
        yield* state.storage.put("record", { ...old, starts: [...old.starts.slice(0, -1), seen] });
      });

      return {
        /** Starts Ponder against a chain address, and remembers the address for the next resume. */
        start: (rpcUrl: string) => begin(rpcUrl),
        /** Starts Ponder again with what it was last started with; does nothing if it never was. */
        resume: () =>
          Effect.gen(function* () {
            const { rpcUrl } = yield* record;
            if (rpcUrl === null) return { started: false as const };
            return yield* begin(rpcUrl);
          }),
        stop: () =>
          Effect.gen(function* () {
            if (!(yield* running.pipe(Effect.mapError(failed("stop"))))) return { stopped: false as const };
            const began = yield* Clock.currentTimeMillis;
            yield* ponder.destroy().pipe(Effect.mapError(failed("stop")));
            const stop = { at: stamp(began), ms: (yield* Clock.currentTimeMillis) - began };
            const old = yield* record;
            yield* state.storage.put("record", { ...old, stops: [...old.stops, stop].slice(-REMEMBERED) });
            return { stopped: true as const, ...stop };
          }),
        /** Whether the container is up, what Ponder says about itself, and its starts and stops. */
        status: () =>
          Effect.gen(function* () {
            const up = yield* running;
            const health = up ? yield* probe("/health") : null;
            const ready = health?.status === 200 ? yield* probe("/ready") : null;
            const indexed = ready?.status === 200 ? yield* probe("/status") : null;
            if (ready?.status === 200) yield* noteReady;
            const { starts, stops } = yield* record;
            return {
              running: up,
              health: health?.status ?? null,
              ready: ready?.status ?? null,
              indexed: indexed?.body ?? null,
              starts,
              stops,
            };
          }),
      };
    });
  }),
) {}

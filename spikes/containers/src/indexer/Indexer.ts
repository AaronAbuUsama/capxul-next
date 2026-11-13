// One world's indexer. The Durable Object starts the Ponder container with the chain's address, answers for it, and
// stops it. Nothing is saved on stop: everything Ponder knows is in the world's database, and a start with the same
// schema carries on from there.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { PONDER_PORT, Ponder } from "./Ponder.ts";

export class IndexerFailed extends Data.TaggedError("IndexerFailed")<{
  readonly step: "start" | "stop" | "status";
  readonly message: string;
}> {}

export interface IndexerSettings {
  readonly rpcUrl: string;
  readonly startBlock: number;
}

export interface IndexerRecord {
  readonly settings: IndexerSettings | null;
  readonly starts: ReadonlyArray<{ readonly at: string; readonly healthyMs: number | null; readonly readyMs: number | null }>;
  readonly stops: ReadonlyArray<{ readonly at: string; readonly ms: number }>;
}

const failed = (step: IndexerFailed["step"]) => (cause: unknown) =>
  new IndexerFailed({ step, message: cause instanceof Error ? cause.message : JSON.stringify(cause) });

export default class Indexer extends Cloudflare.DurableObject<Indexer>()(
  "Indexer",
  Effect.gen(function* () {
    const ponder = yield* Ponder;
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      const port = yield* ponder.getTcpPort(PONDER_PORT);
      const record = state.storage
        .get<IndexerRecord>("record")
        .pipe(Effect.map((found) => found ?? { settings: null, starts: [], stops: [] }));
      const running = ponder.running.pipe(Effect.mapError(failed("status")));

      /** One of Ponder's own endpoints; null while its server is not answering yet. */
      const probe = (path: string) =>
        port.fetch(HttpClientRequest.get(`http://container${path}`)).pipe(
          Effect.flatMap((response) => response.text.pipe(Effect.map((body) => ({ status: response.status, body })))),
          Effect.catch(() => Effect.succeed(null)),
        );

      const begin = (settings: IndexerSettings) =>
        Effect.gen(function* () {
          if (yield* running) return { started: false as const };
          const at = new Date(yield* Clock.currentTimeMillis).toISOString();
          yield* ponder
            .start({ enableInternet: true, env: { RPC_URL: settings.rpcUrl, START_BLOCK: String(settings.startBlock) } })
            .pipe(Effect.mapError(failed("start")));
          // Not for Ponder's sake (it loses nothing by being stopped) but so that the world's own idle stop, which
          // is the one that is recorded, is the stop that happens.
          yield* ponder.setInactivityTimeout(3600 * 1000).pipe(Effect.mapError(failed("start")));
          const old = yield* record;
          yield* state.storage.put("record", { ...old, settings, starts: [...old.starts, { at, healthyMs: null, readyMs: null }] });
          return { started: true as const, at };
        });

      /** Writes down, once each, how long after the last start Ponder was first seen healthy and first seen ready. */
      const note = (healthy: boolean, ready: boolean) =>
        Effect.gen(function* () {
          const old = yield* record;
          const last = old.starts.at(-1);
          if (!last || ((last.healthyMs !== null || !healthy) && (last.readyMs !== null || !ready))) return;
          const since = (yield* Clock.currentTimeMillis) - Date.parse(last.at);
          const seen = {
            ...last,
            healthyMs: last.healthyMs ?? (healthy ? since : null),
            readyMs: last.readyMs ?? (ready ? since : null),
          };
          yield* state.storage.put("record", { ...old, starts: [...old.starts.slice(0, -1), seen] });
        });

      return {
        /** Starts Ponder against a chain address, and remembers the address for the next resume. */
        start: (settings: IndexerSettings) => begin(settings),
        /** Starts Ponder again with what it was last started with; does nothing if it never was. */
        resume: () =>
          record.pipe(
            Effect.flatMap((old) => (old.settings ? begin(old.settings) : Effect.succeed({ started: false as const }))),
          ),
        stop: () =>
          Effect.gen(function* () {
            if (!(yield* running.pipe(Effect.mapError(failed("stop"))))) return { stopped: false as const };
            const began = yield* Clock.currentTimeMillis;
            yield* ponder.destroy().pipe(Effect.mapError(failed("stop")));
            const stop = { at: new Date(began).toISOString(), ms: (yield* Clock.currentTimeMillis) - began };
            const old = yield* record;
            yield* state.storage.put("record", { ...old, stops: [...old.stops, stop] });
            return { stopped: true as const, ...stop };
          }),
        /** Whether the container is up, what Ponder says about itself, and every start and stop so far. */
        status: () =>
          Effect.gen(function* () {
            const up = yield* running;
            const health = up ? yield* probe("/health") : null;
            const ready = health?.status === 200 ? yield* probe("/ready") : null;
            const indexed = ready?.status === 200 ? yield* probe("/status") : null;
            yield* note(health?.status === 200, ready?.status === 200);
            const { settings, ...rest } = yield* record;
            return { running: up, health: health?.status ?? null, ready: ready?.status ?? null, indexed: indexed?.body ?? null, record: rest };
          }),
      };
    });
  }),
) {}

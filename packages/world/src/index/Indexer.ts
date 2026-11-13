// One world's index. The Durable Object starts the Ponder container with the chain's address, answers for it, and
// stops it. Nothing is saved on stop: everything Ponder knows is in the world's database, and a start with the same
// schema carries on from there.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { IndexerFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { PONDER_PORT, Ponder } from "./Ponder.ts";

/** How many starts and stops the index remembers. */
const REMEMBERED = 20;
/** Cloudflare's own stop of an idle container, put far enough out that the world's own idle stop always comes first. */
const PONDER_INACTIVITY_MS = 3600 * 1000;

interface Start {
  readonly at: string;
  readonly atMs: number;
  readonly readyMs: number | null;
}

export interface IndexerRecord {
  /** Where the chain is, as the index was last told; kept for the next resume. */
  readonly rpcUrl: string | null;
  readonly starts: ReadonlyArray<Start>;
  readonly stops: ReadonlyArray<{ readonly at: string; readonly ms: number }>;
}

const empty: IndexerRecord = { rpcUrl: null, starts: [], stops: [] };

const failed =
  (step: IndexerFailed["step"]) =>
  (cause: unknown): IndexerFailed =>
    IndexerFailed.make({ step, message: describeFailure(cause) });

/** Whether one of Ponder's endpoints answered 200. */
const answered = (probed: Option.Option<{ readonly status: number; readonly body: string }>): boolean =>
  Option.isSome(probed) && probed.value.status === 200;

const stamp = (ms: number): string => DateTime.formatIso(DateTime.makeUnsafe(ms));
const remembered = <A>(list: ReadonlyArray<A>, next: A): ReadonlyArray<A> =>
  Arr.takeRight(Arr.append(list, next), REMEMBERED);

export default class Indexer extends Cloudflare.DurableObject<Indexer>()(
  "Indexer",
  Effect.gen(function* () {
    const ponder = yield* Ponder;
    const state = yield* Cloudflare.DurableObjectState;

    // Alchemy builds a Durable Object in two phases: this Effect binds, and the Effect it returns runs once for
    // each instance.
    // @effect-diagnostics-next-line returnEffectInGen:off
    return Effect.gen(function* () {
      const port = yield* ponder.getTcpPort(PONDER_PORT);
      const record = state.storage.get<IndexerRecord>("record").pipe(Effect.map((found) => found ?? empty));
      const running = ponder.running.pipe(Effect.mapError(failed("status")));

      /** One of Ponder's own endpoints; none while its server is not answering yet. */
      const probe = (path: string) =>
        port.fetch(HttpClientRequest.get(`http://container${path}`)).pipe(
          Effect.flatMap((response) => Effect.map(response.text, (body) => ({ status: response.status, body }))),
          Effect.option,
        );

      const begin = (rpcUrl: string) =>
        Effect.gen(function* () {
          if (yield* running) return { started: false as const };
          const atMs = yield* Clock.currentTimeMillis;
          yield* ponder
            .start({ enableInternet: true, env: { RPC_URL: rpcUrl } })
            .pipe(Effect.mapError(failed("start")));
          yield* ponder.setInactivityTimeout(PONDER_INACTIVITY_MS).pipe(Effect.mapError(failed("start")));
          const old = yield* record;
          const start: Start = { at: stamp(atMs), atMs, readyMs: null };
          yield* state.storage.put("record", { ...old, rpcUrl, starts: remembered(old.starts, start) });
          return { started: true as const, at: start.at };
        });

      /** Writes down, once, how long after the last start Ponder was first seen ready. */
      const noteReady = Effect.gen(function* () {
        const old = yield* record;
        const last = Arr.last(old.starts);
        if (Option.isNone(last) || last.value.readyMs !== null) return;
        const seen = { ...last.value, readyMs: (yield* Clock.currentTimeMillis) - last.value.atMs };
        yield* state.storage.put("record", { ...old, starts: Arr.append(Arr.dropRight(old.starts, 1), seen) });
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
            if (!(yield* running)) return { stopped: false as const };
            const began = yield* Clock.currentTimeMillis;
            yield* ponder.destroy().pipe(Effect.mapError(failed("stop")));
            const stop = { at: stamp(began), ms: (yield* Clock.currentTimeMillis) - began };
            const old = yield* record;
            yield* state.storage.put("record", { ...old, stops: remembered(old.stops, stop) });
            return { stopped: true as const, ...stop };
          }),
        /** Whether the container is up, what Ponder says about itself, and its starts and stops. */
        status: () =>
          Effect.gen(function* () {
            const up = yield* running;
            const health = up ? yield* probe("/health") : Option.none();
            const ready = answered(health) ? yield* probe("/ready") : Option.none();
            const indexed = answered(ready) ? yield* probe("/status") : Option.none();
            if (answered(ready)) yield* noteReady;
            const { starts, stops } = yield* record;
            return {
              running: up,
              health: Option.getOrNull(Option.map(health, (probed) => probed.status)),
              ready: Option.getOrNull(Option.map(ready, (probed) => probed.status)),
              indexed: Option.getOrNull(Option.map(indexed, (probed) => probed.body)),
              starts,
              stops,
            };
          }),
      };
    });
  }),
) {}

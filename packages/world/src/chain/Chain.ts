// One world's chain. The Durable Object is the only thing that starts and stops the anvil container, so it can
// always save the chain's state first: a container's disk is gone the moment it stops.
//
//   wake:  nothing saved  -> start anvil from the seed in the image
//          state saved    -> start anvil empty, then anvil_loadState with what was saved
//   stop:  anvil_dumpState -> R2 -> destroy the container
//   idle:  every call pushes a durable callback forward; when it fires, the chain is stopped the same way
//   save:  while calls arrive the state is also saved every SAVE_EVERY, so a container that goes away without
//          being stopped (a crash, the platform replacing it) costs at most that much of the chain
//   fork:  a world made from another is handed that world's state before its first start (adopt)
//
// The chain carries the world's index with it: the index is stopped before the chain is saved and started again
// after the chain wakes. The index's own polling is "quiet": it neither wakes the chain nor keeps it awake, or a
// world with an index would never be idle.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ChainFailed } from "../failures.ts";
import Indexer from "../index/Indexer.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { Anvil, RPC_PORT, restoreEntrypoint } from "./Anvil.ts";
import { ChainState } from "./ChainState.ts";

/** How much of the chain an unsaved stop may cost, at most. */
const SAVE_EVERY = "20 seconds";
/** How long a chain may sit unused before it is saved and stopped, unless the door is told otherwise. */
const IDLE_SECONDS = 600;
/** How many starts and stops the chain remembers. */
const REMEMBERED = 20;
/** At most one storage write for the idle stop in this many milliseconds, however busy the chain is. */
const TOUCH_EVERY_MS = 5000;

/** A stage is one world, so each class has one object, under this name. */
export const WORLD = "world";

/** What the chain remembers about its own starts and stops. */
export interface ChainRecord {
  readonly idleSeconds: number;
  /** True from a start until the stop that saved it. Still true at the next start: the container went unsaved. */
  readonly up: boolean;
  /** Whether the chain's first state came from another world. */
  readonly adopted: boolean;
  readonly starts: ReadonlyArray<{
    readonly at: string;
    readonly from: "seed" | "saved state";
    readonly afterUnsavedStop: boolean;
    readonly ms: number;
  }>;
  readonly stops: ReadonlyArray<{
    readonly at: string;
    readonly why: "asked" | "idle";
    readonly head: string;
    readonly savedBytes: number;
    readonly ms: number;
  }>;
  /** The last save made while the chain kept running. */
  readonly lastSave: { readonly at: string; readonly head: string; readonly ms: number } | null;
}

const fresh: ChainRecord = {
  idleSeconds: IDLE_SECONDS,
  up: false,
  adopted: false,
  starts: [],
  stops: [],
  lastSave: null,
};

/** anvil's answer to one call. A result that is a string is all the chain itself ever asks for. */
const RpcAnswer = Schema.Struct({ result: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Unknown) });

const failed =
  (step: ChainFailed["step"]) =>
  (cause: unknown): ChainFailed =>
    ChainFailed.make({ step, message: describeFailure(cause) });

const stamp = (ms: number): string => DateTime.formatIso(DateTime.makeUnsafe(ms));
const remembered = <A>(list: ReadonlyArray<A>, next: A): ReadonlyArray<A> =>
  Arr.takeRight(Arr.append(list, next), REMEMBERED);

export default class Chain extends Cloudflare.DurableObject<Chain>()(
  "Chain",
  Effect.gen(function* () {
    const anvil = yield* Anvil;
    const state = yield* Cloudflare.DurableObjectState;
    const saved = yield* Cloudflare.R2.ReadWriteBucket(ChainState);
    const indexers = yield* Indexer;

    // Alchemy builds a Durable Object in two phases: this Effect binds, and the Effect it returns runs once for
    // each instance.
    // @effect-diagnostics-next-line returnEffectInGen:off
    return Effect.gen(function* () {
      const key = `anvil/${state.id.toString()}.hex`;
      const port = yield* anvil.getTcpPort(RPC_PORT);
      const lock = yield* Semaphore.make(1);
      const indexer = indexers.getByName(WORLD);
      const pushedAt = yield* Ref.make(0);
      const savePending = yield* Ref.make(false);

      const record = state.storage.get<ChainRecord>("record").pipe(Effect.map((found) => found ?? fresh));
      const remember = (change: (old: ChainRecord) => ChainRecord) =>
        record.pipe(Effect.flatMap((old) => state.storage.put("record", change(old))));
      const running = (step: ChainFailed["step"]) => anvil.running.pipe(Effect.mapError(failed(step)));

      /** Sends one JSON-RPC body to anvil as it is and gives back anvil's answer as it is: the door's traffic. */
      const forward = (body: string) =>
        port
          .fetch(HttpClientRequest.post("http://container/").pipe(HttpClientRequest.bodyText(body, "application/json")))
          .pipe(
            Effect.flatMap((response) => response.text),
            Effect.mapError(failed("rpc")),
          );

      /** Calls one method for the chain's own needs and insists on a string result. */
      const call = (step: ChainFailed["step"], method: string, params: ReadonlyArray<unknown> = []) =>
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
              Predicate.isString(answer.result) || answer.result === true
                ? Effect.succeed(Predicate.isString(answer.result) ? answer.result : "true")
                : Effect.fail(failed(step)(answer.error ?? `${method} gave no result`)),
            ),
          );

      const wake = Effect.gen(function* () {
        if (yield* running("start")) return;
        const began = yield* Clock.currentTimeMillis;
        const { up: afterUnsavedStop, idleSeconds } = yield* record;
        const object = yield* saved.get(key).pipe(Effect.mapError(failed("restore")));
        const restoring = Predicate.isNotNull(object);
        yield* anvil
          .start(restoring ? { entrypoint: restoreEntrypoint, enableInternet: false } : { enableInternet: false })
          .pipe(Effect.mapError(failed("start")));
        // Cloudflare stops a container by itself once its Durable Object has been quiet for a while, and that stop
        // saves nothing. Its limit is put well past ours, so the idle callback below always gets there first.
        yield* anvil.setInactivityTimeout((idleSeconds + 300) * 1000).pipe(Effect.mapError(failed("start")));
        if (Predicate.isNotNull(object)) {
          const dump = yield* object.text().pipe(Effect.mapError(failed("restore")));
          yield* call("restore", "anvil_loadState", [dump]);
        }
        yield* call("start", "eth_chainId");
        const ms = (yield* Clock.currentTimeMillis) - began;
        yield* indexer.resume().pipe(Effect.mapError(failed("start")));
        const from = restoring ? ("saved state" as const) : ("seed" as const);
        const start = { at: stamp(began), from, afterUnsavedStop, ms };
        yield* remember((old) => ({ ...old, up: true, starts: remembered(old.starts, start) }));
      }).pipe(lock.withPermits(1));

      /** Writes the chain's whole state to R2 and says which block it was at. */
      const save = Effect.gen(function* () {
        const head = yield* call("save", "eth_blockNumber");
        const dump = yield* call("save", "anvil_dumpState");
        yield* saved.put(key, dump).pipe(Effect.mapError(failed("save")));
        return { head, dump };
      });

      const halt = (why: "asked" | "idle") =>
        Effect.gen(function* () {
          if (!(yield* running("stop"))) return { stopped: false as const };
          yield* indexer.stop().pipe(Effect.mapError(failed("stop")));
          const began = yield* Clock.currentTimeMillis;
          const { head, dump } = yield* save;
          yield* anvil.destroy().pipe(Effect.mapError(failed("stop")));
          const ms = (yield* Clock.currentTimeMillis) - began;
          const stop = { at: stamp(began), why, head, savedBytes: dump.length, ms };
          yield* remember((old) => ({ ...old, up: false, stops: remembered(old.stops, stop) }));
          return { stopped: true as const, ...stop };
        }).pipe(lock.withPermits(1));

      // A failed stop leaves the callback pending, so it is tried again: a chain is never dropped unsaved.
      const onIdle = yield* Alchemy.makeCallback("idle", () => halt("idle").pipe(Effect.asVoid));

      const onSave = yield* Alchemy.makeCallback("save", () =>
        Effect.gen(function* () {
          yield* Ref.set(savePending, false);
          if (!(yield* running("save"))) return;
          const began = yield* Clock.currentTimeMillis;
          const { head } = yield* save;
          const lastSave = { at: stamp(began), head, ms: (yield* Clock.currentTimeMillis) - began };
          yield* remember((old) => ({ ...old, lastSave }));
        }).pipe(lock.withPermits(1)),
      );

      /** Pushes the idle stop forward, and makes sure a save is coming. */
      const touch = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (now - (yield* Ref.get(pushedAt)) < TOUCH_EVERY_MS) return;
        yield* Ref.set(pushedAt, now);
        const { idleSeconds } = yield* record;
        yield* onIdle.schedule("stop", { after: `${idleSeconds} seconds`, payload: null });
        if (yield* Ref.getAndSet(savePending, true)) return;
        yield* onSave.schedule("save", { after: SAVE_EVERY, payload: null });
      }).pipe(Effect.mapError(failed("rpc")));

      return {
        /** One JSON-RPC body in, anvil's answer out. Starts the chain when it is stopped. */
        rpc: (body: string) => wake.pipe(Effect.andThen(touch), Effect.andThen(forward(body))),
        /** The same for the index, which may neither wake the chain nor keep it awake. */
        quietRpc: (body: string) =>
          running("rpc").pipe(
            Effect.flatMap((up) =>
              up ? forward(body) : Effect.fail(ChainFailed.make({ step: "asleep", message: "the chain is stopped" })),
            ),
          ),
        /** Saves the chain and stops its container now. */
        stop: () => halt("asked"),
        /** The chain's whole state as it is now, for a world that is being made from this one. */
        dump: () =>
          wake.pipe(
            Effect.andThen(touch),
            Effect.andThen(save),
            Effect.map(({ dump }) => dump),
          ),
        /** Takes another world's state as this chain's first state. Refused once the chain has ever started. */
        adopt: (dump: string) =>
          Effect.gen(function* () {
            const old = yield* record;
            if (Arr.isReadonlyArrayNonEmpty(old.starts)) {
              return yield* ChainFailed.make({
                step: "adopt",
                message: "the chain has already started from its own state",
              });
            }
            yield* saved.put(key, dump).pipe(Effect.mapError(failed("adopt")));
            yield* state.storage.put("record", { ...old, adopted: true });
            return { adopted: true as const, bytes: dump.length };
          }).pipe(lock.withPermits(1)),
        /** How long the chain may sit unused before it is saved and stopped. */
        setIdle: (idleSeconds: number) =>
          remember((old) => ({ ...old, idleSeconds })).pipe(
            Effect.andThen(anvil.running),
            Effect.flatMap((up) => (up ? anvil.setInactivityTimeout((idleSeconds + 300) * 1000) : Effect.void)),
            Effect.mapError(failed("rpc")),
          ),
        /** Whether the container is up, and its starts and stops. Never starts the chain. */
        status: () => Effect.all({ running: running("rpc"), record }),
      };
    });
    // The R2 binding is a layer that belongs to this Durable Object's own program, as Alchemy's bindings are written.
    // oxlint-disable-next-line effecttsgo/strict-effect-provide
  }).pipe(Effect.provide(Cloudflare.R2.ReadWriteBucketBinding)),
) {}

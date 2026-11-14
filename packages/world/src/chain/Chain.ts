// One world's chain, on the hub (src/hub): one object per world, by the world's stage. It alone starts and stops
// the world's anvil, so it can always save the chain's state first: a container's disk is gone when it stops.
//   wake:  nothing saved -> anvil from the seed in the image; state saved -> anvil empty, then anvil_loadState;
//          a refused start is tried again within CHAIN_START (src/containers/patience.ts)
//   stop:  anvil_dumpState -> the hub's bucket -> destroy; how far anvil's clock runs from the host's is kept, and a
//          wake sets it again (evm_setTime), since anvil_loadState restarts anvil's clock at the saved head
//   idle and save: every call pushes a durable stop forward, and while calls arrive the state is saved every SAVE_EVERY
//   fork, snap, reset: a world made from another adopts its state; a snapshot saves the state under its name; a reset
//          rewinds the chain to it in place (src/lifecycle/reset.ts)
//   world: it keeps the world's registration, checks each call's token against it (admit) and forgets it all
// The index is stopped before the chain is saved and resumed when it wakes; the bundler is stopped with it. The
// index's polling is "quiet": it neither wakes the chain nor keeps it awake.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import Bundler from "../bundler/Bundler.ts";
import { CHAIN_START, gaveUpMessage, startPatiently } from "../containers/patience.ts";
import { ChainFailed } from "../failures.ts";
import { chainKey, ledgerKey, type Registration, snapshotKey } from "../hub/registration.ts";
import { dropObjects } from "./objects.ts";
import { PLACE } from "../hub/names.ts";
import Indexer from "../index/Indexer.ts";
import { admission } from "./admission.ts";
import { Anvil, RPC_PORT, restoreEntrypoint } from "./Anvil.ts";
import { anvilCalls, failed } from "./calls.ts";
import { ChainState } from "./ChainState.ts";
import { remembered, stamp } from "../containers/record.ts";
import { type ChainRecord, fresh, withGaveUp } from "./record.ts";

/** How much of the chain an unsaved stop may cost, at most. */
const SAVE_EVERY = "20 seconds";
/** At most one storage write for the idle stop in this many milliseconds, however busy the chain is. */
const TOUCH_EVERY_MS = 5000;

export default class Chain extends Cloudflare.DurableObject<Chain>()(
  "Chain",
  Effect.gen(function* () {
    const anvil = yield* Anvil;
    const state = yield* Cloudflare.DurableObjectState;
    const saved = yield* Cloudflare.R2.ReadWriteBucket(ChainState);
    const indexers = yield* Indexer;
    const bundlers = yield* Bundler;

    // Alchemy builds a Durable Object in two phases: this Effect binds, and the Effect it returns runs once for
    // each instance.
    // @effect-diagnostics-next-line returnEffectInGen:off
    return Effect.gen(function* () {
      const port = yield* anvil.getTcpPort(RPC_PORT);
      const { forward, ask, call, clockOffset } = anvilCalls(port);
      const lock = yield* Semaphore.make(1);
      const pushedAt = yield* Ref.make(0);
      const savePending = yield* Ref.make(false);

      const { registered, register, admit } = admission(state.storage);
      const stage = Effect.map(registered, (world) => world.stage);
      const key = Effect.map(stage, chainKey);
      const indexer = Effect.map(stage, (name) => indexers.getByName(name, PLACE));
      const bundler = Effect.map(stage, (name) => bundlers.getByName(name, PLACE));

      const record = state.storage.get<ChainRecord>("record").pipe(Effect.map((found) => found ?? fresh));
      const remember = (change: (old: ChainRecord) => ChainRecord) =>
        record.pipe(Effect.flatMap((old) => state.storage.put("record", change(old))));
      const running = (step: ChainFailed["step"]) => anvil.running.pipe(Effect.mapError(failed(step)));

      // A start Cloudflare refuses is tried again within CHAIN_START (src/containers), and every try is remembered.
      // A chain that never answers fails the call that woke it.
      const wake = Effect.gen(function* () {
        if (yield* running("start")) return;
        const began = yield* Clock.currentTimeMillis;
        const { up: afterUnsavedStop, idleSeconds, clockOffset: offset } = yield* record;
        const object = yield* saved.get(yield* key).pipe(Effect.mapError(failed("restore")));
        const restoring = Predicate.isNotNull(object);
        // Cloudflare stops a container by itself once its Durable Object has been quiet for a while, and that stop
        // saves nothing. Its limit is put well past ours, so the idle callback below always gets there first. It is
        // set with the start: a refused start often shows only at the first call to the container after it.
        const report = yield* startPatiently({
          running: anvil.running,
          start: anvil
            .start(restoring ? { entrypoint: restoreEntrypoint, enableInternet: false } : { enableInternet: false })
            .pipe(Effect.andThen(anvil.setInactivityTimeout((idleSeconds + 300) * 1000))),
          ready: call("start", "eth_chainId"),
          patience: CHAIN_START,
          gaveUp: (tried) => tried,
        }).pipe(
          Effect.catch((tried) =>
            remember((old) => withGaveUp(old, stamp(began), tried)).pipe(
              Effect.ignore,
              Effect.andThen(
                Effect.fail(
                  ChainFailed.make({ step: "start", message: gaveUpMessage("the chain", CHAIN_START, tried) }),
                ),
              ),
            ),
          ),
        );
        if (Predicate.isNotNull(object)) {
          const dump = yield* object.text().pipe(Effect.mapError(failed("restore")));
          yield* call("restore", "anvil_loadState", [dump]);
          // anvil now runs on from the saved head; its own state's clock runs from where it was, as if never stopped.
          // A state adopted from another world has no offset here: the world that adopts it sets its clock itself.
          if (Predicate.isNumber(offset))
            yield* ask("restore", "evm_setTime", [Math.floor((yield* Clock.currentTimeMillis) / 1000) + offset]);
        }
        yield* call("start", "eth_chainId");
        const wakeMs = (yield* Clock.currentTimeMillis) - began;
        // The index is started again by its own Durable Object, which never makes the chain wait on it.
        yield* (yield* indexer).resume().pipe(Effect.mapError(failed("start")));
        const from = restoring ? ("saved state" as const) : ("seed" as const);
        const start = { at: stamp(began), from, afterUnsavedStop, wakeMs, ...report };
        yield* remember((old) => ({ ...old, up: true, starts: remembered(old.starts, start) }));
      }).pipe(lock.withPermits(1));

      /** Writes the chain's whole state to R2, keeps how far anvil's clock runs from the host's, and says which block it was at. */
      const save = Effect.gen(function* () {
        const head = yield* call("save", "eth_blockNumber");
        const offset = yield* clockOffset;
        const dump = yield* call("save", "anvil_dumpState");
        yield* saved.put(yield* key, dump).pipe(Effect.mapError(failed("save")));
        yield* remember((old) => ({ ...old, clockOffset: offset }));
        return { head, dump };
      });

      const halt = (why: "asked" | "idle") =>
        Effect.gen(function* () {
          if (!(yield* running("stop"))) return { stopped: false as const };
          yield* (yield* bundler).stop().pipe(Effect.mapError(failed("stop")));
          yield* (yield* indexer).stop().pipe(Effect.mapError(failed("stop")));
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

      /** Rewinds the chain to the state a snapshot saved: in place when it runs, or as its saved state when it does not. */
      const reset = (snapshot: string) =>
        Effect.gen(function* () {
          const name = yield* stage;
          const began = yield* Clock.currentTimeMillis;
          const object = yield* saved.get(snapshotKey(name, snapshot)).pipe(Effect.mapError(failed("reset")));
          if (Predicate.isNull(object))
            return yield* ChainFailed.make({ step: "reset", message: `no chain state saved as ${snapshot}` });
          const dump = yield* object.text().pipe(Effect.mapError(failed("reset")));
          // alto's nonces and mempool belong to the chain as it was: it starts again on its next call.
          yield* (yield* bundler).stop().pipe(Effect.mapError(failed("reset")));
          const inPlace = yield* running("reset");
          if (inPlace) {
            yield* ask("reset", "anvil_reset", []);
            yield* call("reset", "anvil_loadState", [dump]);
          }
          // The chain's own saved state is the snapshot's now, so a container that goes away comes back to it. Its
          // clock is set by whoever reset it (the world's clock, src/lifecycle/reset.ts), so no offset is kept.
          yield* saved.put(yield* key, dump).pipe(Effect.mapError(failed("reset")));
          const done = { at: stamp(began), snapshot, inPlace, bytes: dump.length, ms: 0 };
          const entry = { ...done, ms: (yield* Clock.currentTimeMillis) - began };
          yield* remember((old) => ({ ...old, clockOffset: undefined, resets: remembered(old.resets ?? [], entry) }));
          return entry;
        }).pipe(lock.withPermits(1));

      return {
        /** One JSON-RPC body in, anvil's answer out. Starts the chain when it is stopped. */
        rpc: (body: string) => wake.pipe(Effect.andThen(touch), Effect.andThen(forward(body))),
        /** Wakes the chain and keeps it awake, as a call would: what the door does before a bundler call. */
        awake: () => wake.pipe(Effect.andThen(touch)),
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
        /** Saves the chain's whole state now under a snapshot's name, kept until the world goes (src/platform). */
        saveAs: (snapshot: string) =>
          wake.pipe(
            Effect.andThen(touch),
            Effect.andThen(save),
            Effect.tap(({ dump }) =>
              Effect.flatMap(stage, (name) => saved.put(snapshotKey(name, snapshot), dump)).pipe(
                Effect.mapError(failed("snapshot")),
              ),
            ),
            Effect.map(({ head, dump }) => ({ head, bytes: dump.length })),
          ),
        /** The chain state a snapshot saved, for a world restored from it. Never starts the chain. */
        snapshot: (snapshot: string) =>
          Effect.flatMap(stage, (name) => saved.get(snapshotKey(name, snapshot))).pipe(
            Effect.mapError(failed("snapshot")),
            Effect.flatMap((object) =>
              Predicate.isNull(object)
                ? Effect.fail(ChainFailed.make({ step: "snapshot", message: `no chain state saved as ${snapshot}` }))
                : object.text().pipe(Effect.mapError(failed("snapshot"))),
            ),
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
            yield* saved.put(yield* key, dump).pipe(Effect.mapError(failed("adopt")));
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
        /** Keeps the world this chain belongs to, and enters it in the hub's ledger; a chain left from an older
         * world of the same name is forgotten first. */
        register: (world: Registration) =>
          Effect.gen(function* () {
            const done = yield* register(world);
            if (!done.again)
              yield* saved
                .put(ledgerKey(world.stage), `owner ${world.owner}\nexpires ${world.expiresAt}\n`)
                .pipe(Effect.mapError(failed("world")));
            return done;
          }),
        /** The world's stage when `secret` is its token's and the world has not expired (./admission.ts). */
        admit,
        /** Rewinds the chain to a snapshot's state (above), and keeps it awake. */
        resetTo: (snapshot: string) => reset(snapshot).pipe(Effect.tap(() => touch)),
        /**
         * Removes everything of the world `name` from the hub: its bundler's and index's containers and state, its
         * chain's container, every object of it in the bucket, and this object's own storage and pending callbacks.
         */
        forget: (name: string) =>
          Effect.gen(function* () {
            yield* onIdle.cancel("stop").pipe(Effect.ignore);
            yield* onSave.cancel("save").pipe(Effect.ignore);
            yield* bundlers
              .getByName(name, PLACE)
              .forget()
              .pipe(Effect.mapError(failed("forget")));
            yield* indexers
              .getByName(name, PLACE)
              .forget()
              .pipe(Effect.mapError(failed("forget")));
            if (yield* running("forget")) yield* anvil.destroy().pipe(Effect.mapError(failed("forget")));
            const objects = yield* dropObjects(saved, name).pipe(Effect.mapError(failed("forget")));
            yield* state.storage.deleteAlarm();
            yield* state.storage.deleteAll();
            return { forgot: name, objects };
          }).pipe(lock.withPermits(1)),
        /** Whether the container is up, and its starts and stops. Never starts the chain. */
        status: () => Effect.all({ running: running("rpc"), record }),
      };
    });
    // The R2 binding is a layer that belongs to this Durable Object's own program, as Alchemy's bindings are written.
    // oxlint-disable-next-line effecttsgo/strict-effect-provide
  }).pipe(Effect.provide(Cloudflare.R2.ReadWriteBucketBinding)),
) {}

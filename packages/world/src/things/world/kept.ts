// What a world's handle is built from, kept for the life of the process: a world.show cost 0.7 to 1.35 s a call, about
// 300 calls a run, because every call asked Neon for the connection string, read the hub's admin token and the
// world's operator token from the shared state, and opened the hub (design-notes/speed.md, change 3).
//
// Each entry is keyed by what it was worked out from, as the world's stage records it now, so a change is a miss:
//   project        the platform stage's Neon project                    (the platform stage)
//   connection     a world's branch's connection string                 (world stage, branch id)
//   hubAdmin       a hub's admin token                                  (hub stage)
//   doorToken      a world's token on its hub                           (world stage, hub, owner, registeredUntil)
//   operatorToken  the operator token bound into a world's Core         (world stage, branch id)
// A world made again under the same name has a new branch, and a renewed one a new `registeredUntil`, so neither
// reads what it had before. A world's entries are also dropped when it is taken down or reset in place
// (`forgetWorld`), and a hub's when it is brought up or down (`forgetHub`).
//
// Two callers that miss at once share one lookup. A lookup that fails keeps nothing: the next caller looks again.
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Str from "effect/String";

/** What each shelf keeps. */
interface Shelves {
  readonly project: string;
  readonly connection: Redacted.Redacted;
  readonly hubAdmin: Redacted.Redacted;
  readonly doorToken: Redacted.Redacted;
  readonly operatorToken: Redacted.Redacted;
}

export type Shelf = keyof Shelves;

/** One shelf: each key's lookup, done or under way; `none` once it failed. */
type Entries<A> = MutableHashMap.MutableHashMap<string, Deferred.Deferred<Option.Option<A>>>;

export type Kept = { readonly [S in Shelf]: Entries<Shelves[S]> };

/** Empty shelves: one process's, or one test's. */
export const makeKept = (): Kept => ({
  project: MutableHashMap.empty(),
  connection: MutableHashMap.empty(),
  hubAdmin: MutableHashMap.empty(),
  doorToken: MutableHashMap.empty(),
  operatorToken: MutableHashMap.empty(),
});

/** The process's shelves, made on first use; a test provides its own. */
export const KeptHandles = Context.Reference<Kept>("@capxul/world/things/world/kept/KeptHandles", {
  defaultValue: makeKept,
});

/** The shelves whose keys begin with a world's stage. */
const WORLD_SHELVES = ["connection", "doorToken", "operatorToken"] as const satisfies ReadonlyArray<Shelf>;

const keyOf = (parts: ReadonlyArray<string>) => Arr.join(parts, "\n");

/**
 * What `lookup` gives under `key` on `shelf`: kept from an earlier call, or looked up now and kept. Its span says
 * which, so a record explains the time of a hit as well as of a miss.
 */
export const kept = Effect.fn("world.handle.kept")(function* <S extends Shelf, E, R>(
  shelf: S,
  key: ReadonlyArray<string>,
  lookup: Effect.Effect<Shelves[S], E, R>,
) {
  const entries: Entries<Shelves[S]> = (yield* KeptHandles)[shelf];
  const id = keyOf(key);
  const mine = yield* Deferred.make<Option.Option<Shelves[S]>>();
  const before = yield* Effect.sync(() => {
    const found = MutableHashMap.get(entries, id);
    if (Option.isNone(found)) MutableHashMap.set(entries, id, mine);
    return found;
  });
  yield* Effect.annotateCurrentSpan({ shelf, kept: Option.isSome(before) ? "hit" : "miss" });
  if (Option.isSome(before)) {
    const value = yield* Deferred.await(before.value);
    // The lookup it waited for failed and kept nothing: this caller looks for itself.
    return Option.isSome(value) ? value.value : yield* lookup;
  }
  return yield* lookup.pipe(
    Effect.onExit((exit) =>
      Exit.isSuccess(exit)
        ? Deferred.succeed(mine, Option.some(exit.value))
        : Effect.andThen(
            Effect.sync(() => {
              const now = MutableHashMap.get(entries, id);
              if (Option.isSome(now) && now.value === mine) MutableHashMap.remove(entries, id);
            }),
            Deferred.succeed(mine, Option.none()),
          ),
    ),
  );
});

/** Keeps a value its caller already holds (a create's or a renewal's), so the next handle does not look it up. */
export const remember = Effect.fn("world.handle.remember")(function* <S extends Shelf>(
  shelf: S,
  key: ReadonlyArray<string>,
  value: Shelves[S],
) {
  const entries: Entries<Shelves[S]> = (yield* KeptHandles)[shelf];
  const done = yield* Deferred.make<Option.Option<Shelves[S]>>();
  yield* Deferred.succeed(done, Option.some(value));
  yield* Effect.sync(() => MutableHashMap.set(entries, keyOf(key), done));
});

const dropWhere = <A>(entries: Entries<A>, drop: (id: string) => boolean) =>
  Effect.sync(() => {
    const ids = Arr.filter(Arr.fromIterable(entries.pipe(MutableHashMap.keys)), drop);
    Arr.forEach(ids, (id) => MutableHashMap.remove(entries, id));
    return ids.length;
  });

/** Drops everything kept of a world: it was taken down, or reset in place. */
export const forgetWorld = Effect.fn("world.handle.forget")(function* (stage: string) {
  const shelves = yield* KeptHandles;
  const mine = Str.startsWith(`${stage}\n`);
  const dropped = yield* Effect.forEach(WORLD_SHELVES, (shelf) => dropWhere(shelves[shelf], mine));
  yield* Effect.annotateCurrentSpan({ world: stage, dropped: Arr.reduce(dropped, 0, (a, b) => a + b) });
});

/** Drops a hub's admin token: the hub was brought up or down, so its token may be another. */
export const forgetHub = Effect.fn("world.handle.forgetHub")(function* (hub: string) {
  const shelves = yield* KeptHandles;
  yield* dropWhere(shelves.hubAdmin, (id) => id === keyOf([hub]));
});

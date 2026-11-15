// Removing everything of one world from the hub's bucket: its chain's saved state, its snapshots' states, then its
// entry in the hub's ledger (src/things/cluster/registration.ts).
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { ledgerKey, worldPrefix } from "../../things/cluster/registration.ts";

/** What removing a world's objects needs of the bucket. */
export interface Objects<E, R> {
  readonly list: (options: {
    readonly prefix: string;
  }) => Effect.Effect<{ readonly objects: ReadonlyArray<{ readonly key: string }>; readonly truncated: boolean }, E, R>;
  readonly delete: (keys: string | Array<string>) => Effect.Effect<void, E, R>;
}

/** Deletes every object under the world's prefix, a page at a time, then its ledger entry; how many there were. */
export const dropObjects = <E, R>(bucket: Objects<E, R>, stage: string): Effect.Effect<number, E, R> =>
  Effect.gen(function* () {
    const page = yield* bucket.list({ prefix: worldPrefix(stage) });
    const keys = Arr.map(page.objects, (object) => object.key);
    if (Arr.isReadonlyArrayNonEmpty(keys)) yield* bucket.delete([...keys]);
    if (page.truncated) return keys.length + (yield* dropObjects(bucket, stage));
    yield* bucket.delete(ledgerKey(stage));
    return keys.length;
  });

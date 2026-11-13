// Restoring a snapshot of the world the client's door serves into a new world. A new world may not outlive its
// source (ExpiryBeyondSource), so its lifetime is what is left of the source's, less two minutes.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { hostNow, millis } from "../support/expect.ts";
import { freshName, type View } from "../support/world.ts";

/** Minutes from now to two minutes before `source` expires, and at least one. */
export const lifetimeWithin = (source: View) =>
  Effect.map(hostNow, (now) => Math.max(1, Math.floor((millis(source.expiresAt) - millis(now)) / 60_000) - 2));

/** world.snapshot.restore of `snapshot` from `source` into a new world of a fresh name. */
export const restoreInto = (source: View, snapshot: string, prefix: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const as = yield* freshName(prefix);
    const lifetimeMinutes = yield* lifetimeWithin(source);
    const made = yield* capxul["world.snapshot.restore"]({ world: source.world, snapshot, as, lifetimeMinutes });
    return { as, made };
  });

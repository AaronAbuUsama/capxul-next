// Restoring a snapshot of the first world into a new world. A new world may not outlive its source
// (ExpiryBeyondSource), so its lifetime is what is left of the source's, less two minutes. A restored world's site
// is made after the restore answers, so a scenario that calls the new world's site waits for it.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { hostNow, millis } from "../support/expect.ts";
import { eventually } from "../support/wait.ts";
import { freshName, NORTHWIND, view, type View } from "../support/world.ts";

/** Minutes from now to two minutes before `source` expires, and at least one. */
export const lifetimeWithin = (source: View) =>
  Effect.map(hostNow, (now) => Math.max(1, Math.floor((millis(source.expiresAt) - millis(now)) / 60_000) - 2));

/** world.snapshot.restore of `snapshot` from `source` into a new world of a fresh name, as `operator`. */
export const restoreInto = (source: View, snapshot: string, prefix: string, operator: "first" | "second" = "first") =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const as = yield* freshName(prefix);
    const lifetimeMinutes = yield* lifetimeWithin(source);
    const made = yield* capxul["world.snapshot.restore"](
      { world: source.world, snapshot, as, lifetimeMinutes },
      { operator },
    );
    return { as, made };
  });

/** world.show of `world` once northwind's site there is ready. */
export const siteReady = (world: string) =>
  eventually(`northwind's site in ${world} to be ready`, view(world), (shown) =>
    Arr.some(shown.companies, (each) => each.handle === NORTHWIND && each.site.state === "ready"),
  );

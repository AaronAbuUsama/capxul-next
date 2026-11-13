// world.snapshot.restore, claim 5: a snapshot that does not exist, or a new world's name that is taken, is refused
// and nothing is made.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { refusal, same, sameInstant } from "../support/expect.ts";
import { freshName, noWorld, thisView, view } from "../support/world.ts";
import { lifetimeWithin } from "./restore.ts";

export const worldSnapshotRestore5 = scenario(
  { operation: "world.snapshot.restore", claim: 5 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* thisView;
    const lifetimeMinutes = yield* lifetimeWithin(world);
    const as = yield* freshName("rs5");
    const missing = yield* refusal(
      "a restore of m9",
      "SnapshotNotFound",
      capxul["world.snapshot.restore"]({ world: world.world, snapshot: "m9", as, lifetimeMinutes }),
    );
    yield* same(
      "SnapshotNotFound",
      { world: missing.world, snapshot: missing.snapshot },
      { world: world.world, snapshot: "m9" },
    );
    yield* noWorld(as);

    const taken = yield* refusal(
      "a restore as the first world's own name",
      "WorldExists",
      capxul["world.snapshot.restore"]({ world: world.world, snapshot: "m3", as: world.world, lifetimeMinutes }),
    );
    yield* same("WorldExists", { world: taken.world, owner: taken.owner }, { world: world.world, owner: world.owner });
    yield* sameInstant("WorldExists's expiry", taken.expiresAt, world.expiresAt);
    yield* same("the first world after the refused restore", yield* view(world.world), world);
  }),
);

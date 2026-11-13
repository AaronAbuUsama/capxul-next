// world.snapshot.restore, claim 4: a world made from a snapshot cannot outlive the world it came from.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { hostNow, millis, refusal, same, sameInstant } from "../support/expect.ts";
import { freshName, LIMITS, noWorld, thisView } from "../support/world.ts";

const MINUTE = 60_000;

export const worldSnapshotRestore4 = scenario(
  { operation: "world.snapshot.restore", claim: 4 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* thisView;
    const as = yield* freshName("rs4");
    const lifetimeMinutes = LIMITS.lifetimeMinutes;
    const before = yield* hostNow;
    const refused = yield* refusal(
      "a restore that outlives its source",
      "ExpiryBeyondSource",
      capxul["world.snapshot.restore"]({ world: world.world, snapshot: "m3", as, lifetimeMinutes }),
    );
    const after = yield* hostNow;
    yield* same("ExpiryBeyondSource's source", refused.source, world.world);
    yield* sameInstant("ExpiryBeyondSource's latest", refused.latest, world.expiresAt);
    const asked = millis(refused.asked);
    yield* expect(
      asked >= millis(before) + (lifetimeMinutes - 1) * MINUTE &&
        asked <= millis(after) + (lifetimeMinutes + 1) * MINUTE,
      `ExpiryBeyondSource asked ${refused.asked}; it must be ${lifetimeMinutes} minutes after the call, within a minute`,
    );
    yield* noWorld(as);
  }),
);

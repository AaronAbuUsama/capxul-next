// world.create, claim 6: an owner with as many live worlds as allowed is refused, and nothing is made.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { freshName, LIMITS, noWorld } from "../support/world.ts";

export const worldCreate6 = scenario(
  { operation: "world.create", claim: 6 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* freshName("wc6");
    const refused = yield* refusal(
      "world.create by an owner at the limit",
      "WorldQuotaReached",
      capxul["world.create"]({
        world,
        grade: "private",
        lifetimeMinutes: 60,
        clock: { mode: "frozen", startAt: null },
      }),
    );
    yield* same("WorldQuotaReached's limit", refused.limit, LIMITS.liveWorldsPerOwner);
    yield* same("WorldQuotaReached's live count", refused.live, LIMITS.liveWorldsPerOwner);
    yield* noWorld(world);
  }),
);

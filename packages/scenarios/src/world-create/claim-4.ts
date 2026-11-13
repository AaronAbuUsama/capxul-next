// world.create, claim 4: every world has an owner and an expiry: the caller owns the world it creates, and it
// expires after the lifetime asked for. Capxul does not say who its caller is, so the owner is checked to be the
// same operator in world.create's and world.show's answers, not by name.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { hostNow, millis, same, sameInstant } from "../support/expect.ts";
import { freshName, view } from "../support/world.ts";

const MINUTE = 60_000;

export const worldCreate4 = scenario(
  { operation: "world.create", claim: 4 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* freshName("wc4");
    const before = yield* hostNow;
    const made = yield* capxul["world.create"]({
      world,
      grade: "private",
      lifetimeMinutes: 60,
      clock: { mode: "frozen", startAt: null },
    });
    const after = yield* hostNow;
    const expiry = millis(made.expiresAt);
    yield* expect(
      expiry >= millis(before) + 59 * MINUTE && expiry <= millis(after) + 61 * MINUTE,
      `the world expires at ${made.expiresAt}; it must be 60 minutes after the call (${before} to ${after}), within a minute`,
    );
    yield* expect(made.owner !== "", "the new world names no owner");
    const shown = yield* view(world);
    yield* same("world.show's owner", shown.owner, made.owner);
    yield* sameInstant("world.show's expiry", shown.expiresAt, made.expiresAt);
  }),
);

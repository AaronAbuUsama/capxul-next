// world.create, claim 4: every world has an owner and an expiry: the caller owns the world it creates, and it
// expires after the lifetime asked for. The operators are named by `nothing`'s facts.
import { startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, given, scenario } from "../scenario.ts";
import { hostNow, millis, same, sameInstant } from "../support/expect.ts";
import { freshName, view } from "../support/world.ts";

const MINUTE = 60_000;

export const worldCreate4 = scenario(
  { operation: "world.create", claim: 4 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { operators } = yield* given(startingWorlds.nothing);
    const create = (world: string, operator: "first" | "second") =>
      capxul["world.create"](
        { world, grade: "private", lifetimeMinutes: 60, clock: { mode: "frozen", startAt: null } },
        { operator },
      );
    const world = yield* freshName("wc4");
    const before = yield* hostNow;
    const made = yield* create(world, "first");
    const after = yield* hostNow;
    yield* same("the new world's owner", made.owner, operators.first);
    const expiry = millis(made.expiresAt);
    yield* expect(
      expiry >= millis(before) + 59 * MINUTE && expiry <= millis(after) + 61 * MINUTE,
      `the world expires at ${made.expiresAt}; it must be 60 minutes after the call (${before} to ${after}), within a minute`,
    );
    const shown = yield* view(world);
    yield* same("world.show's owner", shown.owner, made.owner);
    yield* sameInstant("world.show's expiry", shown.expiresAt, made.expiresAt);

    const second = yield* create(yield* freshName("wc4"), "second");
    yield* same("the owner of the second operator's world", second.owner, operators.second);
  }),
);

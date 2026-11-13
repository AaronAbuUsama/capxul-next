// world.create, claim 2: a fresh world can begin before host time, though not before its seeded chain's last
// block, and an existing world's time cannot be reset. The seeded chain's last block is learnt from the refusal
// that names it, ClockBeforeSeed's `earliest`. The chain's head, read through the door's chain RPC, is not
// checked: Capxul offers no chain read.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { addSeconds, hostNow, millis, refusal, same, sameInstant } from "../support/expect.ts";
import { freshName, noWorld, view } from "../support/world.ts";

const LONG_AGO = "2000-01-01T00:00:00Z";
const DAY = 24 * 3600;

export const worldCreate2 = scenario(
  { operation: "world.create", claim: 2 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* freshName("wc2");
    const ask = (startAt: string) =>
      capxul["world.create"]({ world, grade: "private", lifetimeMinutes: 60, clock: { mode: "frozen", startAt } });

    const early = yield* refusal("world.create starting in 2000", "ClockBeforeSeed", ask(LONG_AGO));
    yield* sameInstant("ClockBeforeSeed's asked", early.asked, LONG_AGO);
    yield* expect(millis(early.earliest) > millis(LONG_AGO), `ClockBeforeSeed's earliest is ${early.earliest}`);
    yield* noWorld(world);

    const start = addSeconds(early.earliest, DAY);
    const now = yield* hostNow;
    yield* expect(
      millis(start) < millis(now),
      `a day after the seeded chain's last block (${start}) is not before host time (${now})`,
    );
    const made = yield* ask(start);
    yield* sameInstant("the new world's clock", made.clock.now, start);
    yield* same("the new world's clock mode", made.clock.mode, "frozen");

    const again = yield* refusal("world.create of the same name again", "WorldExists", ask(start));
    yield* same("WorldExists's world", again.world, world);
    yield* same("WorldExists's owner", again.owner, made.owner);
    yield* sameInstant("WorldExists's expiry", again.expiresAt, made.expiresAt);
    const shown = yield* view(world);
    yield* same("world.show's clock after the second create", shown.clock, made.clock);
  }),
);

// world.clock.warp, claim 2: only the world's owner may move the clock; a person of the world is refused and the
// clock does not move.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { head, thisView, unchangedRecord } from "../support/world.ts";

export const worldClockWarp2 = scenario(
  { operation: "world.clock.warp", claim: 2 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* thisView;
    const before = yield* head;
    const refused = yield* refusal(
      "world.clock.warp as dana",
      "NotWorldOwner",
      capxul["world.clock.warp"]({ target: { _tag: "by", seconds: 3600 } }, { as: "dana" }),
    );
    yield* same(
      "NotWorldOwner",
      { world: refused.world, owner: refused.owner },
      { world: world.world, owner: world.owner },
    );
    yield* same("the clock after the refused warp", (yield* thisView).clock, world.clock);
    yield* unchangedRecord("the refused warp", before);
  }),
);

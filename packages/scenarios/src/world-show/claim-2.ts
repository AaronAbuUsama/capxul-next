// world.show, claim 2: a world made from nothing names no parent, and a name with no world is refused.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { freshName, noWorld, view } from "../support/world.ts";

export const worldShow2 = scenario(
  { operation: "world.show", claim: 2 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* freshName("ws2");
    yield* capxul["world.create"]({
      world,
      grade: "private",
      lifetimeMinutes: 60,
      clock: { mode: "frozen", startAt: null },
    });
    const shown = yield* view(world);
    yield* same("the new world's parent", shown.parent, null);
    yield* noWorld(yield* freshName("none"));
  }),
);

// world.show, claim 2: a world made from nothing names no parent, and a name with no world is refused.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { freshName, noWorld, thisView } from "../support/world.ts";

export const worldShow2 = scenario(
  { operation: "world.show", claim: 2 },
  Effect.gen(function* () {
    const shown = yield* thisView;
    yield* same("the fresh world's parent", shown.parent, null);
    yield* noWorld(yield* freshName("none"));
  }),
);

// world.show, claim 1: a world restored into another names its parent: the first world (the `world` fact), `m3`
// and the record position `m3` holds (the `m3` fact).
import { startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { given, scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { view } from "../support/world.ts";

export const worldShow1 = scenario(
  { operation: "world.show", claim: 1 },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.restored);
    const shown = yield* view(facts.restored.world);
    yield* same("the restored world's parent", shown.parent, {
      world: facts.world.world,
      snapshot: "m3",
      recordSeq: facts.m3.recordSeq,
    });
    yield* same("the restored world's parent, as its restore answered it", shown.parent, facts.restored.parent);
  }),
);

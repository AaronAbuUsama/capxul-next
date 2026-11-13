// world.snapshot.save, claim 3: only the world's owner may save a snapshot, and only of a world that exists.
import { startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { given, scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { freshName, head, unchangedRecord } from "../support/world.ts";

export const worldSnapshotSave3 = scenario(
  { operation: "world.snapshot.save", claim: 3 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const facts = yield* given(startingWorlds.fresh);
    const world = facts.world.world;
    const before = yield* head;
    const notOwner = yield* refusal(
      "a save by the second operator",
      "NotWorldOwner",
      capxul["world.snapshot.save"]({ world, snapshot: "m3", replace: false, template: false }, { operator: "second" }),
    );
    yield* same(
      "NotWorldOwner",
      { world: notOwner.world, owner: notOwner.owner },
      { world, owner: facts.operators.first },
    );
    const missing = yield* freshName("none");
    const refused = yield* refusal(
      "saving a world that does not exist",
      "WorldNotFound",
      capxul["world.snapshot.save"]({ world: missing, snapshot: "m3", replace: false, template: false }),
    );
    yield* same("WorldNotFound's world", refused.world, missing);
    yield* unchangedRecord("the refused saves", before);
  }),
);

// world.snapshot.restore, claim 3: anyone on the platform may restore a template snapshot; only the owner may
// restore any other. Checked: a restore of the template `m3` is owned by the operator who restored it. Not checked,
// and the heart of the claim: the second operator restoring `m3`, and being refused `draft` with NotWorldOwner. A
// call through Capxul acts as the scenario's operator or a person of the world, never as another operator.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { thisView } from "../support/world.ts";
import { restoreInto } from "./restore.ts";

export const worldSnapshotRestore3 = scenario(
  { operation: "world.snapshot.restore", claim: 3 },
  Effect.gen(function* () {
    const world = yield* thisView;
    const { made } = yield* restoreInto(world, "m3", "rs3");
    yield* same("the owner of the world restored from m3", made.owner, world.owner);
  }),
);

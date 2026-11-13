// world.snapshot.save, claim 3: only the world's owner may save a snapshot, and only of a world that exists.
// Checked: the save of a name with no world. Not checked: the save by the second operator, refused with
// NotWorldOwner: a call through Capxul acts as the scenario's operator or a person of the world, never as another
// operator.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { freshName, head, unchangedRecord } from "../support/world.ts";

export const worldSnapshotSave3 = scenario(
  { operation: "world.snapshot.save", claim: 3 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const before = yield* head;
    const missing = yield* freshName("none");
    const refused = yield* refusal(
      "saving a world that does not exist",
      "WorldNotFound",
      capxul["world.snapshot.save"]({ world: missing, snapshot: "m3", replace: false, template: false }),
    );
    yield* same("WorldNotFound's world", refused.world, missing);
    yield* unchangedRecord("the refused save", before);
  }),
);

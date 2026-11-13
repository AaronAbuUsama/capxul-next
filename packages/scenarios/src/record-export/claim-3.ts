// record.export, claim 3: only the world's owner may export the record.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { thisView } from "../support/world.ts";

export const recordExport3 = scenario(
  { operation: "record.export", claim: 3 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* thisView;
    const refused = yield* refusal(
      "record.export as dana",
      "NotWorldOwner",
      capxul["record.export"]({ from: null, to: null }, { as: "dana" }),
    );
    yield* same(
      "NotWorldOwner",
      { world: refused.world, owner: refused.owner },
      { world: world.world, owner: world.owner },
    );
  }),
);

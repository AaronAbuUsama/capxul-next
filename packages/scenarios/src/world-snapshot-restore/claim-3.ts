// world.snapshot.restore, claim 3: anyone on the platform may restore a template snapshot; only the owner may
// restore any other.
import { startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { given, scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { freshName, noWorld, view } from "../support/world.ts";
import { lifetimeWithin, restoreInto } from "./restore.ts";

export const worldSnapshotRestore3 = scenario(
  { operation: "world.snapshot.restore", claim: 3 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const facts = yield* given(startingWorlds.withSnapshot);
    const first = yield* view(facts.world.world);
    const { as, made } = yield* restoreInto(first, "m3", "rs3", "second");
    yield* same("the owner of the world the second operator restored", made.owner, facts.operators.second);
    const exported = yield* capxul["record.export"]({ from: null, to: null }, { at: made.door, operator: "second" });
    yield* same("record.export at its door as the second operator", exported.world, as);

    const draft = yield* freshName("rs3");
    const lifetimeMinutes = yield* lifetimeWithin(first);
    const refused = yield* refusal(
      "the second operator restoring draft",
      "NotWorldOwner",
      capxul["world.snapshot.restore"](
        { world: first.world, snapshot: "draft", as: draft, lifetimeMinutes },
        { operator: "second" },
      ),
    );
    yield* same(
      "NotWorldOwner",
      { world: refused.world, owner: refused.owner },
      { world: first.world, owner: facts.operators.first },
    );
    yield* noWorld(draft);
  }),
);

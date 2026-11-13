// world.create, claim 1: a new world runs with its clock and a record that begins with its birth.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { freshName } from "../support/world.ts";

export const worldCreate1 = scenario(
  { operation: "world.create", claim: 1 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* freshName("wc1");
    const made = yield* capxul["world.create"]({
      world,
      grade: "private",
      lifetimeMinutes: 60,
      clock: { mode: "frozen", startAt: null },
    });
    yield* same("the new world's name", made.world, world);
    yield* same("the new world's state", made.state, "running");
    yield* same("the new world's clock mode", made.clock.mode, "frozen");
    yield* same("the new world's record head", made.recordHead, 1);
    yield* same("the new world's parent", made.parent, null);

    const exported = yield* capxul["record.export"]({ from: null, to: null }, { at: made.door });
    yield* same("the new world's record's head", exported.head, 1);
    yield* same(
      "the new world's record",
      Arr.map(exported.entries, (entry) => ({ seq: entry.seq, event: entry.event, carried: entry.carried })),
      [
        {
          seq: 1,
          event: "world_created",
          carried: { world, owner: made.owner, grade: made.grade, expiresAt: made.expiresAt, parent: null },
        },
      ],
    );
  }),
);

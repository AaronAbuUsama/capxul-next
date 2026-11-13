// world.create, claim 1: a new world runs with its clock and a record that begins with its birth.
// Its record is read back through world.show's record head: the client is made for one world's door, and from the
// starting world `nothing` there is no door yet to call record.export through.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { freshName, view } from "../support/world.ts";

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
    const shown = yield* view(world);
    yield* same("world.show's record head of the new world", shown.recordHead, 1);
    yield* same("world.show's clock of the new world", shown.clock, made.clock);
  }),
);

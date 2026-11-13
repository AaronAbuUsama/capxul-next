// world.create, claim 3: a real world is never made by this operation: asking for one is refused and nothing is made.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { freshName, noWorld } from "../support/world.ts";

export const worldCreate3 = scenario(
  { operation: "world.create", claim: 3 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* freshName("wc3");
    const refused = yield* refusal(
      "world.create of a real world",
      "GradeNotOffered",
      capxul["world.create"]({ world, grade: "real", lifetimeMinutes: 60, clock: { mode: "frozen", startAt: null } }),
    );
    yield* same("GradeNotOffered's grade", refused.grade, "real");
    yield* noWorld(world);
  }),
);

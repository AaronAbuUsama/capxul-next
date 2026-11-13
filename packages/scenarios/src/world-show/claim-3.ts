// world.show, claim 3: it shows a world's owner, grade, expiry, clock, record head, cast and companies, each company
// with its site's state. They are compared with what the call that made the world answered (the `world` fact).
import { startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect, given, scenario } from "../scenario.ts";
import { same, sameInstant } from "../support/expect.ts";
import { company, head, NORTHWIND, view } from "../support/world.ts";

export const worldShow3 = scenario(
  { operation: "world.show", claim: 3 },
  Effect.gen(function* () {
    const { world } = yield* given(startingWorlds.founded);
    const shown = yield* view(world.world);
    yield* same("the owner", shown.owner, world.owner);
    yield* same("the grade", shown.grade, world.grade);
    yield* sameInstant("the expiry", shown.expiresAt, world.expiresAt);
    yield* same("the door", shown.door, world.door);
    yield* same("the chain id", shown.chainId, world.chainId);
    yield* same("the contracts", shown.contracts, world.contracts);
    yield* same("the cast", shown.cast, world.cast);
    yield* same("the clock's mode", shown.clock.mode, "frozen");
    yield* same("the record head", shown.recordHead, yield* head);
    yield* same(
      "the companies",
      Arr.map(shown.companies, (each) => each.handle),
      [NORTHWIND],
    );
    const northwind = yield* company(shown, NORTHWIND);
    yield* same("northwind's site", northwind.site.state, "ready");
    yield* expect(
      northwind.site.url !== null && northwind.site.url !== shown.door,
      `northwind's site is at ${northwind.site.url}, not an address of its own`,
    );
  }),
);

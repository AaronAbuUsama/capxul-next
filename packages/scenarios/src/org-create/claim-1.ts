// org.create, claim 1: the Organization's Safe is Companies House's company Safe for this founder. Checked: the
// answer names a company Safe, and dana's own claimed Safe as its founder's. Not checked: CompanySafeMinted and the
// minter's companySafeAddressFor, which are read through the door's chain RPC, which Capxul does not offer.
import * as Effect from "effect/Effect";
import { expect, scenario } from "../scenario.ts";
import { same, sameAddress } from "../support/expect.ts";
import * as Str from "effect/String";
import { found } from "../support/founding.ts";
import { castMember, thisView } from "../support/world.ts";

export const orgCreate1 = scenario(
  { operation: "org.create", claim: 1 },
  Effect.gen(function* () {
    const world = yield* thisView;
    const dana = yield* castMember(world, "dana");
    const founded = yield* found();
    yield* same("the founder", founded.founder, "dana");
    yield* sameAddress("the founder's Safe", founded.founderSafe, dana.safe);
    yield* expect(
      Str.toLowerCase(founded.safe) !== Str.toLowerCase(founded.founderSafe),
      `the company Safe ${founded.safe} is dana's own Safe`,
    );
  }),
);

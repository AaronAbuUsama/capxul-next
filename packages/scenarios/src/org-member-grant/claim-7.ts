// org.member.grant, claim 7: Manage people is the People hat.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { grantSigned } from "../support/grants.ts";
import { samWears } from "../support/hats.ts";
import { northwind } from "../support/world.ts";

export const orgMemberGrant7 = scenario(
  { operation: "org.member.grant", claim: 7 },
  Effect.gen(function* () {
    const { world, org } = yield* northwind;
    const { sent } = yield* grantSigned(org, "sam", "manage-people");
    yield* samWears(world, sent.transaction, "manage-people");
  }),
);

// org.member.grant, claim 7: Manage people is the People hat. Checked: a grant of manage-people executes and the
// operations then say sam's Safe wears its hat (AlreadyHeld for manage-people), while manage-books is still his to
// be granted. Not checked: that the hat is the deployment's People hat, which only the door's chain RPC shows.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { grant, grantSigned } from "../support/grants.ts";
import { northwind } from "../support/world.ts";

export const orgMemberGrant7 = scenario(
  { operation: "org.member.grant", claim: 7 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    yield* grantSigned(org, "sam", "manage-people");
    const held = yield* refusal(
      "a second grant of manage-people to sam",
      "AlreadyHeld",
      grant(org, "sam", "manage-people"),
    );
    yield* same("AlreadyHeld's permission", held.permission, "manage-people");
    const books = yield* grant(org, "sam", "manage-books");
    yield* same("the grant of manage-books after manage-people", books.change.permission, "manage-books");
  }),
);

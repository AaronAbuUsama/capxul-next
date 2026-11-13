// org.member.grant, claim 2: a caller who is not a Director, a person who is not a current member, and a grant of
// what the member holds are each refused.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { grant } from "../support/grants.ts";
import { head, northwind, unchangedRecord } from "../support/world.ts";

export const orgMemberGrant2 = scenario(
  { operation: "org.member.grant", claim: 2 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const before = yield* head;
    const notDirector = yield* refusal("a grant by sam", "NotADirector", grant(org, "sam", "issue-invoices", "sam"));
    yield* same("NotADirector", { org: notDirector.org, person: notDirector.person }, { org, person: "sam" });
    const notMember = yield* refusal("a grant to olga", "NotAMember", grant(org, "olga", "issue-invoices"));
    yield* same("NotAMember", { org: notMember.org, person: notMember.person }, { org, person: "olga" });
    const held = yield* refusal("manage-books for sam again", "AlreadyHeld", grant(org, "sam", "manage-books"));
    yield* same(
      "AlreadyHeld",
      { org: held.org, person: held.person, permission: held.permission },
      { org, person: "sam", permission: "manage-books" },
    );
    yield* unchangedRecord("the three refused grants", before);
  }),
);

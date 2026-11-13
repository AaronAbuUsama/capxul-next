// org.member.grant, claim 6: a member whose Safe already wears the hat, and a member with no personal Safe, are
// each refused before anything is proposed.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { grant } from "../support/grants.ts";
import { head, northwind, unchangedRecord } from "../support/world.ts";

export const orgMemberGrant6 = scenario(
  { operation: "org.member.grant", claim: 6 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const before = yield* head;
    const held = yield* refusal("manage-books for sam again", "AlreadyHeld", grant(org, "sam", "manage-books"));
    yield* same(
      "AlreadyHeld",
      { org: held.org, person: held.person, permission: held.permission },
      { org, person: "sam", permission: "manage-books" },
    );
    for (const permission of ["manage-books", "issue-invoices", "manage-people"] as const) {
      const noSafe = yield* refusal(`${permission} for pat`, "MemberHasNoSafe", grant(org, "pat", permission));
      yield* same("MemberHasNoSafe", { org: noSafe.org, person: noSafe.person }, { org, person: "pat" });
    }
    yield* unchangedRecord("the refused grants", before);
  }),
);

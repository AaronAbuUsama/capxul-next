// org.member.grant, claim 3: a second change is refused while one waits.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { grant } from "../support/grants.ts";
import { head, northwind, unchangedRecord } from "../support/world.ts";

export const orgMemberGrant3 = scenario(
  { operation: "org.member.grant", claim: 3 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const waiting = yield* grant(org, "sam", "manage-books");
    const before = yield* head;
    const refused = yield* refusal(
      "a grant of issue-invoices to sam",
      "ChangeWaiting",
      grant(org, "sam", "issue-invoices"),
    );
    yield* same(
      "ChangeWaiting",
      { org: refused.org, person: refused.person, change: refused.change },
      { org, person: "sam", change: waiting.change.id },
    );
    yield* unchangedRecord("the refused grant", before);
  }),
);

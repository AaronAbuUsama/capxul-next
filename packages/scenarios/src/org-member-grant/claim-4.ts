// org.member.grant, claim 4: it emits one officer_change_proposed, carrying neither the member nor the note. The
// runner's events check holds every call to this; the scenario also reads it back from the record, where the event
// must carry exactly change, org, permission and proposal.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { findIn, same } from "../support/expect.ts";
import { entriesAfter, head, northwind, objectOf, type Json } from "../support/world.ts";

export const orgMemberGrant4 = scenario(
  { operation: "org.member.grant", claim: 4 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { org } = yield* northwind;
    const before = yield* head;
    const proposed = yield* capxul["org.member.grant"](
      { org, member: "sam", permission: "manage-books", note: "Sam keeps the books" },
      { as: "dana" },
    );
    const entries = yield* entriesAfter(before);
    yield* same(
      "the events the grant added",
      Arr.map(entries, (each) => each.event),
      ["officer_change_proposed", "proposal_opened"],
    );
    const event = yield* findIn("officer_change_proposed", entries, (each) => each.event === "officer_change_proposed");
    const carried = objectOf(event.carried);
    yield* same("the fields officer_change_proposed carries", Arr.sort(Rec.keys<string, Json>(carried), Order.String), [
      "change",
      "org",
      "permission",
      "proposal",
    ]);
    yield* same("what officer_change_proposed carries", carried, {
      change: proposed.change.id,
      org,
      permission: "manage-books",
      proposal: proposed.proposal.id,
    });
  }),
);

// approval.sign, claim 5: a signature short of the threshold is kept, and nothing is sent until the last one
// needed. "Nothing is sent" is read from the record: dana's signature adds approval_signed and no approval_landed.
// That the hat is not worn is read as sam still having no site user. Not checked: the hat through the chain RPC.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { answers, findIn, refusal, same } from "../support/expect.ts";
import { BRIGHTSIDE, create, supplierFields } from "../support/books.ts";
import { grant } from "../support/grants.ts";
import { approve } from "../support/signing.ts";
import { entriesAfter, head, northwind } from "../support/world.ts";

export const approvalSign5 = scenario(
  { operation: "approval.sign", claim: 5 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const proposed = yield* grant(org, "sam", "manage-books");
    const of = (signer: string) => findIn(`${signer}'s approval`, proposed.approvals, (each) => each.signer === signer);
    const before = yield* head;
    const kept = yield* answers("dana's signature", "Collected", approve(yield* of("dana")));
    yield* same("the signatures after dana's", [kept.signatures, kept.threshold], [1, 2]);
    yield* same("the subject", kept.subject, { kind: "officer_change", id: proposed.change.id });
    const added = yield* entriesAfter(before);
    yield* same(
      "the events dana's signature added",
      Arr.map(added, (each) => each.event),
      ["approval_signed"],
    );
    yield* refusal(
      "doc.create as sam before the last signature",
      "NoSiteUser",
      create(org, "Supplier", supplierFields(BRIGHTSIDE), "sam"),
    );
    const sent = yield* answers("eli's signature", "Sent", approve(yield* of("eli")));
    yield* same("the subject sent", sent.subject, kept.subject);
  }),
);

// approval.sign, claim 5: a signature short of the threshold is kept, and nothing is sent until the last one
// needed: dana's signature adds approval_signed and nothing else, and the hat eli's signature minted to sam's Safe
// was not worn by it at the block before.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { answers, findIn, same } from "../support/expect.ts";
import { grant } from "../support/grants.ts";
import { mintedToSam } from "../support/hats.ts";
import { approve } from "../support/signing.ts";
import { entriesAfter, head, northwind } from "../support/world.ts";

export const approvalSign5 = scenario(
  { operation: "approval.sign", claim: 5 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { world, org } = yield* northwind;
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

    const sent = yield* answers("eli's signature", "Sent", approve(yield* of("eli")));
    yield* same("the subject sent", sent.subject, kept.subject);
    const minted = yield* mintedToSam(world, sent.transaction);
    const wears = (block: number | null) =>
      capxul.chain.wears({ hats: world.contracts.hats, hat: minted.hat, wearer: minted.safe, block });
    yield* expect(!(yield* wears(minted.sent.block - 1)), "sam's Safe wore the hat before eli's signature sent it");
    yield* expect(yield* wears(null), "sam's Safe does not wear the hat after eli's signature");
  }),
);

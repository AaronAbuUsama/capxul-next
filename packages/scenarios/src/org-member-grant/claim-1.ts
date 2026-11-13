// org.member.grant, claim 1: a grant is a Director proposal, applied once it executes.
import { Site } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { grantSigned } from "../support/grants.ts";
import { samWears } from "../support/hats.ts";
import { create } from "../support/site.ts";
import { whileRefused } from "../support/wait.ts";
import { northwind } from "../support/world.ts";

export const orgMemberGrant1 = scenario(
  { operation: "org.member.grant", claim: 1 },
  Effect.gen(function* () {
    const { world, org } = yield* northwind;
    const asSam = create(org, Site.DOCTYPES.supplier, Site.supplierFields(Site.BRIGHTSIDE), { as: "sam" });
    yield* refusal("doc.create as sam before the grant", "NoSiteUser", asSam);

    const { proposed, sent } = yield* grantSigned(org, "sam", "manage-books");
    yield* same(
      "the proposed change",
      { member: proposed.change.member, permission: proposed.change.permission, state: proposed.change.state },
      { member: "sam", permission: "manage-books", state: "proposed" },
    );
    yield* same(
      "the approvals' signers",
      Arr.map(proposed.approvals, (each) => each.signer),
      ["dana", "eli"],
    );
    yield* same("the proposal's threshold", proposed.proposal.threshold, 2);
    yield* samWears(world, sent.transaction, "manage-books");

    const made = yield* whileRefused("NoSiteUser", asSam);
    yield* same("the document sam made once his user reached the site", made.docstatus, 0);
  }),
);

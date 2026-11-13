// org.member.grant, claim 1: a grant is a Director proposal, applied once it executes. sam's Safe wearing the Books
// hat is read as the operations show it: a second grant of manage-books is refused with AlreadyHeld, which says his
// Safe wears the hat. Not checked: the hat itself through the door's chain RPC, which Capxul does not offer.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { BRIGHTSIDE, create, supplierFields } from "../support/books.ts";
import { grant, grantSigned } from "../support/grants.ts";
import { whileRefused } from "../support/wait.ts";
import { northwind } from "../support/world.ts";

export const orgMemberGrant1 = scenario(
  { operation: "org.member.grant", claim: 1 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const asSam = create(org, "Supplier", supplierFields(BRIGHTSIDE), "sam");
    yield* refusal("doc.create as sam before the grant", "NoSiteUser", asSam);

    const { proposed } = yield* grantSigned(org, "sam", "manage-books");
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

    const made = yield* whileRefused("NoSiteUser", asSam);
    yield* same("the document sam made once his user reached the site", made.docstatus, 0);
    const held = yield* refusal(
      "a second grant of manage-books to sam",
      "AlreadyHeld",
      grant(org, "sam", "manage-books"),
    );
    yield* same(
      "AlreadyHeld",
      { person: held.person, permission: held.permission },
      { person: "sam", permission: "manage-books" },
    );
  }),
);

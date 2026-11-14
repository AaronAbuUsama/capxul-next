// The checks of every org.member.grant (claims.md, org.member.grant 1 to 7): a grant is a Directors' proposal of the
// permission asked, with one approval per Director at their own signer address, and the record gains one
// officer_change_proposed carrying neither the member nor the note, then its proposal_opened; a caller who is not a
// Director, a person who is not a member, a member with no Safe, a permission held, and a second change while one
// waits are each refused, and nothing is proposed.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import { expect } from "../expectation.ts";
import { same, sameAddress } from "../support/expect.ts";
import { castMember, entriesAfter, objectOf, type Json } from "../support/world.ts";
import { callerOf, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks, type Asked, type Check } from "./format.ts";

type Asking = Asked<"org.member.grant">;

/** A refusal names the company and the member asked. */
const namesOrgAnd = (
  what: string,
  named: { readonly org: string; readonly person: string },
  person: string,
  asked: Asking,
) =>
  check(
    `${what} names the company and ${person === asked.payload.member ? "the member asked" : "the caller"}`,
    same(what, [named.org, named.person], [asked.payload.org, person]),
  );

const refusedFor = (what: string, before: Before, also: ReadonlyArray<Check>) => [
  ...also,
  nothingRecorded(what, before),
];

export const orgMemberGrant = checks<"org.member.grant", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, proposed, before) => [
    check(
      "it proposes the permission asked for the member asked",
      same(
        "the proposed change",
        [proposed.change.member, proposed.change.permission, proposed.change.state],
        [asked.payload.member, asked.payload.permission, "proposed"],
      ),
    ),
    check(
      "it asks each Director once, at their own signer address, and needs at most as many signatures as it asks",
      Effect.gen(function* () {
        const signers = Arr.map(proposed.approvals, (each) => each.signer);
        yield* same("the Directors asked, each once", Arr.dedupe(signers), signers);
        yield* expect(
          Arr.contains(signers, callerOf(asked.options)),
          `the proposing Director ${callerOf(asked.options)} is not asked to sign`,
        );
        for (const approval of proposed.approvals)
          yield* sameAddress(
            `${approval.signer}'s approval's address`,
            approval.signerAddress,
            (yield* castMember(before.world, approval.signer)).signer,
          );
        yield* expect(
          proposed.proposal.threshold >= 1 && proposed.proposal.threshold <= signers.length,
          `the proposal needs ${proposed.proposal.threshold} of ${signers.length} signatures`,
        );
      }),
    ),
    check(
      "the record gains one officer_change_proposed carrying only change, org, permission and proposal, then its proposal_opened",
      Effect.gen(function* () {
        const added = yield* entriesAfter(before.head, before.where);
        yield* same(
          "the events the grant added",
          Arr.map(added, (each) => each.event),
          ["officer_change_proposed", "proposal_opened"],
        );
        const carried = objectOf(added[0]?.carried);
        yield* same(
          "the fields officer_change_proposed carries",
          Arr.sort(Rec.keys<string, Json>(carried), Order.String),
          ["change", "org", "permission", "proposal"],
        );
        yield* same("what officer_change_proposed carries", carried, {
          change: proposed.change.id,
          org: asked.payload.org,
          permission: asked.payload.permission,
          proposal: proposed.proposal.id,
        });
      }),
    ),
  ],
  refusals: {
    NotADirector: (asked, refused, before) =>
      refusedFor("the refused grant", before, [namesOrgAnd("NotADirector", refused, callerOf(asked.options), asked)]),
    NotAMember: (asked, refused, before) =>
      refusedFor("the refused grant", before, [namesOrgAnd("NotAMember", refused, asked.payload.member, asked)]),
    AlreadyHeld: (asked, refused, before) =>
      refusedFor("the refused grant", before, [
        check(
          "AlreadyHeld names the company, the member and the permission asked",
          same(
            "AlreadyHeld",
            [refused.org, refused.person, refused.permission],
            [asked.payload.org, asked.payload.member, asked.payload.permission],
          ),
        ),
      ]),
    ChangeWaiting: (asked, refused, before) =>
      refusedFor("the refused grant", before, [namesOrgAnd("ChangeWaiting", refused, asked.payload.member, asked)]),
    MemberHasNoSafe: (asked, refused, before) =>
      refusedFor("the refused grant", before, [
        namesOrgAnd("MemberHasNoSafe", refused, asked.payload.member, asked),
        check(
          "the member has no claimed personal Safe",
          Effect.flatMap(castMember(before.world, asked.payload.member), (member) =>
            same(`${member.person}'s Safe`, member.safe, null),
          ),
        ),
      ]),
    OrgNotFound: (asked, refused, before) =>
      refusedFor("the refused grant", before, [
        check("OrgNotFound names the company asked", same("its org", refused.org, asked.payload.org)),
      ]),
  },
});

// `capxul invitation accept` (today `invite.accept`): the invitee accepts, and is a member at once.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declareOutcomes, outcome, claim } from "@capxul/blueprint-tools";
import { NotImplemented } from "../../../common/refusals.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { olga } from "../../member/examples.ts";
import { Member } from "../../member/values.ts";
import { InvitationAccepted } from "../events.ts";
import { invitation } from "../examples.ts";
import { InvitationClosed, InvitationNotFound, NotYourInvitation } from "../refusals.ts";
import { Invitation, InvitationId } from "../values.ts";

/** The invitee accepted, and is a member of the company from this call on. */
export class Accepted extends Schema.TaggedClass<Accepted, { readonly brand: unique symbol }>()("Accepted", {
  invitation: Invitation,
  member: Member,
}) {}

/** The invitee had already accepted this invitation: the same answer, and nothing changed. */
export class AlreadyAccepted extends Schema.TaggedClass<AlreadyAccepted, { readonly brand: unique symbol }>()(
  "AlreadyAccepted",
  {
    invitation: Invitation,
    member: Member,
  },
) {}

const acceptRpc = Rpc.make("invite.accept", {
  payload: { invitation: InvitationId },
  success: Schema.Union([Accepted, AlreadyAccepted]),
  error: Schema.Union([InvitationNotFound, NotYourInvitation, InvitationClosed, NotImplemented]),
});

export const inviteAccept = declareOutcomes({
  rpc: acceptRpc,
  outcomes: {
    Accepted: outcome(acceptRpc, "Accepted", [
      {
        event: InvitationAccepted,
        carries: ({ success }) => ({
          invitation: success.invitation.id,
          org: success.invitation.org,
          person: success.member.person,
          role: success.invitation.role,
        }),
      },
    ]),
    AlreadyAccepted: outcome(acceptRpc, "AlreadyAccepted", []),
  },
  budget: {
    excludes: ["waking a parked world"],
    provisional: true,
    ms: 1_500,
    basis: "a read of the invitation and the caller's cast entry in the world's database, then one write",
  },
  examples: [
    {
      payload: { invitation: "inv_olga02" },
      success: Accepted.make({ invitation: invitation("inv_olga02", "accepted"), member: olga }),
    },
    {
      payload: { invitation: "inv_olga02" },
      success: AlreadyAccepted.make({ invitation: invitation("inv_olga02", "accepted"), member: olga }),
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `invite.accept` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: inviteAccept,
  claims: [
    claim(
      "The invitee accepts and is a member at once; nothing is signed and nothing reaches the chain or the company's site.",
      w.founded,
      "invite.accept as olga of dana's second invitation, pending, answers Accepted: the invitation accepted and olga a member. The record gains one invitation_accepted naming olga and nothing else, and the chain's head is unchanged while the world's clock is frozen. org.member.list then lists olga as a member, and org.member.grant as dana of issue-invoices for olga is proposed, not refused with NotAMember.",
      {
        thinLine: true,
      },
    ),
    claim(
      "Accepting again answers the same, and changes nothing.",
      w.founded,
      "invite.accept as olga of the invitation she accepted answers AlreadyAccepted with the same invitation and member, and the record gains no entry.",
    ),
    claim(
      "An invitation that is not the caller's, one no longer pending, and one nobody sent are each refused, and nothing changes.",
      w.founded,
      "invite.accept as sam of olga's invitation is refused with NotYourInvitation naming it and sam; as olga of the invitation she declined, with InvitationClosed in state declined; of an id nobody issued, with InvitationNotFound. record.export shows no new entry, and olga is not a member until she accepts. A cancelled invitation is refused the same way, with InvitationClosed in state cancelled, once org.invite.cancel can cancel one.",
      { refusals: [NotYourInvitation, InvitationClosed, InvitationNotFound] },
    ),
  ],
  dropped: [],
};

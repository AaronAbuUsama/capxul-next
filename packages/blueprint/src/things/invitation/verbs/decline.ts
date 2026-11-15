// `capxul invitation decline` (today `invite.decline`): the invitee declines.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim } from "@capxul/blueprint-tools";
import { NotImplemented } from "../../../common/refusals.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { InvitationDeclined } from "../events.ts";
import { invitation } from "../examples.ts";
import { InvitationClosed, InvitationNotFound, NotYourInvitation } from "../refusals.ts";
import { Invitation, InvitationId } from "../values.ts";

export const inviteDecline = declare({
  rpc: Rpc.make("invite.decline", {
    payload: { invitation: InvitationId },
    success: Invitation,
    error: Schema.Union([InvitationNotFound, NotYourInvitation, InvitationClosed, NotImplemented]),
  }),
  emits: [
    {
      event: InvitationDeclined,
      carries: ({ success }) => ({ invitation: success.id, org: success.org }),
    },
  ],
  budget: {
    excludes: ["waking a parked world"],
    provisional: true,
    ms: 1_500,
    basis: "a read of the invitation and the caller's cast entry in the world's database, then one write",
  },
  examples: [{ payload: { invitation: "inv_olga01" }, success: invitation("inv_olga01", "declined") }],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `invite.decline` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: inviteDecline,
  claims: [
    claim(
      "The invitee declines; the invitation is closed and they do not join.",
      w.founded,
      "invite.decline as olga of dana's invitation answers it declined. The record gains one invitation_declined naming neither olga nor her email, and org.member.list as dana does not list her.",
      { thinLine: true },
    ),
    claim(
      "An invitation that is not the caller's, one no longer pending, and one nobody sent are each refused, and nothing changes.",
      w.founded,
      "invite.decline as sam of olga's invitation is refused with NotYourInvitation; as olga a second time, with InvitationClosed in state declined; of an id nobody issued, with InvitationNotFound. record.export shows no new entry.",
      { refusals: [NotYourInvitation, InvitationClosed, InvitationNotFound] },
    ),
  ],
  dropped: [],
};

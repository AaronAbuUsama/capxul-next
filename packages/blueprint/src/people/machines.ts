// The machines of the domain "people" (src/machine.ts): the invitation's lifecycle, declared once. Its state schema
// (`InvitationState`, values.ts), InvitationClosed's `state` field (refusals.ts), the `step` Core moves an invitation
// with, Core's CHECK constraint and the diagram in claims.md are all derived from it. It names its operations, events
// and refusal by their tags, not by their declarations: those import its state schemas, so naming them here would make
// a cycle, at load and in the types. test/machines.test.ts proves each tag is declared, by the operation named.
import * as Machine from "../machine.ts";

const closed = { refusal: "InvitationClosed" } as const;

/**
 * An invitation is pending from the moment it is made; its invitee ends it by accepting or declining. Accepting one
 * already accepted changes nothing; anything else from a closed invitation is refused. Cancelling (`org.invite.cancel`)
 * comes with that operation, as a new move beside these.
 */
export const Invitation = Machine.make({
  name: "invitation",
  key: "invitation",
  states: ["pending", "accepted", "declined"],
  start: {
    state: "pending",
    by: "org.member.invite",
    event: "member_invited",
  },
  moves: {
    accept: {
      from: ["pending"],
      to: "accepted",
      by: "invite.accept",
      event: "invitation_accepted",
      otherwise: { accepted: "unchanged", declined: closed },
    },
    decline: {
      from: ["pending"],
      to: "declined",
      by: "invite.decline",
      event: "invitation_declined",
      otherwise: { accepted: closed, declined: closed },
    },
  },
});

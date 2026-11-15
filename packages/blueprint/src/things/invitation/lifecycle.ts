// The invitation's lifecycle (the toolkit's lifecycle format, `Machine`), declared once. It holds its operations,
// events and refusal as their declarations, imported: each move is made by its verb, sends its verb's event and refuses
// with its verb's refusal. Its states are the invitation's values (`InvitationState`, and `ClosedState`, which
// InvitationClosed's `state` field is), so none of what it names imports it: the import cycle is gone, at load and in
// the types. The `step` Core moves an invitation with, Core's CHECK constraint and the diagram in
// generated/invitation.md are derived from it, and it compiles only while `ClosedState` is exactly the states its moves
// refuse from.
import { Machine } from "@capxul/blueprint-tools";
import { InvitationAccepted, InvitationDeclined, MemberInvited } from "./events.ts";
import { InvitationClosed } from "./refusals.ts";
import { ClosedState, InvitationState } from "./values.ts";
import { invitationAccept } from "./verbs/accept.ts";
import { invitationDecline } from "./verbs/decline.ts";
import { invitationSend } from "./verbs/send.ts";

const closed = { refusal: InvitationClosed } as const;

/**
 * An invitation is pending from the moment it is made; its invitee ends it by accepting or declining. Accepting one
 * already accepted changes nothing; anything else from a closed invitation is refused. Cancelling (`invitation.cancel`)
 * comes with that operation, as a new move beside these.
 */
export const Invitation = Machine.make({
  name: "invitation",
  key: "invitation",
  states: InvitationState,
  refused: ClosedState,
  start: {
    state: "pending",
    by: invitationSend,
    event: MemberInvited,
  },
  moves: {
    accept: {
      from: ["pending"],
      to: "accepted",
      by: invitationAccept,
      event: InvitationAccepted,
      otherwise: { accepted: "unchanged", declined: closed },
    },
    decline: {
      from: ["pending"],
      to: "declined",
      by: invitationDecline,
      event: InvitationDeclined,
      otherwise: { accepted: closed, declined: closed },
    },
  },
});

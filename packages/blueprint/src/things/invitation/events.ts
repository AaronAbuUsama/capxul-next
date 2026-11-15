// The concept "people": who belongs to a company, and the invitations that bring a person in. The company's founder
// invites a person by email to be a member (for now only the founder: docs/roadmap.md, "Who may invite"); the person
// who signs in with that email lists their invitations and accepts or declines; once they accept they are a member at
// once. A member's Seat is no hat, no Safe owner and no site user (ADR-0040 in infrastructure: "Inviting someone
// creates a Seat, not an on-chain role"), so nothing here waits for a signature or writes to the chain or to a
// company's site. All five are served through a world's door.
//
// What an invitation announces, and what each event carries.
import * as Schema from "effect/Schema";
import { OrgId, PersonId } from "../../common/values.ts";
import { InvitationId, InvitedRole } from "./values.ts";

/** A company invited someone by email. It carries neither the email nor whose it is. */
export class MemberInvited extends Schema.TaggedClass<MemberInvited, { readonly brand: unique symbol }>()(
  "member_invited",
  {
    invitation: InvitationId,
    org: OrgId,
    role: InvitedRole,
    by: PersonId,
  },
) {}

/** An invitee accepted: from now on they are a member of the company. */
export class InvitationAccepted extends Schema.TaggedClass<InvitationAccepted, { readonly brand: unique symbol }>()(
  "invitation_accepted",
  {
    invitation: InvitationId,
    org: OrgId,
    person: PersonId,
    role: InvitedRole,
  },
) {}

/** An invitee declined. It carries neither the email nor who declined. */
export class InvitationDeclined extends Schema.TaggedClass<InvitationDeclined, { readonly brand: unique symbol }>()(
  "invitation_declined",
  {
    invitation: InvitationId,
    org: OrgId,
  },
) {}

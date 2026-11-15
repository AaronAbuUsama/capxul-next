// The values of the domain "people": who belongs to a company and the invitations that bring them in. A Seat, a
// person's belonging to a company, is off the chain and off the site: it is no hat, no Safe owner and no site user
// (packages/blueprint/src/people/order.md says why). Declared here once; the domain's operations and refusals import
// them from here, and its door exports them.
import * as Schema from "effect/Schema";
import { Instant, OrgHandle, OrgId, PersonId } from "../values.ts";
import { Invitation as InvitationMachine } from "./machines.ts";

/** An email address, in lower case, as a person signs up with it (a person of the cast: `<person>@cast.test`). */
export const Email = Schema.String.check(Schema.isPattern(/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/));

/** An invitation, by the id `org.member.invite` answered. */
export const InvitationId = Schema.String.check(Schema.isPattern(/^inv_[a-z0-9]{6,40}$/));

/**
 * What an invitation offers: a member's Seat. A Director is a signer of the company Safe, added by a Directors'
 * proposal, and a permission is a hat granted by `org.member.grant` once the person is a member; neither is offered
 * by an invitation, so accepting one writes nothing to the chain.
 */
export const InvitedRole = Schema.Literal("member");

/** How a person belongs to a company: a Director (a signer of its Safe) or a member (a Seat). */
export const MemberRole = Schema.Literals(["director", "member"]);

/** Where an invitation stands: exactly the states of its machine (machines.ts). */
export const InvitationState = InvitationMachine.State;

/** One invitation, as its company's Directors and its invitee see it. */
export const Invitation = Schema.Struct({
  id: InvitationId,
  org: OrgId,
  handle: OrgHandle,
  /** The address it was sent to. The person of the world who signs in with it is its invitee. */
  email: Email,
  role: InvitedRole,
  /** The person who invited: for now always the company's founder (docs/roadmap.md, "Who may invite"). */
  invitedBy: PersonId,
  state: InvitationState,
  /** World time. */
  invitedAt: Instant,
});

/** One person of a company: a Director or a member, with the email they sign in with. */
export const Member = Schema.Struct({
  person: PersonId,
  email: Schema.String,
  role: MemberRole,
});

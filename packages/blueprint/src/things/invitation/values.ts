// An invitation's values: what one is and where it stands. A Seat, a person's belonging to a company, is off the
// chain and off the site (docs/build-order.md says why).
import * as Schema from "effect/Schema";
import { Instant, OrgHandle, OrgId, PersonId } from "../../common/values.ts";

/** An email address, in lower case, as a person signs up with it (a person of the cast: `<person>@cast.test`). */
export const Email = Schema.String.check(Schema.isPattern(/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/));

/** An invitation, by the id `invitation.send` answered. */
export const InvitationId = Schema.String.check(Schema.isPattern(/^inv_[a-z0-9]{6,40}$/));

/**
 * What an invitation offers: a member's Seat. A Director is a signer of the company Safe, added by a Directors'
 * proposal, and a permission is a hat granted by `org.member.grant` once the person is a member; neither is offered
 * by an invitation, so accepting one writes nothing to the chain.
 */
export const InvitedRole = Schema.Literal("member");

/**
 * The rule or the state that decided a refusal of an invitation's verb, as its `refused` log names it: no such company,
 * not the founder, a member already, invited already, no such invitation, not the invitee, or closed.
 */
export const RefusalRule = Schema.Literals([
  "no-such-company",
  "not-the-founder",
  "already-a-member",
  "already-invited",
  "no-such-invitation",
  "not-the-invitee",
  "closed",
]);

/** Where an invitation stands: its machine's states (lifecycle.ts), in order, from which it derives its SQL CHECK. */
export const InvitationState = Schema.Literals(["pending", "accepted", "declined"]);

/**
 * Where an invitation stands when an answer to it is refused: the closed states, as InvitationClosed names them. Its
 * machine (lifecycle.ts) compiles only while these are exactly the states its moves refuse from.
 */
export const ClosedState = Schema.Literals(["accepted", "declined"]);

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

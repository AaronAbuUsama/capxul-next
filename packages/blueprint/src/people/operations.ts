// The concept "people": who belongs to a company, and the invitations that bring a person in. The company's founder
// invites a person by email to be a member (for now only the founder: docs/roadmap.md, "Who may invite"); the person
// who signs in with that email lists their invitations and accepts or declines; once they accept they are a member at
// once. A member's Seat is no hat, no Safe owner and no site user (ADR-0040 in infrastructure: "Inviting someone
// creates a Seat, not an on-chain role"), so nothing here waits for a signature or writes to the chain or to a
// company's site. All five are served through a world's door.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import {
  AlreadyAMember,
  AlreadyInvited,
  CannotManagePeople,
  InvitationClosed,
  InvitationNotFound,
  NotAMember,
  NotImplemented,
  NotYourInvitation,
  OrgNotFound,
} from "../errors.ts";
import { declare, declareOutcomes, outcome } from "../operation.ts";
import { OrgId, PersonId } from "../values.ts";
import { Email, Invitation, InvitationId, InvitedRole, Member } from "./values.ts";

export { Email, Invitation, InvitationId, InvitationState, InvitedRole, Member, MemberRole } from "./values.ts";

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

const PEOPLE_BUDGET = {
  excludes: ["waking a parked world"],
  provisional: true,
} as const;

const invitation = (id: string, state: typeof Invitation.Type.state, invitedBy = "dana") => ({
  id,
  org: "org_northwind1",
  handle: "northwind",
  email: "olga@cast.test",
  role: "member" as const,
  invitedBy,
  state,
  invitedAt: "2026-11-13T09:05:00.000Z",
});

const olga = { person: "olga", email: "olga@cast.test", role: "member" as const };

export const memberInvite = declare({
  rpc: Rpc.make("org.member.invite", {
    payload: { org: OrgId, email: Email, role: InvitedRole },
    success: Invitation,
    error: Schema.Union([OrgNotFound, CannotManagePeople, AlreadyAMember, AlreadyInvited, NotImplemented]),
  }),
  emits: [
    {
      event: MemberInvited,
      carries: ({ payload, success }) => ({
        invitation: success.id,
        org: payload.org,
        role: payload.role,
        by: success.invitedBy,
      }),
    },
  ],
  budget: {
    ...PEOPLE_BUDGET,
    ms: 1_500,
    basis: "reads of the company's board and members and of the world's cast in its database, then one write",
  },
  examples: [
    {
      payload: { org: "org_northwind1", email: "olga@cast.test", role: "member" },
      success: invitation("inv_olga01", "pending"),
    },
  ],
});

export const inviteList = declare({
  rpc: Rpc.make("invite.list", {
    payload: {},
    success: Schema.Struct({
      /** Every invitation sent to the caller's email, whatever its state, oldest first. The world's owner has none. */
      invitations: Schema.Array(Invitation),
    }),
    error: NotImplemented,
  }),
  emits: [],
  budget: { ...PEOPLE_BUDGET, ms: 1_000, basis: "one read of the world's database" },
  examples: [{ payload: {}, success: { invitations: [invitation("inv_olga01", "pending")] } }],
});

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
    ...PEOPLE_BUDGET,
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
    ...PEOPLE_BUDGET,
    ms: 1_500,
    basis: "a read of the invitation and the caller's cast entry in the world's database, then one write",
  },
  examples: [{ payload: { invitation: "inv_olga01" }, success: invitation("inv_olga01", "declined") }],
});

export const memberList = declare({
  rpc: Rpc.make("org.member.list", {
    payload: { org: OrgId },
    success: Schema.Struct({
      org: OrgId,
      /**
       * Its Directors in the board's order, then its members in the order they joined. Its Directors and members see
       * it, and so does the world's owner, who sees the whole world; anyone else is refused with `NotAMember`.
       */
      members: Schema.Array(Member),
    }),
    error: Schema.Union([OrgNotFound, NotAMember, NotImplemented]),
  }),
  emits: [],
  budget: { ...PEOPLE_BUDGET, ms: 1_000, basis: "one read of the world's database" },
  examples: [
    {
      payload: { org: "org_northwind1" },
      success: {
        org: "org_northwind1",
        members: [
          { person: "dana", email: "dana@cast.test", role: "director" },
          { person: "eli", email: "eli@cast.test", role: "director" },
          { person: "sam", email: "sam@cast.test", role: "member" },
          { person: "pat", email: "pat@cast.test", role: "member" },
          olga,
        ],
      },
    },
  ],
});

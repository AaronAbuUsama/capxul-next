// The ways the invitation's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import { OrgId, PersonId } from "../../common/values.ts";
import { ClosedState, Email, InvitationId } from "./values.ts";

/**
 * The caller may not manage the company's people: for now only its founder invites (a person of the world or not), so
 * another Director, a member and anyone else is refused. A role that grants it comes later (docs/roadmap.md, "Who may
 * invite").
 */
export class CannotManagePeople extends refusal<CannotManagePeople, { readonly brand: unique symbol }>()(
  "CannotManagePeople",
  {
    org: OrgId,
    person: PersonId,
  },
  4,
) {}

/** The email is that of a person who already belongs to the company, as a Director or a member. */
export class AlreadyAMember extends refusal<AlreadyAMember, { readonly brand: unique symbol }>()(
  "AlreadyAMember",
  {
    org: OrgId,
    person: PersonId,
  },
  2,
) {}

/** The company's invitation to this email is still pending: it is answered or cancelled before another is sent. */
export class AlreadyInvited extends refusal<AlreadyInvited, { readonly brand: unique symbol }>()(
  "AlreadyInvited",
  {
    org: OrgId,
    email: Email,
    invitation: InvitationId,
  },
  2,
) {}

/** No invitation has this id in the world. */
export class InvitationNotFound extends refusal<InvitationNotFound, { readonly brand: unique symbol }>()(
  "InvitationNotFound",
  {
    invitation: InvitationId,
  },
  2,
) {}

/** The invitation was sent to another email than the caller's: only its invitee answers it. */
export class NotYourInvitation extends refusal<NotYourInvitation, { readonly brand: unique symbol }>()(
  "NotYourInvitation",
  {
    invitation: InvitationId,
    person: PersonId,
  },
  4,
) {}

/**
 * The invitation is closed: its lifecycle (lifecycle.ts) refuses the answer from the state it is in, which `state` names.
 */
export class InvitationClosed extends refusal<InvitationClosed, { readonly brand: unique symbol }>()(
  "InvitationClosed",
  {
    invitation: InvitationId,
    state: ClosedState,
  },
  2,
) {}

export const refusals = {
  CannotManagePeople,
  AlreadyAMember,
  AlreadyInvited,
  InvitationNotFound,
  NotYourInvitation,
  InvitationClosed,
} as const;

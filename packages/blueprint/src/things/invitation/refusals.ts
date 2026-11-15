// The ways the invitation's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../../generated/refusals.ts";
import { OrgId, PersonId } from "../../common/values.ts";
import { Invitation } from "./lifecycle.ts";
import { Email, InvitationId } from "./values.ts";

/**
 * The caller may not manage the company's people: for now only its founder invites (a person of the world or not), so
 * another Director, a member and anyone else is refused. A role that grants it comes later (docs/roadmap.md, "Who may
 * invite").
 */
export class CannotManagePeople extends Schema.TaggedError<CannotManagePeople, { readonly brand: unique symbol }>()(
  "CannotManagePeople",
  {
    org: OrgId,
    person: PersonId,
  },
) {}

/** The email is that of a person who already belongs to the company, as a Director or a member. */
export class AlreadyAMember extends Schema.TaggedError<AlreadyAMember, { readonly brand: unique symbol }>()(
  "AlreadyAMember",
  {
    org: OrgId,
    person: PersonId,
  },
) {}

/** The company's invitation to this email is still pending: it is answered or cancelled before another is sent. */
export class AlreadyInvited extends Schema.TaggedError<AlreadyInvited, { readonly brand: unique symbol }>()(
  "AlreadyInvited",
  {
    org: OrgId,
    email: Email,
    invitation: InvitationId,
  },
) {}

/** No invitation has this id in the world. */
export class InvitationNotFound extends Schema.TaggedError<InvitationNotFound, { readonly brand: unique symbol }>()(
  "InvitationNotFound",
  {
    invitation: InvitationId,
  },
) {}

/** The invitation was sent to another email than the caller's: only its invitee answers it. */
export class NotYourInvitation extends Schema.TaggedError<NotYourInvitation, { readonly brand: unique symbol }>()(
  "NotYourInvitation",
  {
    invitation: InvitationId,
    person: PersonId,
  },
) {}

/**
 * The invitation is closed: its lifecycle (lifecycle.ts) refuses the answer from the state it is in, which `state` names.
 */
export class InvitationClosed extends Schema.TaggedError<InvitationClosed, { readonly brand: unique symbol }>()(
  "InvitationClosed",
  {
    invitation: InvitationId,
    state: Invitation.RefusedState,
  },
) {}

export const refusals = {
  CannotManagePeople,
  AlreadyAMember,
  AlreadyInvited,
  InvitationNotFound,
  NotYourInvitation,
  InvitationClosed,
} as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  CannotManagePeople: 4,
  AlreadyAMember: 2,
  AlreadyInvited: 2,
  InvitationNotFound: 2,
  NotYourInvitation: 4,
  InvitationClosed: 2,
};

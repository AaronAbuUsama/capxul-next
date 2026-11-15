// The refusals of the domain "people": who may invite, whom, and who may answer an invitation. Each is declared once,
// here; ../errors.ts gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../errors.ts";
import { OrgId, PersonId } from "../values.ts";
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

/** The invitation is no longer pending: it was accepted, declined or cancelled, and can no longer be answered. */
export class InvitationClosed extends Schema.TaggedError<InvitationClosed, { readonly brand: unique symbol }>()(
  "InvitationClosed",
  {
    invitation: InvitationId,
    state: Schema.Literals(["accepted", "declined", "cancelled"]),
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

// `capxul invitation accept`: the invitee accepts, and is a member at once.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { log, outcome, promise, promisesOf, span, verb } from "@capxul/blueprint-tools";
import { NotImplemented } from "../../../common/refusals.ts";
import { roles } from "../../../common/values.ts";
import { startingPoints as w, type PromisesOf } from "../../../starting-points/points.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { Member } from "../../member/values.ts";
import { InvitationAccepted } from "../events.ts";
import { InvitationClosed, InvitationNotFound, NotYourInvitation } from "../refusals.ts";
import { Invitation, InvitationId, RefusalRule } from "../values.ts";

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

const acceptRpc = Rpc.make("invitation.accept", {
  payload: { invitation: InvitationId },
  success: Schema.Union([Accepted, AlreadyAccepted]),
  error: Schema.Union([InvitationNotFound, NotYourInvitation, InvitationClosed, NotImplemented]),
});

/** Its logs. */
const logs = {
  /** Written where it refuses, naming the rule or the state that refused. */
  refused: log("invitation.accept.refused", { invitation: InvitationId, rule: RefusalRule }),
};

export const invitationAccept = verb({
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
  allowed: [roles.invitee],
  refusesOthers: NotYourInvitation,
  spans: {
    /** The invitation, held for the transaction, once it is known to be the caller's own. */
    load: span("invitation.accept.load", StepKind.database),
    /** Its move, the new member and its event, written in the same transaction. */
    write: span("invitation.accept.write", StepKind.database),
  },
  logs,
  refusals: {
    InvitationNotFound: logs.refused,
    NotYourInvitation: logs.refused,
    InvitationClosed: logs.refused,
  },
  budget: {
    excludes: ["waking a parked world"],
    provisional: true,
    ms: 1_500,
    basis: "a read of the invitation and the caller's cast entry in the world's database, then one write",
  },
  examples: [
    {
      payload: { invitation: "inv_olga02" },
      success: Accepted.make({
        invitation: {
          id: "inv_olga02",
          org: "org_northwind1",
          handle: "northwind",
          email: "olga@cast.test",
          role: "member" as const,
          invitedBy: "dana",
          state: "accepted" as const,
          invitedAt: "2026-11-13T09:05:00.000Z",
        },
        member: { person: "olga", email: "olga@cast.test", role: "member" as const },
      }),
    },
    {
      payload: { invitation: "inv_olga02" },
      success: AlreadyAccepted.make({
        invitation: {
          id: "inv_olga02",
          org: "org_northwind1",
          handle: "northwind",
          email: "olga@cast.test",
          role: "member" as const,
          invitedBy: "dana",
          state: "accepted" as const,
          invitedAt: "2026-11-13T09:05:00.000Z",
        },
        member: { person: "olga", email: "olga@cast.test", role: "member" as const },
      }),
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `invitation.accept` promises, each promise checked by the journeys. */
export const promises: PromisesOf = promisesOf(invitationAccept, [
  promise(
    "The invitee accepts and is a member at once; nothing is signed and nothing reaches the chain or the company's site.",
    w.founded,
    "invitation.accept as olga of dana's second invitation, pending, answers Accepted: the invitation accepted and olga a member. The world's history gains one invitation_accepted naming olga and nothing else, and the chain's head is unchanged while the world's clock is frozen. member.list then lists olga as a member, and org.member.grant as dana of issue-invoices for olga is proposed, not refused with NotAMember.",
    { thinLine: true },
  ),
  promise(
    "Accepting again answers the same, and changes nothing.",
    w.founded,
    "invitation.accept as olga of the invitation she accepted answers AlreadyAccepted with the same invitation and member, and the world's history gains no entry.",
  ),
  promise(
    "An invitation that is not the caller's, one no longer pending, and one nobody sent are each refused, and nothing changes.",
    w.founded,
    "invitation.accept as sam of olga's invitation is refused with NotYourInvitation naming it and sam; as olga of the invitation she declined, with InvitationClosed in state declined; of an id nobody issued, with InvitationNotFound. The world's history shows no new entry, and olga is not a member until she accepts. A cancelled invitation is refused the same way, with InvitationClosed in state cancelled, once invitation.cancel can cancel one.",
    { refusals: [NotYourInvitation, InvitationClosed, InvitationNotFound] },
  ),
]);

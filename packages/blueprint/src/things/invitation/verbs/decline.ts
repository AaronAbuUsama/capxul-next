// `capxul invitation decline`: the invitee declines.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { log, promise, promisesOf, span, verb } from "@capxul/blueprint-tools";
import { NotImplemented } from "../../../common/refusals.ts";
import { roles } from "../../../common/values.ts";
import { startingPoints as w, type PromisesOf } from "../../../starting-points/points.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";
import { InvitationDeclined } from "../events.ts";
import { InvitationClosed, InvitationNotFound, NotYourInvitation } from "../refusals.ts";
import { Invitation, InvitationId, RefusalRule } from "../values.ts";

/** Its logs. */
const logs = {
  /** Written where it refuses, naming the rule or the state that refused. */
  refused: log("invitation.decline.refused", { invitation: InvitationId, rule: RefusalRule }),
};

export const invitationDecline = verb({
  rpc: Rpc.make("invitation.decline", {
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
  allowed: [roles.invitee],
  refusesOthers: NotYourInvitation,
  spans: {
    /** The invitation, held for the transaction, once it is known to be the caller's own. */
    load: span("invitation.decline.load", StepKind.database),
    /** Its move and its event, written in the same transaction. */
    write: span("invitation.decline.write", StepKind.database),
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
      payload: { invitation: "inv_olga01" },
      success: {
        id: "inv_olga01",
        org: "org_northwind1",
        handle: "northwind",
        email: "olga@cast.test",
        role: "member" as const,
        invitedBy: "dana",
        state: "declined" as const,
        invitedAt: "2026-11-13T09:05:00.000Z",
      },
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `invitation.decline` promises, each promise checked by the journeys. */
export const promises: PromisesOf = promisesOf(invitationDecline, [
  promise(
    "The invitee declines; the invitation is closed and they do not join.",
    w.founded,
    "invitation.decline as olga of dana's invitation answers it declined. The world's history gains one invitation_declined naming neither olga nor her email, and member.list as dana does not list her.",
    { thinLine: true },
  ),
  promise(
    "An invitation that is not the caller's, one no longer pending, and one nobody sent are each refused, and nothing changes.",
    w.founded,
    "invitation.decline as sam of olga's invitation is refused with NotYourInvitation; as olga a second time, with InvitationClosed in state declined; of an id nobody issued, with InvitationNotFound. The world's history shows no new entry.",
    { refusals: [NotYourInvitation, InvitationClosed, InvitationNotFound] },
  ),
]);

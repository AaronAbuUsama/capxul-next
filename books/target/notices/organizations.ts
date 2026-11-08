// The organizations area: the invitation email. Organizations records the offer and when it last
// asked for a send (the resend cooldown); notices sends the email from `org_invite_transitioned` and
// keeps its delivery record (organizations.invitation-delivery). Three transitions send it: a
// Seat-only offer born open (`send`), an offer with grants once the Board's batch executed (`open`),
// and a resend (`resend`). An offer to an `@handle` (an agent) has no mailbox and sends nothing. A
// provider's refusal is this concept's record and never changes the offer.

import { table_principals } from "../access/data.ts";
import { machine_org_invite, table_org_invitations, table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { noticeWorkflow } from "./kit.ts";

const OLD = "packages/backend/src/organizations/invitations";

const i = machine_org_invite.t;

const READS = [table_org_invitations, table_organizations, table_parties, table_principals];

const STEPS = [
  {
    name: "offer",
    about: "Reads the invitation: its grantee's mailbox (none for an `@handle`: no notice), its offers and its expiry.",
  },
  {
    name: "facts",
    about:
      "The Organization's name and handle, who invited (the inviter Party's name), what is offered (a Seat, officer hats, " +
      "allowances), when it expires, and the `capxul invite accept` line with the invitation id.",
  },
] as const;

const SAME =
  "Sends `organization-invitation` to the grantee's mailbox; an agent's offer sends nothing. A provider refusal is " +
  "recorded here, retried by the notice's own process, and never changes the offer's phase, digest or expiry.";

export const workflow_notices_organizations_invitation_sent = noticeWorkflow({
  id: "notices.organizations.invitation-sent",
  title: "Email a Seat-only invitation when it is offered",
  about: `Follows \`send\`: a Seat-only offer is born open, expiring in seven days. ${SAME}`,
  trigger: { transition: i.send },
  reads: READS,
  steps: STEPS,
  was: [`${OLD}/external.ts:64`, `${OLD}/operations/invite.ts:1`, "books/as-is/organizations/data.ts:1346"],
});

export const workflow_notices_organizations_invitation_opened = noticeWorkflow({
  id: "notices.organizations.invitation-opened",
  title: "Email an invitation with grants once the Board's batch executed",
  about:
    "Follows `open`: an offer with grants opens when the company Safe ran the transaction that minted them, so the " +
    `invitee is emailed only once there is something to accept. ${SAME}`,
  trigger: { transition: i.open },
  reads: READS,
  steps: STEPS,
  was: [`${OLD}/external.ts:64`, `${OLD}/external.ts:145`],
});

export const workflow_notices_organizations_invitation_resent = noticeWorkflow({
  id: "notices.organizations.invitation-resent",
  title: "Email a pending invitation again on a resend",
  about:
    "Follows `resend`, at most once a minute per offer (organizations' cooldown). Each resend is its own transition, " +
    `so each sends exactly one message to the invitee, and a redelivered one sends none. ${SAME}`,
  trigger: { transition: i.resend },
  reads: READS,
  steps: STEPS,
  was: [`${OLD}/operations/resend.ts:14`, `${OLD}/external.ts:159`],
});

// The organizations area: the invitation email. Organizations records the offer and when it last
// asked for a send (the resend cooldown); notices sends the email from `org_invite_transitioned` and
// keeps its delivery record (organizations.invitation-delivery). Three transitions send it: a
// Seat-only offer born open (`send`), an offer with grants once the Board's batch executed (`open`),
// and a resend (`resend`). An offer to an `@handle` (an agent) has no mailbox and sends nothing. A
// provider's refusal is this concept's record and never changes the offer. Two more follow an
// Organization's start-up and its head: its Forward Deployed Engineer is ready when the setup that made
// it completes, and the Directors hear when a connected head stops answering (notices.head-and-fde).

import { table_principals } from "../access/data.ts";
import {
  machine_org_head,
  machine_org_invite,
  machine_org_setup,
  table_org_heads,
  table_org_invitations,
  table_org_setups,
  table_organizations,
} from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { contract_safe } from "../shared/external.ts";
import { DIRECTORS, noticeWorkflow } from "./kit.ts";

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
  was: [`${OLD}/external.ts:64`, `${OLD}/operations/invite.ts:1`, "docs/as-is/archive/organizations/data.ts:1346"],
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

// ── start-up and the head (aaron.fde-agent, aaron.frappe-head) ──────────────────────────────

export const workflow_notices_organizations_fde_ready = noticeWorkflow({
  id: "notices.organizations.fde-ready",
  title: "Tell a founder their Organization's FDE is ready",
  about:
    "Follows `complete` of an Organization's setup: the install landed, the founder and the Forward Deployed Engineer " +
    "are seated and the FDE's Party is active (organizations.fde-seat). Sends `fde-ready` once to the founder: the " +
    "Organization, the FDE's handle, that it acts only through the CLI and SDK as a member with no hat until the Board " +
    "grants one (agents.fde-authority), where its key is kept on the founder's machine, and how to start a sitting with " +
    "it. A setup that began with `--no-fde` holds no FDE and sends nothing. The founder's own Seat needs no email: they " +
    "followed the setup to its end.",
  trigger: { transition: machine_org_setup.t.complete },
  reads: [table_org_setups, table_organizations, table_parties, table_principals],
  steps: [
    { name: "setup", about: "Reads the completed setup: no `fde_party_id` ends here; else the founder's principal and the FDE's Party." },
    { name: "facts", about: "The Organization's name and handle, the FDE's handle, where its key is kept (`fde_key_store`) and the first command to run." },
  ],
  was: ["books/target/shared/rulings.ts (aaron.fde-agent)", "docs/design/frappe/projects-and-startup.md (section 3)"],
});

export const workflow_notices_organizations_head_stalled = noticeWorkflow({
  id: "notices.organizations.head-stalled",
  title: "Tell the Directors their Frappe head stopped answering",
  about:
    "Follows `stall` of a head connection: the site could not be read past its retries, refused the key, lost the " +
    "Capxul app, or moved to another time zone or currency, so every app's sync waits and nothing is lost " +
    "(organizations.head-connection). Sends `head-stalled` once per stall to the Directors and to the Director who " +
    "connected it: the site, the reason (`issue.reason`), since when, and what fixes it (restore the site, a new key, " +
    "reinstall the Capxul app, or set the zone back); the connection recovers by itself when the site answers again. " +
    `A recovery sends nothing. ${DIRECTORS}`,
  trigger: { transition: machine_org_head.t.stall },
  reads: [table_org_heads, table_organizations, table_parties, table_principals],
  steps: [
    { name: "head", about: "Reads the failing connection: its site, its `issue` and who connected it." },
    { name: "facts", about: "The Organization's name, the site's URL, the reason in words and the step that fixes it." },
  ],
  chain: [contract_safe.f.getOwners],
  was: ["books/target/shared/rulings.ts (aaron.frappe-head)", "docs/design/frappe/projects-and-startup.md (section 4)"],
});

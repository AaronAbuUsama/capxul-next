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
  machine_fde_guest,
  machine_org_fde,
  machine_org_head,
  machine_org_invite,
  machine_org_setup,
  table_org_fde_guests,
  table_org_fdes,
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
    "Organization, the FDE's handle, that anyone of the Organization may ask it, and any guest the management names " +
    "(`org fde guest add`), that it acts only as the person who asks, with their own Seat and hats, so it needs no hat " +
    "and every signature stays the asker's (aaron.fde-anyone, organizations.fde-for-the-asker), that Capxul hosts it and its key is the host's, never on the founder's machine " +
    "(aaron.fde-hosted, organizations.fde-at-start-up), its start-up month and how to talk to it (`capxul org fde ask`). " +
    "A setup that began with `--no-fde` holds no FDE and sends nothing. The founder's own Seat needs no email: they " +
    "followed the setup to its end.",
  trigger: { transition: machine_org_setup.t.complete },
  reads: [table_org_setups, table_org_fdes, table_organizations, table_parties, table_principals],
  steps: [
    { name: "setup", about: "Reads the completed setup: no `fde_party_id` ends here; else the founder's principal and the FDE's Party." },
    { name: "facts", about: "The Organization's name and handle, the FDE's handle, its hosting's paid-through instant (`org-fdes`), and `capxul org fde ask`." },
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

// ── the hosted FDE's hosting (aaron.fde-hosted; organizations.fde-hosting) ──────────────────────

export const workflow_notices_organizations_fde_due = noticeWorkflow({
  id: "notices.organizations.fde-due",
  title: "Remind the Directors the FDE's hosting falls due",
  about:
    "Follows `fall_due` of an Organization's hosted FDE: seven days before its paid-through instant, by the hosting's " +
    "own timer (organizations.fde-hosting). Sends `fde-hosting-due` once per due episode to the Directors: the FDE's " +
    "handle, the instant it is paid to, the price of a month (FDE_HOSTING_PRICE), that it pauses then if unpaid, and " +
    `the command to run, \`capxul org fde pay [<months>] --from <budget> --org <handle>\`, from a budget its payer wears the hat of. ${DIRECTORS}`,
  trigger: { transition: machine_org_fde.t.fall_due },
  reads: [table_org_fdes, table_organizations, table_parties, table_principals],
  steps: [
    { name: "hosting", about: "Reads the hosting row: its `paid_through`, the FDE's Party and handle; one no longer `due` ends here." },
    { name: "facts", about: "The Organization's name and handle, the FDE's handle, `paid_through` in the Organization's time zone, and the price." },
  ],
  chain: [contract_safe.f.getOwners],
  was: ["books/target/shared/rulings.ts (aaron.fde-hosted, aaron.test-prices)", "books/target/organizations/decisions.ts (organizations.fde-hosting)"],
});

export const workflow_notices_organizations_fde_paused = noticeWorkflow({
  id: "notices.organizations.fde-paused",
  title: "Tell the Directors the FDE paused for an unpaid month",
  about:
    "Follows `pause` of an Organization's hosted FDE: its paid-through instant passed unpaid, so the host paused it " +
    "(organizations.fde-hosting). Sends `fde-paused` once per pause to the Directors: the FDE takes no message and its " +
    "sandbox is stopped, nothing on chain changed and its hats stay, and paying again (`capxul org fde pay --from " +
    `<budget> --org <handle>\`) wakes it, the months running from the payment. ${DIRECTORS}`,
  trigger: { transition: machine_org_fde.t.pause },
  reads: [table_org_fdes, table_organizations, table_parties, table_principals],
  steps: [
    { name: "hosting", about: "Reads the paused hosting row: its `paused_at` and the FDE's Party and handle." },
    { name: "facts", about: "The Organization's name and handle, the FDE's handle, when it paused, and the price of a month." },
  ],
  chain: [contract_safe.f.getOwners],
  was: ["books/target/shared/rulings.ts (aaron.fde-hosted)", "books/target/organizations/decisions.ts (organizations.fde-hosting)"],
});

// ── the FDE's guests (aaron.fde-anyone; organizations.fde-guests) ───────────────────────────

const GUEST_STEPS = [
  { name: "guest", about: "Reads the guest: their Party's mailbox (none for a person known only by @handle and no email: no notice), who named them and the note." },
  {
    name: "facts",
    about:
      "The Organization's name and handle, who named them, the note, how to sign in with this mailbox (`capxul auth " +
      "login <email>`, then the emailed code) and the line to ask: `capxul org fde ask <message> --org <handle>`.",
  },
] as const;

const GUEST_ABOUT =
  "Sends `fde-guest-named` once to the guest's mailbox: the Organization that named them, by whom, the note, that " +
  "they are admitted to the beta (`accounts.admit` via fde-guest, so this is their welcome), how to sign in and how " +
  "to ask its FDE, which does for them only what an outside party may (organizations.fde-for-the-asker). A removal " +
  "sends nothing.";

export const workflow_notices_organizations_fde_guest_named = noticeWorkflow({
  id: "notices.organizations.fde-guest-named",
  title: "Tell an outside person they may ask an Organization's FDE",
  about: `Follows \`name\`: People or a Director named an outside person a guest of the FDE. ${GUEST_ABOUT}`,
  trigger: { transition: machine_fde_guest.t.name },
  reads: [table_org_fde_guests, table_organizations, table_parties, table_principals],
  steps: GUEST_STEPS,
  was: ["books/target/shared/rulings.ts (aaron.fde-anyone)", "books/target/organizations/decisions.ts (organizations.fde-guests)"],
});

export const workflow_notices_organizations_fde_guest_named_again = noticeWorkflow({
  id: "notices.organizations.fde-guest-named-again",
  title: "Tell a removed guest they may ask an Organization's FDE again",
  about: `Follows \`name_again\`: a removed guest is named again. ${GUEST_ABOUT}`,
  trigger: { transition: machine_fde_guest.t.name_again },
  reads: [table_org_fde_guests, table_organizations, table_parties, table_principals],
  steps: GUEST_STEPS,
  was: ["books/target/shared/rulings.ts (aaron.fde-anyone)", "books/target/organizations/decisions.ts (organizations.fde-guests)"],
});

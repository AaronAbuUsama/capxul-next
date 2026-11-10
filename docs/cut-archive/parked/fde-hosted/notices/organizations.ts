// Moved out of the built book by the cut, 10 November 2026, from books/target/notices/organizations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { table_principals } from "../access/data.ts";
import {
  machine_fde_guest,
  machine_org_fde,
  machine_org_invite,
  machine_org_setup,
  table_org_fde_guests,
  table_org_fdes,
  table_org_invitations,
  table_org_setups,
  table_organizations,
} from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { contract_safe } from "../shared/external.ts";
import { DIRECTORS, noticeWorkflow } from "./kit.ts";

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

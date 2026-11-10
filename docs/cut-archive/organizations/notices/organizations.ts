// Moved out of the built book by the cut, 10 November 2026, from books/target/notices/organizations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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

// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/processes.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import {
  contract_agent_owner,
  contract_company_safe_minter,
  contract_hats,
  contract_installer,
  contract_safe,
  integration_chain_rpc,
  integration_fde_host,
  integration_frappe_head,
  integration_indexer,
  integration_service_signer,
} from "../shared/external.ts";
import {
  event_fde_payment_transitioned,
  event_org_fde_transitioned,
  event_org_setup_transitioned,
  machine_org_fde,
  table_org_fde_payments,
  table_org_fdes,
  event_org_app_transitioned,
  event_org_head_transitioned,
  event_org_member_transitioned,
  machine_org_app,
  machine_org_head,
  table_org_apps,
  table_org_heads,
  machine_org_invite,
  machine_org_member,
  machine_org_setup,
  table_org_deployments,
  table_org_invitations,
  table_org_members,
  table_org_setups,
  table_organizations,
} from "./data.ts";
import { rpc_organizations_setups_resume } from "./setups.ts";
import {
  rpc_organizations_invitations_accept,
  rpc_organizations_invitations_cancel,
  rpc_organizations_invitations_decline,
  rpc_organizations_invitations_invite,
} from "./invitations.ts";
import { procedure_approvals_open } from "../approvals/procedures.ts";
import { procedure_parties_activate, procedure_parties_register, procedure_parties_release } from "../parties/procedures.ts";
import { table_hat_wearers, table_safe_executions } from "../indexing/data.ts";
import { event_approval_transitioned } from "../approvals/data.ts";
import { table_indexer_progress } from "../indexing/data.ts";
import { rpc_organizations_heads_ring } from "./heads.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";

export const workflow_organizations_heads_watch = defineWorkflow({
  id: "organizations.heads.watch",
  title: "One head connection's life: check the site, install wanted apps, follow it",
  about:
    "The one durable process of a head connection, started by its `connect`: it waits on the site for days at a time and " +
    "must survive a crash. It reads the site (`readSite`) and confirms the connection when the Capxul app is there at a " +
    "version Capxul speaks, with its Custom Fields, the fundamental apps (ERPNext, Frappe HR, Frappe CRM), the " +
    "Organization's time zone and a Company in its currency; anything else stalls it with the reason (a head in another " +
    "time zone would date every document a day wrong, and one in another currency would value every amount wrong). Connected, a Frappe Cloud head's host is asked to install each wanted app (`installApp`, " +
    "with the team's token); a self-hosted head's is not, since its owner installs it with bench; either way it marks " +
    "the app installed once readSite lists it. It checks the site again once a day by its " +
    "own timer, at once when an app is wanted, and on a ring while failing; a check that fails past its retries stalls " +
    "it, and the next good one recovers it. It ends when a Director disconnects the head. It syncs no app's records: " +
    "each app concept's own process does, from `confirm` (organizations.head-ownership). It pushes the members' " +
    "Users, with their hats' roles, at `confirm`, on a Seat's change and daily (organizations.head-users). On a devnet its daily timer is a stop, " +
    "and the stand-in head follows the clock (organizations.head-clock).",
  concept: concept_organizations,
  priority: "normal",
  trigger: { transition: machine_org_head.t.connect },
  instance: { per: table_org_heads },
  signals: [rpc_organizations_heads_ring],
  waits: [
    { name: "daily-check", for: "timer", timeoutMs: DAY, about: "Read the site again a day after the last check." },
    {
      name: "app-wanted",
      for: "signal",
      key: [{ on: [event_org_app_transitioned], props: ["org_id"] }],
      about: "An app became wanted: ask the head's host to install it now.",
    },
    {
      name: "seat-changed",
      for: "signal",
      key: [{ on: [event_org_member_transitioned], props: ["org_id"] }],
      about: "A Seat of the Organization was born or ended: push the members' Users now.",
    },
    {
      name: "ring",
      for: "signal",
      key: [{ on: [rpc_organizations_heads_ring], props: ["headId"] }],
      about: "The head rang while the connection is failing: the site is up again, so check it now.",
    },
    {
      name: "disconnected",
      for: "signal",
      key: [{ on: [event_org_head_transitioned], props: ["org_id", "head_id"] }],
      about: "A Director disconnected it: end.",
    },
  ],
  steps: [
    {
      name: "check",
      about:
        "readSite; confirm, stall or recover; record Frappe's and the Capxul app's versions and the time zone, and each " +
        "of the Organization's apps' version as the site lists it (org-apps.version, the fundamental apps' included).",
    },
    { name: "install-wanted", about: "Connected: on a Frappe Cloud head, installApp for each wanted app not yet asked for, then readSite again; on any head, install each wanted app readSite lists." },
    {
      name: "users",
      about:
        "Connected: upsertDocs a User for each person holding a current Seat, with the roles its hats give now, and disable the User of a Seat that ended.",
    },
    { name: "await", about: "Wait for the timer, a wanted app, a Seat's change, a ring or the disconnect." },
  ],
  reads: [
    table_org_heads, table_org_apps, table_organizations, table_org_members, table_principals, table_parties,
    table_org_deployments, table_hat_wearers,
  ],
  writes: [table_org_heads, table_org_apps],
  drives: [machine_org_head.t.confirm, machine_org_head.t.stall, machine_org_head.t.recover, machine_org_app.t.install],
  invokes: [],
  emits: [],
  calls: [integration_frappe_head.c.readSite, integration_frappe_head.c.installApp, integration_frappe_head.c.upsertDocs],
  chain: [],
  idempotency:
    "One process per head connection (`org-head:<orgId>:<headId>`); each transition is guarded by the state it moves " +
    "from, an app already asked for is not asked for again, and a User is written by the member's `capxul_id` with its " +
    "version, so a repeated push changes nothing.",
  // Real time bounding one run's work between its waits (time.real-elapsed): a push or a read of the site with retries.
  timeoutMs: 10 * 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});

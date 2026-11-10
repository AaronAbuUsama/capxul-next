// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_activity, concept_board, concept_budgets, concept_notices, concept_organizations, concept_parties } from "../shared/foundation.ts";
import { error_CANCELLED, error_FEATURE_NOT_AVAILABLE, error_SEAT_LIMIT_REACHED, error_WRONG_STATE } from "../shared/vocabulary.ts";
import {
  event_org_invite_transitioned,
  event_org_member_transitioned,
  event_org_setup_transitioned,
  machine_org_invite,
  machine_org_member,
  machine_org_setup,
  table_org_deployments,
  table_org_invitations,
  table_org_members,
  table_org_setups,
  table_organizations,
} from "./data.ts";
import {
  procedure_organizations_add_bought_seats,
  procedure_organizations_bind_invitation_grants,
  procedure_organizations_return_bought_seats,
} from "./procedures.ts";
import { rpc_organizations_setups_begin, rpc_organizations_setups_get, rpc_organizations_setups_resume } from "./setups.ts";
import { rpc_organizations_workspaces_list, rpc_organizations_workspaces_me } from "./workspaces.ts";
import { rpc_organizations_members_list, rpc_organizations_seats_raise } from "./members.ts";
import {
  rpc_organizations_invitations_accept,
  rpc_organizations_invitations_cancel,
  rpc_organizations_invitations_decline,
  rpc_organizations_invitations_invite,
  rpc_organizations_invitations_list,
  rpc_organizations_invitations_resend,
} from "./invitations.ts";
import {
  workflow_organizations_invitations_follow,
  workflow_organizations_members_end_agent_seats,
  workflow_organizations_setups_set_up,
} from "./processes.ts";
import {
  flow_client_onboarding_begin_organization,
  flow_client_org_members_get,
  flow_client_org_setup_get,
  flow_client_org_setup_resume,
  flow_client_org_setup_subscribe,
  flow_client_orgs_invitations,
  flow_client_operator_organizations_seats_raise,
  flow_client_orgs_use,
} from "./flows.ts";
import {
  operation_invite_decline,
  operation_invite_list,
  operation_org_create,
  operation_org_invite_cancel,
  operation_org_invite_list,
  operation_org_invite_resend,
  operation_org_list,
  operation_org_me,
  operation_org_member_get,
  operation_org_member_list,
  operation_org_retry,
  operation_org_show,
  operation_org_wait,
  operation_use_org,
} from "./operations.ts";
import {
  concept_books,
  concept_contacts,
  component_frappe_app,
  system_capxul,
} from "../shared/foundation.ts";
import { contract_agent_owner, integration_frappe_head } from "../shared/external.ts";
import {
  event_org_head_transitioned,
  event_seat_purchase_transitioned,
  machine_org_app,
  machine_org_head,
  machine_seat_purchase,
  table_org_apps,
  table_org_heads,
  table_org_seat_purchases,
} from "./data.ts";
import {
  rpc_organizations_heads_connect,
  rpc_organizations_heads_disconnect,
  rpc_organizations_heads_ring,
  rpc_organizations_heads_show,
} from "./heads.ts";
import { workflow_organizations_fde_host, workflow_organizations_heads_watch as workflow_heads_watch } from "./processes.ts";
import { rpc_organizations_apps_add, rpc_organizations_apps_list, rpc_organizations_apps_remove } from "./apps.ts";
import { rpc_organizations_fde_ask, rpc_organizations_fde_show, rpc_organizations_fde_turn } from "./fde.ts";
import { rpc_organizations_seats_show } from "./members.ts";
import { flow_client_org_fde_ask, flow_client_org_head_connect, flow_client_org_head_disconnect } from "./flows.ts";
import {
  NEW_OPERATIONS,
  operation_org_fde_turn_get,
  operation_org_head_app_add,
  operation_org_head_app_list,
  operation_org_head_app_remove,
  operation_org_fde_ask,
  operation_org_fde_show,
  operation_org_head_connect,
  operation_org_head_disconnect,
  operation_org_head_show,
  operation_org_seats_show,
} from "./operations.ts";
import {
  machine_fde_payment,
  machine_org_fde,
  table_org_fde_asks,
  table_org_fde_payments,
  table_org_fdes,
} from "./data.ts";
import { procedure_organizations_extend_fde_hosting, procedure_organizations_return_fde_hosting } from "./procedures.ts";
import { concept_agents, concept_devnet, concept_payments } from "../shared/foundation.ts";
import {
  machine_fde_guest,
  table_org_doc_calls,
  table_org_fde_guests,
} from "./data.ts";
import {
  rpc_organizations_fde_guests_add,
  rpc_organizations_fde_guests_list,
  rpc_organizations_fde_guests_remove,
} from "./fde.ts";
import {
  rpc_organizations_doc_calls_list,
  rpc_organizations_docs_amend,
  rpc_organizations_docs_apply,
  rpc_organizations_docs_cancel,
  rpc_organizations_docs_change,
  rpc_organizations_docs_create,
  rpc_organizations_docs_get,
  rpc_organizations_docs_list,
  rpc_organizations_docs_remove,
  rpc_organizations_docs_submit,
  rpc_organizations_doctypes_get,
  rpc_organizations_doctypes_list,
} from "./docs.ts";
import { flow_client_org_head_docs_remove } from "./flows.ts";
import {
  DOC_OPERATIONS,
  FDE_ANYONE_OPERATIONS,
  operation_org_head_doc_amend,
  operation_org_head_doc_call_list,
  operation_org_head_doc_remove,
  operation_org_head_doc_submit,
  operation_org_head_doctype_get,
  operation_org_head_doctype_list,
  operation_org_fde_guest_add,
  operation_org_fde_guest_list,
  operation_org_fde_guest_remove,
} from "./operations.ts";
import { procedure_accounts_admit } from "../accounts/procedures.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { component_core_sdk, concept_accounts, concept_approvals } from "../shared/foundation.ts";
import { integration_fde_host as integration_fde_host_ } from "../shared/external.ts";

export const decision_organizations_head_connection = defineDecision({
  id: "organizations.head-connection",
  title: "A head connection is organizations' record and process; each app syncs itself",
  question: "The head ruling: connecting a head is a separate step. What records it, and who syncs what?",
  options: [
    {
      label: "connection-here-sync-per-app",
      text:
        "`org-heads` holds the one live connection (site, host, sealed key, what the site said) and its process checks the " +
        "site and installs wanted apps; each app concept syncs its own records from the connection's `confirm`, through " +
        "the `frappe-head` integration.",
    },
    { label: "head-concept", text: "A new head concept above every app, which syncs all of them." },
  ],
  chosen: "connection-here-sync-per-app",
  why:
    "Every app concept depends on organizations, so each can read the connection and follow its transitions; a head " +
    "concept above them all would have to write every app's tables, which P4 forbids. One live connection at a time " +
    "keeps one head per Organization's data. The API key is sealed under record-bound encryption bound to the row, as " +
    "banking seals bank details, and never returned; so are the ring secret (a signature is checked with the secret, " +
    "not its hash) and, for Frappe Cloud, the team's token its site API needs to install an app, which no site key can. Connecting is a Director's step, because it hands the Organization's " +
    "records to an outside system (organizations.commands).",
  source: FRAPPE_RULINGS,
  affects: [table_org_heads, machine_org_head, workflow_heads_watch, integration_frappe_head],
});

export const decision_organizations_head_ownership = defineDecision({
  id: "organizations.head-ownership",
  title: "Money and identity are Capxul's; business records shared; the rest the head's",
  question:
    "aaron.frappe-head: once a head is connected, accounting, payroll, CRM and projects sync between the two, with Capxul " +
    "the system of record for money and identity. Who owns what, field by field?",
  options: [
    {
      label: "three-classes",
      text:
        "Capxul's: money and identity (payments and the vouchers posted from book facts, Parties' names, handles and Safes, " +
        "Seats, hats, budgets, agreements' terms): pushed one way, read-only on the head, overwritten if they drift. " +
        "Shared: the fundamental apps' business records (projects, tasks, timesheets, CRM relationship fields, the " +
        "non-money parts of the books and payroll): either side may change them, each change based on a version, and " +
        "Capxul applies a head change through its own checks; an older base or a refused change loses. The head's: every " +
        "other app's documents and the head's customizations, which Capxul never copies. A pulled edit is authorized as " +
        "the member the head user's mailbox matches, with that member's rights and hats, never the connection's own; an " +
        "app may be stricter, never looser. With no member matched, an app may apply only what any member may do " +
        "(projects), or push the edit back: the CRM always does, since editing it needs the People hat by ruling " +
        "(contacts.crm-permission). The members' Users and their roles are identity, pushed one way from the hats " +
        "(organizations.head-users); a role never authorizes a pulled edit, the member's hats do.",
    },
    { label: "capxul-all", text: "Capxul owns everything it holds; the head may only read and ask." },
    { label: "head-all", text: "Once connected, the head owns everything but money and identity, and Capxul follows it." },
  ],
  chosen: "three-classes",
  why:
    "For Aaron, to confirm the reading. Money and identity must never move because a head's database says so: the chain " +
    "decides, and the head books what settled (docs/vision/erp.md). Business records are what people edit in Frappe's " +
    "forms every day, so a head that could not edit them would not be a head; Capxul applying them through its own " +
    "checks keeps the guards and lets an Organization disconnect its head with records it can trust. The three classes " +
    "are what each app's designer follows: projects first (projects.head-sync); books, payroll, contacts and parties " +
    "decide which of their fields fall in each class. Whose authority a pulled edit runs under was asked by the CRM " +
    "lane (identity assembly): the matched member's, because the Organization's permissions are hats worn by members, " +
    "and a connection that edited with its own authority would let every head user do what only a hat allows. The head " +
    "vouches for its own users: a Director who connects one trusts its administrators with the shared records, and the " +
    "match gives an edit a member's rights, never more. Roles pushed from the hats let the head's forms stop most such " +
    "edits before Capxul must push them back.",
  source: FRAPPE_RULINGS,
  affects: [integration_frappe_head, component_frappe_app, table_org_heads, concept_books, concept_contacts],
});

export const decision_organizations_head_doorbell = defineDecision({
  id: "organizations.head-doorbell",
  title: "The head rings a doorbell with no data; Capxul pulls with its own key",
  question: "How does Capxul learn that something changed on the head, without polling it every minute?",
  options: [
    { label: "doorbell", text: "The Capxul app posts a signed, data-free ring after a change commits; it wakes every app's sync, which pulls; a daily pull catches a lost ring." },
    { label: "poll", text: "Each app's sync polls the head every minute." },
    { label: "webhook-with-data", text: "The head posts each change with its content to Capxul." },
  ],
  chosen: "doorbell",
  why:
    "A minute-scale poll is a timer the one clock would stop at, half a million stops a simulated year " +
    "(devnet.warp-barrier), and a load on every head. A webhook with data would make the head a writer into Capxul " +
    "holding Capxul's trust; a ring carries nothing, so a forged one is refused and a replayed one only causes an extra " +
    "pull, and every change still " +
    "comes through Capxul's own read with Capxul's own key. On a devnet the stand-in head rings at the stop its scripted " +
    "edit happens.",
  source: by("books/target/devnet/decisions.ts (devnet.warp-barrier); books/target/banking/inbox.ts (a signed delivery route)"),
  affects: [rpc_organizations_heads_ring, table_org_heads, workflow_heads_watch, component_frappe_app],
});

export const decision_organizations_frappe_app_fields = defineDecision({
  id: "organizations.frappe-app-fields",
  title: "The Capxul app's Custom Fields, one Party field, and what listChanges reports",
  question:
    "The four Frappe lanes each asked the Capxul app for Frappe for Custom Fields and changes, under names that differ " +
    "(the CRM's and the books' `capxul_party`, payroll's `capxul_party_id` on Employee). Which fields does the app add, " +
    "and what must `listChanges` catch?",
  options: [
    {
      label: "one-set",
      text:
        "`capxul_id` and `capxul_version` on every synced DocType. One Party field, `capxul_party`, on Contact, CRM " +
        "Organization, Customer, Supplier and Employee (payroll's `capxul_party_id` takes this name); a Party in any " +
        "other role is named by role (`capxul_payee_party` on Salary Component). `capxul_hidden` on Contact and CRM " +
        "Organization. Each app concept's own fields by its decisions (payroll.head-sync's on Salary Structure " +
        "Assignment, Payroll Entry and Salary Slip); on User, a member's `capxul_id` and `capxul_party` " +
        "(organizations.head-users). The app finds or creates a document Capxul names by `capxul_party` " +
        "(parties.head-parties) and makes the link records it names first (CRM Industry, CRM Lead Source, CRM " +
        "Territory, Currency). `listChanges` reports every synced DocType (the CRM's Contact, CRM Organization, CRM " +
        "Lead, CRM Deal; projects', payroll's and the books') and every write path: a document event (`on_change`, " +
        "which Frappe runs for a save, a submit, a cancel and a `db_set`) appends a change row naming the document, and " +
        "`frappe.db.set_value`, which runs no event, is caught by `listChanges` itself, which first appends a row for " +
        "each synced document whose `modified` is later than its own last row recorded. A row names the document; its fields are " +
        "read as they stand when `listChanges` answers, so a raw write in the same request as a recorded change (Frappe " +
        "CRM restoring a new deal's `deal_owner` with `update_modified=False`) is reported with it. On a connection's " +
        "first call it lists every document the site already holds.",
    },
    { label: "per-app-names", text: "Each app's lane keeps the names it chose; the app carries both Party fields on Employee." },
  ],
  chosen: "one-set",
  why:
    "The component is one app and one seam, so one name per meaning: two Party fields on Employee would let them " +
    "disagree, and a lookup by Party must work the same for a voucher's party, a contact and an employee. Reporting " +
    "every write path matters because Frappe CRM converts a lead with `db_set` and `set_value`, which run no `on_update`, " +
    "so a hook on saves alone would lose a conversion; reporting what the site already holds on the first call lets a " +
    "head connected late be adopted (contacts.head-mapping). Renaming a CRM Organization also rewrites the " +
    "`company_name` of its Contacts, a Data field `rename_doc` does not follow. Every person's Seat is a User whose " +
    "Contact carries the member's `capxul_party` (organizations.head-users), and a won deal's Customer the head makes " +
    "(`create_customer_on_status_change`) is the head's, given the `capxul_party` of what Frappe makes it from: the " +
    "deal's CRM Organization (a Company customer) or, with none, its primary Contact (an Individual), and none when " +
    "that has no Party. The `modified` sweep is needed because Frappe CRM writes CRM Lead (`update_lead_contact`) and " +
    "CRM Deal (a Contact's mailbox change) with `frappe.db.set_value`, which no hook sees. Payroll's own field list is " +
    "payroll's; this records only the shared names.",
  source: asmBy("docs/design/frappe/crm.md (head and organizations); docs/design/frappe/accounting.md (capxul_party); books/target/payroll/decisions.ts"),
  affects: [component_frappe_app, integration_frappe_head, table_org_heads, concept_contacts, concept_books],
});

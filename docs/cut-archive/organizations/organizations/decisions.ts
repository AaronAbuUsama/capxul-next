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

export const decision_organizations_startup = defineDecision({
  id: "organizations.startup",
  title: "Start-up: the Company's facts, the fundamental apps, their start-ups, the FDE",
  question:
    "The Frappe rulings: an Organization starts with all of its fundamental apps (accounting, " +
    "payroll, CRM, projects) in Frappe's shapes, whether or not a head is connected. What does `org create`'s start-up " +
    "step create, and who creates each part?",
  options: [
    {
      label: "begin-and-reactions",
      text:
        "`begin`, in its one transaction, writes the Company's facts on the Organization (abbreviation, currency, time zone, " +
        "fiscal-year start, from the country as ERPNext's setup wizard does) and the app list (the fundamental apps " +
        "installed and native, any other asked-for app wanted); the setup's process asks Capxul's FDE host for the FDE " +
        "(organizations.fde-at-start-up). Each fundamental " +
        "app's concept starts itself from the setup's `begin` transition where its frozen behaviour allows: payroll its " +
        "settings, projects its settings and starting types, and the CRM needs nothing written. Books keeps facts from the first money but " +
        "makes no chart until `org books accounts import` runs (frozen: no chart until one is made), which a Books-hat " +
        "wearer runs in the first sitting, with the hosted FDE (`org fde ask`). The install batch creates the FDE on chain.",
    },
    { label: "one-big-setup", text: "The setup process creates every app's starting records itself." },
    { label: "at-ready", text: "Nothing until the setup is ready; then each app starts." },
  ],
  chosen: "begin-and-reactions",
  why:
    "P4 lets organizations write only its own tables, and the apps sit above it, so each app's starting records are its " +
    "own concept's, started from organizations' transition (the reacting concept depends on the one that changed). " +
    "Starting at `begin` matches the rulings: the books keep facts from the first money, and money can reach the company " +
    "Safe's predicted address before the mint. The Company's facts belong on the Organization because every app reads " +
    "them and a head's Company and System Settings must carry the same ones. What each app creates is each designer's: " +
    "for books, nothing at begin, since a chart comes only from the import (books' own decision, keeping the frozen " +
    "'no chart until one is made'), and the import makes the tree, the fiscal years from `fiscal_year_start` and the " +
    "main cost centre (books.startup); for payroll, Payroll Settings only, through payroll.startup.open, and no salary " +
    "components, which a business defines itself (payroll.startup); for the CRM, nothing: its statuses " +
    "are fixed defaults and its counter comes with its first write (contacts.startup); for projects, projects.startup.",
  source: by(`${WIZARD}/setup_wizard.py:get_setup_stages; ${WIZARD}/operations/install_fixtures.py; books/target/shared/rulings.ts (aaron.frappe-shape)`),
  affects: [
    rpc_organizations_setups_begin, table_organizations, table_org_apps, machine_org_setup, concept_books, 
    concept_contacts, 
  ],
});

export const decision_organizations_head_clock = defineDecision({
  id: "organizations.head-clock",
  title: "A head runs on the one clock: Capxul's times for money, one time zone for days",
  question: "The one clock (time.one-clock) runs the larger system too. How does a connected head follow it?",
  options: [
    {
      label: "follower-and-zone",
      text:
        "Money's times are Capxul's (a voucher is dated at its fact's block); a head's own dates are Frappe's, read through " +
        "frappe.utils; every instant crosses as UTC and every day in the Organization's time zone, which the head must " +
        "share (else the connection stalls). On a devnet the Capxul app is a follower: it sets now_datetime to the clock's " +
        "now, runs Frappe's due jobs at each stop, and reports only daily-or-slower jobs as its next due.",
    },
    { label: "own-clocks", text: "Each side keeps its own clock and the sync converts." },
  ],
  chosen: "follower-and-zone",
  why:
    "ERPNext reads time almost only through Frappe's helpers, and Frappe's tests already freeze them, so following the " +
    "clock is one patch in the Capxul app, not a fork (docs/vision/erp.md section 5). A head in another zone would put a " +
    "task's due day or a fiscal year's first day on another date. Reporting only slow jobs as stops follows the barrier's " +
    "own rule, because Frappe's every-tick and 15-minute jobs would make a simulated year hundreds of thousands of stops; " +
    "which of Frappe's jobs count as stops is the devnet designer's to fix with the stand-in head.",
  source: by("books/target/shared/time.ts (time.one-clock, time.clients-take-server-now); books/target/devnet/decisions.ts (devnet.followers); docs/vision/erp.md (section 5)"),
  affects: [component_frappe_app, integration_frappe_head, table_organizations],
});

export const decision_organizations_commands = defineDecision({
  id: "organizations.commands",
  title: "Decision pack: the app, head and hosted FDE commands to add (new capabilities)",
  question:
    "Adding Frappe apps, connecting a head and reaching the hosted FDE are new capabilities, not among the 215 " +
    "(aaron.frappe-shape, aaron.frappe-head, aaron.fde-hosted). Which commands does Capxul add, and who may run them?",
  options: [
    {
      label: "apps-and-head",
      text:
        "Recommended: exactly the 8 commands of docs/design/new-commands.md (section 5.4), in its one grammar, each one " +
        "SDK method under `client.org(orgId)` over one rpc in organizations (`organizations.<area>.<verb>`), a flow where it " +
        "prompts or waits: `org head app list` " +
        "(any member, read); `org head app add <app>` and `org head app remove <app>` (a Director, or the Organization's own agent, " +
        "its FDE; write; a fundamental app is never removed); `org head connect <site-url> --host frappe-cloud|self-hosted` " +
        "(a Director; vendor: a flow reads the head user's API key, and on Frappe Cloud the team's token, from a prompt " +
        "or a file, never a flag, previews what is shared, and follows the check to connected or failing), `org head " +
        "show` (any member, read: status, versions, time zone, issue and the apps as the head runs them; each app's sync " +
        "position is that app concept's) and `org head disconnect` (a Director, write: a flow previews, then one rpc); and, for the hosted FDE (aaron.fde-hosted), `org fde show` (any member, " +
        "read: its state on the host, its hats, the day its hosting is paid through and FDE_HOSTING_PRICE) and `org fde " +
        "ask <message>` (any member, or a guest the management names, by aaron.fde-anyone; vendor: a flow sends the " +
        "message to the host and prints the FDE's reply when its turn ends; the FDE acts as the asker). Paying for the hosting, `org fde pay`, is organizations.buy-seats', since payments books it as it books " +
        "`org seats buy`.",
    },
    { label: "apps-only", text: "Viable. Only the app commands now; connecting a head waits for its own pack." },
    { label: "fde-only", text: "Weak. No commands: the FDE adds apps and connects heads through a conversation surface of its own." },
  ],
  chosen: "apps-and-head",
  why:
    "A decision pack under rules.new-operations. Aaron accepted its app and head commands as recommended (8 November " +
    "2026, sixth batch, question 10 of docs/decisions/open-for-aaron.md); the two FDE commands were added after his " +
    "answer, under aaron.fde-hosted (docs/design/new-commands.md section 6), and who may ask the FDE is put to him in " +
    "organizations.fde-commands. All eight are booked as operations beyond the 215, with their claims, refusals and " +
    "worlds (organizations.app-commands, organizations.head-commands, organizations.fde-commands, " +
    "organizations.command-worlds). " +
    "The FDE acts through the same CLI as everyone (aaron.fde-agent), so whatever it may do must be a command; an " +
    "FDE-only surface would put an unchecked path beside the CLI. Connecting a head hands the Organization's records to " +
    "an outside system, so it is a Director's step, not the FDE's: the FDE prepares it and a Director runs it. Adding an " +
    "app is reversible and moves no money, so the FDE may do it; any other member may not, because a connected head's " +
    "host is then asked to install it (agents.fde-authority follows this). aaron.fde-hosted adds two commands no pack " +
    "listed: the FDE runs on Capxul's host, not beside the founder's CLI, so the Organization needs `org fde show` to " +
    "see it and `org fde ask` to talk to it through Capxul's own sign-in. Asking was a Director's until aaron.fde-anyone " +
    "let any member, or a guest the management names, ask, the FDE acting as the asker (organizations.fde-commands, " +
    "organizations.fde-for-the-asker). The start-up's two (app list and add) are critical, and the FDE's two are " +
    "not, since it is not on the critical path (organizations.command-priorities). Buying seats and paying the hosting are " +
    "organizations.buy-seats', and organizations books that pack's `org seats show` (organizations.seats-show).",
  source: by(
    "books/target/shared/rulings.ts (aaron.erp-on-capxul, aaron.frappe-shape, aaron.frappe-head, aaron.fde-agent, aaron.fde-hosted); docs/design/new-commands.md (section 5.4); docs/decisions/open-for-aaron.md (question 10)",
  ),
  affects: [
    table_org_apps, table_org_fdes, machine_org_app, 
    rpc_organizations_apps_list, rpc_organizations_apps_add, rpc_organizations_apps_remove, 
    rpc_organizations_heads_show, 
    
    ...NEW_OPERATIONS, system_capxul,
  ],
});

export const decision_organizations_startup_worlds = defineDecision({
  id: "organizations.startup-worlds",
  title: "Existing worlds start Acme with `--no-fde`; a new world starts it with its FDE",
  question:
    "With an FDE by default, every Organization world would hold an FDE, so `agent create --org` there would meet the " +
    "own-agent limit and `org member list` would show one more Seat. How do the frozen operations keep their worlds?",
  options: [
    { label: "no-fde-in-old-worlds", text: "Every existing world's `org create` passes `--no-fde`, so each holds what it says; a new world, `org-with-fde`, is `org-ready` with its FDE, for the FDE's own claims." },
    { label: "rewrite-worlds", text: "Rewrite every Organization world around its FDE: Acme's @acme-bot becomes its FDE." },
  ],
  chosen: "no-fde-in-old-worlds",
  why:
    "The worlds are evidence for frozen claims and refusals: `org-with-proposals-gate-off` must hold no agent of Acme's " +
    "own so `agent create --org` reaches FEATURE_NOT_AVAILABLE, and `org-with-agent` makes @acme-bot with `agent create " +
    "--org`, which by the FDE ruling is Acme's FDE anyway. Keeping them unchanged keeps every frozen behaviour where it " +
    "was proved. For the devnet designer: add `--no-fde` to the Organization worlds' `org create` and add `org-with-fde`.",
  source: by("books/target/devnet/worlds.ts (org-ready, org-with-agent, org-with-proposals-gate-off); books/target/agents/operations.ts"),
  affects: [operation_org_create, flow_client_onboarding_begin_organization],
});

export const decision_organizations_head_users = defineDecision({
  id: "organizations.head-users",
  title: "Each person's Seat is a User on the head, with the roles its hats give",
  question:
    "A connected head needs each member as a User: Frappe CRM names a lead's or deal's owner by User, Frappe makes a " +
    "Contact for every User, and a pulled edit is judged as the member the head user's mailbox matches. The CRM lane " +
    "asked that every Seat be a User and that the head's roles follow the hats, but no process pushed them. Who makes " +
    "the members' Users, with which roles, and when?",
  options: [
    {
      label: "heads-watch",
      text:
        "Organizations' own head process (`organizations.heads.watch`) pushes the members as identity, one way: at " +
        "`confirm`, on each `org_member_transitioned` and at each daily check, `upsertDocs` writes a User for each person " +
        "holding a current Seat (their email, name, the member's `capxul_id` and `capxul_party`, enabled) and disables " +
        "the User of a Seat that ended, never deleting it. An agent's Seat has no User: Frappe keys a User by email and " +
        "an agent has none, and an agent works through the CLI and SDK; a record naming an agent member names no User " +
        "there. A User's roles are what its member's hats give, as Has Role rows Capxul holds: the People hat Sales User, " +
        "Sales Manager, HR Manager and Projects Manager; the Books hat Accounts User and Accounts Manager; the Invoicing " +
        "hat Accounts User; every member Projects User. A role whose hat is gone is taken away at the next push, or " +
        "sooner at the member's next document-family call, which sets them first (organizations.doc-authority); one a " +
        "head administrator gives by hand is the head's and authorizes nothing in Capxul. Frappe makes the User's " +
        "Contact after the User commits (`create_contact`, enqueued), or finds the one that already holds its email, " +
        "and the Capxul app copies the User's `capxul_party` onto it: the same Party a person's entry by that " +
        "mailbox already names.",
    },
    { label: "per-app", text: "Each app concept pushes the Users it needs, with the roles its own records need." },
    { label: "head-admin", text: "The head's administrator makes the Users and gives the roles; Capxul only matches mailboxes." },
  ],
  chosen: "heads-watch",
  why:
    "Seats and hats are identity, which is Capxul's (organizations.head-ownership), and organizations holds both, so " +
    "it pushes them; one owner keeps three app concepts from writing the same User. A role is a convenience that lets " +
    "the head's own forms stop an edit early: a pulled edit is still judged by the member's hats when it is applied, " +
    "so a role up to a day behind a hat (hats are chain facts this process reads at each check, not events it follows) " +
    "only means the head accepts an edit Capxul then pushes back, or refuses one a new hat would allow until the next " +
    "push. The mapping follows each app's own decision: contacts.crm-permission (Sales User and Sales Manager follow " +
    "the People hat), payroll.hr-authority (the People hat is HR Manager), projects.permissions (members work tasks and " +
    "time; the People hat manages projects) and ERPNext's own permissions (Accounts User makes Journal Entries and Sales " +
    "Invoices; only Accounts Manager makes Cost Centers). Frappe's roles are coarser than Capxul's checks (a Projects " +
    "User may make a Project there, which projects then pushes back), which is why roles never authorize. Head-admin " +
    "would let a head admit someone with no Seat. Found in the identity review.",
  source: by("/tmp/frappe/frappe/core/doctype/user/user.py:349 (on_update, create_contact); /tmp/erpnext account, cost_center, journal_entry, sales_invoice, project, task .json permissions"),
  affects: [
    integration_frappe_head, component_frappe_app, table_org_members, concept_contacts,
    concept_books,
  ],
});

const ALL_NEW = [...NEW_OPERATIONS, operation_org_seats_show];

export const decision_organizations_app_commands = defineDecision({
  id: "organizations.app-commands",
  title: "Apps: any member lists; a Director or the FDE adds and removes, from a catalogue",
  question:
    "How do `org head app list|add|remove` behave: who may run them, which app names are accepted, and what do adding twice " +
    "and removing a fundamental app do?",
  options: [
    {
      label: "catalogue",
      text:
        "`org head app list` for any member. `org head app add|remove` for a Director (the Director hat, read from indexing) or " +
        "the Organization's own agent acting as itself (the Seat whose use is `organization`, a self-run one), as " +
        "aaron.frappe-shape and aaron.fde-agent have the FDE add apps in conversation; the hosted FDE never acts as " +
        "itself but as its asker (aaron.fde-anyone), so it adds one for a Director who asks. An app is one of HEAD_APPS, the deployment's catalogue " +
        "of published Frappe apps a host can install; any other name, or a fundamental app, is INVALID_INPUT at add. " +
        "Adding an app already wanted or installed answers it as it stands; a removed one is wanted again. Removing a " +
        "fundamental app is WRONG_STATE, and one the Organization never had INVALID_INPUT. None of them calls the head: " +
        "the head connection's process installs what is wanted.",
    },
    { label: "any-name", text: "Accept any well-formed Frappe app name, so a self-hosted head's own app can be added; the host's installApp refuses one it lacks." },
    { label: "members", text: "Any member adds an app (agents.fde-authority's earlier wording)." },
  ],
  chosen: "catalogue",
  why:
    "Other apps are added at start-up or in conversation with the FDE, so the FDE must be able to add one, and so must a " +
    "person: a Director, because a connected head's host is then asked to install it, which is the Organization's " +
    "choice (docs/design/new-commands.md section 3). The FDE is recognised by its Seat's use, so the guard needs no read " +
    "of agents, which sits above. A catalogue answers the same before any head exists and lets an eval refuse a name; a " +
    "self-hosted head's own app is its owner's to install and is the head's (organizations.apps-native-or-head). Adding " +
    "twice being one want matches `want`, a birth. A fundamental app is in every Organization from its first day, so " +
    "removing one asks for a state none may be in: WRONG_STATE, as G6 gives a forbidden transition.",
  source: passBy("books/target/shared/rulings.ts (aaron.frappe-shape, aaron.fde-agent); docs/design/new-commands.md (G3, G4, G6, section 5.4)"),
  affects: [
    rpc_organizations_apps_list, rpc_organizations_apps_add, rpc_organizations_apps_remove, operation_org_head_app_list,
    operation_org_head_app_add, operation_org_head_app_remove, table_org_apps, machine_org_app,
  ],
});

export const decision_organizations_head_commands = defineDecision({
  id: "organizations.head-commands",
  title: "Head: a Director connects after a preview; any member reads; no secret in a flag",
  question: "How do `org head connect|show|disconnect` behave, and where does the site's check happen?",
  options: [
    {
      label: "flow-and-rpcs",
      text:
        "`org head connect` (aaron.frappe-head) is a flow: it reads the key and secret, and on Frappe Cloud the team's " +
        "token and name, from a prompt or files; previews what is shared and asks; connects in one write that seals the " +
        "secrets and births the connection, whose process checks the site; and follows `organizations.heads.show` live " +
        "until connected or failing, ending with the issue's code (PROVIDER_ERROR unreachable; WRONG_STATE no Capxul " +
        "app, another time zone or currency; ROLE_PERMISSION_DENIED a refused key). `org head show` is that read, once, " +
        "for any member: the connection's own fields and the apps, never a secret, and not each app's sync position. " +
        "`org head disconnect` is a flow that reads the live head (none is WRONG_STATE), previews and asks, then calls one rpc, keeping every record. Connect and disconnect are a " +
        "Director's (the Director hat, from indexing), never an agent's.",
    },
    { label: "check-in-rpc", text: "The connect rpc reads the site before it writes (an action of class vendor), refusing a bad key at once." },
  ],
  chosen: "flow-and-rpcs",
  why:
    "Connecting hands the Organization's records to an outside system, so a person who governs runs it, a Director " +
    "(organizations.head-connection); the FDE prepares it and asks. Leaving the check to the connection's process " +
    "keeps the rpc one transaction and the check in one place, with the same reasons and retries on the first check as " +
    "on any later one; the flow's live follow gives the person the answer the rpc would have. Secrets in flags end up " +
    "in shell history and process lists (G5). Each app's sync position is in its own concept's tables, which " +
    "organizations cannot read (P4): a member reads it through that app's records. Disconnecting keeps Capxul's " +
    "records, which is what makes connecting safe to try. A preview is a prompt the SDK method asks, and the CLI calls " +
    "one method (A4), so both head writes that preview are flows, as `contact link` and `org hr employee leave` are.",
  source: passBy("books/target/shared/rulings.ts (aaron.frappe-head); docs/design/new-commands.md (G5, section 5.4); organizations.head-connection"),
  affects: [
    rpc_organizations_heads_show, 
    operation_org_head_show, 
  ],
});

export const decision_organizations_command_priorities = defineDecision({
  id: "organizations.command-priorities",
  title: "The start-up's commands are critical: app list and add; the FDE's are not",
  question:
    "The grammar makes every new command normal; the commands pass marks the ones a pilot or a start-up needs critical. " +
    "Which of organizations' nine?",
  options: [
    {
      label: "start-up",
      text:
        "Four: `org fde show` and `org fde ask`, since under aaron.fde-hosted the founder reaches the FDE, which sets " +
        "the Organization up, only through them; and `org head app list` and `org head app add`, since aaron.fde-agent has the FDE " +
        "add the apps a business needs in that conversation. The head's three, `org head app remove` and `org seats show` are " +
        "normal: a head connects as a separate step (aaron.frappe-head), and a start-up has ten seats.",
    },
    {
      label: "start-up-without-fde",
      text:
        "Two: `org head app list` and `org head app add`, since a start-up adds the apps its business needs beyond the " +
        "fundamental ones, a Director directly or through the FDE. `org fde show` and `org fde ask` are normal, with the " +
        "head's three, `org head app remove` and `org seats show`.",
    },
    { label: "none", text: "Every command normal, as G8 has it." },
  ],
  chosen: "start-up-without-fde",
  why:
    "Aaron's ruling aaron.fde-anyone (8 November 2026, night, question 36, which named this record): 'The FDE is not " +
    "on the critical path anyway.' So start-up's premise, that `org fde ask` is how a founder's first sitting happens " +
    "at all, no longer holds, and the FDE's two commands are normal: nothing a pilot or a start-up needs waits on them. " +
    "A start-up still adds the apps beyond the fundamental ones, so `org head app list|add` stay critical. Critical orders " +
    "the build's work and the evals a start-up depends on; it changes no budget. projects.critical-commands does the " +
    "same for a pilot's first engagement.",
  source: passBy("docs/design/new-commands.md (G8); books/target/shared/rulings.ts (aaron.fde-anyone, aaron.fde-hosted, aaron.fde-agent, aaron.frappe-head)"),
  affects: ALL_NEW,
});

export const decision_organizations_command_worlds = defineDecision({
  id: "organizations.command-worlds",
  title: "Seven worlds for the new commands: a head's site, a head, a hosted FDE's states",
  question: "Which worlds do the nine commands' claims and refusals start from?",
  options: [
    {
      label: "reuse-and-six",
      text:
        "Reuse signed-out, two-founders (an outsider names Acme), org-ready (a Director, no head, no FDE), " +
        "org-with-member (Sam, a member with no hat; Olga outside) and org-with-pending-invitation. Ask devnet for: " +
        "org-with-head-site (org-with-member plus a stand-in Frappe site for Acme, hosted as on Frappe Cloud, up and not " +
        "connected), org-with-head (that site connected by Dana as a Frappe Cloud head, whose host installs a wanted app), org-with-head-site-down (the site's fault switch down), org-with-fde (rebuilt " +
        "for the hosted FDE of aaron.fde-hosted: its key with the stand-in host, its hosting running in its start-up " +
        "month), org-with-fde-paused (org-with-fde warped past its paid-through instant, unpaid) and " +
        "org-with-fde-host-down (org-with-fde with the stand-in host's fault switch down); and org-with-fde-allowance " +
        "(org-with-fde, funded, with a Board top budget, an allowance under it that Dana wears and the payout ceiling set), from which a hosting payment, and payments' `org fde pay` " +
        "and `org seats buy`, start.",
    },
    { label: "steps-in-evals", text: "Each eval connects a site or warps the FDE itself, from org-ready or org-with-fde." },
  ],
  chosen: "reuse-and-six",
  why:
    "Each refusal needs a state no catalogued world holds: a site to connect, a live head, a hosted FDE paused or " +
    "unreachable. Building the head worlds from org-with-member keeps Sam (no Director hat) and Olga (outside) in each, " +
    "so the authority refusals need no world of their own. The paused world is a warp, so it proves the lapse on the " +
    "one clock (devnet.warp-barrier). A world is shared by every claim that starts from it, so building each once is " +
    "cheaper than repeating its steps in each eval.",
  source: passBy("books/target/devnet/worlds.ts; devnet.head-stand-in; devnet.fde-host-stand-in; aaron.fde-hosted"),
  affects: [...ALL_NEW, concept_devnet],
});

const DOC_RPCS = [
  rpc_organizations_docs_list, rpc_organizations_docs_get, rpc_organizations_docs_create, rpc_organizations_docs_change,
  rpc_organizations_docs_submit, rpc_organizations_docs_cancel, rpc_organizations_docs_amend, rpc_organizations_docs_apply,
  rpc_organizations_docs_remove, rpc_organizations_doctypes_list, rpc_organizations_doctypes_get,
];

export const decision_organizations_doc_family = defineDecision({
  id: "organizations.doc-family",
  title: "Decision pack: the document family that reaches what lives only on the head",
  question:
    "aaron.sdk-reaches-everything: the Core SDK and the CLI reach every capability, and what lives only on a connected " +
    "head is reached 'through a generic document family over the SDK (`org doc list|get|create|change|submit|cancel " +
    "<DocType>`), with the caller's authority, logged, on the world clock' (spelt `org head doc` since " +
    "organizations.head-group). Which commands, and what does Frappe's own REST API need that those six lack?",
  options: [
    {
      label: "six-and-what-frappe-needs",
      text:
        "Recommended: twelve commands in the one grammar (docs/design/new-commands.md section 5.7), each one SDK " +
        "method under `client.org(orgId)` over one rpc in organizations (`organizations.docs.*`, `organizations." +
        "doctypes.*`, `organizations.doc-calls.list`): the six ruled, `org head doc list|get|create|change|submit|cancel " +
        "<DocType>`; three Frappe's documents need, `org head doc amend` (a cancelled document's correction), `org head doc apply " +
        "<action>` (a Workflow's step, since a DocType under a Workflow moves only by its actions) and `org head doc " +
        "remove` (Frappe's Delete, for a draft or a document that is never submitted: a flow that previews); two that " +
        "say what can be reached, `org head doctype list|get` (Frappe's meta: fields, child tables, Workflow, the member's " +
        "rights, and why a DocType is not reached); and `org head doc-call list`, the log. Left out: a count (a list pages), " +
        "copy (create and amend cover it), bulk writes (each document is its own authorised, logged call), whitelisted " +
        "methods (they write any DocType, a native or a money one, around the family's guard; a head capability that " +
        "needs one is designed as its own command), and files and comments (Frappe's core module is native).",
    },
    { label: "six-only", text: "Exactly the six commands of the ruling." },
    { label: "rest-proxy", text: "One command that passes any path and body to the head's REST API." },
  ],
  chosen: "six-and-what-frappe-needs",
  why:
    "A pack under rules.new-operations, serving aaron.sdk-reaches-everything; For Aaron: the twelve stand until he " +
    "answers. The six alone cannot finish what Frappe starts: a cancelled document is corrected only by Amend, a " +
    "DocType with an active Workflow moves through its actions, whose transitions carry the roles, conditions and " +
    "self-approval rule the head's approvals are made of, and a draft made in error can only be deleted, since Frappe " +
    "cancels only what was submitted. Frappe's desk offers a Workflow's document only its actions, but its server does " +
    "not refuse a direct submit or cancel: validate_workflow checks only a changed state, and set_workflow_state_on_action " +
    "then sets the state the Workflow gives that docstatus, so the Capxul app refuses `org head doc submit` and `cancel` " +
    "under an active Workflow itself, as the desk does, and `apply` is the only way through. An agent or a program " +
    "using the SDK must also learn what a DocType takes before it writes, which " +
    "is Frappe's meta. A REST proxy would hand the head's whole API, its methods included, to every caller around the " +
    "guards the ruling asks for. Every family command is `vendor` (G8: it calls the head before it answers), " +
    "`normal` priority (no pilot and no start-up runs one), area `organizations`, implemented by its rpc except " +
    "`org head doc remove`, a flow because it previews (G5). The React SDK does not mirror the family: it is the Core SDK's " +
    "and the CLI's (the ruling draws the line there). The head's two methods, `docRead` and `docWrite`, are the " +
    "`frappe-head` integration's (shared/external.ts) and the Capxul app's to serve (component frappe-app).",
  source: worldBy("books/target/shared/rulings.ts (aaron.sdk-reaches-everything, aaron.frappe-head); /tmp/frappe/frappe/api/v2.py; /tmp/frappe/frappe/model/workflow.py"),
  affects: [
    ...DOC_RPCS, rpc_organizations_doc_calls_list, flow_client_org_head_docs_remove, table_org_doc_calls, ...DOC_OPERATIONS,
    integration_frappe_head, component_frappe_app, system_capxul,
  ],
});

export const decision_organizations_doc_reach = defineDecision({
  id: "organizations.doc-reach",
  title: "The family never reaches a native DocType, money, or the head's machinery",
  question:
    "The ruling refuses the family 'for any DocType a native concept owns (those have their own commands) and for money " +
    "(Capxul is the system of record)'. Which DocTypes are those, and who decides, Capxul or the head?",
  options: [
    {
      label: "lists-and-hooks",
      text:
        "Four refusals, all INVALID_INPUT with the reason. Native: every DocType of a native app's modules (`org-apps`' " +
        "`modules`: Frappe's core, ERPNext's accounts and projects, Frappe HR's payroll, Frappe CRM's FCRM), naming " +
        "that module's commands (NATIVE_MODULE_COMMANDS), and each DocType a native concept holds elsewhere " +
        "(NATIVE_DOCTYPES: Company, Department, Employee, Customer, Supplier, Contact, Address, Currency, payroll.hr-" +
        "scope's native HR DocTypes and HR Settings, the WhatsApp app's WA Account and WA Message, and the CRM's email, " +
        "Communication), naming the " +
        "commands that reach it. Money: any DocType the head's installed apps list in LEDGER_HOOKS " +
        "(`accounting_dimension_doctypes`, `period_closing_doctypes`, the advance-payment, bank-reconciliation, " +
        "audit-trail and repost-allowed lists, merged as frappe.get_hooks merges them) and their child tables; the " +
        "DocTypes that post or re-post the ledger though no hook lists them (LEDGER_UNHOOKED: ERPNext's Repost Item " +
        "Valuation); and every DocType of a money module (MONEY_MODULES: Frappe Lending's Loan Management). Machinery: " +
        "HEAD_MACHINERY, what changes who may do what on the head or what a DocType is, runs code there, moves data in " +
        "bulk, lets someone with no User write, holds sign-in or outside credentials, or sends through the head's own " +
        "channels. Child tables: reached only through their parent. Capxul refuses the named lists before any call; the " +
        "Capxul app refuses by module and hooks, which only the head knows.",
    },
    { label: "allowlist", text: "Reach only a list of head-only DocTypes Capxul names (recruitment, appraisal, training, onboarding)." },
    { label: "drafts-of-money", text: "As lists-and-hooks, but let money DocTypes be read and kept as drafts, refusing only their submit." },
  ],
  chosen: "lists-and-hooks",
  why:
    "Native is a fact of Capxul's book, so Capxul's own list says it, before the head is called; a module's DocTypes " +
    "change with each Frappe release, so the app reads them from the head's meta. Money cannot be listed once: an app " +
    "installed later brings its own, and the apps declare most of what posts in these hooks (ERPNext's Stock Entry, " +
    "Delivery Note, Purchase Receipt, Landed Cost Voucher and Asset; the Sales and Purchase Orders that take advances; " +
    "Frappe HR's Expense Claim, Payroll Entry, Leave Encashment and Gratuity), so the rule follows the apps. Not all, " +
    "as reading every posting controller showed: ERPNext's Repost Item Valuation, which the Books hat's Accounts " +
    "Manager may submit, rewrites past vouchers' ledger entries, and Frappe Lending (in HEAD_APPS) posts from Loan " +
    "Accrual Repost, Loan Repayment Repost, Loan Transfer and Process Loan Accounting, listed in none of its hooks; so " +
    "Capxul names the first, takes Loan Management as money whole, and a lane that finds another adds it. An " +
    "allowlist fails 'everything' the day a customer installs Helpdesk. The machinery is refused " +
    "because identity is Capxul's (organizations.head-ownership) and each item reaches native or money records, or " +
    "the world's channels (aaron.world-clock), around the guard: a Custom Field, Property Setter or Workflow changes " +
    "how a native DocType behaves, a Notification sends and sets fields on any document, a Web Form lets someone with " +
    "no User write, and the rest run code, move data in bulk or hold sign-in and credentials; Frappe's core module " +
    "(Server Script, User, Role, Data Import) is native anyway. For Aaron: " +
    "stock, selling and buying documents post to the ledger, so they are money here and are worked in the head's own " +
    "desk (books copies their vouchers, books.head-vouchers); drafts-of-money would let the SDK prepare them. " +
    "NATIVE_DOCTYPES' HR rows are payroll.hr-scope's, and its WhatsApp rows the real app's WA Account and WA Message.",
  source: worldBy(
    "erpnext and hrms hooks.py; erpnext stock/repost_item_valuation; frappe/lending hooks.py, loan_management; " +
      "frappe@1a7ea577 custom, workflow, email, website; frappe/whatsapp WA Account; payroll.hr-scope",
  ),
  affects: [...DOC_RPCS, table_org_apps, integration_frappe_head, component_frappe_app, concept_books, concept_contacts],
});

export const decision_organizations_doc_authority = defineDecision({
  id: "organizations.doc-authority",
  title: "A family call runs on the head as the member's own User; the head decides",
  question:
    "The ruling: 'the caller's authority mapped (a member's hats to the head's roles; a head user matched by mailbox)'. " +
    "As whom does a family call run on the head, and whose rules decide it?",
  options: [
    {
      label: "as-own-user",
      text:
        "Capxul's backend calls the Capxul app with the connection's key, the member's mailbox and member id, and the " +
        "roles the member's hats give at that moment (indexing's wearers, read at the call, mapped as " +
        "organizations.head-users maps them); the app finds the enabled User carrying that `capxul_id` at that mailbox " +
        "(pushed by organizations.head-users), first brings that User's Capxul-held roles to that set where they differ, " +
        "as the next push would, and runs the call as that User (`frappe.set_user`), so Frappe's own role permissions, " +
        "user permissions, permission query conditions, field levels and validations decide, as in its desk. A missing " +
        "or disabled User is ROLE_PERMISSION_DENIED. Only a person member has a User: an agent's own call is refused, and " +
        "the hosted FDE acts as its asker's User (organizations.fde-for-the-asker). A guest has no Seat and is refused.",
    },
    { label: "connection-user", text: "Every call runs as the connection's own head user, and Capxul checks the member's hats itself." },
    { label: "hats-only", text: "Capxul maps each DocType to a hat and checks it; the head is called as the connection's user." },
  ],
  chosen: "as-own-user",
  why:
    "These documents are the head's (organizations.head-ownership: every other app's documents are the head's), so the " +
    "head's own rules are the authority over them, and running as the member's User applies exactly those rules with " +
    "nothing copied into Capxul. The roles that User holds are the hats' (People gives HR Manager, which Frappe HR's " +
    "recruitment, training and onboarding DocTypes grant nearly everything; an Appraisal's cancel and amend are HR " +
    "User's alone, and a Workflow's actions only its transitions' roles, which Frappe never inherits from another), " +
    "plus any the head's administrator gave it, " +
    "which the head trusts for its own documents; they still never authorise a pulled edit of Capxul's records. The " +
    "hats' roles are set at each call because authority follows the hat at that moment (docs/design/authority.md: a " +
    "person swapped out loses it), and the push alone runs up to a day behind a hat, which a pulled edit survives " +
    "(Capxul judges it again) but a family call would not (the head alone decides it). Running " +
    "as the connection's user would give every member the connection's rights, and a Capxul map of every DocType of " +
    "every app to a hat would be a second permission model that drifts from the head's. Matching by mailbox and member " +
    "id keeps a head administrator's User of the same email from standing in for a member. Agents have no User because " +
    "Frappe keys a User by email (organizations.head-users); an agent works through native commands.",
  source: worldBy("/tmp/frappe/frappe/client.py; /tmp/hrms/hrms/hr/doctype/job_opening/job_opening.json (HR User, HR Manager); organizations.head-users"),
  affects: [...DOC_RPCS, integration_frappe_head, component_frappe_app, table_org_members],
});

export const decision_organizations_doc_log = defineDecision({
  id: "organizations.doc-log",
  title: "Every family call is logged once, by its call id, on the world's clock",
  question: "The ruling says the family is 'logged'. What is logged, when, who reads it, and how does a retry stay one call?",
  options: [
    {
      label: "every-call",
      text:
        "`org-doc-calls`: one row per call, read or write, done or refused, written in one transaction after the head " +
        "answers or Capxul refuses: whose authority (the member, or the FDE's asker with the ask), the head User, the " +
        "verb, the DocType and name, the outcome and code, field and filter names but never values, the count, the " +
        "head's `modified` and docstatus after a write, and `at`, the world's now. The SDK method makes the call id once " +
        "and repeats it on a retry: a logged id answers as logged, and the Capxul app answers a write it already applied " +
        "under that id as the first time. A call the head did not answer (PROVIDER_ERROR, RATE_LIMITED) is logged " +
        "refused but is the one row that may change, once: a retry under its id calls the head again, and the row " +
        "records what the head then answers, with `completed_at`. `org head doc-call list`: a Director reads every call, any " +
        "other member their own.",
    },
    { label: "writes-only", text: "Log only writes; reads appear in traces." },
    { label: "head-versions", text: "Log nothing in Capxul: Frappe's Version and Activity Log already record changes." },
  ],
  chosen: "every-call",
  why:
    "Reads are logged too because the hosted FDE now reads for anyone (aaron.fde-anyone), and an Organization must be " +
    "able to see what was read from its HR records and for whom; Frappe's Version records changes, not reads, and " +
    "lives on a head that may be disconnected. Names but never values keep Capxul from copying the head's documents " +
    "(organizations.head-ownership). One call id per invocation makes a create after a lost answer one document, " +
    "which Frappe's insert alone is not. Logging after the answer, as the FDE's ask does, keeps each rpc to one " +
    "transaction; a crash between the head's write and the log leaves the write unlogged until the SDK's retry, " +
    "which the app answers from its record of the call id. A lost answer is the same case seen from the other side: " +
    "the head may have applied the write, so a PROVIDER_ERROR row that answered every retry as logged would record a " +
    "write as refused for good and leave the SDK's retry unable to learn the document it made; completing that one " +
    "row keeps the log true and the write once. A Director governs, so reads every call; anyone else sees " +
    "what was done with their own authority. `at` is the world's now (aaron.world-clock), and the head stamps its own " +
    "documents with its now, which follows the same clock (organizations.head-clock).",
  source: worldBy("books/target/shared/rulings.ts (aaron.sdk-reaches-everything, aaron.world-clock); organizations.fde-commands (the ask is logged after the host answers)"),
  affects: [table_org_doc_calls, rpc_organizations_doc_calls_list, operation_org_head_doc_call_list, ...DOC_RPCS, component_core_sdk, component_frappe_app],
});

export const decision_organizations_doc_worlds = defineDecision({
  id: "organizations.doc-worlds",
  title: "Worlds for the family and for anyone asking the FDE: head documents, guests",
  question: "Which worlds do the document family's and the FDE commands' claims and refusals start from?",
  options: [
    {
      label: "reuse-and-five",
      text:
        "Reuse signed-out, org-with-member (no head), org-with-head, org-with-fde, org-with-fde-paused, " +
        "org-with-fde-host-down and org-with-fde-allowance. Ask devnet for five: org-with-head-docs (org-with-head plus, " +
        "on the stand-in head, a Designation Accountant; Job Openings HR-OPN-2026-0001 and -0002, both Open, -0002 made " +
        "a second after -0001 so their `modified` differ; Training Events `Onboarding week` (draft), `Safety training` " +
        "(submitted, with an employee row) and `Old induction` (cancelled); a Job Applicant named, as Frappe HR names " +
        "one, by its email, kim@applicants.test, under a Workflow `Applicant Review`, Open to Shortlisted (Shortlist) or " +
        "Rejected (Reject), Shortlisted to Accepted (Accept), its transitions allowed to HR Manager, the role the People " +
        "hat gives Dana's User (organizations.head-users), not HR User, which no hat gives; Sam's User with no HR " +
        "role; the meta's modules, Project in ERPNext's projects; ERPNext's ledger hooks naming Stock Entry), " +
        "org-with-head-down (org-with-head with the stand-in head's " +
        "fault switch down), org-with-fde-member (org-with-fde plus Sam's Seat with no hat and Olga ready outside) and " +
        "org-with-fde-guest (org-with-fde-member with Olga named a guest by Dana, note `Our accountant`), and " +
        "org-with-fde-head-docs (org-with-fde-member with the stand-in head connected by Dana and holding " +
        "org-with-head-docs' documents).",
    },
    { label: "real-bench", text: "Run every family claim against a real bench with Frappe HR, booted as a follower." },
  ],
  chosen: "reuse-and-five",
  why:
    "Each refusal needs a state no catalogued world holds: head documents in each docstatus and a Workflow, a head " +
    "that stops answering after it connected, an FDE with a member who wears no hat, and a named guest. The stand-in " +
    "head must then answer `docRead` and `docWrite` for its documents: Frappe's docstatus rules (submit a draft, " +
    "cancel a submitted one, amend a cancelled one, never delete a submitted one), the fixture DocTypes' role " +
    "permissions, their mandatory fields, the Workflow's transitions, the ledger hooks, and a call id it already " +
    "applied. A real bench (devnet.head-stand-in's escape hatch) stays for a claim that needs Frappe's own validations; " +
    "none of these does. Two facts of the real systems shape the claims. The stand-in host ends a turn as it is " +
    "posted, and an ask closes once its turn is read ended, which `org fde ask` does before it returns; so a claim " +
    "that runs the FDE's commands under an ask holds turns first (`capxul-devnet fault fde-host hold`) and asks with " +
    "`--timeout-seconds 1`, whose CLI_DEADLINE answer gives the ask's id and leaves it open, then runs them with " +
    "`capxul-devnet fde run <org> --ask <askId> --`, which devnet adds to its stand-in host. And the head stamps " +
    "`modified` with the world's now, so on a frozen clock two writes at one instant share a stamp and Frappe's " +
    "timestamp check cannot tell them apart: the `--modified` claim warps between the two writes. For the devnet " +
    "designer: these worlds, the stand-in head's family methods and its `drop-answer` fault (the first answer held " +
    "back once, after the write), and `fde run --ask`.",
  source: worldBy(
    "devnet worlds.ts; devnet.head-stand-in; devnet.fde-host-stand-in; hrms job_applicant.py (autoname); " +
      "frappe workflow.py (get_transitions); document.py (check_if_latest)",
  ),
  affects: [...DOC_OPERATIONS, concept_devnet],
});

/** The fifteen commands surface.head-group moves under `org head`. */
const HEAD_GROUP_OPERATIONS = [operation_org_head_app_list, operation_org_head_app_add, operation_org_head_app_remove, ...DOC_OPERATIONS];

export const decision_organizations_head_group = defineDecision({
  id: "organizations.head-group",
  title: "The head's apps, documents, DocTypes and call log are spelt under `org head`",
  question:
    "Aaron, 9 November 2026: 'The number was not the issue. We need everything you can do on Frappe to be programmatic " +
    "and accessible from our tooling. It's the logical groupings.' surface.head-group puts the Frappe site's commands " +
    "in one group, `org head`. How does organizations apply it to the fifteen commands it booked under `org app`, " +
    "`org doc`, `org doctype` and `org doc-call`?",
  options: [
    {
      label: "spelling-only",
      text:
        "Rename each command, its id and its export to the tree's words, its SDK method and flow with them, and change " +
        "no behaviour, claim or refusal but the commands they quote. `org app list|add|remove` becomes `org head app " +
        "list|add|remove` (ids org.head.app.*); `org doc list|get|create|change|submit|cancel|amend|apply|remove` " +
        "becomes `org head doc …` (org.head.doc.*); `org doctype list|get` becomes `org head doctype list|get` " +
        "(org.head.doctype.*); `org doc-call list` becomes `org head doc-call list` (org.head.doc-call.list). Every SDK " +
        "method gains `.head` (`client.org(orgId).head.apps.list`, `.head.docs.get`, `.head.doctypes.list`, " +
        "`.head.docCalls.list`), so the flow client.org.docs.remove becomes client.org.head.docs.remove. The commands " +
        "a refusal names follow the tree as well: NATIVE_DOCTYPES and NATIVE_MODULE_COMMANDS now name `org hr " +
        "employee`, `hr leave` and `org hr leave`, `org projects`, `org projects task` and `org projects timesheet`, and " +
        "the rest of HR's and payroll's new words.",
    },
    { label: "alias", text: "Book the tree's spelling beside the old one, both answering." },
    { label: "as-booked", text: "Keep the four nouns as booked (surface.head-group's own as-booked option)." },
  ],
  chosen: "spelling-only",
  why:
    "All fifteen are operations beyond the 215 (rules.new-operations), so each id is its command's words and moves " +
    "with them, and no command of the 215 is renamed. An alias gives one capability two commands, which rule 4a " +
    "forbids (a command is no other operation's). The rpcs keep their ids (`organizations.docs.*`), which name the " +
    "concept's area, not a command. Where a decision quotes Aaron or a question as it was asked, the quotation keeps " +
    "its words. What reaches what does not change: organizations.doc-reach stays as accepted until Aaron answers " +
    "question 52 (surface.frappe-reach). The commands still serve aaron.frappe-head (apps) and " +
    "aaron.sdk-reaches-everything (the document family).",
  source: surfaceBy("surface.tree; surface.head-group; docs/design/command-surface.md 4, 5.2, 9; aaron.frappe-head; aaron.sdk-reaches-everything"),
  affects: [...HEAD_GROUP_OPERATIONS, flow_client_org_head_docs_remove, table_org_doc_calls, component_core_sdk],
});

export const decision_organizations_head_claims = defineDecision({
  id: "organizations.head-claims",
  title: "Each head command claims what it really does: its answer, its writes, a retry",
  question:
    "Five of organizations' commands beyond the 215 carried one acceptance claim each: `org head show`, `org head doc " +
    "submit`, `org head doc amend`, `org head doctype list` and `org fde guest list`. Which further claims does each " +
    "behaviour already booked have, observable through the CLI from a catalogued world?",
  options: [
    {
      label: "what-the-rpc-does",
      text:
        "Claim what each one's rpc already books, and nothing else. `org head show`: the apps as the head runs them; it " +
        "reads only Capxul's rows, so it answers while the head is down; failing at the daily check that fails and " +
        "connected at the next good one (organizations.heads.watch's `stall` and `recover`); `rungAt` on the world's " +
        "clock (organizations.heads.ring). `org head doc submit`: the head User and the world's clock in its log row; a " +
        "DocType that is never submitted refused; a retry under the same call id submits once (organizations.doc-log). " +
        "`org head doc amend`: the amendment is a draft to submit, the original stays cancelled; an amendment's " +
        "amendment is `-2`; a retry amends once. `org head doctype list`: `--module`, and a native module naming its " +
        "commands; no child table; paging by name; the call logged. `org fde guest list`: removed guests after active, " +
        "`--status`, paging, no write.",
    },
    { label: "one-each", text: "Keep one claim each: the success path is enough for a read or a single write." },
  ],
  chosen: "what-the-rpc-does",
  why:
    "A claim is an eval, and one claim leaves the rest of a command's booked behaviour untested: what it answers, what " +
    "it changes and what a retry does. Each added claim restates a sentence of its rpc's or process's about, from a " +
    "world the catalog holds (org-with-head, org-with-head-down, org-with-head-docs, org-with-fde-guest) and never an " +
    "invented behaviour. Two were left out as unsure: a submit under an active Workflow (the world's only Workflow " +
    "runs on Job Applicant, which Frappe HR does not submit, so the refusal it would meet first is not booked), and " +
    "amending one cancelled document twice (Frappe would name both amendments `-1`). For the devnet designer: the " +
    "stand-in head's metas need Job Opening not submittable (hrms@8816102: no is_submittable) and Training Event " +
    "Employee a child table of Training Event (istable), Project in module Projects, and its daily check to fail " +
    "while its fault switch is down. Truth review, 9 November 2026: two more for devnet. The stand-in names an amendment of an " +
    "amendment by Frappe's Amend Counter (`Old induction-1` amended is `Old induction-2`, frappe@1a7ea57 naming.py " +
    "`_set_amended_name`), not `<name>-1` again. The world's Training Events carry hrms' mandatory fields (event_status, " +
    "type, location, start_time before end_time, introduction: training_event.json, `validate_period`), since the " +
    "submit and amend claims submit them through the family, which checks them. Here: the per-app versions `org head " +
    "show` prints are the head connection's process's `check` step's, now booked there. `org head show`'s failing " +
    "claim reads the stall's issue `at`, which the stall records, rather than `checkedAt`; the amend retry reads the " +
    "one document amended from `Old induction`.",
  source: surfaceBy("heads.ts, docs.ts, fde.ts, organizations.heads.watch; devnet worlds.ts; hrms@8816102 job_opening, training_event(_employee); frappe@1a7ea57 naming.py, document.py"),
  affects: [
    operation_org_head_show, operation_org_head_doc_submit, operation_org_head_doc_amend, operation_org_head_doctype_list,
    concept_devnet,
  ],
});

export const decision_organizations_reach_holes = defineDecision({
  id: "organizations.reach-holes",
  title: "Four holes in the family's guard, closed by its own accepted tests",
  question:
    "Reading every DocType of erpnext@6b946b0, hrms@8816102 and crm@2cecd30 against organizations.doc-reach " +
    "(docs/design/command-surface.md section 7.6) found what the accepted guard reaches though its own tests say it " +
    "should not, or leaves unclear: Transaction Deletion Record, which deletes every transaction of a Company and is " +
    "in no hook; SMS Center, Email Digest, Newsletter and Auto Email Report, which exist to send through the head's own " +
    "mail or SMS; a child table a hook lists under a parent it does not (Material Request Item, Request for Quotation " +
    "Item, Asset Movement Item); and Frappe HR documents that write native HR records on submit. Which does " +
    "organizations close, and how, while Aaron's question 52 is open?",
  options: [
    {
      label: "by-the-accepted-tests",
      text:
        "Close each by the test organizations.doc-reach already applies, and change nothing else. Transaction Deletion " +
        "Record joins LEDGER_UNHOOKED: it rewrites the ledger though no hook says so, as Repost Item Valuation does. The " +
        "four senders join HEAD_MACHINERY, which already refuses what sends through a channel of the head's own " +
        "(Notification). A hooked child makes no money of its parent: the parent is judged by its own listing, and the " +
        "child is reached only through it, so Material Request, Request for Quotation and Asset Movement stay reached. " +
        "The HR documents are payroll's to answer (refuse them, or have payroll.hr-head-sync take in what they write): " +
        "NATIVE_DOCTYPES gains them only when payroll asks.",
    },
    { label: "parent-as-money", text: "As by-the-accepted-tests, but a hooked child makes its parent money too." },
    { label: "wait", text: "Change nothing until Aaron answers question 52." },
  ],
  chosen: "by-the-accepted-tests",
  why:
    "Each fix applies the accepted rule to a DocType it missed, and the rule itself says a lane that finds another " +
    "unhooked writer of the ledger adds it. Transaction Deletion Record, submitted, deletes the Company's GL and stock " +
    "entries with its transactions, which is re-posting the ledger at its widest; under question 52's recommendation it " +
    "is refused as moving money too, so either answer refuses it. The senders are the channel case Notification " +
    "already is, and a world's channels are its own (aaron.world-clock, time.world-channels). The parents post nothing " +
    "(read in erpnext@6b946b0: Material Request updates requested quantities, Request for Quotation emails its " +
    "suppliers through the head's mail, which a world keeps in its sink, and Asset Movement sets an Asset's location " +
    "and custodian); `accounting_dimension_doctypes` lists their items because the items carry dimension fields that " +
    "post only when a listed document takes them up. parent-as-money would refuse three documents that move no money, " +
    "against the 9 November ruling; waiting would leave a Company's ledger deletable through the family. " +
    "surface.frappe-reach's wider narrowing is not applied here: organizations.doc-reach stays as accepted until Aaron " +
    "answers question 52.",
  source: surfaceBy("erpnext@6b946b0 hooks.py and the seven DocTypes named; frappe@1a7ea577 auto_email_report; command-surface.md 7.6; organizations.doc-reach"),
  affects: [...DOC_RPCS, ...DOC_OPERATIONS, component_frappe_app, integration_frappe_head],
});

export const decision_organizations_head_fit = defineDecision({
  id: "organizations.head-fit",
  title: "A refusal names the record's group and both sides; the FDE reads as its asker",
  question:
    "Fit review of the surface pass (9 November 2026; Aaron: 'It's the logical groupings'). After the rename, the " +
    "commands the family's refusals name still followed the old nouns' pairing, not the tree's groups: the Payroll " +
    "module named `org payroll` and `org hr employee`, Projects three of its group's records, and two HR rows only one " +
    "side. The org-apps index said `org show` lists the installed apps, and `org fde guest list`'s first claim promised " +
    "the order and the paging its two new claims prove, while its about never named `--status`. And the who of every " +
    "member read (`org head show`, `org head app list`, `org fde show`, `org fde guest list`, `org seats show`) said " +
    "'the FDE included', though the hosted FDE never acts as itself. What should each say?",
  options: [
    {
      label: "by-group",
      text:
        "Each pointer names the record's group, with the person's side where one has it, as surface.hr-group places HR. " +
        "Payroll module: `org payroll` and `payroll`, and `org hr advance settle` for an advance's Additional Salary. " +
        "Projects module: `org projects`, with its `member`, `settings`, `task`, `timesheet`, `activity-type` and " +
        "`project-type`. Leave Allocation adds `hr leave balance`; Employee Checkin names `hr attendance checkin` and " +
        "`list`. `org head doctype list`'s claim names both sides of Leave Application and Expense Claim, as the refusal " +
        "does. The index names `org head show`. The guest list's first claim says what its evidence shows (the note and " +
        "who named them), and its about names `--status active|removed` and the paging. A member read's who says the " +
        "hosted FDE reads only as the member who asked it, and a self-run own agent as itself.",
    },
    { label: "as-renamed", text: "Keep the pointers as the rename left them: the old pairs with the new words." },
  ],
  chosen: "by-group",
  why:
    "Employee is ERPNext Setup's (erpnext@6b946b0 employee.json: module Setup), not the Payroll module's, and has its " +
    "own NATIVE_DOCTYPES row naming `org hr employee`. Naming it for the Payroll module sent a Frappe reader asking " +
    "after Salary Slip or Employee Incentive to HR, and left out the person's side (`payroll payslip`, `payroll " +
    "agreement`), while every two-sided HR row names both. The one Payroll-module DocType a command outside the " +
    "payroll group writes is an advance's Additional Salary (payroll.advance-recovery). Projects is one group now, so " +
    "all of it is under " +
    "`org projects`, Activity Type and Project Type included. `hr leave balance` reads Leave Allocations, and `hr " +
    "attendance list` prints your check-ins (payroll's operations). `org show` runs client.org.setup.get, which never " +
    "reads org-apps; `org head show` and `org head app list` do. A claim's title is what its evidence proves, so the " +
    "title no longer repeats what claims 2 and 3 prove. docs/design/authority.md: 'A call with no live token is " +
    "refused, so the hosted FDE never acts as itself', which MEMBER_GUARD already does; only the who said otherwise. " +
    "Text only: no rpc, guard, refusal code or behaviour changes.",
  source: surfaceBy(
    "command-surface.md 3, 4; erpnext@6b946b0 setup/doctype/employee/employee.json; hrms@8816102 payroll/doctype; " +
      "payroll operations hr.leave.balance, hr.attendance.list; organizations flows client.org.setup.get; organizations.fde-guests.list",
  ),
  affects: [
    ...DOC_RPCS, operation_org_head_doctype_list, table_org_apps, operation_org_head_show,
    operation_org_head_app_list, operation_org_seats_show, rpc_organizations_apps_list,
    rpc_organizations_seats_show, 
  ],
});

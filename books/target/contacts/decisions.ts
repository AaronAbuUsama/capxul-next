// Every judgment the contacts design makes, as a decision record. Made by Claude on 8 November 2026
// under A1-A4 and P1-P10, with the old code (/home/user/factory, integration/factory: old parties'
// contacts area and the CLI's contact commands) and the frozen book as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_contacts, concept_parties } from "../shared/foundation.ts";
import { machine_org_head, table_org_deployments, table_org_heads, table_org_members } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import {
  event_contact_transitioned,
  event_deal_transitioned,
  event_lead_transitioned,
  machine_contact,
  machine_deal,
  machine_lead,
  table_contact_changes,
  table_contact_head_syncs,
  table_contacts,
  table_crm_settings,
  table_deal_contacts,
  table_deals,
  table_leads,
} from "./data.ts";
import { workflow_contacts_head_sync, workflow_contacts_mail_thread, workflow_contacts_whatsapp_account } from "./processes.ts";
import {
  machine_communication,
  machine_crm_task,
  machine_inbound_mail,
  machine_wa_account,
  machine_wa_message,
  table_communications,
  table_crm_call_logs,
  table_crm_notes,
  table_crm_tasks,
  table_inbound_mails,
  table_timeline_links,
  table_wa_accounts,
  table_wa_messages,
} from "./data.ts";
import { rpc_contacts_timeline_list } from "./timeline.ts";
import { rpc_contacts_mail_receive, rpc_contacts_mail_send } from "./mail.ts";
import {
  rpc_contacts_whatsapp_connect,
  rpc_contacts_whatsapp_disconnect,
  rpc_contacts_whatsapp_receive,
  rpc_contacts_whatsapp_send,
  rpc_contacts_whatsapp_show,
} from "./whatsapp.ts";
import { rpc_contacts_notes_save } from "./notes.ts";
import { rpc_contacts_tasks_list, rpc_contacts_tasks_move, rpc_contacts_tasks_save } from "./tasks.ts";
import { rpc_contacts_calls_log } from "./calls.ts";
import { integration_mail, integration_whatsapp } from "../shared/external.ts";
import { table_chain_payments, table_escrows } from "../indexing/data.ts";
import {
  rpc_contacts_book_add,
  rpc_contacts_book_get,
  rpc_contacts_book_hide,
  rpc_contacts_book_label,
  rpc_contacts_book_list,
  rpc_contacts_book_record,
  rpc_contacts_book_unhide,
} from "./book.ts";
import {
  rpc_contacts_leads_convert,
  rpc_contacts_leads_get,
  rpc_contacts_leads_list,
  rpc_contacts_leads_move,
  rpc_contacts_leads_save,
} from "./leads.ts";
import { rpc_contacts_deals_get, rpc_contacts_deals_list, rpc_contacts_deals_move, rpc_contacts_deals_save } from "./deals.ts";
import {
  flow_client_account_address_book_change,
  flow_client_account_address_book_create,
  flow_client_account_address_book_hide,
  flow_client_account_address_book_label,
  flow_client_account_address_book_link,
  flow_client_account_address_book_unhide,
  flow_client_org_crm_deals_change,
  flow_client_org_crm_deals_create,
  flow_client_org_crm_deals_get,
  flow_client_org_crm_deals_list,
  flow_client_org_crm_deals_move,
  flow_client_org_crm_leads_change,
  flow_client_org_crm_leads_convert,
  flow_client_org_crm_leads_create,
  flow_client_org_crm_leads_get,
  flow_client_org_crm_leads_list,
  flow_client_org_crm_leads_move,
  flow_client_org_crm_emails_send,
  flow_client_org_crm_notes_add,
  flow_client_org_crm_notes_change,
  flow_client_org_crm_tasks_change,
  flow_client_org_crm_tasks_create,
  flow_client_org_crm_whatsapp_connect,
  flow_client_org_crm_whatsapp_disconnect,
  flow_client_org_crm_whatsapp_send,
} from "./flows.ts";
import {
  operation_contact_add,
  operation_contact_change,
  operation_contact_create,
  operation_contact_hide,
  operation_contact_label,
  operation_contact_link,
  operation_contact_list,
  operation_contact_unhide,
  operation_org_crm_deal_change,
  operation_org_crm_deal_create,
  operation_org_crm_deal_get,
  operation_org_crm_deal_list,
  operation_org_crm_deal_move,
  operation_org_crm_lead_change,
  operation_org_crm_lead_convert,
  operation_org_crm_lead_create,
  operation_org_crm_lead_get,
  operation_org_crm_lead_list,
  operation_org_crm_lead_move,
  operation_org_crm_call_log,
  operation_org_crm_email_send,
  operation_org_crm_note_add,
  operation_org_crm_note_change,
  operation_org_crm_task_change,
  operation_org_crm_task_create,
  operation_org_crm_task_list,
  operation_org_crm_task_move,
  operation_org_crm_timeline,
  operation_org_crm_whatsapp_connect,
  operation_org_crm_whatsapp_disconnect,
  operation_org_crm_whatsapp_send,
  operation_org_crm_whatsapp_show,
} from "./operations.ts";

const CLAUDE = "Claude, contacts design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const FRAPPE_CRM = "Claude, contacts Frappe redesign (crm lane), 8 November 2026";
const crmBy = (evidence: string) => `${FRAPPE_CRM}; evidence: ${evidence}`;
const P = "packages/backend/src/parties";
/** Frappe's sources, read on 8 November 2026. */
const CRM = "frappe/crm@2cecd300 crm";

const OPERATIONS = [
  operation_contact_add, operation_contact_hide, operation_contact_label, operation_contact_list, operation_contact_unhide,
];
const WRITES = [rpc_contacts_book_add, rpc_contacts_book_label, rpc_contacts_book_hide, rpc_contacts_book_unhide];
const READS = [rpc_contacts_book_list, rpc_contacts_book_get];
const FLOWS = [
  flow_client_account_address_book_label, flow_client_account_address_book_hide, flow_client_account_address_book_unhide,
];
const LEAD_RPCS = [
  rpc_contacts_leads_save, rpc_contacts_leads_move, rpc_contacts_leads_convert, rpc_contacts_leads_list, rpc_contacts_leads_get,
];
const DEAL_RPCS = [rpc_contacts_deals_save, rpc_contacts_deals_move, rpc_contacts_deals_list, rpc_contacts_deals_get];
const CRM_RPCS = [rpc_contacts_book_record, ...LEAD_RPCS, ...DEAL_RPCS];
const CRM_WRITES = [
  rpc_contacts_book_record, rpc_contacts_leads_save, rpc_contacts_leads_move, rpc_contacts_leads_convert,
  rpc_contacts_deals_save, rpc_contacts_deals_move,
];
const BOOK_FLOWS = [
  flow_client_account_address_book_create, flow_client_account_address_book_change, flow_client_account_address_book_link,
];
const LEAD_FLOWS = [
  flow_client_org_crm_leads_create, flow_client_org_crm_leads_change, flow_client_org_crm_leads_move,
  flow_client_org_crm_leads_convert, flow_client_org_crm_leads_list, flow_client_org_crm_leads_get,
];
const DEAL_FLOWS = [
  flow_client_org_crm_deals_create, flow_client_org_crm_deals_change, flow_client_org_crm_deals_move,
  flow_client_org_crm_deals_list, flow_client_org_crm_deals_get,
];
const CRM_FLOWS = [...BOOK_FLOWS, ...LEAD_FLOWS, ...DEAL_FLOWS];
/** The CRM's fourteen commands, operations beyond the 215 (rules.new-operations, contacts.crm-capabilities). */
const BOOK_OPS = [operation_contact_create, operation_contact_change, operation_contact_link];
const LEAD_OPS = [
  operation_org_crm_lead_create, operation_org_crm_lead_change, operation_org_crm_lead_move, operation_org_crm_lead_convert,
  operation_org_crm_lead_list, operation_org_crm_lead_get,
];
const DEAL_OPS = [
  operation_org_crm_deal_create, operation_org_crm_deal_change, operation_org_crm_deal_move, operation_org_crm_deal_list,
  operation_org_crm_deal_get,
];
const CRM_OPERATIONS = [...BOOK_OPS, ...LEAD_OPS, ...DEAL_OPS];
/** The commands an Organization's start-up and its first sale need (contacts.critical-commands). */
const CRITICAL = [
  operation_contact_create, operation_org_crm_lead_create, operation_org_crm_lead_list, operation_org_crm_lead_convert,
  operation_org_crm_deal_list, operation_org_crm_deal_move,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_contacts_one_book_table = defineDecision({
  id: "contacts.one-book-table",
  title: "One contacts table per owner, an entry per Party, its id the PartyId",
  question: "How is the address book stored, now that it leaves old parties' party edges?",
  options: [
    {
      label: "owner-table",
      text:
        "One `contacts` table with tenancy `owner` (`owner_kind` person or organization, `owner_id` their tenant id), one row " +
        "per owner and entry, keyed by the entry's `contact_id`, which is the PartyId for an entry born from a Party; at " +
        "most one entry per Party in a book (`contacts-by-party`, unique).",
    },
    { label: "two-tables", text: "A person's book and an Organization's book in two tables, each with its own tenant column." },
    {
      label: "party-edges",
      text: "Keep old parties' `partyEdges`: directed edges between the owner's Party and the counterparty's, of kind contact or employed.",
    },
  ],
  chosen: "owner-table",
  why:
    "Every frozen contact command runs the same way for both books, so one table and one set of rpcs serve them, with the " +
    "`owner` tenancy P8 gives a row a person or an Organization can own. Keying by the tenant ids, not by the owner's Party, " +
    "lets the generated row-level security match the session's tenant directly. 'Every locator lands on one party-keyed " +
    "entry' is the unique `contacts-by-party` index, and every entry the frozen commands make is born from a Party, so its " +
    "id is its PartyId, as `contact add` prints. The key is the entry's own id rather than the PartyId because the book is " +
    "also an Organization's CRM, which keeps people and companies before they have a Party (contacts.private-entries). " +
    "The old edge table also held payroll's `employed` engagements and the provenance other concepts wrote; both go " +
    "(contacts.relationships). `owner_id` leads the key and the indexes with `owner_kind` second, so the two kinds' ids " +
    "never need to differ.",
  source: by(`${P}/tables.ts:153 (partyEdges, contact and employed kinds); ${P}/contacts/reads.ts:140; P8`),
  affects: [table_contacts, concept_contacts],
});

export const decision_contacts_relationships = defineDecision({
  id: "contacts.relationships",
  title: "Relationships are `manual` and `member`; last activity is the last change",
  question:
    "The old book merged how you know a counterparty from edges other concepts wrote: paid, paidBy, invoiced, invoicedBy, " +
    "member, manual and employed. Which can the target keep?",
  options: [
    {
      label: "manual-member",
      text:
        "Keep `manual` (added by hand, contacts' own) and `member` (an active Seat, read from organizations, which contacts " +
        "depends on). Drop the rest; `lastActivityAt` is the entry's last change.",
    },
    {
      label: "react-up",
      text:
        "Keep them all: contacts reacts to payments', requests' and payroll's transitions through the outbox and records " +
        "the provenance.",
    },
    {
      label: "procedures",
      text: "Keep them all: payments, requests and payroll invoke a contacts procedure in their own transactions, as old parties' `recordContactEdges` was.",
    },
  ],
  chosen: "manual-member",
  why:
    "The concept map puts contacts below payments, payroll and requests, so contacts may neither read them nor react to " +
    "their transitions (the reacting concept depends on the one that changed), and making it depend on requests would be " +
    "a cycle (requests depends on banking, which depends on contacts). They cannot write the book either: none of them " +
    "depends on contacts, and a relationship is a projection that may lag, never a money fact, so rules.procedures forbids " +
    "a procedure. No frozen acceptance line needs the dropped values: the frozen text names a `relationship` field and " +
    "says 'how you know them', and `manual` and `member` keep that meaning, so the shape is kept and its values narrowed " +
    "(a reader of the old values never sees a new one). Where someone was paid or invoiced is activity's feed. Last " +
    "activity was the last payment or invoice with them; it becomes the entry's own last change, or its member's Seat's.",
  source: by(`${P}/writes/edges.ts:26 and :125 (ensureEmployedEdge, recordContactEdges); packages/protocol/src/parties/schema.ts:43`),
  affects: [
    table_contacts, rpc_contacts_book_list, rpc_contacts_book_get, operation_contact_list, operation_contact_add,
    concept_contacts,
  ],
});

export const decision_contacts_members_derived = defineDecision({
  id: "contacts.members-derived",
  title: "An Organization's members are read from its Seats when the book is read",
  question: "How does an Organization's book show its members?",
  options: [
    {
      label: "read-time",
      text: "Each read joins the Organization's active Seats (organizations' `org-members`) to its rows, by PartyId.",
    },
    {
      label: "projection",
      text: "A contacts workflow triggered by `org_member_transitioned` copies each Seat into `contacts` as a member row.",
    },
  ],
  chosen: "read-time",
  why:
    "The Seat is the one record of membership and contacts depends on organizations, so reading it keeps one source and " +
    "no lag: when a Seat ends, the member relationship is gone on the next read, which is what `contact list` #2 claims. " +
    "A projection would be a second copy that can drift and a workflow whose only job is copying (P3). The read stays on " +
    "indexes: the book's own index and the `org_id` range of the Seats' `by_org_party`. A row is written for a member only " +
    "when the book curates it (a label or hide), and it keeps that curation if the member leaves and returns; an entry " +
    "is in the book while it is `manual` or `member`. The member's label falls back to the Party's name, never the " +
    "invitation's mailbox, which the old book showed.",
  source: by(`${P}/contacts/reads.ts:73 (accumulateMembers from orgMembers); ${P}/contacts/tests/list.test.ts:54`),
  affects: [table_org_members, table_contacts, rpc_contacts_book_list, rpc_contacts_book_get, operation_contact_list],
});

export const decision_contacts_visibility_machine = defineDecision({
  id: "contacts.visibility-machine",
  title: "Hidden or listed is the `contact` machine, with one event",
  question: "Is hiding an entry a status with named transitions, or a plain boolean?",
  options: [
    {
      label: "machine",
      text:
        "A `contact` machine on `contacts.visibility`: listed and hidden, with `hide`, `unhide` and `add_again`, each " +
        "sending `contact_transitioned`.",
    },
    { label: "boolean", text: "Keep a `hidden` boolean that hide, unhide and add set, as the old edge did." },
  ],
  chosen: "machine",
  why:
    "P7: every write to a status is a named transition, and a machine sends one event. Hidden is a status: two verbs and " +
    "contact add change it, and the old system already told its funnel about each change (`contact_relationship_changed`, " +
    "now gone with its emitter). `add_again` is separate from `unhide` because a different command takes it: adding a " +
    "hidden contact by hand lists it again, as the old add did and as `contact add`'s `hidden: false` says. Hiding a " +
    "hidden entry or unhiding a listed one is no transition and returns the entry as it is (`contact unhide` #2). Label " +
    "changes are not a status, so they send nothing. The event carries the book and the entry's id, never a label or mailbox.",
  source: by(`${P}/contacts/operations/add.ts:21; ${P}/contacts/rules.ts:43; ${P}/contacts/events.ts:66; P7`),
  affects: [machine_contact, event_contact_transitioned, rpc_contacts_book_hide, rpc_contacts_book_unhide, rpc_contacts_book_add],
});

export const decision_contacts_ref_and_label = defineDecision({
  id: "contacts.ref-and-label",
  title: "An entry's ref is its party locator; its label the owner's words or a name",
  question: "What does an entry show as `ref` and `label`, and what are a label's rules?",
  options: [
    {
      label: "party-ref",
      text:
        "`ref` is `{kind: party, partyId}` for every entry with a Party (null on a private one). `label` is the owner's " +
        "label, or the primary mailbox they typed (kept in the entry's `email_ids` when they added by email), else the " +
        "Party's display name, handle, then the entry's id. A given label is trimmed and must be 1 to 120 characters.",
    },
    { label: "typed-ref", text: "`ref` is the locator the owner typed (handle, email, address or party)." },
  ],
  chosen: "party-ref",
  why:
    "A party ref is what the money path takes and carries no custody detail; a typed address ref would print a 0x address " +
    "(`contact add` #1 forbids custody evidence on the wire, which the old test checks as no 0x address), and a typed " +
    "email ref would show a mailbox for every locator after a second add by another one. The old code returned the party " +
    "ref too. The label never falls back to a mailbox or an address: a PartyId is public (any address resolves to one), " +
    "so a mailbox fallback would turn an address into an email in two calls (`contact add` #3). An explicit empty label " +
    "on add is INVALID_INPUT, as the frozen refusal says ('the label is empty'); the old code read it as no label. That is " +
    "surface, so the book wins (P10 rung 1). The typed mailbox moved from the label to `email_ids`, Frappe Contact's own " +
    "list of mailboxes, so a label is only ever the owner's own words; it is still shown before the Party's name, so an " +
    "entry added by email with no label shows the mailbox typed, as before.",
  source: by(`${P}/contacts/rules.ts:26 and :36; ${P}/rules.ts:19; ${P}/contacts/tests/add.test.ts:25 and :147`),
  affects: [table_contacts, rpc_contacts_book_add, rpc_contacts_book_label, operation_contact_add, operation_contact_list],
});

// ── behaviour ───────────────────────────────────────────────────────────────────────────────

export const decision_contacts_resolve_in_add = defineDecision({
  id: "contacts.resolve-in-add",
  title: "contact add resolves its Party in its own transaction, through parties' door",
  question: "Adding a mailbox or an address nobody has named yet needs a Party first. Who makes it, and when?",
  options: [
    {
      label: "procedure",
      text: "`contacts.book.add` invokes `parties.resolve-recipient` in its transaction, then writes the entry; `contact add` stays one rpc.",
    },
    {
      label: "flow",
      text: "A Core SDK flow calls a parties rpc that names the Party, then `contacts.book.add` with its PartyId.",
    },
  ],
  chosen: "procedure",
  why:
    "Parties' door already has the procedure for this, and names a contact among its users: its money fact is that the " +
    "first record naming a counterparty binds it to the Safe its money routes to, so every later naming, the person's " +
    "claim and the chain views agree. Invoking it keeps `contact add` one rpc (A4) and one transaction, so a refusal " +
    "after resolution (your own Party) commits nothing, a newly named Party included: 'refused before any write' holds. " +
    "The flow would leave a named Party behind a refused add and need an rpc parties does not offer. The label is checked " +
    "before the procedure runs. One procedure from one other concept is within sys:tx-width.",
  source: by(`books/target/parties/procedures.ts (parties.resolve-recipient); ${P}/contacts/writes.ts:29 (pairByLocator)`),
  affects: [procedure_parties_resolve_recipient, rpc_contacts_book_add, operation_contact_add],
});

export const decision_contacts_guided_flows = defineDecision({
  id: "contacts.guided-flows",
  title: "get, label, hide and unhide are Core SDK flows; add and list are one rpc",
  question: "Which contact commands are one rpc and which compose several calls?",
  options: [
    {
      label: "guided-flows",
      text:
        "The commands that pick an entry and show it before acting at a terminal are flows (list, prompt, get, prompt, " +
        "write); add and list are one rpc each.",
    },
    { label: "cli-composes", text: "Every command is one rpc and the CLI reads the book and the entry itself, as the old CLI did." },
  ],
  chosen: "guided-flows",
  why:
    "A4: the CLI calls exactly one SDK method. At a terminal, label, hide and unhide read the entry for their preview " +
    "before the one write, and get, label, hide and unhide may pick from the book: that composition belongs in the SDK, " +
    "with its questions as prompt steps the host answers (a terminal, or none for a script). Given a PartyId and " +
    "`--confirm`, each flow is one call, so 'an explicit get never lists or prompts'. Add's preview shows only what was " +
    "typed and needs no read, so the CLI shows it before calling one rpc; list pages on the server. The old CLI made two " +
    "or three SDK calls per guided command.",
  source: by("apps/cli/src/commands/contact/internal/write.ts:26; contact/subcommands/get/execute.ts:21; A4"),
  affects: [...FLOWS, ...OPERATIONS],
});

export const decision_contacts_not_in_book_code = defineDecision({
  id: "contacts.not-in-book-code",
  title: "A Party outside the book is INVALID_INPUT at a terminal too",
  question: "label, hide and unhide of a Party not in the book: which code, in a script and at a terminal?",
  options: [
    { label: "invalid-input", text: "INVALID_INPUT in both modes, from the rpc or from the flow's preview read." },
    { label: "as-is", text: "CLI_USAGE at a terminal (the old CLI's own check after its preview read), INVALID_INPUT from a script." },
  ],
  chosen: "invalid-input",
  why:
    "The frozen refusals of all three say INVALID_INPUT when 'the party is not in the book', and `contact unhide` #1 says " +
    "they refuse it, with no mode. Refusal codes are surface, so the book wins (P10 rung 1); the old CLI's terminal-only " +
    "CLI_USAGE was a reviewer's finding, not a design. CLI_USAGE stays for what the CLI checks itself: a malformed id " +
    "(neither a PartyId nor a private entry's `contact_` id, which `contact list` now shows too), a missing ID or " +
    "`--confirm` in a script, an empty `--label`.",
  source: by("apps/cli/src/commands/contact/internal/write.ts:40; docs/as-is/lane-reports/review-agent.json"),
  affects: [flow_client_account_address_book_label, flow_client_account_address_book_hide, flow_client_account_address_book_unhide, operation_contact_unhide],
});

export const decision_contacts_members_write = defineDecision({
  id: "contacts.members-write",
  title: "Only the People hat edits an Organization's book; every member reads it",
  question: "Who may add, label, hide and unhide in an Organization's book?",
  options: [
    { label: "member", text: "Any active Seat, as the frozen `who` says ('a member of the Organization for its book')." },
    {
      label: "people-hat",
      text:
        "Only a member whose Safe wears the Organization's People hat (old managePeople, as old parties' `requireWriter` " +
        "checked); every member may read the book. A member without it is ROLE_PERMISSION_DENIED, nothing written.",
    },
    {
      label: "contacts-permission",
      text: "A new Capxul-side contacts permission on the Seat, granted and taken back by the People hat's wearer.",
    },
  ],
  chosen: "people-hat",
  why:
    "Aaron's ruling (aaron.contacts-permissions, 8 November 2026): 'there should be permissions for editing the contact " +
    "book. It shouldn't just be anyone can do anything.' This record had chosen `member`; it now follows the ruling. The " +
    "People hat is the permission: authority in an Organization is hats (P9), the People hat already decides who may " +
    "invite and manage members, the old code checked exactly it (`requireWriter`), and the founder wears it from setup, " +
    "so no new grant, command or table is needed; a separate permission would be a second authority system beside the " +
    "hats. Behaviour kept: an outsider is still ROLE_PERMISSION_DENIED, and every frozen claim's world still holds (in " +
    "`person-with-contacts` Dan, Acme's founder, writes its book); the frozen `who` is rewritten (a spelling of who, P10 " +
    "rung 1), and the designed refusal 'You cannot write to that book' now has its case: Rex, Acme's agent, holds a Seat " +
    "and no hat. The map needed one edge: whether a Safe wears a hat is indexing's, so contacts depends on indexing " +
    "(shared/foundation.ts, dependencies.of-contacts), and every write reads the hat's id from organizations' " +
    "deployment and its wearers from indexing's `hat-wearers`.",
  source: by(`${P}/guards.ts:41 (requireWriter, requireManager); books/target/shared/rulings.ts (aaron.contacts-permissions); contact.add.yaml (designed refusals)`),
  affects: [...WRITES, ...OPERATIONS.filter((o) => o !== operation_contact_list), concept_contacts],
});


export const decision_contacts_get_bank_accounts = defineDecision({
  id: "contacts.get-bank-accounts",
  title: "contact get's bank accounts are banking's: the operation belongs with banking",
  question:
    "`contact get` returns the bank accounts saved for the contact, which banking owns, and contacts sits below banking. " +
    "How does the operation get them?",
  options: [
    {
      label: "owner-banking",
      text:
        "Move `contact.get` to banking in OPERATION_OWNERS, as `contact.bank.add` already is: banking's flow calls " +
        "`contacts.book.get` (banking depends on contacts) and then its own masked account list for that Party.",
    },
    { label: "flow-up", text: "Contacts' flow calls banking's rpc: contacts would depend on banking, a cycle (rule 8)." },
    { label: "read-up", text: "`contacts.book.get` reads banking's table: a read-boundary problem the build refuses." },
    { label: "drop", text: "Return no bank accounts: the frozen `returns` loses `bankAccounts` (P10 rung 1)." },
  ],
  chosen: "owner-banking",
  why:
    "Only a concept above both can compose the entry and the accounts, and banking is the one above contacts that owns " +
    "the accounts; the frozen command already lives beside `contact bank add` there in spirit (it prints `bank pay`). " +
    "The other options break the concept map, the build or the frozen surface. The architecture review made the move " +
    "(shared operations.contact-get-in-banking), so contacts no longer books the operation or its flow (contacts.get-moved); " +
    "`contacts.book.list` and `contacts.book.get` stay for banking's flow to step through.",
  source: by("apps/cli/src/commands/contact/subcommands/get/execute.ts:50 (a second call, bankAccounts.list); OPERATION_OWNERS"),
  affects: [rpc_contacts_book_get, rpc_contacts_book_list, concept_contacts],
});

export const decision_contacts_server_pages = defineDecision({
  id: "contacts.server-pages",
  title: "The server pages the book with a keyset cursor",
  question: "How is `contact list --limit --after` served?",
  options: [
    {
      label: "server-keyset",
      text:
        "`contacts.book.list` takes `limit` (1 to 100, default 25) and `after`, an opaque cursor over (last change, PartyId) " +
        "bound to the book, and returns `nextCursor`.",
    },
    { label: "client-cut", text: "Return the whole book and let the CLI cut the page, as the old row and CLI did." },
  ],
  chosen: "server-keyset",
  why:
    "The frozen notes promise 25 at a time and a cursor; reading the whole book on every page grows with the book, and " +
    "P5's read budget is per call. A keyset over the book's own index answers any page in the same time. The CLI still " +
    "refuses a `--limit` out of range or a malformed `--after` with CLI_USAGE before calling, as the old CLI did; a cursor " +
    "that decodes but names another book is the rpc's INVALID_INPUT.",
  source: by("apps/cli/src/runtime/paging.ts:82; packages/backend/src/parties/contacts/operations/list.ts:21 (onePage)"),
  affects: [rpc_contacts_book_list, operation_contact_list, table_contacts],
});

export const decision_contacts_acceptance_rewrites = defineDecision({
  id: "contacts.acceptance-rewrites",
  title: "One claim rewritten: contact list #1",
  question: "Which of contacts' 19 frozen acceptance lines name a mechanism a black box cannot see?",
  options: [
    {
      label: "one",
      text:
        "Only `contact list` #1, 'A book read touches no full table scan.', rewritten as: the book lists only its own entries, " +
        "and its read time does not grow with what lies outside it.",
    },
    { label: "none", text: "Keep all 19 verbatim." },
  ],
  chosen: "one",
  why:
    "A table scan is storage: no observer sees one. What its test proved was that seeding many unrelated people does not " +
    "change the answer, and what a scan would cost is time; both are observable (the world and the trace), and the old " +
    "system passes both, since it read by index. The other 18 are outcomes: 'party-keyed' and 'derived' name what the " +
    "output shows (a PartyId, a relationship that goes with the Seat), and 'the wire carries no custody evidence' is " +
    "checked on the CLI's output.",
  source: by(`${P}/contacts/tests/list.test.ts:26; P1`),
  affects: [operation_contact_list],
});

export const decision_contacts_no_door_no_process = defineDecision({
  id: "contacts.no-door-no-process",
  title: "Contacts has no procedures, and one process: the head sync",
  question: "Does contacts need a door for other concepts or a durable process?",
  options: [
    {
      label: "none-but-sync",
      text:
        "No procedure: concepts above read `contacts` and call its rpcs from their flows; every change to an entry, lead " +
        "or deal is inside one rpc. One workflow, the CRM's sync with a connected head (contacts.head-sync), because it " +
        "waits on the head for as long as the head is connected.",
    },
    {
      label: "door",
      text: "A `contacts.add-entry` procedure for banking to add a name-only contact inside its bank account save.",
    },
  ],
  chosen: "none-but-sync",
  why:
    "A procedure needs a money fact (P4, rules.procedures); an entry is not one: if a saved bank account's contact entry " +
    "lagged or was missing, no money would move or be owned unaccounted for, since the account belongs to the Party, not " +
    "the entry; a lead or a deal is a forecast. So banking adds a contact through `contacts.book.add` (by the Party's id) " +
    "from its own flow, and reads the table to find one. Entries, leads and deals are changed only inside an rpc and " +
    "wait on nothing (rules.durable-processes), and membership is read, not copied, so nothing reacts to them. The head " +
    "sync is different: it lives as long as the connection and waits on two systems, so it is a process. Old parties' " +
    "`recordContactEdges`, `ensureEmployedEdge` and the `emitRelationshipChanged` telemetry action are not ported (P2, " +
    "P4, P7).",
  source: by(`${P}/contacts/operations/emit-relationship-changed.ts:1; ${P}/accounts/README.md:26 (a new contact needs a name)`),
  affects: [concept_contacts, table_contacts, table_leads, table_deals, rpc_contacts_book_add, workflow_contacts_head_sync],
});

export const decision_contacts_no_destinations = defineDecision({
  id: "contacts.no-destinations",
  title: "Contacts holds no receiving destinations",
  question: "Where do a contact's wallet and bank destinations live?",
  options: [
    {
      label: "elsewhere",
      text:
        "A contact's wallet is its Party's Safe (parties); its bank accounts are banking's. Old parties' " +
        "`counterpartyDestinations` and `parties.destinations.*` are not ported into contacts.",
    },
    { label: "here", text: "Keep a destinations table of wallets and bank accounts per contact in contacts." },
  ],
  chosen: "elsewhere",
  why:
    "The concept map gives old parties' destinations and resolution to parties and a contact's bank accounts to banking. " +
    "On v4 money to a Party lands in its one Safe (or the outside address itself), so a per-book wallet list would be a " +
    "second, conflicting answer to where money goes. No frozen operation reaches the old destination rows (P2), and the " +
    "old Solana clean-up and its report were one-off plumbing.",
  source: by(`${P}/tables.ts:215 (counterpartyDestinations); ${P}/README.md:3; books/target/shared/foundation.ts (concept_parties, concept_banking)`),
  affects: [concept_contacts, table_contacts],
});

export const decision_contacts_decline_is_cancelled = defineDecision({
  id: "contacts.decline-is-cancelled",
  title: "Declining a terminal preview is CANCELLED",
  question: "What does a contact command end with when the person answers no to its preview?",
  options: [
    { label: "cancelled", text: "CANCELLED (exit 130): the person stopped it and nothing was written." },
    { label: "as-is", text: "CLI_USAGE (exit 2), as the old CLI's `confirmWrite` refused with 'The write was not confirmed.'" },
  ],
  chosen: "cancelled",
  why:
    "The frozen book does not say (P10 rung 5: the old code is evidence, not specification). A decline is a person's " +
    "choice, not a usage mistake, and the shared vocabulary's CANCELLED says exactly what happened: the command stopped " +
    "before it finished and nothing was sent, as a declined approval already ends (vocabulary.drop-signer-rejected). Scripts " +
    "pass `--confirm` and never see the question, so no script's exit code changes. Other concepts' terminal previews " +
    "should end the same way.",
  source: by("apps/cli/src/commands/org/internal/write.ts:57; apps/cli/src/auth/input.ts:11 (inputRequired is CLI_USAGE)"),
  affects: [...FLOWS, operation_contact_add, operation_contact_hide, operation_contact_label, operation_contact_unhide],
});

// ── worlds and budgets ──────────────────────────────────────────────────────────────────────

export const decision_contacts_worlds = defineDecision({
  id: "contacts.worlds",
  title: "One world for every contacts refusal: person-with-contacts",
  question: "Which devnet world reaches each refusal of the contact commands (contacts' five, and banking's `contact get`)?",
  options: [
    {
      label: "person-with-contacts",
      text:
        "Ada, a signed-in person (claimed, mailbox ada@example.com), whose own book holds: Bea, a claimed person added by " +
        "handle with the label `Bea`; vendor@example.com, a provisional person added by email with no label; Cy, hidden; " +
        "two different Parties both labelled `Sam`. Zed is a claimed person in no book of Ada's. Acme is an active " +
        "Organization Ada holds no Seat in, with Seats for Dan (a person) and Rex (an agent Dan owns); Acme's book holds " +
        "Dan added by hand (`manual` and `member`) and Rex as `member` only, and an unknown handle `nobody` names no Party.",
    },
    { label: "per-refusal", text: "A separate world for each code." },
  ],
  chosen: "person-with-contacts",
  why:
    "Every refusal needs only a signed-in person with a book and an Organization outside it: INVALID_INPUT from adding " +
    "Ada herself, `nobody` or a 121-character label, or curating Zed; ROLE_PERMISSION_DENIED from `--org acme` as Ada; " +
    "CLI_USAGE from a script without `--input` or `--confirm`; NOT_AUTHENTICATED from the same world with no session. " +
    "Acme's Seats and book serve `contact list` #2 and #4 from the same snapshot (Dan acting, then Rex removed on chain).",
  source: by("books/frozen/operations.ts (contact.* refusals and acceptance)"),
  affects: OPERATIONS,
});

export const decision_contacts_budgets = defineDecision({
  id: "contacts.budgets",
  title: "Class budgets, and one override for the guided commands",
  question: "Which budget does each contacts record take?",
  options: [
    {
      label: "class-with-guided",
      text:
        "Reads `read`, writes `write`, the CRM's included; the guided get, label, hide, unhide and link (flow and operation) " +
        "allow a second call in sequence: read 800/1,600 ms, write 900/1,900 ms, excluding `wait.person`.",
    },
    { label: "class-only", text: "Class defaults everywhere, the guided path included." },
  ],
  chosen: "class-with-guided",
  why:
    "No contacts rpc calls the chain, the bundler or a vendor, so `read` and `write` fit (P5). At a terminal the guided " +
    "commands make a second call before their one read or write (the picker's list, the preview's read), which the class " +
    "default does not allow for. The person's picking and answering are `wait.person` spans and never system time. A " +
    "script's run of the same flow makes one call and stays well inside the override.",
  source: by("packages/book/src/budgets.ts; P5; P6 (wait.person for prompt steps)"),
  affects: [
    ...FLOWS, operation_contact_label, operation_contact_hide, operation_contact_unhide, ...READS, ...WRITES, ...CRM_RPCS,
    ...CRM_FLOWS, ...CRM_OPERATIONS,
  ],
});

// ── assembly ────────────────────────────────────────────────────────────────────────────────

export const decision_contacts_get_moved = defineDecision({
  id: "contacts.get-moved",
  title: "`contact get` leaves contacts: banking books it over contacts' rpcs",
  question:
    "OPERATION_OWNERS now gives `contact.get` to banking (shared operations.contact-get-in-banking). Contacts still booked " +
    "the operation and its flow `client.account.address-book.get`. What stays in contacts?",
  options: [
    {
      label: "drop-both",
      text:
        "Remove the operation and its flow; keep `contacts.book.list` (the picker) and `contacts.book.get` (the entry, or " +
        "null) as the rpcs banking's flow steps through before its own masked accounts.",
    },
    { label: "keep-flow", text: "Remove the operation, keep the flow for the SDK's address book." },
    { label: "keep-both", text: "Keep both until banking books its own." },
  ],
  chosen: "drop-both",
  why:
    "A4 gives the operation one SDK flow, and banking's flow is that flow: it alone can add `bankAccounts`. A second " +
    "contacts flow for the same SDK method would be a duplicate record or a second answer to one call, and keeping the " +
    "operation would book it twice. Both rpcs stay reached: label, hide and unhide step through them for their " +
    "picker and preview. The removed acceptance observations (null outside the book, exit 0; the owner reads their " +
    "entry back and `--org` without a Seat is ROLE_PERMISSION_DENIED; a get given a PartyId is one `contacts.book.get` " +
    "call with no list or `wait.person`) and the guided-get budget (p95 1,600 ms) pass to banking's record.",
  source: by("books/target/shared/foundation.ts (OPERATION_OWNERS contact.get); shared operations.contact-get-in-banking; A4; contact.get.yaml"),
  affects: [rpc_contacts_book_get, rpc_contacts_book_list, concept_contacts],
});

// ── the CRM in Frappe CRM's shapes (the crm lane, 8 November 2026) ───────────────────────────

export const decision_contacts_frappe_shape = defineDecision({
  id: "contacts.frappe-shape",
  title: "Each Organization's CRM is Frappe CRM's doctypes, one table each",
  question:
    "Every Organization starts with a CRM, in Frappe CRM's shape, complete without a Frappe head and synced with one " +
    "once it is connected. Frappe CRM keeps a person as a Contact (with Contact Email and Contact Phone rows), a company " +
    "as a CRM Organization, a prospect as a CRM Lead, and a sale as a CRM Deal with its people in CRM Contacts. How does " +
    "the contact book hold them?",
  options: [
    {
      label: "doctype-tables",
      text:
        "One table per doctype, under Frappe's field names: `contacts` holds Contact and CRM Organization entries (a " +
        "`doctype` column, since the frozen commands list, hide and label both alike), `leads` holds CRM Lead, `deals` " +
        "CRM Deal and `deal-contacts` CRM Contacts. Each entry names its Party, the identity the global directory holds; " +
        "everything the business knows about it (its mailboxes, numbers, title, company, website, industry, territory, " +
        "size, revenue) stays in the owner's book. Statuses and lost reasons take Frappe CRM's install defaults; sources, " +
        "industries and territories are free names (contacts.crm-statuses).",
    },
    {
      label: "address-book-only",
      text:
        "Keep the address book as it was (a label and visibility per Party) and leave leads, deals and the business's " +
        "fields to the Frappe head.",
    },
    {
      label: "own-shape",
      text: "A CRM in Capxul's own shape (a contact with free-form notes, an opportunity with its own stages), mapped to Frappe at the head.",
    },
  ],
  chosen: "doctype-tables",
  why:
    "The CRM is one of the two apps every Organization starts with, and its data lives in Frappe's shapes from the first " +
    "day whether or not a head is connected, so the address book alone is not enough: an Organization with no head would " +
    "have no leads or deals. Taking the doctypes table for table, field for field, makes a head's sync a mapping of names " +
    "and ids, never a transformation that could lose what one side holds, and makes Frappe's own rules the book's: a lead " +
    "needs a name, a company or a mailbox; a lost status needs a reason; a won deal records when; one primary contact. " +
    "Contact and CRM Organization share a table because the frozen commands treat every entry alike (one list, one id " +
    "space, one hidden state), as Frappe CRM itself lists both beside each other; the rest are separate, as in Frappe. " +
    "The two layers keep core check C14 fitting (the directory leaks nothing a CRM keeps private) and settle C15 (the " +
    "address book extends to a CRM): the private half is here, the identity there. Only what the CRM needs on its own was " +
    "taken: SLAs, communication status, products, enrichment and social links are left to the head, which can add them " +
    "as its own fields.",
  source: crmBy(`${CRM}/fcrm/doctype/crm_lead|crm_deal|crm_organization|crm_contacts/*.json; frappe/frappe@1a7ea577 frappe/contacts/doctype/contact/contact.json; docs/vision/erp.md (C14, C15)`),
  affects: [
    table_contacts, table_leads, table_deals, table_deal_contacts, machine_lead, machine_deal, rpc_contacts_book_record,
    ...LEAD_RPCS, ...DEAL_RPCS, concept_contacts,
  ],
});

export const decision_contacts_private_entries = defineDecision({
  id: "contacts.private-entries",
  title: "A company not on Capxul is a private entry until it has a Party",
  question:
    "The directory holds only identities Capxul can name and pay (parties.outside-companies), so a prospect company, a " +
    "supplier paid only by bank or a person known only by phone has no Party. The CRM must still keep them. How?",
  options: [
    {
      label: "private-entry",
      text:
        "An entry with no Party: `party_id` null, its own id `contact_<ulid>`, `ref` null in every read, so it cannot be " +
        "paid or invoiced through the book until it has a Party. It is linked once, by `contact link` (contacts.book-verbs): " +
        "when the company is on Capxul (its handle), is paid at a wallet (its address), or the person's mailbox is " +
        "given (which names them in the directory), and it keeps its id. Wire inputs that named an entry by `partyId` now name it by `contactId`, the same " +
        "value for every entry born from a Party.",
    },
    {
      label: "re-key",
      text: "A private entry takes its Party's id as its own id when it is linked.",
    },
    { label: "elsewhere", text: "Keep companies without a Party out of the book, in a separate prospects table." },
  ],
  chosen: "private-entry",
  why:
    "One book of people and companies is Frappe CRM's own model and what a business expects: its prospects, its " +
    "bank-paid suppliers and its customers sit in one list. An id that changes at linking would break every lead, deal " +
    "and connected head that points at it, so a private entry keeps its own; every entry the frozen commands make is " +
    "still born from a Party with the PartyId as its id, so their claims hold. A separate prospects table would be a " +
    "second contact book with its own hide and label. A private entry never shares its Party with another entry " +
    "(`contacts-by-party`), and a link is refused rather than merged when the Party is already in the book, so no two " +
    "entries can disagree about where money goes.",
  source: crmBy("books/target/parties/decisions.ts (parties.outside-companies); contact.add.yaml acceptance 1; crm frontend/src/pages/Organization.vue:490"),
  affects: [table_contacts, rpc_contacts_book_record, rpc_contacts_book_get, rpc_contacts_book_list, rpc_contacts_book_add, procedure_parties_resolve_recipient, ...FLOWS],
});

export const decision_contacts_crm_statuses = defineDecision({
  id: "contacts.crm-statuses",
  title: "Lead and deal stages are Frappe's status types; statuses its defaults",
  question:
    "Frappe CRM's lead and deal statuses are per-site lists (CRM Lead Status, CRM Deal Status), each with a `type` from " +
    "Open, Ongoing, On Hold, Won and Lost, a position and, for a deal, a probability. A state machine needs fixed states. " +
    "What do the `lead` and `deal` machines run on?",
  options: [
    {
      label: "types-and-defaults",
      text:
        "The machine runs on the status's type (`stage`): open, ongoing, won and lost; and for a lead converted, which is " +
        "CRM Lead's `converted` check, not a type. The status names are Frappe CRM's install defaults, each mapped to its " +
        "type (New; Contacted, Nurture; Qualified, Converted; Unqualified, Junk; and Qualification, Demo/Making, " +
        "Proposal/Quotation, Negotiation, Ready to Close, Won, Lost with their probabilities); moving within a stage " +
        "writes the name only. On Hold, which no default status has, is not booked. Lost reasons are Frappe's nine " +
        "defaults. Sources, industries and territories are free names, which a head creates as its link records on sync.",
    },
    { label: "per-org-lists", text: "Per-Organization status tables, editable, seeded with the defaults." },
    { label: "names-as-states", text: "Each default status name is a state." },
  ],
  chosen: "types-and-defaults",
  why:
    "Frappe's own behaviour hangs on the type, never the name: a Won type sets the deal's closed date, a Lost type needs a " +
    "reason, a Lost lead cannot convert, and kanban columns are statuses inside types. So the type is the state and P7's " +
    "one event per machine reports every stage change; renaming within a stage changes no state. Fixed default names " +
    "keep an Organization without a head complete and consistent; editable lists, and On Hold, come with the first " +
    "Organization whose head has its own statuses, mapped by type, which `contacts.head.sync` can do without changing these " +
    "machines. Names as states would make a renamed status a migration. Conversion is its own state because nothing may " +
    "follow it, but it is not a status: Frappe's default Converted status is of type Won, its `convert_to_deal` sets " +
    "the status to Qualified and the `converted` check (`mark_converted`), and its leads list hides converted leads by " +
    "that check. So the stage is converted exactly when the check is set, with status Qualified, and a person may pick " +
    "Converted like Qualified without converting, as in Frappe. Revised in review: the first pass gave Converted its own " +
    "type, which a head would have read as won.",
  source: crmBy(`${CRM}/install.py:46, :97, :466 (default statuses and lost reasons); crm_lead.py:173, :546, :600 (mark_converted); crm_deal.py:98, :282`),
  affects: [machine_lead, machine_deal, event_lead_transitioned, event_deal_transitioned, table_leads, table_deals, rpc_contacts_leads_move, rpc_contacts_deals_move],
});

export const decision_contacts_lead_conversion = defineDecision({
  id: "contacts.lead-conversion",
  title: "A lead converts once, naming its person in the directory then",
  question:
    "Frappe CRM's `convert_to_deal` makes a Contact (matched by mailbox only), a CRM Organization (matched by name) and a " +
    "CRM Deal, and marks the lead converted. What does Capxul's conversion do, and when does a lead's mailbox enter the " +
    "global directory?",
  options: [
    {
      label: "convert-once",
      text:
        "One transaction that locks the lead: the person is the entry given, or the book's entry for the lead's mailbox, " +
        "resolved through the directory (naming a provisional Party if new), or a private Contact with no mailbox; the " +
        "company is the entry given, else the book's CRM Organization whose shown name is the lead's typed name, else a " +
        "new private one from it; the deal is born from the lead; the lead becomes converted with the deal's id, status " +
        "Qualified. A lost lead is WRONG_STATE; a converted one answers its deal. A lead names no Party before that.",
    },
    { label: "name-at-capture", text: "Resolve a lead's mailbox in the directory when the lead is captured." },
    { label: "never-by-name", text: "Never match the lead's typed company name: the company is the entry given or a new private one." },
  ],
  chosen: "convert-once",
  why:
    "A lead is an unqualified prospect, often junk; naming every one in the global directory would fill it with digests " +
    "of mailboxes nobody will pay. A converted lead's person is someone the business deals with, which is what a contact " +
    "is, so the directory learns of them exactly when `contact add` would. Matching a person by mailbox is Frappe's own " +
    "rule ('Match only on email which uniquely identifies a person') and the directory's key, so it holds across the " +
    "Organization's book and every other. A company is matched by its name because that is Frappe's own rule " +
    "(`create_organization`) and, on a head, a CRM Organization's name is its identity, unique on the site: a " +
    "conversion made on the head lands on the existing company, so one made here must too, or the two sides would " +
    "split one company in two. A deal names a company and moves no money, and the match never changes an entry's " +
    "Party, so it cannot route a payment; a caller who means another company passes it (Frappe's " +
    "`existing_organization`). Answering the first deal on a second conversion is Frappe's 'Return Existing', which " +
    "makes an agent's retry safe; the lead's lock and its `deal_id` enforce it. `deals-by-lead` is not unique, because " +
    "a head may still make a second deal from one lead (Frappe's default is 'Create'). Revised in review: the first " +
    "pass never matched by name and made `deals-by-lead` unique, which a head's push and pull could not keep.",
  source: crmBy(`${CRM}/fcrm/doctype/crm_lead/crm_lead.py:230, :267 (by organization_name), :335 (by email), :354, :546 ('Create' by default), :583, :600`),
  affects: [rpc_contacts_leads_convert, machine_lead, machine_deal, table_deals, table_leads, table_contacts, procedure_parties_resolve_recipient],
});

export const decision_contacts_crm_permission = defineDecision({
  id: "contacts.crm-permission",
  title: "The People hat edits the whole CRM; every member reads it",
  question:
    "Editing an Organization's contact book needs its edit permission, the People hat (contacts.members-write). Leads " +
    "and deals are part of the same CRM. Who may read and change them, and who may own a lead or deal?",
  options: [
    {
      label: "people-hat",
      text:
        "The same as the book: every member reads the CRM; only a member whose Safe wears the People hat records, " +
        "changes, moves or converts, whether in Capxul or on a connected head. A lead's or deal's owner is a member (an " +
        "active Seat's Party).",
    },
    {
      label: "sales-hat",
      text: "A separate sales permission (Frappe's Sales User and Sales Manager), as a new hat in each Organization's tree.",
    },
    { label: "any-member", text: "Any member edits leads and deals; only the contact book needs the hat." },
  ],
  chosen: "people-hat",
  why:
    "The CRM is the Organization's contact book in Frappe's shape, so its edit permission is the book's, and one " +
    "permission for one app keeps who-may-change-what one answer. The hat is already the Organization's authority " +
    "(P9), the founder wears it from setup, and an agent given it works the CRM with no new grant; the hosted Forward " +
    "Deployed Engineer needs none, since it acts as an asker who wears it (aaron.fde-anyone, organizations.fde-for-the-asker). A sales hat would need a hat in every Organization's tree and an officer command to grant " +
    "it, which nothing asks for yet; it can split from the People hat later without changing a table. Letting any member " +
    "edit leads would bring back the rule the book's own permission replaced. The owner must be a member because " +
    "Frappe's `lead_owner` and `deal_owner` are site users who work the record. A connected head's edits arrive through " +
    "`contacts.head.sync` and are held to the same rule: applied as the member the head user's mailbox matches, only if " +
    "that member's Safe wears the People hat, else pushed back. Projects applies a head edit under the connection's " +
    "authority when no member matches; the CRM cannot, because editing the contact book is a permission by ruling " +
    "(contacts.members-write), and because the book is where money paid to an entry is aimed (only `contact link`, " +
    "in Capxul, names an entry's Party: contacts.book-verbs). Revised in review: the first pass let the connection's authority apply " +
    "an edit no member made. The head's own roles (Sales User, Sales Manager) should follow the hat, so its forms stop " +
    "other users before Capxul has to push back.",
  source: crmBy("books/target/contacts/decisions.ts (contacts.members-write); frappe crm_organization.json and contact.json permissions (Sales User, Sales Manager)"),
  affects: [
    ...CRM_WRITES, rpc_contacts_leads_list, rpc_contacts_leads_get, rpc_contacts_deals_list, rpc_contacts_deals_get,
    table_org_deployments, table_org_members, workflow_contacts_head_sync,
    // the conversations' writes keep the same rule (contacts.conversation-commands)
    rpc_contacts_mail_send, rpc_contacts_whatsapp_connect, rpc_contacts_whatsapp_disconnect, rpc_contacts_whatsapp_send,
    rpc_contacts_notes_save, rpc_contacts_tasks_save, rpc_contacts_tasks_move, rpc_contacts_calls_log,
  ],
});

export const decision_contacts_crm_capabilities = defineDecision({
  id: "contacts.crm-capabilities",
  title: "The CRM's new capabilities get their CLI commands now, in one grammar",
  question:
    "Recording a person or company, and capturing, moving and converting leads and deals, are new capabilities: none is " +
    "among the 215 frozen operations. Rule rules.new-operations now books a new operation for an Aaron ruling, with a " +
    "decision pack naming its commands. How does an Organization with no head work its CRM now, and how do the CRM and " +
    "projects, which booked their new capabilities differently, become one approach?",
  options: [
    {
      label: "sdk-now-cli-later",
      text:
        "Book the rpcs now, each behind one Core SDK method (`client.account.addressBook.record`, " +
        "`client.org(orgId).crm.leads.*`, `.crm.deals.*`) that serves the SDK: the Organization's Forward Deployed " +
        "Engineer and any other SDK client use them (a connected head syncs through contacts' own process instead). The " +
        "CLI commands (for example `contact record`, `crm lead add`, " +
        "`move`, `convert`, `list`, `get` and `crm deal add`, `move`, `list`, `get`) are this decision pack's " +
        "recommendation, booked as operations by rules.new-operations in the CLI operations pass, each one call to the " +
        "SDK method already booked. Projects follows the same shape: its rpcs and SDK methods first, then its pack's " +
        "commands.",
    },
    {
      label: "cli-now",
      text:
        "Recommended: book now, under rules.new-operations, exactly the 14 commands of docs/design/new-commands.md " +
        "(section 5.2), in its one grammar, each calling one SDK method that keeps its other surfaces and adds `cli`: " +
        "`contact create <label> --type person|company`, `contact change <contact>` and `contact link <contact> " +
        "<locator>` (the caller's own book, or with `--org` the Organization's; three flows " +
        "`client.account.addressBook.create|change|link` over `contacts.book.record`, which records, changes and links; " +
        "`link` previews and asks, since it chooses where money paid to the entry goes); `org crm lead " +
        "create|change|move|convert|list|get` (`client.org(orgId).crm.leads.*`; create and change are two flows over " +
        "`contacts.leads.save`); and `org crm deal create|change|move|list|get` (`client.org(orgId).crm.deals.*`; create " +
        "and change over `contacts.deals.save`). Who (contacts.crm-permission): every member reads the CRM; only a member " +
        "whose Safe wears the People hat records, changes, moves or converts, the hosted FDE only for such an asker; a person's own " +
        "book is theirs. Reads are `read`, the rest `write`, all `normal`.",
    },
    { label: "head-only", text: "No CRM capabilities in Capxul: leads and deals are worked only in a connected Frappe head." },
  ],
  chosen: "cli-now",
  why:
    "Aaron asked on 8 November 2026 for the new commands to be designed in the book, and accepted this recommendation " +
    "in his sixth batch; the fourteen are booked under rules.new-operations in ./operations.ts, each in this pack's " +
    "affects, with its verbs (contacts.book-verbs, contacts.crm-verbs), its priority (contacts.critical-commands, which " +
    "makes six of them `critical` in place of this option's 'all `normal`') and its worlds (contacts.crm-worlds) decided apart. The capability serves aaron.crm-frappe-shape and " +
    "aaron.frappe-shape: an Organization with no head works its CRM through these commands, and the FDE through the " +
    "same CLI (aaron.fde-agent). The rpcs and flows were booked SDK-first (sdk-now-cli-later); the commands now follow " +
    "the one grammar every new command keeps (docs/design/new-commands.md): `org` for what only an Organization has, " +
    "`create` for a document with a lifecycle (a lead, a deal, a new book entry; `add` keeps `contact add`'s meaning), " +
    "`change` for fields, `get` for one record, and one SDK method per command, so an rpc that both creates and " +
    "changes is two commands. Head-only would leave an Organization without a head with no leads or deals.",
  source: crmBy("tools/check-frozen.ts ('a target operation that is none of the 215'); books/target/shared/rulings.ts (aaron.crm-frappe-shape, aaron.frappe-shape, aaron.fde-agent)"),
  affects: [...CRM_OPERATIONS, ...CRM_RPCS, ...CRM_FLOWS, concept_contacts],
});

export const decision_contacts_head_sync = defineDecision({
  id: "contacts.head-sync",
  title: "Contacts syncs its own CRM with a connected head, one process per head",
  question:
    "When a Frappe head is connected, its CRM and the Organization's must stay one. Who syncs the CRM's records, how, " +
    "and what stays Capxul's alone?",
  options: [
    {
      label: "own-process",
      text:
        "Contacts' own process, `contacts.head.sync`, as every app concept syncs its own records: started at the " +
        "connection's `confirm`, it pushes `contact-changes` in seq order (`upsertDocs`) and pulls the head's changes " +
        "(`listChanges`), applying each through the CRM's own checks and transitions by the version rule of " +
        "organizations.head-ownership, as a member wearing the People hat (contacts.crm-permission); what it does not " +
        "apply (a conflict, a refusal, a deletion) it pushes back. Each Frappe record carries its `capxul_id`, and a " +
        "Contact or CRM Organization its `capxul_party`. An entry's Party, and so where money goes, is set only in " +
        "Capxul. How each record meets its document on the head is contacts.head-mapping.",
    },
    {
      label: "sdk-agent",
      text: "The head's sync runs outside the backend as an agent of the Organization, reading the lists and writing through the SDK methods.",
    },
    { label: "head-master", text: "Once a head is connected, the head's CRM is the record and Capxul's copy follows it." },
  ],
  chosen: "own-process",
  why:
    "The connected head is one integration that each app concept follows for its own records (the `frappe-head` " +
    "integration, organizations.head-ownership), so the CRM syncs as projects do: one ordered change log, cursors per " +
    "connection, and a version on every record so a stale head edit never overwrites a newer Capxul one. Applying pulled " +
    "changes through the CRM's own checks and transitions keeps Frappe's rules and the frozen claims in one place " +
    "whoever writes, and every stage change still sends its machine's event. An outside agent would need its own " +
    "credentials, its own cursor and a time-ordered read that can miss a late commit; a gap-free `seq` is what makes " +
    "the push exact. Head-master would let a head repoint an entry to another Party, which would redirect payments, so " +
    "`capxul_party` is never taken from the head: a Contact born there with a primary mailbox is named in the " +
    "directory exactly as a recorded person is, and one whose Party already has an entry is refused, never merged, so " +
    "one Party is one entry. Capxul never deletes a CRM record, so a head's deletion is pushed back like any refused " +
    "edit; a refused document born in the head has no Capxul version to push, so it stays there unadopted. Statuses " +
    "map one to one by name; a custom status the head adds is refused and pushed back until per-Organization lists " +
    "exist (contacts.crm-statuses).",
  source: crmBy("books/target/shared/external.ts (integration frappe-head); books/target/projects/processes.ts (projects.head.sync); organizations/data.ts (org-heads)"),
  affects: [
    workflow_contacts_head_sync, table_contact_head_syncs, table_contact_changes, table_contacts, table_leads, table_deals,
    table_deal_contacts, table_org_heads, machine_org_head, table_parties, procedure_parties_resolve_recipient, concept_parties,
  ],
});

export const decision_contacts_change_log = defineDecision({
  id: "contacts.change-log",
  title: "Every Organization-owned CRM write is logged in commit order",
  question:
    "A connected head must receive every change to an Organization's CRM, in order, exactly once, including the whole " +
    "history when it connects late. What records the order?",
  options: [
    {
      label: "seq-log",
      text:
        "`contact-changes`: one row per change to an Organization's book entry, lead or deal, appended in the writing " +
        "transaction with the next `seq` from `crm-settings` under its lock; the record keeps that seq as its `version`. " +
        "A person's own book logs nothing.",
    },
    { label: "updated-at", text: "Page each table by `updated_at`, as the lists do." },
    { label: "outbox", text: "Follow the machines' events through the outbox." },
  ],
  chosen: "seq-log",
  why:
    "A time column cannot promise exactly once: a write that commits after a reader passed its time is skipped, the gap " +
    "the vision's core check C5 finds in the books. A counter taken under one row lock commits in order, so paging by " +
    "`seq` skips nothing, and the version it gives each record is what the head's edits are compared against. The " +
    "outbox carries only stage changes, not a label or a phone number. The log holds ids, so it stays small and the " +
    "push reads each record as it stands. The counter row costs one lock per CRM write, which an Organization's CRM, " +
    "written by people and a few agents, never feels. Only Organizations have heads, so a person's book stays unlogged.",
  source: crmBy("books/target/projects/data.ts (project-changes, the same pattern); docs/vision/erp.md (C5)"),
  affects: [table_contact_changes, table_crm_settings, table_contacts, table_leads, table_deals, ...WRITES, ...CRM_WRITES, workflow_contacts_head_sync],
});

export const decision_contacts_head_mapping = defineDecision({
  id: "contacts.head-mapping",
  title: "Each CRM record meets its head document by Frappe's own rules",
  question:
    "The CRM's tables carry Frappe CRM's field names, but a head has rules no table shows: a CRM Organization is named " +
    "by its `organization_name`, unique on the site, and Contact's `company_name` and CRM Deal's `organization` name it; " +
    "Frappe makes a Contact for every User; CRM Lead's `first_name` is mandatory in its form; Frappe's own conversion " +
    "marks a lead `converted`, sets it Qualified and makes another deal if asked again; and a site connected late may " +
    "already hold a CRM. How does each record meet its document there?",
  options: [
    {
      label: "frappe-rules",
      text:
        "Follow Frappe's own rules. An organization entry is pushed with its shown name (its label, else its Party's " +
        "display name) as `organization_name`; when another document on the head holds that name, with ` - 2`, ` - 3` " +
        "and on (the first free), as Frappe numbers a Contact's name, kept as `head_name`; a label change renames it " +
        "there. A Contact's `first_name` is the shown name, with no last name, and Frappe names it. A pulled " +
        "`full_name` or `organization_name` becomes the entry's label only when it differs from the name Capxul shows; " +
        "a Party's display name is never taken from a head. A member is a User on the head with the Contact Frappe made " +
        "for it: a deal naming a member names that Contact, found by its `capxul_party`, and a lead's or deal's owner is " +
        "the owner's User; an agent has no User (organizations.head-users), so an agent owner goes as null and a pulled " +
        "null owner leaves Capxul's agent owner as it is; a member's own row (its label " +
        "or hide) is not pushed while the member holds a Seat, and a change to a User's Contact is not pulled. A lead " +
        "with no first name is written as Frappe's Data Import writes one (mandatory fields not enforced), the path " +
        "`set_lead_name` serves. A converted lead is `converted` there with status Qualified; a lead the head converts " +
        "is pulled as `convert` with the first deal whose `lead` names it, which Frappe writes first (with no such deal " +
        "it is refused), and later deals from it are kept as deals. On a site that already holds a CRM, the first push adopts a Contact with no " +
        "`capxul_id` whose primary mailbox is an entry's, and a CRM Organization whose name is an organization entry's " +
        "shown name (Frappe's own keys), instead of making a second; the rest is pulled as documents born there.",
    },
    {
      label: "push-as-is",
      text:
        "Push every record under its own label and let the head refuse what it cannot hold (a second organization of " +
        "one name, a lead with no first name, a second Contact for a User).",
    },
    {
      label: "customize-naming",
      text: "Change CRM Organization's naming on the head to a hash with a Property Setter, so names need not be unique.",
    },
  ],
  chosen: "frappe-rules",
  why:
    "Each rule is one the head enforces whether Capxul knows it or not. CRM Organization is named by `organization_name` " +
    "(autoname by field), and Contact's `company_name` is a Data field holding that name, so two companies of one name " +
    "cannot both exist there; the frozen book lets two entries share a label (`contact label` #2), so the push must " +
    "tell them apart, and Frappe's own numbering of Contact names is the least surprising way. Renaming a CRM " +
    "Organization does not rewrite Contacts' `company_name`, so the head's Capxul app must. Changing CRM Organization's " +
    "naming would break Frappe CRM's pages, which show and link organizations by that name, and is a customization the " +
    "ruling asks to avoid. Frappe makes a Contact for every User (`create_contact`), so pushing a member as another " +
    "Contact would split one person in two, and that Contact's mailbox is the member's own, which a book never shows " +
    "(contacts.members-derived). Frappe's `convert_to_deal` makes the deal first and then sets the lead's `converted` " +
    "check with `db_set`, and by default makes another deal on a second conversion, so the pull takes the first and " +
    "keeps the rest. Frappe's form needs a lead's first name, but `set_lead_name` serves imports that hold only a " +
    "company or a mailbox, and Capxul's leads follow it. Adopting by mailbox and by name is how Frappe CRM itself " +
    "dedupes (`contact_exists`, `create_organization`). None of this touches money: an entry's Party is still set only " +
    "in Capxul. Added in review: the first pass said only that a sync renames fields, which left all of this to the build.",
  source: crmBy(
    `${CRM} crm_organization.json (autoname by field), crm_lead.json, crm_lead.py:140, :546, :600; frappe@1a7ea577 ` +
      "user.py:1615 (create_contact), contact.py:57, document.py:2287 (db_set)",
  ),
  affects: [
    workflow_contacts_head_sync, table_contacts, table_leads, table_deals, table_deal_contacts, table_org_members,
    table_parties, machine_lead, rpc_contacts_leads_convert,
  ],
});

// ── the assembly after the Frappe lanes (8 November 2026) ────────────────────────────────────

const ASSEMBLY = "Claude, identity assembly after the Frappe lanes, 8 November 2026";
const asmBy = (evidence: string) => `${ASSEMBLY}; evidence: ${evidence}`;

export const decision_contacts_startup = defineDecision({
  id: "contacts.startup",
  title: "The CRM starts empty at begin; a business's contacts come in by command",
  question:
    "Every fundamental app starts itself from organizations' `org-setup.begin` (organizations.startup). What does the " +
    "CRM create when an Organization begins, and how does a business's existing list of people and companies get in?",
  options: [
    {
      label: "nothing-to-seed",
      text:
        "No start-up process: an Organization's CRM is complete at `begin` with nothing written. Its status lists are " +
        "fixed defaults (contacts.crm-statuses), its `crm-settings` counter is inserted by its first write under that " +
        "row's lock, and its members are read from Seats, never copied (contacts.members-derived). The Organization " +
        "itself is no CRM Organization: Frappe CRM's organizations are counterparties, and the Organization is ERPNext's " +
        "Company (organizations.company-shape). Existing contacts are imported in the start-up sitting one record at a " +
        "time, through `contact add` (a person or company with a Party) and `contact create` (a private entry, or a person " +
        "by mailbox, with Frappe's fields), by a People hat wearer: the founder, or the hosted FDE for one who asks it (agents.fde-people-hat). " +
        "A head connected later receives the whole CRM from seq 1 (contacts.head.sync).",
    },
    {
      label: "startup-process",
      text: "A workflow triggered by `org-setup.begin` that writes `crm-settings` and a CRM Organization for the Organization itself.",
    },
    { label: "bulk-import", text: "As nothing-to-seed, plus a bulk import rpc that takes a file of contacts in one transaction." },
  ],
  chosen: "nothing-to-seed",
  why:
    "A process whose only write would be a counter row that the first write inserts anyway is a process with nothing to " +
    "do, and P3 keeps no process for what a transaction can do. organizations.startup had listed 'the Organization's own " +
    "CRM Organization' for the CRM; Frappe CRM has no own-company record (its CRM Organization is a company you sell to " +
    "or buy from), so writing one would make the Organization a counterparty of itself in its own CRM and in a head's. " +
    "Importing through the booked writes keeps every check (the People hat, `parties.resolve-recipient` naming each " +
    "person, the change log) on every imported record, which a bulk path would have to repeat; a bulk import is a new " +
    "capability for the CRM's decision pack (contacts.crm-capabilities), not needed for the start-up, whose contact lists " +
    "are small. Answers the projects and start-up lane's ask for a CRM start-up from `begin`, and the CRM lane's for the " +
    "start-up import.",
  source: asmBy("docs/design/frappe/crm.md (FDE and organizations); docs/design/frappe/projects-and-startup.md (section 1 table); books/target/organizations/decisions.ts (organizations.startup)"),
  affects: [table_crm_settings, table_contacts, rpc_contacts_book_add, rpc_contacts_book_record, workflow_contacts_head_sync, concept_contacts],
});

// ── the CRM's commands, booked under rules.new-operations (8 November 2026) ──────────────────

const COMMANDS = "Claude, CRM commands pass (contacts), 8 November 2026";
const cmdBy = (evidence: string) => `${COMMANDS}; evidence: ${evidence}`;

export const decision_contacts_book_verbs = defineDecision({
  id: "contacts.book-verbs",
  title: "`contact create`, `change` and `link` share one write; only `link` names a Party",
  question:
    "The CRM's one book write, `contacts.book.record`, records a new entry, changes its details and links its Party. The " +
    "grammar gives each its own verb and SDK method (docs/design/new-commands.md, G3 and G7). What does each command do, " +
    "and which of them may decide where money paid to an entry goes?",
  options: [
    {
      label: "three-verbs",
      text:
        "`contact create <label> --type person|company` records a new entry: a person given a primary mailbox is born " +
        "from its Party, and one whose Party already has an entry in the book is INVALID_INPUT naming it, never merged. " +
        "`contact change <contact>` sets details only and never names a Party: a mailbox given to a private person stays " +
        "a detail, and a change that gives nothing is INVALID_INPUT, as projects' `change` commands refuse it. `contact link <contact> <locator>` names a private entry's Party once, after a preview at a terminal " +
        "(`--confirm` from a script), and refuses an entry that has one, a Party already in the book and a Party of the " +
        "other kind (an Organization's for a person; a mailbox, a person's or an agent's for a company). The label stays " +
        "`contact label`'s. Three flows over the one rpc, area `payments` as the frozen contact commands are.",
    },
    { label: "one-command", text: "`contact record`, one command over the one SDK method `client.account.addressBook.record`, as it was booked SDK-first." },
    { label: "change-links", text: "As three-verbs, but `contact change` giving a private person a primary mailbox links it, as `contacts.book.record` first did." },
  ],
  chosen: "three-verbs",
  why:
    "G3 gives each verb one meaning and G7 one SDK method per command, so one rpc that creates, changes and links serves " +
    "three commands, as `contact hide` and `unhide` share one machine. Linking is the one step that decides where money " +
    "paid to an entry goes and cannot be undone, so it is its own command with a preview, as the grammar asks of every " +
    "command that cannot be undone (vocabulary.declined-preview-cancelled). Letting `change` link by mailbox, as the " +
    "SDK-first rpc did, would aim payments without that preview, and a head's edit of a mailbox, which the sync applies " +
    "through the same checks, would do it from outside Capxul, where contacts.head-sync already says a head never sets " +
    "an entry's Party. A create whose person's Party already has an entry is refused rather than merged, as a head-born " +
    "Contact is, because a merge would overwrite details another member typed; `contact add` keeps its frozen landing " +
    "on the existing entry. A company on Capxul is an Organization's Party or a wallet (parties.outside-companies), and " +
    "the preview shows the locator only as typed, so the rpc holds the kinds apart. The label keeps its frozen command. " +
    "The rulings it serves, in its source: the book is Frappe CRM's Contact and CRM Organization, and in an " +
    "Organization's book each of these writes is the People hat's.",
  source: cmdBy("serves aaron.crm-frappe-shape and aaron.contacts-permissions; docs/design/new-commands.md (G3, G5, G7, 5.2); contacts.head.sync; parties.outside-companies"),
  affects: [...BOOK_OPS, ...BOOK_FLOWS, rpc_contacts_book_record],
});

export const decision_contacts_crm_verbs = defineDecision({
  id: "contacts.crm-verbs",
  title: "Leads and deals: create and change split one save; owners named as members",
  question:
    "`contacts.leads.save` and `contacts.deals.save` both capture and change, their owners were PartyIds, and `get` " +
    "answered null for an id outside the Organization. How do the `org crm lead` and `org crm deal` commands spell these " +
    "in the grammar's verbs and arguments?",
  options: [
    {
      label: "grammar",
      text:
        "`create` (no id) and `change <id>` are two SDK methods and two flows over each save; `move`, `convert`, `list` " +
        "and `get` keep their one-rpc flows, each now serving the CLI and the SDK alike. `--owner` names a member as G5 " +
        "does, an email or an agent's @handle, which the save resolves against the Organization's active Seats. " +
        "`get` of an id that is none of the Organization's leads or deals is INVALID_INPUT, as `payment get` is, never " +
        "null; an id of another kind (a `deal_` id for a lead, a `lead_` id for a deal) is CLI_USAGE before any call, as " +
        "`payment get` refuses an id not starting `payment_`. A `change` that gives no field is INVALID_INPUT. `org crm " +
        "deal create` needs `--company`; `--contact` repeats and `--primary` names the one primary " +
        "person. A lead's change must still leave a first name, a company name or a mailbox. `--clear <field>` empties " +
        "a field, named by its flag.",
    },
    { label: "save-command", text: "One `save` command per record, creating with no id and changing with one." },
    { label: "party-ids", text: "As grammar, but `--owner` takes only a PartyId, as the rpcs did." },
  ],
  chosen: "grammar",
  why:
    "G3: `create` makes a document with a lifecycle and `change` edits fields, never a status, so one rpc that does both " +
    "is two commands and two methods (docs/design/new-commands.md, section 4). An owner is a member who works the record " +
    "(Frappe's `lead_owner` and `deal_owner`), and G5 names a member by email or an agent's @handle everywhere, as " +
    "projects' `--member` does; a PartyId alone would make every script look one up first. G6 has no not-found code, " +
    "so `get` refuses an unknown id as `payment get` does, and the SDK's agents read the same refusal; G6 makes a " +
    "malformed id CLI_USAGE, and the 215 do so for an id of the wrong kind (`payment get`, `activity get`), so a " +
    "deal's id given for a lead is one too. An empty `change` is refused, as projects' are (corrected in review " +
    "(fit): this let `--owner` take any @handle or a PartyId, and refused a wrong-kind id as INVALID_INPUT). A deal opened by hand names its company because Frappe CRM's " +
    "deals list leads with it and its Organization page links deals by it; CRM Deal itself requires only `status`, and " +
    "a conversion sets the company only when the lead names one or `--company` is given, so the SDK method, as Frappe, " +
    "takes a deal with none (corrected in review: this said a conversion always sets it). A change that empties every name would leave a lead " +
    "Frappe's `set_lead_name` cannot name. Each rpc stays one transaction; only its spelling and the owner lookup " +
    "change, which reads `parties` for a handle or a mailbox's digest. Found on the way: `contacts.deals.move` checked " +
    "the People hat without reading its wearers, and now reads them. The FDE works the CRM through these same commands.",
  source: cmdBy("serves aaron.crm-frappe-shape and aaron.fde-agent; docs/design/new-commands.md (G3, G5, G6, 5.2); frappe/crm@2cecd300 crm_lead.py:140, crm_deal.json"),
  affects: [...LEAD_OPS, ...DEAL_OPS, ...LEAD_FLOWS, ...DEAL_FLOWS, rpc_contacts_leads_save, rpc_contacts_deals_save, rpc_contacts_deals_move],
});

export const decision_contacts_critical_commands = defineDecision({
  id: "contacts.critical-commands",
  title: "The CRM commands a start-up and its first sale need are critical",
  question:
    "The grammar makes every new command `normal`. Which CRM commands does an Organization need from its first day, so " +
    "that they are `critical`?",
  options: [
    {
      label: "startup-and-first-sale",
      text:
        "Six: `contact create`, with which the start-up sitting brings in the business's people and companies " +
        "(contacts.startup); and `org crm lead create`, `list` and `convert` and `org crm deal list` and `move`: capture " +
        "a prospect, see the pipeline, convert it, and win or lose the deal. The other eight are `normal`.",
    },
    { label: "none", text: "Every command `normal`, as the grammar page has it: no B3 pilot runs one." },
    { label: "all", text: "Every CRM command `critical`." },
  ],
  chosen: "startup-and-first-sale",
  why:
    "The CRM is fundamental from an Organization's first day, and the FDE sets it up in the start-up sitting (the two " +
    "rulings in its source): the business's existing contacts come in then, one `contact create` or `contact add` at " +
    "a time (`contact add` is frozen and `normal` by rule 4). A pilot's first sale is the loop of the other five: " +
    "capture, list, convert, list the deals, move one to won. `change`, `link`, `get` and a lead's `move` refine it, and " +
    "`create` and `list` print every id the loop needs. None is on the B3 pilots' money path, so `critical` orders the " +
    "build's work and the evals a pilot depends on; it changes no budget. Projects marks its first engagement the same " +
    "way (projects.critical-commands). It changes one line of the pack's accepted recommendation, 'all `normal`' " +
    "(contacts.crm-capabilities), because the commands pass asked for the commands a pilot or start-up needs to be " +
    "marked critical; no command, flag or budget changes.",
  source: cmdBy("serves aaron.frappe-shape and aaron.fde-agent; docs/design/new-commands.md (G8); contacts.startup; CONVENTIONS rule 4 (priority)"),
  affects: CRITICAL,
});

export const decision_contacts_crm_worlds = defineDecision({
  id: "contacts.crm-worlds",
  title: "The CRM's refusals start from person-with-contacts or a new org-with-crm",
  question:
    "Every refusal of the fourteen commands needs a world. person-with-contacts holds a person's book and Acme with Dan " +
    "(People hat) and Rex (no hat), but no lead, deal or private person. Which worlds do the refusals and claims start from?",
  options: [
    {
      label: "one-more-world",
      text:
        "`contact create` starts from person-with-contacts. The other thirteen start from a new world, org-with-crm, " +
        "built from it by the commands themselves: Lou, a private person in Ada's book known by a phone number; in " +
        "Acme's book Globex Ltd (a private company) and Kim Park (kim@globex.test, born from her mailbox, at Globex); six " +
        "leads (Pat New, Quinn Contacted, Jo of Hooli Qualified, Max lost as Junk for Poor Fit, Kim's own Nurture with " +
        "company `globex ltd`, and Ivy of Umbrella Corp, owned by Dan, converted into the Umbrella deal); and three " +
        "Globex deals (a pilot in Qualification, a renewal won, an upsell lost for Pricing); Dan current. " +
        "person-with-contacts' private company is now recorded by `contact create`.",
    },
    { label: "per-command", text: "A world per command." },
    { label: "extend", text: "Add the leads, deals and private person to person-with-contacts itself." },
  ],
  chosen: "one-more-world",
  why:
    "One more snapshot reaches every remaining refusal: NOT_AUTHENTICATED with no session, ROLE_PERMISSION_DENIED as Ada " +
    "(no Seat) or Rex (no People hat), INVALID_INPUT from bad values and foreign ids, and WRONG_STATE from Ivy's " +
    "converted lead and Max's lost one; Kim's lead is there to show a conversion matching by mailbox and by name. " +
    "Building it with the new commands keeps a world a black box (devnet.deterministic-worlds: steps never write a " +
    "table) and makes the world a first proof of create, move and convert. Extending person-with-contacts would change " +
    "what the frozen contact commands and banking's `contact get` read there. The Board's grant and revoke of the " +
    "People hat to Rex, which the hat claims make, are steps of those evals, not of the world, so Rex starts with no hat.",
  source: cmdBy("books/target/devnet/worlds.ts (person-with-contacts, org-with-crm); devnet.deterministic-worlds; contacts.worlds"),
  affects: CRM_OPERATIONS,
});

// ── the CRM review (truth), 8 November 2026 ─────────────────────────────────────────────────

const REVIEW = "Claude, CRM review (truth), 8 November 2026";
const reviewBy = (evidence: string) => `${REVIEW}; evidence: ${evidence}`;

export const decision_contacts_convert_by_kept_mailbox = defineDecision({
  id: "contacts.convert-by-kept-mailbox",
  title: "A conversion first takes the person whose entry keeps the lead's mailbox",
  question:
    "`contacts.leads.convert` found the lead's person only through the Party of its mailbox. Since `contact change` " +
    "no longer links (contacts.book-verbs), and a head's edit of a private Contact's mailbox comes in through the same " +
    "checks, a private person can keep that mailbox as a detail with no Party. Frappe's `convert_to_deal` finds the " +
    "person by Contact Email (`contact_exists`). Which entry does a conversion take?",
  options: [
    {
      label: "kept-mailbox",
      text:
        "The `--contact` given; else the book's Contact that keeps the lead's mailbox among its `email_ids`, case aside " +
        "(the latest changed if several), private or not, never linked by the match; else the entry of the mailbox's " +
        "Party, resolved through `parties.resolve-recipient` (an entry added by handle keeps no mailbox), or a new one " +
        "born from it; else, with no mailbox, a new private Contact. A new entry keeps the lead's mailbox, numbers and " +
        "job title, as Frappe's `create_contact` copies them.",
    },
    {
      label: "party-only",
      text:
        "As first booked: the Party's entry or a new one. A private person who keeps the mailbox is not found, and the " +
        "conversion enters them a second time.",
    },
    { label: "link-on-convert", text: "Take the private person and link it to the mailbox's Party in the conversion." },
  ],
  chosen: "kept-mailbox",
  why:
    "Refuted in review: with party-only, a private person who keeps nia@bakers.test as a detail is entered again by " +
    "converting a lead with that mailbox, against the conversion's own claim that nobody is entered twice, and against " +
    "Frappe, whose `contact_exists` matches 'only on email which uniquely identifies a person' in Contact Email, the " +
    "rows the book's `email_ids` are. Two entries for one person would also reach a head as two Contacts with one " +
    "mailbox. Matching the kept mailbox first finds every entry Frappe would; the Party's entry next finds one added by " +
    "handle, which keeps no mailbox (`contact add` #3) but is the same person. Link-on-convert would choose where money " +
    "paid to the entry goes without `contact link`'s preview, which contacts.book-verbs keeps for that step alone. A " +
    "match changes no Party, so a private person stays private and the lead's mailbox then names nobody in the " +
    "directory. Refines contacts.lead-conversion, whose person was the mailbox's entry.",
  source: reviewBy("frappe/crm@2cecd300 crm_lead.py:230 (create_contact), :335 (contact_exists, by Contact Email); contacts.book-verbs; contacts.head.sync"),
  affects: [rpc_contacts_leads_convert, operation_org_crm_lead_convert, table_contacts],
});

export const decision_contacts_lead_list_like_frappe = defineDecision({
  id: "contacts.lead-list-like-frappe",
  title: "The lead list leaves converted leads out, as Frappe CRM's does",
  question:
    "`contacts.leads.list` said it read the leads as Frappe CRM's list and kanban do, yet it listed converted leads by " +
    "default. Frappe CRM's Leads page passes `converted: 0` to every view (list, group by, kanban), and its quick " +
    "filters drop `converted`, so a converted lead is never listed there; it is reached from its deal. What does " +
    "`org crm lead list` list with no `--stage`?",
  options: [
    {
      label: "like-frappe",
      text:
        "The leads not converted, newest change first; `--stage converted` lists the converted ones, the only way to; " +
        "every other stage lists as before.",
    },
    { label: "every-lead", text: "Every lead, converted ones included, as first booked; only the words change." },
  ],
  chosen: "like-frappe",
  why:
    "Refuted in review against Frappe CRM's Leads page and its list api. The pipeline a member works is the leads still " +
    "to win or lose; a converted lead's work goes on in its deal, which `org crm deal list` shows and whose `lead` " +
    "names it, so listing it among open leads shows work already done, and the default list would grow with every " +
    "sale. `--stage converted` keeps every converted lead one command away, and `org crm lead get` still reads one. " +
    "Only the read changes: no table, machine or event, and `leads-by-activity` serves the list with converted rows " +
    "skipped. In org-with-crm the list now prints five leads, and Ivy's only under converted.",
  source: reviewBy("frappe/crm@2cecd300 frontend/src/pages/Leads.vue:26 (converted: 0 on every view), crm/api/doc.py:207; contacts.crm-statuses"),
  affects: [rpc_contacts_leads_list, flow_client_org_crm_leads_list, operation_org_crm_lead_list, table_leads],
});

// ── the CRM review (fit), 8 November 2026 ───────────────────────────────────────────────────

const FIT = "Claude, CRM review (fit), 8 November 2026";
const fitBy = (evidence: string) => `${FIT}; evidence: ${evidence}`;

export const decision_contacts_deal_list_filters = defineDecision({
  id: "contacts.deal-list-filters",
  title: "The deal list's filters apply together, as every other list's do",
  question:
    "`org crm deal list` took `--stage`, `--company` and `--contact`, and said to filter by one of them, but said " +
    "nothing of two given at once, so the build would choose. What does the list do when more than one is given?",
  options: [
    {
      label: "together",
      text:
        "Every filter given applies: `--company <Globex> --stage open` lists Globex's open deals. The rpc reads by the " +
        "narrowest index it has (a person's deals, else a company's, else a stage's, else all by last change) and checks " +
        "the other filters on each row, newest change first; the cursor stays bound to the Organization and the filters.",
    },
    { label: "one-only", text: "One filter at a time: two or more together are CLI_USAGE before any call." },
  ],
  chosen: "together",
  why:
    "Refuted in review (fit): the grammar's row gives the three flags side by side with no exclusion, and every list " +
    "of the 215 and of the other packs combines its filters (`activity list` its status, kind, direction and dates; " +
    "`org project list` its status, type, customer and member), as Frappe CRM's deals list combines its filters. A " +
    "pilot's question is often one company's open deals. A CLI_USAGE for a pair would be a refusal no other list has. " +
    "No table or index changes: one person's or one company's deals are few, so a row check after the narrowest " +
    "index stays within the read budget.",
  source: fitBy("docs/design/new-commands.md (5.2, G6); books/target/activity/operations.ts (activity list); books/target/projects/projects.ts (projects.projects.list); frappe/crm@2cecd300 crm_deal.py:304"),
  affects: [rpc_contacts_deals_list, flow_client_org_crm_deals_list, operation_org_crm_deal_list],
});

// ── the CRM's conversations (8 November 2026) ───────────────────────────────────────────────

const TALK = "Claude, CRM conversations pass (crm-conversations), 8 November 2026";
const talkBy = (evidence: string) => `${TALK}; evidence: ${evidence}`;
const WA_SRC = "frappe/whatsapp@59bf368";
const FRAPPE_SRC = "frappe/frappe@1a7ea577";

const TALK_OPS = [
  operation_org_crm_timeline, operation_org_crm_email_send, operation_org_crm_whatsapp_connect,
  operation_org_crm_whatsapp_disconnect, operation_org_crm_whatsapp_show, operation_org_crm_whatsapp_send,
  operation_org_crm_note_add, operation_org_crm_note_change, operation_org_crm_task_create, operation_org_crm_task_change,
  operation_org_crm_task_move, operation_org_crm_task_list, operation_org_crm_call_log,
];
const TALK_FLOWS = [
  flow_client_org_crm_emails_send, flow_client_org_crm_whatsapp_connect, flow_client_org_crm_whatsapp_disconnect,
  flow_client_org_crm_whatsapp_send, flow_client_org_crm_notes_add, flow_client_org_crm_notes_change,
  flow_client_org_crm_tasks_create, flow_client_org_crm_tasks_change,
];
const TALK_RPCS = [
  rpc_contacts_timeline_list, rpc_contacts_mail_send, rpc_contacts_mail_receive, rpc_contacts_whatsapp_connect,
  rpc_contacts_whatsapp_disconnect, rpc_contacts_whatsapp_show, rpc_contacts_whatsapp_send, rpc_contacts_whatsapp_receive,
  rpc_contacts_notes_save, rpc_contacts_tasks_save, rpc_contacts_tasks_move, rpc_contacts_tasks_list, rpc_contacts_calls_log,
];
const TALK_TABLES = [
  table_communications, table_inbound_mails, table_wa_accounts, table_wa_messages, table_crm_call_logs, table_crm_notes,
  table_crm_tasks, table_timeline_links,
];
const SENDS = [operation_org_crm_email_send, operation_org_crm_whatsapp_send];

export const decision_contacts_conversation_commands = defineDecision({
  id: "contacts.conversation-commands",
  title: "The CRM's conversations get thirteen commands in the one grammar",
  question:
    "Aaron's evening answer: the CRM tracks every conversation, email, WhatsApp, calls, notes and tasks, on one " +
    "timeline per contact, lead and deal, in Frappe CRM's shape, native. None is among the 215. Which commands does it " +
    "get, under rules.new-operations, and who may run them?",
  options: [
    {
      label: "thirteen",
      text:
        "Thirteen, in docs/design/new-commands.md's grammar (section 5.8), each one SDK method: `org crm timeline " +
        "<record>`; `org crm email send <record>`; `org crm whatsapp connect|disconnect|show|send`; `org crm note " +
        "add|change`; `org crm task create|change|move|list`; and `org crm call log <record>`. A record is a contact " +
        "entry's, a lead's or a deal's id. Every member reads; a member whose Safe wears the People hat writes " +
        "(contacts.crm-permission), and a task's assignee also moves their own (contacts.task-assignee). Reads are " +
        "`read`, a command that calls Resend or Meta `vendor`, the rest `write`; all `normal`.",
    },
    {
      label: "lifecycle-verbs",
      text:
        "As thirteen, but a task's statuses as lifecycle verbs (`org crm task start|complete|cancel|reopen`, or `done` " +
        "as first asked) and `org crm email reply` beside `send`: seventeen.",
    },
    { label: "timeline-only", text: "Only `org crm timeline`: conversations are written on a connected head's Frappe CRM." },
  ],
  chosen: "thirteen",
  why:
    "For Aaron: which commands the conversations get is this pack's question; its recommendation stands until he " +
    "answers. It serves aaron.crm-frappe-shape (the CRM is Frappe CRM's, and Frappe CRM's lead and deal pages are its " +
    "activity timeline, emails, calls, notes and tasks), aaron.sdk-reaches-everything (every capability through the " +
    "Core SDK and the CLI; the FDE works the CRM through these same methods, as its asker) and aaron.world-clock (each channel is " +
    "the world's), and carries out his evening answer that the CRM tracks every conversation natively. Timeline-only " +
    "would leave an Organization with no head unable to write to its customers, against the CRM being native from the " +
    "first day. The grammar decides the spelling: `org crm` as for leads and deals (G1, G2); `timeline` is a view, no " +
    "record kind, so it is read by its noun with the record as its argument, as the 215 read `org cap-table` and " +
    "`balance`; `send`, `connect|disconnect` and `log` are domain verbs (G3); a task moves through CRM Task's " +
    "statuses with `move`, as leads and deals move through theirs, rather than four lifecycle verbs or the brief's " +
    "`done`, which is no verb (contacts.task-verbs); a reply is `send --in-reply-to`, one command for one act " +
    "(contacts.conversation-spelling). A note is never removed (contacts.notes-kept). No command is `critical`: no B3 " +
    "pilot or start-up runs one.",
  source: talkBy("serves aaron.crm-frappe-shape, aaron.sdk-reaches-everything and aaron.world-clock; docs/decisions/open-for-aaron.md (evening: the CRM tracks every conversation); docs/design/new-commands.md (G1-G10)"),
  affects: [...TALK_OPS, ...TALK_FLOWS, ...TALK_RPCS, concept_contacts],
});

export const decision_contacts_conversations_shape = defineDecision({
  id: "contacts.conversations-shape",
  title: "Each conversation kind is its Frappe doctype, one table each, with links",
  question:
    "Frappe keeps an email as a Communication (with its Communication Link rows), a WhatsApp message as the WhatsApp " +
    "app's WA Message on a WA Account, a call as CRM Call Log, a note as FCRM Note and a task as CRM Task, each with a " +
    "reference to the lead or deal it is about. How does the CRM hold them?",
  options: [
    {
      label: "doctype-tables",
      text:
        "One table per doctype under Frappe's field names (communications, wa-accounts, wa-messages, crm-call-logs, " +
        "crm-notes, crm-tasks), each with Frappe's `reference_doctype` and `reference_name`, plus `timeline-links`, " +
        "Frappe's Dynamic Link rows, which put each item on every record whose timeline shows it; and `inbound-mails`, " +
        "the ids of what reached the mailbox before it is read.",
    },
    { label: "activities", text: "One `activities` table with a kind column and a JSON body for every kind." },
    { label: "head-only", text: "Keep conversations only on a connected head." },
  ],
  chosen: "doctype-tables",
  why:
    "contacts.frappe-shape took Frappe CRM table for table so a head syncs by mapping names; conversations follow it, " +
    "so a head's Frappe CRM shows them where it shows its own, and Frappe's rules are the book's (one primary " +
    "reference; a call's note is an FCRM Note; a task's statuses are CRM Task's). One activities table would hide each " +
    "kind's rules in JSON and make the sync a transformation. The links table is how Frappe itself puts a Communication " +
    "on several Contacts' timelines (`set_timeline_links`), and it lets one index serve every record's timeline. " +
    "Statuses that change are machines with one event each (communication, wa-message, wa-account, crm-task); a call's " +
    "outcome is a fact written once (contacts.call-logs). Only an Organization keeps them, as only an Organization has " +
    "a CRM. Head-only would leave the native CRM mute, against the evening answer.",
  source: talkBy(`${FRAPPE_SRC} communication.json, communication.py:428; ${WA_SRC} wa_message.json, wa_account.json; ${CRM} crm_call_log.json, fcrm_note.json, crm_task.json`),
  affects: [...TALK_TABLES, machine_communication, machine_inbound_mail, machine_wa_account, machine_wa_message, machine_crm_task, table_contact_changes],
});

export const decision_contacts_timeline = defineDecision({
  id: "contacts.timeline",
  title: "One timeline per contact, lead and deal; a deal's includes its lead's",
  question:
    "Frappe CRM's `get_activities` builds a lead's or deal's timeline from its versions, comments, communications, " +
    "calls, notes and tasks, a deal's with its lead's; Frappe's desk shows a Contact's from its timeline links. What is " +
    "on each record's timeline in Capxul, in what order, and what is left out?",
  options: [
    {
      label: "links",
      text:
        "Every item the timeline links put on the record, newest first by its world time (an email's or message's " +
        "send or receipt, a call's, note's or task's creation, as Frappe CRM sorts by `creation`; items written at one " +
        "instant as they were written, by their ids' ULIDs), each read as it stands; a deal's also reads " +
        "its lead's links, so a converted lead's history moves with it and is never copied; the record's own birth; " +
        "and the chain's money with its Party (contacts.timeline-money). An email or call links its record and every " +
        "contact entry keeping a mailbox or number it names. `--kind` filters. A converted lead takes no new item: its " +
        "deal carries the work on. Field changes are not shown: Capxul keeps no Version docs, and the change log holds " +
        "ids only (contacts.change-log).",
    },
    { label: "per-kind", text: "One list command per kind (emails, messages, calls, notes, tasks), as Frappe CRM's tabs show them." },
    { label: "versions", text: "As links, with a Version row per record change, to show field changes as Frappe does." },
  ],
  chosen: "links",
  why:
    "Aaron asked for one timeline per contact, lead and deal: one read that merges every kind is what a person or the " +
    "FDE needs before writing to someone, and Frappe CRM's activity tab is that merge. Reading the lead's links from " +
    "the deal is Frappe's own `get_deal_activities`, and it keeps one copy of each item. Linking every contact entry " +
    "a message names is Frappe's `set_timeline_links`, so Kim's timeline shows the email the pilot deal sent her. " +
    "Per-kind lists would split one story into five commands. Version rows would double every CRM write for a " +
    "history the stages' events already tell the funnel; they can be added later without changing a command. " +
    "Refusing new items on a converted lead follows contacts.lead-conversion (a converted lead changes no more).",
  source: talkBy(`${CRM} api/activities.py:16, :27, :193; ${FRAPPE_SRC} communication.py:428`),
  affects: [rpc_contacts_timeline_list, operation_org_crm_timeline, table_timeline_links, table_deals],
});

export const decision_contacts_timeline_money = defineDecision({
  id: "contacts.timeline-money",
  title: "A timeline shows the money the chain proves with the record's Party",
  question:
    "This pass's brief asks for payments and requests to a contact to show on its timeline; Aaron's evening answer " +
    "names email, WhatsApp, calls, notes and tasks, not money, so this is the pass's own extension. Contacts sits below payments and " +
    "requests (banking depends on contacts, requests on banking), so it can read neither's rows, and a flow belongs " +
    "higher up when it needs a concept its own does not depend on (CONVENTIONS rule 8). Contacts does depend on " +
    "indexing, whose views hold every PaymentSent and every escrow. What money does the timeline show?",
  options: [
    {
      label: "chain-now",
      text:
        "The chain's: each PaymentSent between the Organization's company Safe and the record's Party's Safe, either " +
        "way, with its token, amount, payment id and document hash; each claim escrow the company Safe sent that the " +
        "Party's Safe owns; and each invoice escrow the Party's Safe sends that the company Safe owns, each with its " +
        "standing, read from indexing's chain-payments and escrows. A request paid from the Party's Safe shows as its " +
        "payment, carrying its Invoice's hash; one an outside payer pays shows as its invoice escrow, since its payout's " +
        "PaymentSent names the escrow as sender. A request not yet funded, and a payment not yet sent (scheduled, " +
        "awaiting approval), do not show.",
    },
    {
      label: "activity-flow",
      text:
        "Book the timeline as activity's flow, with activity gaining contacts and requests as dependencies: contacts' " +
        "timeline rpc, then activity's feed of Payments with the Party (every status), then requests' issued to it.",
    },
    { label: "contacts-above-payments", text: "Make contacts depend on payments, so it reads every Payment; requests still cannot be read." },
  ],
  chosen: "chain-now",
  why:
    "For Aaron: whether a timeline must also show what is not on the chain yet, an Invoice issued but unpaid and a " +
    "payment scheduled or awaiting approval. Recommended: chain-now, which needs no new edge between concepts and " +
    "shows every payment once it moves, both ways, every paid Invoice by its hash (by its escrow when an outside payer " +
    "paid it) and money waiting for the contact; " +
    "unpaid requests stay one command away in `request list --org`. If he wants them on the timeline, activity-flow " +
    "is the way that keeps the concept map acyclic: it moves the command to activity (the read model of money) and " +
    "adds contacts and requests to activity's dependencies, a foundation change. Contacts-above-payments would still " +
    "miss requests and reorder the concept map for half the answer. A lead and a private entry have no Party, so their " +
    "timelines show no money. Money is read through indexing's chain views, which already scope each row to the " +
    "Safes the tenant owns.",
  source: talkBy("docs/decisions/open-for-aaron.md (evening); books/target/shared/foundation.ts (contacts, banking, requests, activity dependsOn); CONVENTIONS rule 8"),
  affects: [rpc_contacts_timeline_list, operation_org_crm_timeline, table_chain_payments, table_escrows],
});

export const decision_contacts_crm_mailbox = defineDecision({
  id: "contacts.crm-mailbox",
  title: "Each Organization's CRM has one mailbox, `<handle>@<CRM_MAIL_DOMAIN>`",
  question:
    "Email in and out goes through a per-Organization CRM mailbox, on the mail integration notices already uses. " +
    "Frappe keeps a mailbox as an Email Account (one address, IMAP or a forward in, SMTP out). Which address is it, " +
    "how is it set up, and how does a sent email name its sender?",
  options: [
    {
      label: "handle-mailbox",
      text:
        "The address is the Organization's handle at the deployment's CRM_MAIL_DOMAIN (`acme@crm.capxul.app`; on a " +
        "devnet `acme@crm.devnet.test`), which Resend receives for: it exists from the Organization's birth, since a " +
        "handle never changes, so nothing is set up and no row holds it. An email goes From `<member's name> at " +
        "<Organization's name>` at that address, Reply-To the same, with Capxul's own Message-ID, so a reply comes back " +
        "and threads. A notice's mail stays SENDER_EMAIL's (notices.mail-channel).",
    },
    { label: "own-domain", text: "Each Organization connects its own domain (DNS records for Resend) before it can send." },
    { label: "member-mailboxes", text: "Each member connects their own mailbox (Gmail, Outlook) as a Frappe Email Account." },
  ],
  chosen: "handle-mailbox",
  why:
    "A mailbox derived from the handle works from the first day with no step a founder must take, as the CRM is " +
    "fundamental from birth (aaron.frappe-shape), and it is one address the whole Organization shares, as Frappe CRM's " +
    "shared Email Account is. Resend receives a domain's mail and posts a signed event, so the integration notices " +
    "uses gains its inbound half and no IMAP poller, which P3 would forbid as a cron. An Organization's own domain is " +
    "better branding and can be added later as a setting without changing a command; member mailboxes would put each " +
    "member's private mail in reach and need OAuth with each provider. A sender named `<member> at <Organization>` " +
    "says who wrote it while replies still reach everyone working the record. A handle's `_` and `-` are valid in an " +
    "address's local part. The domain is a deployment setting, CRM_MAIL_DOMAIN, in each environment.",
  source: talkBy(`${FRAPPE_SRC} email/doctype/email_account (append_to, use_imap); books/target/shared/external.ts (mail); books/target/parties/data.ts (handles never change)`),
  affects: [rpc_contacts_mail_send, rpc_contacts_mail_receive, integration_mail, table_communications],
});

export const decision_contacts_mail_threading = defineDecision({
  id: "contacts.mail-threading",
  title: "Inbound mail threads by Message-ID, then by mailbox, else it makes a lead",
  question:
    "Frappe's receive.py threads an inbound email by its In-Reply-To (a Communication's or an Email Queue's " +
    "Message-ID), then by a `#name` or subject-and-sender match on the Email Account's `append_to` doctype, else makes " +
    "a new document of it. Which record does an email to the CRM mailbox land on?",
  options: [
    {
      label: "id-then-mailbox",
      text:
        "Its In-Reply-To, then each References id newest first, naming a communication of the Organization: the same " +
        "record. Else the sender's mailbox: the latest-changed lead not converted whose `email` it is, else the " +
        "latest-changed contact entry keeping it; from a member of the Organization, the first recipient so matched. " +
        "Else a new lead from the sender, source Email. The mailbox's own mail, a Message-ID already held and a " +
        "member's unmatched mail are dropped, with the reason.",
    },
    { label: "frappe-subject", text: "As id-then-mailbox, with Frappe's subject-and-sender match within 60 days before the mailbox." },
    { label: "no-new-leads", text: "As id-then-mailbox, but an unknown sender's mail waits unthreaded for a member to place it." },
  ],
  chosen: "id-then-mailbox",
  why:
    "The Message-ID chain is the one identity an email carries, and Capxul writes its own Message-IDs, so every reply " +
    "to a CRM email threads exactly; References covers a client that drops In-Reply-To. A subject is no identity: two " +
    "customers' 'Invoice' would merge, which is why Frappe guards it with a sender and a 60-day window, and the " +
    "mailbox match after the thread already gives what that guard leaves. A lead before a contact follows Frappe " +
    "CRM, whose Email Account appends to CRM Lead; the latest changed wins, as `contacts.convert-by-kept-mailbox` " +
    "chooses. A member's own reply or a copy they send the mailbox (as a CRM's BCC address is used) lands on the " +
    "person they wrote to, never on the member; one that names no one is dropped, since a member is never a lead. " +
    "An unknown sender becomes a lead as Frappe CRM makes one, so no email is lost; spam control is the provider's.",
  source: talkBy(`${FRAPPE_SRC} email/receive.py:829 (parent_communication), :864 (reference_document), :903, :943; ${CRM} install.py:438 (lead source Email)`),
  affects: [workflow_contacts_mail_thread, table_communications, table_inbound_mails, machine_inbound_mail],
});

export const decision_contacts_mail_inbound = defineDecision({
  id: "contacts.mail-inbound",
  title: "A mail event is stored at once; each email's own process reads and threads it",
  question:
    "Resend posts a signed event for each email it receives, naming the email by id; the body is read with a second " +
    "call. Frappe pulls a mailbox over IMAP on a schedule. Where does reading and threading happen?",
  options: [
    {
      label: "store-then-process",
      text:
        "`contacts.mail.receive` checks the signature and stores one inbound row per CRM mailbox the email was received " +
        "for (Resend's `received_for`, so a BCC copy counts, which `to` and `cc` would miss), in " +
        "one transaction, and answers; a process per row (`contacts.mail.thread`) reads the email and threads it, " +
        "retried durably. The same route moves a sent email's delivery from Resend's delivered, bounced and complained " +
        "events.",
    },
    { label: "in-webhook", text: "Read and thread inside the webhook's rpc, and let Resend retry a failure." },
    { label: "imap-poll", text: "Poll the mailbox, as Frappe's Email Account does." },
  ],
  chosen: "store-then-process",
  why:
    "Resend waits seconds for an answer and retries a failed delivery for a limited time, so reading the body inside " +
    "the webhook would lose an email to a long Resend outage; storing the id first and reading it in a durable process " +
    "keeps it until it is read, and the inbound row makes a repeated event a no-op (Frappe's `is_exist_in_system`). A " +
    "poll would be a new cron, which P3 does not keep, and would date mail by the poll, not by its arrival on the " +
    "world's clock. Delivery events name only the provider's id, hence its cross-tenant index; a notice's events find " +
    "no communication and are ignored.",
  source: talkBy(`${FRAPPE_SRC} email/receive.py:719, :791; docs/decisions/policy-pack.md (P3); books/target/shared/external.ts (mail)`),
  affects: [rpc_contacts_mail_receive, workflow_contacts_mail_thread, table_inbound_mails, machine_communication],
});

export const decision_contacts_whatsapp_connect = defineDecision({
  id: "contacts.whatsapp-connect",
  title: "An Organization connects its own WhatsApp Business number, one at a time",
  question:
    "WhatsApp goes through Meta's WhatsApp Business Cloud API as an integration an Organization connects. Frappe's " +
    "WhatsApp app keeps a WA Account (phone id, business id, app id, access token) and a webhook with a verify token " +
    "and app secret. How does an Organization connect, where do the secrets live, and how is the connection kept?",
  options: [
    {
      label: "own-number",
      text:
        "The Organization brings its number, its WhatsApp Business Account and a system user's token from its own " +
        "Meta app: `org crm whatsapp connect --key-file` reads the ids and secrets, Capxul checks the number with Meta, " +
        "subscribes the app to the number's WhatsApp Business Account (Meta sends no webhook otherwise), seals the " +
        "secrets on the account's row and prints the webhook route, one per account, to set as the app's callback " +
        "with the verify token. One live number per Organization and one Organization per number. The account's " +
        "process checks the number daily and marks it failing while Meta refuses it.",
    },
    {
      label: "embedded-signup",
      text: "Capxul is a Meta Tech Provider: one Capxul app, Embedded Signup in the web app, one webhook for all.",
    },
    { label: "head-only", text: "WhatsApp only through a connected head's WhatsApp app." },
  ],
  chosen: "own-number",
  why:
    "Bringing its own Meta app is how Frappe's WhatsApp app connects, needs nothing of Capxul beyond the API, and keeps " +
    "each Organization's messages under its own WhatsApp Business Account. Embedded Signup needs Capxul to be a " +
    "verified Tech Provider and a browser flow, which the CLI-first surface cannot run; it can be added later beside " +
    "this one. Head-only would leave a CRM with no head without WhatsApp. The subscription is the WhatsApp app's own " +
    "`subscribe_webhook`, whose source notes that the dashboard's webhook verification does not subscribe the app, so " +
    "connect makes it rather than leave a number that never hears back. A route per account lets each delivery be " +
    "checked against its own app secret with no session, and a disconnected account's route refuses. The secrets are " +
    "record-bound encrypted like a head's key and never read back. A daily check, the process's own timer, catches a " +
    "revoked token before a person's send does. On a devnet the stand-in's key file gives every field (aaron.world-" +
    "clock, devnet.whatsapp-stand-in).",
  source: talkBy(`${WA_SRC} wa_account.json, wa_settings.json, webhook.py:30, api/whatsapp.py:10; devnet.whatsapp-stand-in`),
  affects: [
    rpc_contacts_whatsapp_connect, rpc_contacts_whatsapp_disconnect, rpc_contacts_whatsapp_show, rpc_contacts_whatsapp_receive,
    workflow_contacts_whatsapp_account, table_wa_accounts, machine_wa_account, integration_whatsapp,
  ],
});

export const decision_contacts_whatsapp_threading = defineDecision({
  id: "contacts.whatsapp-threading",
  title: "A WhatsApp message lands on the contact whose number it is, else a new lead",
  question:
    "Frappe CRM's WhatsApp hook resolves an incoming message's number to a Contact, lead or deal " +
    "(`find_contact_lead_or_deal_from_number`) and, when the account appends to CRM Lead, makes a lead for a new " +
    "sender. Which record does a message land on in Capxul?",
  options: [
    {
      label: "context-then-number",
      text:
        "A reply to a message of this account (its context id): the same record. Else the latest-changed contact " +
        "entry keeping the number, else the latest-changed lead not converted whose `mobile_no` or `phone` it is. Else " +
        "a new lead with the sender's profile name, the number and source WhatsApp. A message sent is about the record " +
        "it was sent from.",
    },
    { label: "unmatched", text: "As context-then-number, but a new sender's message waits unthreaded." },
  ],
  chosen: "context-then-number",
  why:
    "WhatsApp's context id is the message's own thread, as Message-ID is email's. Frappe CRM's order for a number is " +
    "a deal (the one its primary contact heads, whichever the database returns), then an open lead, then the Contact " +
    "(`find_by_phone`). Capxul puts it on the contact, as the brief asks: a person often heads several deals (Kim " +
    "heads three), so a deal would be a guess, and a number is a person's; an open lead comes next, for a prospect " +
    "with no entry yet. Frappe CRM makes a lead for a new sender only when the account's append action to CRM Lead is " +
    "set (an opt-in); Capxul always does, with source WhatsApp, so no conversation is lost. The timeline links put " +
    "the message on every entry keeping the number, as for email.",
  source: talkBy(`${CRM} api/whatsapp.py:42, :70; ${CRM} integrations/api.py:195 (find_by_phone); ${WA_SRC} webhook.py:126; ${CRM} install.py:438 (lead source WhatsApp)`),
  affects: [rpc_contacts_whatsapp_receive, rpc_contacts_whatsapp_send, table_wa_messages, machine_wa_message],
});

export const decision_contacts_whatsapp_window = defineDecision({
  id: "contacts.whatsapp-window",
  title: "A free-form WhatsApp text goes only in the 24-hour window, on the world's clock",
  question:
    "WhatsApp lets a business send a free-form message only within 24 hours of the person's last message to it; " +
    "outside that window only an approved template goes, and Meta refuses anything else (code 131047). Where is the " +
    "window checked, and on whose clock?",
  options: [
    {
      label: "world-window",
      text:
        "Capxul checks it before calling Meta, from the last Incoming message from that number to the account, 24 " +
        "hours on the world's clock: a text outside it is WRONG_STATE naming the window, and Meta's own refusal maps " +
        "to the same code. A template goes any time.",
    },
    { label: "meta-only", text: "Send and let Meta refuse." },
  ],
  chosen: "world-window",
  why:
    "aaron.world-clock: everything in a world follows its clock, WhatsApp included, so a world at rate 4 closes the " +
    "window after six real hours, and a warp past it closes it at once, which an eval can show. Meta's real window on " +
    "staging runs on real time, and its refusal is the same code, so the behaviour is one. Checking first spares a " +
    "vendor call and tells the person to send a template.",
  source: talkBy("aaron.world-clock; time.world-channels; developers.facebook.com WhatsApp Cloud API error code 131047; devnet.whatsapp-stand-in (refuse)"),
  affects: [rpc_contacts_whatsapp_send, operation_org_crm_whatsapp_send, table_wa_messages, integration_whatsapp],
});

export const decision_contacts_conversations_on_the_world_clock = defineDecision({
  id: "contacts.conversations-on-the-world-clock",
  title: "Every conversation is dated by the world's clock, on the world's own channels",
  question:
    "aaron.world-clock: a world is self-contained and everything in it follows its clock, emails and WhatsApp " +
    "included, and each channel is the world's (time.world-channels). What does that mean for the CRM's conversations?",
  options: [
    {
      label: "world-dated",
      text:
        "Every time the CRM writes is the world's now: an email's `communication_date`, a message's `timestamp`, a " +
        "call's logging and default end, a note's and task's times, a task's `completed_at`; and the WhatsApp window is counted " +
        "on it. A vendor's own envelope stays real and is kept apart (an email's Date header as `envelope_date`, a " +
        "webhook signature's timestamp checked against real time, time.real-elapsed). On a devnet and in a shared " +
        "world, mail goes to the sink and comes from `capxul-devnet mail receive`, WhatsApp to and from the stand-in; " +
        "on staging Resend and Meta's test number, held to the world's recipients.",
    },
    { label: "envelope-dated", text: "Date each email by its Date header and each message by Meta's timestamp." },
  ],
  chosen: "world-dated",
  why:
    "A timeline is one story only if every item on it is dated on one clock: a reply received in a world at rate 4 " +
    "must sort after the email it answers, whatever the real clock or the sender's says, and a warp must move what is " +
    "due. Keeping the envelope apart keeps the vendor's facts honest without mixing clocks. The channels are the " +
    "world's so an eval reads every message in the sink or the stand-in, and nothing a world says reaches a real person.",
  source: talkBy("aaron.world-clock; books/target/shared/time.ts (time.world-channels, time.real-elapsed); devnet.whatsapp-stand-in"),
  affects: [...TALK_TABLES.filter((t) => t !== table_timeline_links), integration_mail, integration_whatsapp],
});

export const decision_contacts_task_verbs = defineDecision({
  id: "contacts.task-verbs",
  title: "A CRM task moves through CRM Task's statuses with `move`",
  question:
    "CRM Task has five statuses (Backlog, Todo, In Progress, Done, Canceled) and Frappe CRM moves a task between any " +
    "two, on its status menu and its board. The brief named `org crm task create|done`. How are the moves spelt?",
  options: [
    { label: "move", text: "`org crm task move <task> <status>`, as `org crm lead move` and `org crm deal move` move theirs." },
    { label: "lifecycle", text: "`org crm task start|complete|cancel|reopen`, as projects' `org task` does." },
    { label: "done", text: "`org crm task done <task>`, and the others by `change --status`." },
  ],
  chosen: "move",
  why:
    "G3 names a status change by a lifecycle verb or a domain verb, never `change`; the CRM already moves leads and " +
    "deals through Frappe CRM's statuses with `move`, so its tasks do too, one verb for one kind of step within one " +
    "app, and any status may follow any as on Frappe's board. Projects' tasks follow ERPNext's Task, whose transitions " +
    "have guards (dependencies, review), so lifecycle verbs fit there; CRM Task has none. `done` is not a verb and " +
    "would leave four statuses to `change`, against G3. The machine still names each stage change: start, complete, " +
    "cancel, reopen.",
  source: talkBy(`docs/design/new-commands.md (G3, 5.1, 5.2); ${CRM} crm_task.json (status options); contacts.crm-verbs`),
  affects: [operation_org_crm_task_move, rpc_contacts_tasks_move, machine_crm_task],
});

export const decision_contacts_task_assignee = defineDecision({
  id: "contacts.task-assignee",
  title: "A CRM task's assignee moves their own task without the People hat",
  question:
    "Writing to the CRM needs the People hat (contacts.crm-permission). A task is assigned to a member, often one " +
    "without it, who is asked to do it. May they mark it in progress or done?",
  options: [
    { label: "assignee-moves", text: "The assignee moves their own task's status; making, changing and reassigning stay the People hat's." },
    { label: "hat-only", text: "Only the People hat moves any task." },
  ],
  chosen: "assignee-moves",
  why:
    "A task is the CRM asking a member to act; one who cannot say they acted would have to ask a hat wearer to say it " +
    "for them. G4's Self term (a person for their own records) and projects.permissions (members work their own " +
    "tasks) already admit it, and Frappe CRM's Sales User updates the tasks assigned to them. Moving a status changes " +
    "no record the money path reads and names no Party, so the People hat's guard over the book is untouched. An agent " +
    "assigned a task moves it the same way.",
  source: talkBy("docs/design/new-commands.md (G4: Self, Worker); projects.permissions; contacts.crm-permission"),
  affects: [rpc_contacts_tasks_move, operation_org_crm_task_move, table_crm_tasks],
});

export const decision_contacts_notes_kept = defineDecision({
  id: "contacts.notes-kept",
  title: "A note is changed, never removed; pinning is not booked",
  question: "Frappe CRM lets a note be edited, pinned and deleted. Which of these does the CRM take?",
  options: [
    { label: "change-only", text: "`org crm note add` and `change`; no remove, no pin." },
    { label: "full", text: "Add, change, remove, pin and unpin." },
  ],
  chosen: "change-only",
  why:
    "A record's history is what a person or the FDE reads before writing to a customer, and every other CRM record " +
    "(an entry, a lead, a deal, a task) is kept and never deleted, so a note is too; a wrong one is changed. Pinning is " +
    "a page's layout, which no CLI reader needs yet, and it can be added as `pin|unpin` later.",
  source: talkBy(`${CRM} fcrm_note.json (pinned), api/activities.py:556; contacts.frappe-shape (kept records)`),
  affects: [table_crm_notes, rpc_contacts_notes_save, operation_org_crm_note_add, operation_org_crm_note_change],
});

export const decision_contacts_call_logs = defineDecision({
  id: "contacts.call-logs",
  title: "Calls are logged by hand; a call's outcome is a fact, not a machine",
  question:
    "CRM Call Log serves telephony (Twilio, Exotel), whose calls move through Initiated, Ringing and In Progress, and " +
    "manual logs. Which does the CRM take, and is a call's status a state machine?",
  options: [
    {
      label: "manual",
      text:
        "Manual logs only, `telephony_medium` Manual, with one of CRM Call Log's final statuses written once; the " +
        "member who made or took it, the other party's number, start, end or duration (a call that is over: it ends " +
        "no later than the world's now, by default just now), placed on the timeline when logged, and a note as an " +
        "FCRM Note.",
    },
    { label: "telephony", text: "Book a telephony integration and the call's live statuses as a machine." },
  ],
  chosen: "manual",
  why:
    "A call log records what happened; no command moves it later, so a machine would have only births. Telephony needs " +
    "a vendor no ruling names and a world stand-in for phone calls; manual logs give the timeline its calls now, and " +
    "a telephony integration can add live statuses later. A final status is a call already over, so a log with no start " +
    "ended when it was logged, and none ends in the world's future. Frappe CRM's timeline sorts a call by its " +
    "`creation`, so a call logged late still shows when it was logged, with its own start and end. A log's note as an " +
    "FCRM Note is Frappe CRM's own link, so a head shows both.",
  source: talkBy(`${CRM} crm_call_log.json (status, telephony_medium, note), crm_call_log.py:50`),
  affects: [table_crm_call_logs, rpc_contacts_calls_log, operation_org_crm_call_log],
});

export const decision_contacts_conversations_head_sync = defineDecision({
  id: "contacts.conversations-head-sync",
  title: "Notes, tasks and calls sync both ways; emails and messages only to the head",
  question:
    "A connected head runs Frappe CRM, which keeps the same doctypes. Which conversations does `contacts.head.sync` " +
    "push and pull, and what does a head never change?",
  options: [
    {
      label: "channel-is-capxul",
      text:
        "Every conversation record goes into the change log and is pushed. Notes, tasks and call logs are pulled back " +
        "by the CRM's rules, a People hat wearer's edit applied. Emails and WhatsApp messages are pushed only: a head " +
        "never sends through its own Email Account or WA Account for the Organization's CRM, so a Communication or WA " +
        "Message born on the head is refused and left unadopted. A WA Account is never synced: its secrets are Capxul's.",
    },
    { label: "all-both-ways", text: "Sync every conversation both ways, a head's own sends included." },
  ],
  chosen: "channel-is-capxul",
  why:
    "The mailbox and the number are Capxul's channels, held to the world (aaron.world-clock): a head sending through " +
    "its own would put mail outside the world's clock and channels, and would not thread back, since only Capxul writes " +
    "the Message-IDs. Notes, tasks and calls are records people type, and Frappe CRM's pages edit them, so they come " +
    "back as leads and deals do. Email Account is already the head's machinery that the document family refuses " +
    "(organizations.doc-reach).",
  source: talkBy("contacts.head-sync; organizations.head-ownership; books/target/organizations/data.ts (HEAD_MACHINERY: Email Account)"),
  affects: [workflow_contacts_head_sync, table_contact_changes, ...TALK_TABLES],
});

export const decision_contacts_attachments_later = defineDecision({
  id: "contacts.attachments-later",
  title: "An email's attachments are named, not kept, until contacts can store files",
  question:
    "An inbound email or WhatsApp message may carry attachments or media. Frappe keeps them as Files attached to the " +
    "Communication. Contacts depends on neither media nor documents, which store files. What does it keep?",
  options: [
    { label: "names", text: "Each attachment's name, type and size (a WhatsApp media message's Meta id and type); never its bytes. Sends carry none." },
    { label: "media-now", text: "Add media to contacts' dependencies and keep every attachment there." },
  ],
  chosen: "names",
  why:
    "For Aaron: whether the CRM should keep attachments now. Recommended: names now. Keeping files needs a foundation " +
    "edge from contacts to media and a retention rule for customers' files, a decision of its own; the timeline still " +
    "says an attachment came, and the provider keeps the email for a while. Sending attachments waits for the same edge.",
  source: talkBy(`${FRAPPE_SRC} email/receive.py:617 (get_attachment), :655; books/target/shared/foundation.ts (contacts dependsOn)`),
  affects: [table_communications, table_wa_messages, rpc_contacts_mail_send],
});

export const decision_contacts_sends_preview = defineDecision({
  id: "contacts.sends-preview",
  title: "A send, and connecting or disconnecting WhatsApp, preview at a terminal",
  question:
    "G5: a command that cannot be undone, or that hands records to an outside system, previews and asks. Which of the " +
    "conversation commands do?",
  options: [
    {
      label: "sends-and-channel",
      text:
        "`org crm email send` and `org crm whatsapp send` (a message cannot be taken back), and `org crm whatsapp " +
        "connect` and `disconnect` (they hand the CRM's conversations to Meta, or stop them). `--confirm` answers yes " +
        "from a script; a decline is CANCELLED; the hosted FDE never answers one for its asker. Notes, tasks and call " +
        "logs, which stay in Capxul and can be changed, do not.",
    },
    { label: "none", text: "No preview: a send is what the person asked for." },
  ],
  chosen: "sends-and-channel",
  why:
    "An email or message reaches a person outside Capxul and cannot be recalled, as `request issue` reaches its payer " +
    "after its own `--confirm`; a script confirms as every other such command does. A preview is the asker's own to " +
    "answer (new-commands G4, organizations.fde-for-the-asker), so each of the four rpcs, and `contact link`'s, refuses " +
    "the hosted FDE's act-for call with ROLE_PERMISSION_DENIED: the FDE drafts the message and the member sends it. " +
    "Revised in review (fit): the first pass let the FDE confirm. The preview resolves nothing before the write, as " +
    "`contact link`'s does, so a terminal run makes the same one call a script makes.",
  source: talkBy("docs/design/new-commands.md (G4, G5); aaron.fde-anyone; organizations.fde-for-the-asker; vocabulary.declined-preview-cancelled; contacts.book-verbs"),
  affects: [
    ...SENDS, operation_org_crm_whatsapp_connect, operation_org_crm_whatsapp_disconnect, operation_contact_link,
    flow_client_org_crm_emails_send, flow_client_org_crm_whatsapp_send, rpc_contacts_mail_send, rpc_contacts_whatsapp_send,
    rpc_contacts_whatsapp_connect, rpc_contacts_whatsapp_disconnect, rpc_contacts_book_record,
  ],
});

export const decision_contacts_conversation_worlds = defineDecision({
  id: "contacts.conversation-worlds",
  title: "Conversation commands start from org-with-crm or org-with-conversations",
  question: "The thirteen commands' claims and refusals need worlds. org-with-crm holds Acme's CRM but no conversation. Which worlds do they start from?",
  options: [
    {
      label: "one-more-world",
      text:
        "org-with-crm for what needs no conversation (a first send, a first connect, a converted lead's refusals, " +
        "no number connected), and a new org-with-conversations built from it by the commands and the world's own " +
        "controls: Kim's number +447700900789 and Ivy's +447700900444; Acme's stand-in number +447700900100 connected; " +
        "the Globex pilot's `Pilot proposal` emailed to Kim and her reply threaded by Message-ID; Nia Bloom's " +
        "`Deliveries` email making her lead; Kim's WhatsApp `Is the pilot still on?` and Dan's `Yes, from 6 January.`; " +
        "the pilot's note `Budget` and task `Send the contract` assigned to Rex; a call logged with Kim; and 40 USDC " +
        "from Acme waiting for Kim in a claim escrow. Dan current; Rex with no hat.",
    },
    { label: "extend", text: "Add the conversations to org-with-crm itself." },
  ],
  chosen: "one-more-world",
  why:
    "One snapshot reaches every remaining claim and refusal, and building it with the commands and the stand-ins' " +
    "controls keeps the world a black box (devnet.deterministic-worlds): an inbound email or message is the outside " +
    "party acting, which no Capxul surface makes, so it is a supervisor control. Extending org-with-crm would change " +
    "what the fourteen CRM commands' claims read there. For the devnet's owner: the catalog entry, and " +
    "`capxul-devnet mail receive`, are theirs to add (contacts' forOthers).",
  source: talkBy("books/target/devnet/worlds.ts (org-with-crm); devnet.deterministic-worlds; devnet.whatsapp-stand-in; contacts.crm-worlds"),
  affects: TALK_OPS,
});

// ── review, crm-conversations (truth): what the real systems do ─────────────────────────────

const TRUTH_REVIEW = "Claude, review of crm-conversations (truth lens), 8 November 2026";

export const decision_contacts_whatsapp_early_status = defineDecision({
  id: "contacts.whatsapp-early-status",
  title: "A WhatsApp status that overtakes its send is redelivered, not dropped",
  question:
    "Meta answers a send with its wamid and then posts the message's `sent` and `delivered` statuses, which can reach " +
    "the route before the send's own transaction commits; the stand-in posts them at once. The WhatsApp app logs and " +
    "drops a status for a wamid it does not hold. What does the CRM do with one?",
  options: [
    {
      label: "redeliver",
      text:
        "A status naming no message of the account, dated within five minutes of the world's now, is counted early: " +
        "the route stores the rest of the body and answers 503, and Meta redelivers it, as it redelivers any delivery " +
        "not answered 200 for up to 7 days. An older one is ignored.",
    },
    { label: "drop", text: "Ignore it, as the WhatsApp app does." },
    { label: "hold", text: "Keep it in a table of its own until a message with its wamid is written." },
  ],
  chosen: "redeliver",
  why:
    "Dropping it would leave a delivered message `sent` for good whenever Meta, or the stand-in, is quicker than the " +
    "commit, and `org crm whatsapp send`'s claim that its delivery shows on the timeline could not be observed. Meta's " +
    "own redelivery is the queue, so nothing new is kept, and a repeated body changes nothing (wamids are unique per " +
    "Organization). The five minutes bound a status of a message sent outside Capxul on the same number (a head's " +
    "WhatsApp app): it is retried briefly, then ignored. The bound is on the world's now, since the status is dated " +
    "there, by Meta's clock in production and the stand-in's on a devnet (time.world-channels). Holding statuses would " +
    "need a table and a sweep for those that never match.",
  source: `${TRUTH_REVIEW}; evidence: frappe/whatsapp@59bf368 webhook.py:242; developers.facebook.com WhatsApp Cloud API webhooks (redelivered for up to 7 days); devnet.whatsapp-stand-in`,
  affects: [rpc_contacts_whatsapp_receive, operation_org_crm_whatsapp_send, integration_whatsapp],
});

// ── review, crm-conversations (fit): the grammar and the rulings ────────────────────────────

const FIT_REVIEW = "Claude, review of crm-conversations (fit lens), 9 November 2026";

export const decision_contacts_conversation_spelling = defineDecision({
  id: "contacts.conversation-spelling",
  title: "The conversation commands' flags and methods, held to the one grammar",
  question:
    "The first booking of contacts.conversation-commands spelt a reply `--reply-to <email>`, a note's title `--title` " +
    "where a task's is its argument, a task's member `--assign` on create and `--assigned` on list, and gave each of " +
    "the thirteen methods a flow, five of them one rpc call. How does each fit docs/design/new-commands.md?",
  options: [
    {
      label: "grammar",
      text:
        "A reply is `--in-reply-to <id>` on both sends (Frappe's Communication `in_reply_to`, the header it sets); a " +
        "note's title is `org crm note add <record> <title>`, as `org crm task create <record> <title>` and `org task " +
        "create <subject>`; a task's member is `--assigned-to <member>` on create, change and list, the field it prints; " +
        "`org crm task change` takes `--title`; a task's due time is `--due`, CRM Task's `due_date`, an instant, beside " +
        "G5's `--by` and `--close-by`; `org crm timeline <record>` is a view read by its noun, its method " +
        "`client.org(orgId).crm.timeline`. The timeline, `whatsapp show`, a task's move and list, and a call's log are " +
        "each implemented by their one rpc; the four other writes and the sends keep their flows.",
    },
    { label: "as-booked", text: "Keep the first booking's spellings and flows." },
  ],
  chosen: "grammar",
  why:
    "G5 makes `<email>` a mailbox, and `--reply-to` is the Reply-To header the send itself sets (`git send-email` " +
    "keeps `--in-reply-to` for the thread and `--reply-to` for the address), so `--reply-to <email>` would be read as " +
    "an address. A record's required name is its argument across the grammar (`org project create <name>`, `org task " +
    "create <subject>`, `contact create <label>`), and Frappe requires both a note's and a task's title. One field " +
    "gets one flag, named as it prints, as `org crm deal list --company` repeats create's; and create's title being " +
    "an argument, change needs `--title` or a task could not be renamed. A due time is not a period's end, which G5 " +
    "spells `--end`, and Frappe calls it due. A view of one record has no record kind to verb, so it is read by its " +
    "noun as the 215 read `org cap-table` and `activity events`. G7: a method that is one rpc call is implemented by " +
    "that rpc, and its exception covers only flows the CRM had before; note add and change, and task create and " +
    "change, are two methods over one save rpc each, and the sends and WhatsApp's connect and disconnect preview.",
  source: `${FIT_REVIEW}; evidence: docs/design/new-commands.md (G3, G5, G7, 5.1, 5.2); frappe/frappe@1a7ea577 communication/email.py:60 (in_reply_to); frappe/crm@2cecd300 fcrm_note.json and crm_task.json (title reqd, assigned_to, due_date)`,
  affects: [...TALK_OPS, ...TALK_FLOWS, rpc_contacts_mail_send, rpc_contacts_whatsapp_send, rpc_contacts_timeline_list, rpc_contacts_whatsapp_show, rpc_contacts_tasks_move, rpc_contacts_tasks_list, rpc_contacts_calls_log],
});

// ── the world pass's build (9 November 2026): staging's WhatsApp stays in its world ─────────

import { environment_staging } from "../shared/foundation.ts";

export const decision_contacts_whatsapp_staging_numbers = defineDecision({
  id: "contacts.whatsapp-staging-numbers",
  title: "On staging, `org crm whatsapp connect` admits only Meta's test numbers",
  question:
    "Staging is self-contained by its channels (time.world-channels): its mail reaches only MAIL_ALLOWED_RECIPIENTS. " +
    "Meta's test number sends only to its registered recipients, but nothing stopped an Organization on staging from " +
    "connecting a real Business number, which would message real people. How is staging's WhatsApp held to its world?",
  options: [
    {
      label: "allow-list",
      text:
        "A staging setting, WHATSAPP_ALLOWED_NUMBERS, lists the phone number ids of the Meta test numbers staging may " +
        "use; `contacts.whatsapp.connect` refuses any other `phone_id` on staging, INVALID_INPUT before any call to " +
        "Meta, as mail refuses an address MAIL_ALLOWED_RECIPIENTS does not list. A devnet and a shared world use the " +
        "stand-in, and production lists none.",
    },
    { label: "verified-name", text: "Admit a number only when Meta reads its verified name as its test number's." },
    { label: "none", text: "Trust each Organization to connect only a test number on staging." },
  ],
  chosen: "allow-list",
  why:
    "A deployment setting is checked before any call and holds whatever Meta names its test numbers; a verified name " +
    "is Meta's display text, not a promise, and trusting each Organization would let one staging tenant message real " +
    "people. It mirrors MAIL_ALLOWED_RECIPIENTS, so both of staging's outside channels are held the same way.",
  source: "Claude, world pass build, 9 November 2026; evidence: time.world-channels; contacts.whatsapp-connect; Meta's test business number (registered recipients only)",
  affects: [rpc_contacts_whatsapp_connect, environment_staging, integration_whatsapp],
});

// Moved out of the built book by the cut, 10 November 2026, from books/target/contacts/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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
import { environment_staging } from "../shared/foundation.ts";

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
    "`org projects list` its status, type, customer and member), as Frappe CRM's deals list combines its filters. A " +
    "pilot's question is often one company's open deals. A CLI_USAGE for a pair would be a refusal no other list has. " +
    "No table or index changes: one person's or one company's deals are few, so a row check after the narrowest " +
    "index stays within the read budget.",
  source: fitBy("docs/design/new-commands.md (5.2, G6); books/target/activity/operations.ts (activity list); books/target/projects/projects.ts (projects.projects.list); frappe/crm@2cecd300 crm_deal.py:304"),
  affects: [rpc_contacts_deals_list, flow_client_org_crm_deals_list, operation_org_crm_deal_list],
});

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
    { label: "lifecycle", text: "`org crm task start|complete|cancel|reopen`, as projects' `org projects task` does." },
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
        "note's title is `org crm note add <record> <title>`, as `org crm task create <record> <title>` and `org projects task " +
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
    "an address. A record's required name is its argument across the grammar (`org projects create <name>`, `org projects task " +
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

export const decision_contacts_whatsapp_show_claims = defineDecision({
  id: "contacts.whatsapp-show-claims",
  title: "`org crm whatsapp show` also claims what it shows after a disconnect",
  question:
    "`org crm whatsapp show` was booked with one claim: the live number, or null when none was ever connected. What " +
    "else does its behaviour already decide that its evals should hold it to?",
  options: [
    {
      label: "after-disconnect",
      text:
        "A second claim, from org-with-conversations: after a disconnect it shows the last number as disconnected, after " +
        "another connect the new account, active, and a show writes nothing. It follows from contacts.whatsapp.show " +
        "(the live account, else the last one disconnected, else null) and adds no behaviour.",
    },
    { label: "one", text: "Keep the one claim." },
  ],
  chosen: "after-disconnect",
  why:
    "With one claim an implementation that answered null after a disconnect, or kept showing the old number after a " +
    "new connect, would pass, though the rpc books both (aaron.crm-frappe-shape). The world and commands are the ones " +
    "`org crm whatsapp disconnect` and `connect` already claim.",
  source: "Claude, surface pass (frappe-apps), 9 November 2026; evidence: books/target/contacts/whatsapp.ts " +
    "(contacts.whatsapp.show); aaron.crm-frappe-shape",
  affects: [operation_org_crm_whatsapp_show],
});

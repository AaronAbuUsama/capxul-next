// Contacts' durable processes: the CRM's sync with a connected Frappe head; each inbound email's
// threading (`contacts.mail.thread`); and each connected WhatsApp number's account
// (`contacts.whatsapp.account`), decisions contacts.mail-threading and contacts.whatsapp-connect.
//
// An address book entry, a lead and a deal change only inside an rpc: nothing about them waits on a
// signature, the chain, a date, a person or Bridge, so none has a process of its own (decision
// rules.durable-processes). A lead's conversion is one transaction; a deal's expected closure date
// is a forecast, not a timer. The member relationship is read from organizations' Seats when the
// book is read, so no workflow copies it. The old `parties.contacts.emitRelationshipChanged` action
// only posted telemetry after a write (P7: the machines' events now leave through the outbox) and
// is not ported.
//
// The head sync is the CRM's share of a connected head: each app concept syncs its own records
// (organizations.head-ownership), and this is contacts' (decision contacts.head-sync).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import { integration_frappe_head, integration_mail, integration_whatsapp } from "../shared/external.ts";
import {
  event_org_head_transitioned,
  machine_org_head,
  table_org_deployments,
  table_org_heads,
  table_org_members,
  table_organizations,
} from "../organizations/data.ts";
import { table_principals } from "../access/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import {
  machine_communication,
  machine_contact,
  machine_crm_task,
  machine_deal,
  machine_inbound_mail,
  machine_lead,
  machine_wa_account,
  table_communications,
  table_contact_changes,
  table_contact_head_syncs,
  table_contacts,
  table_crm_call_logs,
  table_crm_notes,
  table_crm_settings,
  table_crm_tasks,
  table_deal_contacts,
  table_deals,
  table_inbound_mails,
  table_leads,
  table_timeline_links,
  table_wa_accounts,
  table_wa_messages,
} from "./data.ts";
import { rpc_contacts_mail_receive } from "./mail.ts";
import { rpc_contacts_whatsapp_disconnect, rpc_contacts_whatsapp_receive } from "./whatsapp.ts";

const DAY = 86_400_000;
/** The conversation records a head also receives (contacts.conversations-head-sync). */
const CONVERSATIONS = [table_communications, table_wa_messages, table_crm_call_logs, table_crm_notes, table_crm_tasks, table_timeline_links];
const RECORDS = [table_contacts, table_leads, table_deals, table_deal_contacts, ...CONVERSATIONS];

export const workflow_contacts_head_sync = defineWorkflow({
  id: "contacts.head.sync",
  title: "Sync the Organization's CRM with its connected head",
  about:
    "Started when a head connection is confirmed, one instance per connection; it waits on two systems for as long as " +
    "the head is connected and must survive a crash. Push: it pages `contact-changes` after `pushed_seq` and writes " +
    "each changed record as it stands to the head (`upsertDocs`, in seq order, each with its version and the version " +
    "the head was last given), the first time from seq 1, so the head gets the whole CRM in order; how each record " +
    "meets its document there (names, members' Users, a lead's conversion, a head that already holds a CRM) is " +
    "contacts.head-mapping. Pull: it reads the head's own changes after `pulled_change` (`listChanges`) and applies " +
    "each by the rules of organizations.head-ownership, through the same checks and transitions the CRM's rpcs use, " +
    "with its change logged `origin` head. The editor must be a member whose Safe wears the People hat, matched by the " +
    "head user's mailbox, as for every CRM write (aaron.contacts-permissions). An edit by anyone else, one based on an " +
    "older version (a conflict), one the checks refuse, and a deletion are not applied: Capxul's version is pushed back " +
    "over it, and a refused document born in the head is left there with no `capxul_id`, counted `refused`. An entry's " +
    "Party is Capxul's alone: a head never sets or changes `capxul_party`. A Contact born in the head with a primary " +
    "mailbox is named in the directory through `parties.resolve-recipient`, as a recorded person is, unless that Party " +
    "already has an entry in the book (then it is refused, never merged); one with none, and every CRM Organization " +
    "born there, is a private entry. It wakes on a CRM change here, on the head's ring, and once a day to catch a " +
    "missed ring; while the head is failing it waits. It ends when the head is disconnected; the records stay. Notes, " +
    "tasks and call logs sync both ways; emails and WhatsApp messages only out (contacts.conversations-head-sync).",
  concept: concept_contacts,
  priority: "normal",
  trigger: { transition: machine_org_head.t.confirm },
  instance: { per: table_contact_head_syncs },
  waits: [
    {
      name: "capxul-change",
      for: "signal",
      key: [{ on: [table_contact_changes], props: ["org_id"] }],
      about: "A CRM record changed here: push it.",
    },
    {
      name: "ring",
      for: "signal",
      key: [{ on: [table_org_heads], props: ["org_id", "head_id"] }],
      about: "The head rang its doorbell (organizations.heads.ring stamped the connection): pull its changes.",
    },
    { name: "catch-up", for: "timer", timeoutMs: DAY, about: "A day after the last pull: pull, in case a ring was lost." },
    {
      name: "disconnected",
      for: "signal",
      key: [{ on: [event_org_head_transitioned], props: ["org_id", "head_id"] }],
      about: "The head stopped failing, started failing, or was disconnected: carry on, wait, or end.",
    },
  ],
  steps: [
    {
      name: "push",
      about:
        "Page contact-changes after pushed_seq; upsertDocs in seq order (a member's own row is skipped while the member " +
        "holds a Seat); record the head's names; advance pushed_seq.",
    },
    {
      name: "pull",
      about:
        "listChanges after pulled_change; apply what a People hat wearer changed; push back a conflict, a refusal or a " +
        "deletion; leave a refused head-born document unadopted; advance pulled_change.",
    },
    { name: "await", about: "Wait for a change here, a ring, the daily catch-up or the connection's next transition." },
  ],
  // The People hat's id is the deployment's; its wearers are indexing's (contacts.members-write).
  reads: [
    table_org_heads, table_org_members, table_org_deployments, table_hat_wearers, table_principals, table_parties, table_contact_head_syncs,
    table_contact_changes, table_crm_settings, ...RECORDS,
  ],
  writes: [table_contact_head_syncs, table_contact_changes, table_crm_settings, ...RECORDS],
  drives: [
    machine_contact.t.hide,
    machine_contact.t.unhide,
    machine_lead.t.capture,
    machine_lead.t.reopen,
    machine_lead.t.engage,
    machine_lead.t.qualify,
    machine_lead.t.lose,
    machine_lead.t.convert,
    machine_deal.t.start,
    machine_deal.t.reopen,
    machine_deal.t.engage,
    machine_deal.t.win,
    machine_deal.t.lose,
    machine_crm_task.t.create,
    machine_crm_task.t.start,
    machine_crm_task.t.complete,
    machine_crm_task.t.cancel,
    machine_crm_task.t.reopen,
  ],
  invokes: [procedure_parties_resolve_recipient],
  emits: [],
  calls: [integration_frappe_head.c.upsertDocs, integration_frappe_head.c.listChanges],
  chain: [],
  idempotency:
    "One process per head connection (`contacts-head:<orgId>:<headId>`). A push is idempotent by version (the head " +
    "answers unchanged), and a pulled change already applied is skipped by its head name and time.",
  timeoutMs: 60_000,
  retries: { max: 8, backoff: "exponential" },
  budget: budget("background"),
});

// ── conversations ───────────────────────────────────────────────────────────────────────────

export const workflow_contacts_mail_thread = defineWorkflow({
  id: "contacts.mail.thread",
  title: "Read an email the CRM mailbox received and thread it onto its record",
  about:
    "Started after `contacts.mail.receive` stored an inbound email, one instance per inbound row. It cannot be a step " +
    "of the webhook: reading the email is a vendor call retried over minutes, and threading it must survive a crash, " +
    "while Resend waits only seconds for its answer. It reads the email (`mail.getReceived`) and threads it as " +
    "Frappe's receive.py does (contacts.mail-threading): (1) its In-Reply-To, then each References id newest first, " +
    "naming a communication of this Organization by `message_id`: the email answers it and is about the same record; " +
    "(2) else the sender's mailbox: the latest-changed lead not converted whose `email` it is, else the latest-changed " +
    "contact entry keeping it in `email_ids`, or, when the sender is a member of the Organization (their own reply, or " +
    "a copy they sent the mailbox), the first recipient matched so; (3) else a lead is captured from the sender " +
    "(`first_name` its display name, as CRM Lead's sender_name_field takes it, `email`, source Email), as Frappe's " +
    "email account appending to CRM Lead does. An " +
    "email from the mailbox itself, one whose Message-ID the CRM already holds, and a member's that matches nothing are " +
    "dropped, with the reason. A kept email is one transaction: the communication (`receive`, at the world's now, its " +
    "Date header as `envelope_date`), its timeline links (its record, and every contact entry keeping the sender's or " +
    "a recipient's mailbox), a new lead with its change-log row, the communication's change-log row, and `thread`.",
  concept: concept_contacts,
  priority: "normal",
  trigger: { after: rpc_contacts_mail_receive },
  instance: { per: table_inbound_mails },
  steps: [
    { name: "load", about: "Reads the inbound row; one no longer `received` ends the instance." },
    { name: "read", about: "`mail.getReceived` by the row's id, retried while Resend is down or throttles." },
    { name: "match", about: "Thread by In-Reply-To and References, else by the sender's or a member's recipient's mailbox, else a new lead." },
    { name: "store", about: "The communication, its links, any new lead and their change-log rows, and `thread`; or `drop` with the reason." },
  ],
  reads: [
    table_inbound_mails, table_communications, table_leads, table_contacts, table_deals, table_org_members, table_parties,
    table_organizations, table_crm_settings,
  ],
  writes: [table_inbound_mails, table_communications, table_timeline_links, table_leads, table_contact_changes, table_crm_settings],
  drives: [machine_inbound_mail.t.thread, machine_inbound_mail.t.drop, machine_communication.t.receive, machine_lead.t.capture],
  invokes: [],
  emits: [],
  calls: [integration_mail.c.getReceived],
  chain: [],
  idempotency:
    "`crm-inbound:<orgId>:<inboundId>` for the instance; `thread` and `drop` move only a `received` row, and a " +
    "Message-ID is stored once per Organization, so a resumed run writes nothing twice.",
  timeoutMs: DAY,
  retries: { max: 8, backoff: "exponential" },
  compensation: "None: an email that cannot be read in a day stays `received`, visible to an operator, and Resend keeps it.",
  budget: budget("background"),
  was: ["github.com/frappe/frappe@1a7ea577:frappe/email/receive.py:829", "github.com/frappe/frappe@1a7ea577:frappe/email/receive.py:864"],
});

export const workflow_contacts_whatsapp_account = defineWorkflow({
  id: "contacts.whatsapp.account",
  title: "Keep a connected WhatsApp number checked until it is disconnected",
  about:
    "Started when an Organization connects a WhatsApp number, one instance per account, for as long as it is connected: " +
    "it owns the account's machine past its birth. Once a day on the world's clock it reads the number from Meta with " +
    "its token (`whatsapp.readNumber`): a token or number Meta refuses marks the account failing (`fail`, with Meta's " +
    "error), so sends are refused until it answers again (`recover`); Meta down changes nothing and it tries the next " +
    "day. A signed delivery on the account's route (`contacts.whatsapp.receive`) also proves Meta reaches it, so a " +
    "failing account recovers. It ends when the account is disconnected; its messages stay.",
  concept: concept_contacts,
  priority: "normal",
  trigger: { transition: machine_wa_account.t.connect },
  instance: { per: table_wa_accounts },
  signals: [rpc_contacts_whatsapp_receive, rpc_contacts_whatsapp_disconnect],
  waits: [
    {
      name: "delivery",
      for: "signal",
      key: [{ on: [rpc_contacts_whatsapp_receive], props: ["accountId"] }],
      about: "A signed delivery from Meta on the account's route: a failing account recovers.",
    },
    { name: "check", for: "timer", timeoutMs: DAY, about: "A day after the last check: read the number from Meta." },
    {
      name: "disconnected",
      for: "signal",
      key: [{ on: [rpc_contacts_whatsapp_disconnect], props: ["org_id", "account_id"] }],
      about: "`org crm whatsapp disconnect`: end.",
    },
  ],
  steps: [
    { name: "check", about: "`whatsapp.readNumber`; record `checked_at`; `fail` on a refusal, `recover` on an answer while failing." },
    { name: "await", about: "Wait for a delivery, the daily check or the disconnect." },
  ],
  reads: [table_wa_accounts],
  writes: [table_wa_accounts],
  drives: [machine_wa_account.t.fail, machine_wa_account.t.recover],
  invokes: [],
  emits: [],
  calls: [integration_whatsapp.c.readNumber],
  chain: [],
  idempotency: "One process per account (`wa-account:<orgId>:<accountId>`); `fail` and `recover` move only from the state read.",
  timeoutMs: 60_000,
  retries: { max: 8, backoff: "exponential" },
  budget: budget("background"),
  was: ["github.com/frappe/whatsapp@59bf368:whatsapp/whatsapp/doctype/wa_account/wa_account.json"],
});

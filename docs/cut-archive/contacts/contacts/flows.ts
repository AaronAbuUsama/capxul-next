// Moved out of the built book by the cut, 10 November 2026, from books/target/contacts/flows.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineFlow, type Rpc } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { Doctype } from "./data.ts";
import {
  Book,
  DetailsInput,
  Entry,
  EntryWithDetails,
  Locator,
  rpc_contacts_book_get,
  rpc_contacts_book_record,
  rpc_contacts_book_hide,
  rpc_contacts_book_label,
  rpc_contacts_book_list,
  rpc_contacts_book_unhide,
} from "./book.ts";
import {
  DealFields,
  DealView,
  rpc_contacts_deals_get,
  rpc_contacts_deals_list,
  rpc_contacts_deals_move,
  rpc_contacts_deals_save,
} from "./deals.ts";
import { EmailItem, WhatsAppItem, NoteItem } from "./timeline.ts";
import { rpc_contacts_mail_send } from "./mail.ts";
import {
  WhatsAppAccount,
  rpc_contacts_whatsapp_connect,
  rpc_contacts_whatsapp_disconnect,
  rpc_contacts_whatsapp_send,
  rpc_contacts_whatsapp_show,
} from "./whatsapp.ts";
import { NoteFields, rpc_contacts_notes_save } from "./notes.ts";
import { TaskFields, TaskView, rpc_contacts_tasks_save } from "./tasks.ts";
import {
  LeadFields,
  LeadView,
  rpc_contacts_leads_convert,
  rpc_contacts_leads_get,
  rpc_contacts_leads_list,
  rpc_contacts_leads_move,
  rpc_contacts_leads_save,
} from "./leads.ts";

export const flow_client_org_crm_leads_create = crm({
  id: "client.org.crm.leads.create",
  title: "Capture a lead",
  about: "Frappe CRM's new lead form: `contacts.leads.save` with no lead, a new lead with status New.",
  command: "org crm lead create",
  sdk: "client.org(orgId).crm.leads.create",
  rpc: rpc_contacts_leads_save,
  input: Schema.Struct({ orgId: S, fields: LeadFields }),
  output: LeadView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.json`, `${CRM}/fcrm/doctype/crm_lead/crm_lead.py:140`],
});

export const flow_client_org_crm_leads_change = crm({
  id: "client.org.crm.leads.change",
  title: "Change a lead's fields",
  about: "Frappe CRM's lead form on a saved lead: `contacts.leads.save` with the lead's id; a converted lead is WRONG_STATE.",
  command: "org crm lead change",
  sdk: "client.org(orgId).crm.leads.change",
  rpc: rpc_contacts_leads_save,
  input: Schema.Struct({ orgId: S, lead: S, fields: LeadFields }),
  output: LeadView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.json`],
});

export const flow_client_org_crm_leads_move = crm({
  id: "client.org.crm.leads.move",
  title: "Move a lead to another status",
  about: "Frappe CRM's lead status menu and kanban drag: a default status, with a lost reason for a lost one.",
  command: "org crm lead move",
  sdk: "client.org(orgId).crm.leads.move",
  rpc: rpc_contacts_leads_move,
  output: LeadView,
  read: false,
  was: [`${CRM}/install.py:46`],
});

export const flow_client_org_crm_leads_convert = crm({
  id: "client.org.crm.leads.convert",
  title: "Convert a lead to a deal",
  about: "Frappe CRM's Convert to Deal: the deal, its person and its company, once; a retry answers the same deal.",
  command: "org crm lead convert",
  sdk: "client.org(orgId).crm.leads.convert",
  rpc: rpc_contacts_leads_convert,
  output: rpc_contacts_leads_convert.output,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.py:546`],
});

export const flow_client_org_crm_leads_list = crm({
  id: "client.org.crm.leads.list",
  title: "List an Organization's leads",
  about: "Frappe CRM's leads list and kanban: a page of the leads not converted, newest change first, or one stage's (converted the only way to list converted ones).",
  command: "org crm lead list",
  sdk: "client.org(orgId).crm.leads.list",
  rpc: rpc_contacts_leads_list,
  output: rpc_contacts_leads_list.output,
  read: true,
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.py:470`],
});

export const flow_client_org_crm_leads_get = crm({
  id: "client.org.crm.leads.get",
  title: "Read one lead",
  about: "Frappe CRM's lead page: one lead; an id that is none of the Organization's leads is INVALID_INPUT, never null.",
  command: "org crm lead get",
  sdk: "client.org(orgId).crm.leads.get",
  rpc: rpc_contacts_leads_get,
  output: LeadView,
  read: true,
  errors: [error_INVALID_INPUT],
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.json`],
});

export const flow_client_org_crm_deals_create = crm({
  id: "client.org.crm.deals.create",
  title: "Open a deal",
  about: "Frappe CRM's new deal form: `contacts.deals.save` with no deal, a new deal in Qualification for its company.",
  command: "org crm deal create",
  sdk: "client.org(orgId).crm.deals.create",
  rpc: rpc_contacts_deals_save,
  input: Schema.Struct({ orgId: S, fields: DealFields }),
  output: DealView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.py:482`],
});

export const flow_client_org_crm_deals_change = crm({
  id: "client.org.crm.deals.change",
  title: "Change a deal's fields or its people",
  about: "Frappe CRM's deal form on a saved deal: `contacts.deals.save` with the deal's id, whatever its stage.",
  command: "org crm deal change",
  sdk: "client.org(orgId).crm.deals.change",
  rpc: rpc_contacts_deals_save,
  input: Schema.Struct({ orgId: S, deal: S, fields: DealFields }),
  output: DealView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.json`],
});

export const flow_client_org_crm_deals_move = crm({
  id: "client.org.crm.deals.move",
  title: "Move a deal to another status",
  about: "Frappe CRM's deal status menu and pipeline drag: worked, won or lost, with a lost reason for a lost one.",
  command: "org crm deal move",
  sdk: "client.org(orgId).crm.deals.move",
  rpc: rpc_contacts_deals_move,
  output: DealView,
  read: false,
  was: [`${CRM}/install.py:97`],
});

export const flow_client_org_crm_deals_list = crm({
  id: "client.org.crm.deals.list",
  title: "List an Organization's deals",
  about: "Frappe CRM's deals list and pipeline: a page, newest change first, filtered by stage, company and person, together when given.",
  command: "org crm deal list",
  sdk: "client.org(orgId).crm.deals.list",
  rpc: rpc_contacts_deals_list,
  output: rpc_contacts_deals_list.output,
  read: true,
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.py:304`],
});

export const flow_client_org_crm_deals_get = crm({
  id: "client.org.crm.deals.get",
  title: "Read one deal",
  about: "Frappe CRM's deal page: one deal with its people; an id that is none of the Organization's deals is INVALID_INPUT.",
  command: "org crm deal get",
  sdk: "client.org(orgId).crm.deals.get",
  rpc: rpc_contacts_deals_get,
  output: DealView,
  read: true,
  errors: [error_INVALID_INPUT],
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.json`],
});

export const flow_client_org_crm_emails_send = defineFlow({
  id: "client.org.crm.emails.send",
  title: "Send an email about a record, with a preview at a terminal",
  about:
    "At a terminal it shows the record, the recipients as typed (else the record's own mailbox, which the rpc " +
    "resolves), the subject and the text's first lines, and asks; then, or straight away with `--confirm`, the one " +
    "send, `contacts.mail.send`, under the send key it made. A script without `--confirm` is the CLI's CLI_USAGE. " +
    serves("org crm email send"),
  component: component_core_sdk,
  surfaces: CRM_SURFACES,
  sdk: "client.org(orgId).crm.emails.send",
  input: Schema.Struct({
    orgId: S,
    record: S,
    subject: Schema.optionalKey(S),
    text: S,
    to: Schema.optionalKey(Schema.Array(S)),
    cc: Schema.optionalKey(Schema.Array(S)),
    bcc: Schema.optionalKey(Schema.Array(S)),
    inReplyTo: Schema.optionalKey(S),
    confirm: Schema.optionalKey(Schema.Boolean),
  }),
  output: EmailItem,
  steps: [sendKey, confirmSend("the record, the recipients, the subject and the first lines"), { name: "send", rpc: rpc_contacts_mail_send, about: "The one send." }],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: vendorWithPreview,
  was: [`${CRM}/api/email.py:1`],
});

export const flow_client_org_crm_whatsapp_connect = defineFlow({
  id: "client.org.crm.whatsapp.connect",
  title: "Connect a WhatsApp Business number, with a preview at a terminal",
  about:
    "Takes the number's Meta ids, access token, app secret and verify token from the key file, or asks for each at " +
    "a terminal (a secret is never a flag); at a terminal it shows the number id and business account, that the " +
    "Organization's CRM will send and receive WhatsApp through Meta on it, and asks; then, or with `--confirm`, the " +
    "one write, `contacts.whatsapp.connect` (which also subscribes the Meta app to the number's business account), " +
    "and prints the webhook URL and verify token to set as the app's callback. " +
    serves("org crm whatsapp connect"),
  component: component_core_sdk,
  surfaces: CRM_SURFACES,
  sdk: "client.org(orgId).crm.whatsapp.connect",
  input: Schema.Struct({ ...rpc_contacts_whatsapp_connect.input.fields, confirm: Schema.optionalKey(Schema.Boolean) }),
  output: rpc_contacts_whatsapp_connect.output,
  steps: [
    { name: "secrets", local: "prompt", about: "Only at a terminal and without `--key-file`: asks for each id and secret, never echoing a secret." },
    confirmSend("the number id, the business account and that the CRM's WhatsApp will go through Meta on it"),
    { name: "connect", rpc: rpc_contacts_whatsapp_connect, about: "The one write, after Meta answered for the number." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: vendorWithPreview,
  was: ["github.com/frappe/whatsapp@59bf368:whatsapp/whatsapp/doctype/wa_account/wa_account.json"],
});

export const flow_client_org_crm_whatsapp_disconnect = defineFlow({
  id: "client.org.crm.whatsapp.disconnect",
  title: "Disconnect the WhatsApp number, with a preview at a terminal",
  about:
    "At a terminal it reads the live account (none ends with WRONG_STATE before any write), shows its number and " +
    "that nothing more will be sent or received on it, and asks; then, or with `--confirm`, the one write, " +
    "`contacts.whatsapp.disconnect`. " +
    serves("org crm whatsapp disconnect"),
  component: component_core_sdk,
  surfaces: CRM_SURFACES,
  sdk: "client.org(orgId).crm.whatsapp.disconnect",
  input: Schema.Struct({ orgId: S, confirm: Schema.optionalKey(Schema.Boolean) }),
  output: WhatsAppAccount,
  steps: [
    { name: "current", rpc: rpc_contacts_whatsapp_show, about: "Only at a terminal: the account; none live is WRONG_STATE before any write." },
    confirmSend("the number and that nothing more will be sent or received on it"),
    { name: "disconnect", rpc: rpc_contacts_whatsapp_disconnect, about: "The one write." },
  ],
  errors: [error_CANCELLED, error_WRONG_STATE],
  calls: [],
  spans: [],
  budget: writeWithPreview,
  was: ["github.com/frappe/whatsapp@59bf368:whatsapp/whatsapp/doctype/wa_account/wa_account.json"],
});

export const flow_client_org_crm_whatsapp_send = defineFlow({
  id: "client.org.crm.whatsapp.send",
  title: "Send a WhatsApp message about a record, with a preview at a terminal",
  about:
    "At a terminal it shows the record, the number as typed (else the record's own, which the rpc resolves) and the " +
    "text or template, and asks; then, or with `--confirm`, the one send, `contacts.whatsapp.send`, under the send key " +
    "it made. A script without `--confirm` is the CLI's CLI_USAGE. " +
    serves("org crm whatsapp send"),
  component: component_core_sdk,
  surfaces: CRM_SURFACES,
  sdk: "client.org(orgId).crm.whatsapp.send",
  input: Schema.Struct({
    orgId: S,
    record: S,
    text: Schema.optionalKey(S),
    template: Schema.optionalKey(
      Schema.Struct({ name: S, language: Schema.optionalKey(S), params: Schema.optionalKey(Schema.Array(S)) }),
    ),
    to: Schema.optionalKey(S),
    inReplyTo: Schema.optionalKey(S),
    confirm: Schema.optionalKey(Schema.Boolean),
  }),
  output: WhatsAppItem,
  steps: [sendKey, confirmSend("the record, the number and the text or template"), { name: "send", rpc: rpc_contacts_whatsapp_send, about: "The one send." }],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: vendorWithPreview,
  was: ["github.com/frappe/whatsapp@59bf368:whatsapp/whatsapp/doctype/wa_message/wa_message.py:200"],
});

export const flow_client_org_crm_notes_add = crm({
  id: "client.org.crm.notes.add",
  title: "Add a note on a record",
  about: "Frappe CRM's Notes tab: `contacts.notes.save` with no note, a new note on the record.",
  command: "org crm note add",
  sdk: "client.org(orgId).crm.notes.add",
  rpc: rpc_contacts_notes_save,
  input: Schema.Struct({ orgId: S, record: S, fields: NoteFields }),
  output: NoteItem,
  read: false,
  was: [`${CRM}/fcrm/doctype/fcrm_note/fcrm_note.json`],
});

export const flow_client_org_crm_notes_change = crm({
  id: "client.org.crm.notes.change",
  title: "Change a note's title or content",
  about: "Frappe CRM's note editor: `contacts.notes.save` with the note's id.",
  command: "org crm note change",
  sdk: "client.org(orgId).crm.notes.change",
  rpc: rpc_contacts_notes_save,
  input: Schema.Struct({ orgId: S, note: S, fields: NoteFields }),
  output: NoteItem,
  read: false,
  was: [`${CRM}/fcrm/doctype/fcrm_note/fcrm_note.json`],
});

export const flow_client_org_crm_tasks_create = crm({
  id: "client.org.crm.tasks.create",
  title: "Make a task on a record",
  about: "Frappe CRM's new task form: `contacts.tasks.save` with no task, Backlog or Todo.",
  command: "org crm task create",
  sdk: "client.org(orgId).crm.tasks.create",
  rpc: rpc_contacts_tasks_save,
  input: Schema.Struct({ orgId: S, record: S, status: Schema.optionalKey(Schema.Literals(["Backlog", "Todo"])), fields: TaskFields }),
  output: TaskView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_task/crm_task.json`],
});

export const flow_client_org_crm_tasks_change = crm({
  id: "client.org.crm.tasks.change",
  title: "Change a task's fields",
  about: "Frappe CRM's task form on a saved task: `contacts.tasks.save` with the task's id; its status moves only by `move`.",
  command: "org crm task change",
  sdk: "client.org(orgId).crm.tasks.change",
  rpc: rpc_contacts_tasks_save,
  input: Schema.Struct({ orgId: S, task: S, fields: TaskFields }),
  output: TaskView,
  read: false,
  was: [`${CRM}/fcrm/doctype/crm_task/crm_task.json`],
});

// Contacts' timeline area: one timeline per contact entry, lead and deal (decision contacts.timeline),
// in the shape of Frappe CRM's activity timeline (`crm.api.activities.get_activities`), which gathers a
// lead's or deal's emails, calls, notes, tasks and field changes newest first, a deal's including its
// lead's. Here it gathers every conversation the timeline links put on the record (./data.ts), the
// record's own birth, and the money the chain shows between the Organization and the record's Party
// (decision contacts.timeline-money). Every member reads it (contacts.crm-permission). Every `at` is
// the world's time (aaron.world-clock).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import {
  CALL_STATUSES,
  DELIVERY_STATES,
  RecordDoctype,
  TASK_STATUSES,
  table_communications,
  table_contacts,
  table_crm_call_logs,
  table_crm_notes,
  table_crm_tasks,
  table_deal_contacts,
  table_deals,
  table_leads,
  table_timeline_links,
  table_wa_messages,
} from "./data.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { table_chain_payments, table_escrows } from "../indexing/data.ts";
import { WHO_CRM_READ } from "./leads.ts";

const CRM = "github.com/frappe/crm@2cecd300:crm";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

/** The record an item is about: Frappe's reference doctype and name. */
export const RecordRef = Schema.Struct({ doctype: RecordDoctype, id: S });
const Base = { id: S, at: N, reference: RecordRef };

/** An email, as the timeline and `org crm email send` print it (Communication's fields). */
export const EmailItem = Schema.Struct({
  kind: Schema.Literal("email"),
  ...Base,
  direction: Schema.Literals(["sent", "received"]),
  subject: S,
  from: S,
  from_name: NullOr(S),
  to: Schema.Array(S),
  cc: Schema.Array(S),
  text: S,
  message_id: S,
  /** The communication it answers. */
  in_reply_to: NullOr(S),
  delivery_status: Schema.Literals(DELIVERY_STATES),
  /** The member who sent it: their PartyId; null for one received. */
  by: NullOr(S),
  attachments: Schema.Array(S),
});

/** A WhatsApp message, as the timeline and `org crm whatsapp send` print it (WA Message's fields). */
export const WhatsAppItem = Schema.Struct({
  kind: Schema.Literal("whatsapp"),
  ...Base,
  direction: Schema.Literals(["sent", "received"]),
  counterpart: S,
  text: NullOr(S),
  template: NullOr(S),
  status: Schema.Literals(["sent", "delivered", "read", "failed", "received"]),
  /** The message it answers. */
  reply_to: NullOr(S),
  error: NullOr(Schema.Struct({ code: S, message: S })),
  by: NullOr(S),
});

/** A call log (CRM Call Log's fields). */
export const CallItem = Schema.Struct({
  kind: Schema.Literal("call"),
  ...Base,
  type: Schema.Literals(["Incoming", "Outgoing"]),
  status: Schema.Literals(CALL_STATUSES),
  counterpart: NullOr(S),
  /** The member who made or took it. */
  member: S,
  /** When the call started and ended, on the world's clock; `at` is when it was logged. */
  start: N,
  duration: N,
  end: N,
  /** Its FCRM Note. */
  note: NullOr(S),
});

/** A note (FCRM Note's fields). */
export const NoteItem = Schema.Struct({
  kind: Schema.Literal("note"),
  ...Base,
  title: S,
  content: NullOr(S),
  by: S,
  changedAt: N,
});

/** A task (CRM Task's fields), placed at its creation and shown as it stands. */
export const TaskItem = Schema.Struct({
  kind: Schema.Literal("task"),
  ...Base,
  title: S,
  status: Schema.Literals(Object.keys(TASK_STATUSES) as [keyof typeof TASK_STATUSES, ...(keyof typeof TASK_STATUSES)[]]),
  priority: Schema.Literals(["Low", "Medium", "High"]),
  assigned_to: NullOr(S),
  due: NullOr(N),
});

/** Money the chain shows between the Organization and the record's Party (contacts.timeline-money). */
export const MoneyItem = Schema.Struct({
  kind: Schema.Literal("money"),
  /** The payment id, or the escrow's address. */
  id: S,
  /** The block's time, which on a devnet is the world's. */
  at: N,
  reference: RecordRef,
  /** `out`: from the Organization's company Safe to the Party; `in`: from the Party to it. */
  direction: Schema.Literals(["out", "in"]),
  /**
   * `payment`: a PaymentSent between the two Safes; `claim-escrow`: money the company Safe sent waiting for the Party
   * (out); `invoice-escrow`: an outside payer's invoice escrow for the Organization's request, funded by the Party (in).
   */
  via: Schema.Literals(["payment", "claim-escrow", "invoice-escrow"]),
  token: S,
  /** Raw token units. */
  amount: S,
  payment_id: S,
  document_hash: NullOr(S),
  /** An escrow's standing; null for a payment. */
  standing: NullOr(Schema.Literals(["open", "paid", "refunded"])),
  tx_hash: NullOr(S),
});

/** The record's own birth: a lead captured, a deal opened or converted from its lead, an entry added or recorded. */
export const RecordItem = Schema.Struct({
  kind: Schema.Literal("record"),
  ...Base,
  event: Schema.Literals(["created", "converted"]),
});

export const TimelineItem = Schema.Union([EmailItem, WhatsAppItem, CallItem, NoteItem, TaskItem, MoneyItem, RecordItem]);
export const TimelineKind = Schema.Literals(["email", "whatsapp", "call", "note", "task", "money", "record"]);

/** One page of a record's timeline. */
export const TimelinePage = Schema.Struct({
  record: Schema.Struct({ doctype: RecordDoctype, id: S, label: S }),
  items: Schema.Array(TimelineItem),
  nextCursor: NullOr(S),
});

export const rpc_contacts_timeline_list = defineRpc({
  id: "contacts.timeline.list",
  title: "Read one page of a contact's, lead's or deal's timeline, newest first",
  about:
    "Frappe CRM's activity timeline for one record of the Organization's CRM: `record` is a contact entry's id " +
    "(`party_`, `contact_`), a `lead_` or a `deal_` id, and one not in this CRM is INVALID_INPUT. It merges, newest " +
    "first: every conversation item the timeline links put on the record (`timeline-links-by-record`), each read as it " +
    "stands (an email, a WhatsApp message, a call log, a note, a task); for a deal, its lead's items too, as Frappe's " +
    "deal timeline gathers its lead's activities; the record's own birth (`record`: created, or for a deal from a lead, " +
    "converted); and the money the chain shows between the Organization and the record's Party (contacts.timeline-" +
    "money), from indexing's views: each PaymentSent between the company Safe and the Party's Safe, either way, with " +
    "its token, raw amount, payment id and document hash (an Invoice paid from the Party's Safe carries its " +
    "document's); each claim escrow whose sender is the company Safe and whose owner is the Party's Safe (out); and " +
    "each invoice escrow whose sender is the Party's Safe and whose owner is the company Safe (in: an outside payer's " +
    "request, whose payout's PaymentSent names the escrow, not the Party), each escrow once, with its standing. A " +
    "contact entry's Party is its own, a " +
    "deal's is its company entry's; a lead and a private entry have none, so they show no money. `kinds` keeps only " +
    "the kinds given. `limit` is 1 to 100 (25 when absent); `after` is the cursor the last page gave, bound to this " +
    "Organization, record and kinds, and another, or a forged one, is INVALID_INPUT. Every `at` is the world's time: an " +
    "email's or message's when it was sent or received, a call's, note's or task's creation, a payment's block. Items " +
    "at one instant keep the order they were written, newest first: by the ULID of their ids without the prefix, and " +
    "chain items by block and log index (time.read-once).",
  concept: concept_contacts,
  kind: "query",
  who: WHO_CRM_READ,
  input: Schema.Struct({
    orgId: S,
    record: S,
    kinds: Schema.optionalKey(Schema.Array(TimelineKind)),
    limit: Schema.optionalKey(Schema.Int),
    after: Schema.optionalKey(S),
  }),
  output: TimelinePage,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [
    table_timeline_links, table_communications, table_wa_messages, table_crm_call_logs, table_crm_notes, table_crm_tasks,
    table_contacts, table_leads, table_deals, table_deal_contacts, table_org_members, table_organizations, table_parties,
    table_chain_payments, table_escrows,
  ],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${CRM}/api/activities.py:16`, `${CRM}/api/activities.py:27`, `${CRM}/api/activities.py:448`],
});

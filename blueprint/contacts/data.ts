// Contacts' data: the address book of whoever you act as (a person or an Organization), and each
// Organization's CRM, in Frappe CRM's shapes (decision contacts.frappe-shape). One table per Frappe
// doctype, with Frappe's field names, so a connected Frappe head syncs by mapping fields, never by
// transforming them:
//
//   contacts       Frappe's Contact (a person, an agent, a wallet) and CRM Organization (a company),
//                  one entry per Party in a book, or a private entry with no Party yet
//   leads          CRM Lead
//   deals          CRM Deal
//   deal-contacts  CRM Contacts, the deal's child table of people
//
// and every conversation with them (decision contacts.conversations-shape): communications
// (Communication, email), inbound-mails (what reached the CRM mailbox, before it is threaded),
// wa-accounts and wa-messages (the WhatsApp app's WA Account and WA Message), crm-call-logs (CRM
// Call Log), crm-notes (FCRM Note), crm-tasks (CRM Task) and timeline-links (Dynamic Link rows that
// put each one on its records' timelines);
//
// and, for a connected head, the change log every Organization-owned CRM write appends to
// (`contact-changes`, with its counter in `crm-settings`) and each head connection's cursors
// (`contact-head-syncs`), which the one sync process (./processes.ts) follows.
//
// An entry is in a book when its owner added it by hand (relationship `manual`, a row with
// `added_at`) or, in an Organization's book, when its Party holds a Seat there (relationship
// `member`, derived at read time from organizations' Seats, never copied). A row with no `added_at`
// only curates a member's entry. Bank accounts are banking's; a contact's wallet is its Party's Safe
// (parties). Who a Party is, its name and photo, is the directory's (parties); what an owner knows
// about it is here, and nowhere else.
//
// Ids: an entry born from a Party has that Party's id (`party_<ulid>`) as its id; a private entry
// `contact_<ulid>`; `lead_<ulid>`, `deal_<ulid>`. Times are epoch milliseconds. Decisions:
// ./decisions.ts.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";

const OLD = "packages/backend/src/parties";
/** Frappe's sources, read on 8 November 2026: frappe/frappe at 1a7ea577, frappe/crm at 2cecd300. */
const FRAPPE = "github.com/frappe/frappe@1a7ea577:frappe/contacts/doctype";
const CRM = "github.com/frappe/crm@2cecd300:crm";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

/** Whose book a row is in. Each kind's id is the tenant column of that kind (P8). */
export const OwnerKind = Schema.Literals(["person", "organization"]);
export const Visibility = Schema.Literals(["listed", "hidden"]);
/** Which Frappe doctype an entry is: a Contact (a person, an agent, a wallet) or a CRM Organization (a company). */
export const Doctype = Schema.Literals(["contact", "organization"]);

// ── Frappe CRM's fixed lists, from its install defaults ─────────────────────────────────────

/** CRM Organization's `no_of_employees` choices, and CRM Lead's. */
export const EMPLOYEE_RANGES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"] as const;

/**
 * Frappe CRM's default lead statuses (`add_default_lead_statuses`), each with the stage its `type` names. The `lead`
 * machine runs on the stage; moving between two statuses of one stage is no transition. Converted is of type Won there,
 * like Qualified: a lead's `converted` stage is CRM Lead's `converted` check, not a status type, and Frappe's own
 * conversion sets the status to Qualified (`mark_converted`).
 */
export const LEAD_STATUSES = {
  New: "open",
  Contacted: "ongoing",
  Nurture: "ongoing",
  Qualified: "won",
  Converted: "won",
  Unqualified: "lost",
  Junk: "lost",
} as const;

/** Frappe CRM's default deal statuses (`add_default_deal_statuses`): the stage its `type` names and its probability. */
export const DEAL_STATUSES = {
  Qualification: { stage: "open", probability: 10 },
  "Demo/Making": { stage: "ongoing", probability: 25 },
  "Proposal/Quotation": { stage: "ongoing", probability: 50 },
  Negotiation: { stage: "ongoing", probability: 70 },
  "Ready to Close": { stage: "ongoing", probability: 90 },
  Won: { stage: "won", probability: 100 },
  Lost: { stage: "lost", probability: 0 },
} as const;

/** Frappe CRM's default lost reasons (`add_default_lost_reasons`); `Other` needs `lost_notes`. */
export const LOST_REASONS = [
  "Pricing",
  "Competition",
  "Budget Constraints",
  "Missing Features",
  "Long Sales Cycle",
  "No Decision-Maker",
  "Unresponsive Prospect",
  "Poor Fit",
  "Other",
] as const;

const EmployeeRange = Schema.Literals(EMPLOYEE_RANGES);
const LeadStatus = Schema.Literals(Object.keys(LEAD_STATUSES) as [keyof typeof LEAD_STATUSES, ...(keyof typeof LEAD_STATUSES)[]]);
const DealStatus = Schema.Literals(Object.keys(DEAL_STATUSES) as [keyof typeof DEAL_STATUSES, ...(keyof typeof DEAL_STATUSES)[]]);
const LostReason = Schema.Literals(LOST_REASONS);
/** A lead's stage: its status's type, or `converted` once CRM Lead's `converted` check is set. */
export const LeadStage = Schema.Literals(["open", "ongoing", "won", "lost", "converted"]);
export const DealStage = Schema.Literals(["open", "ongoing", "won", "lost"]);

/** Contact Email: one of the mailboxes an owner keeps for a person. */
export const ContactEmail = Schema.Struct({ email_id: S, is_primary: Schema.Boolean });
/** Contact Phone: one of the numbers an owner keeps for a person. */
export const ContactPhone = Schema.Struct({ phone: S, is_primary_phone: Schema.Boolean, is_primary_mobile_no: Schema.Boolean });

/** What every synced row carries for a connected head: its name there, and the version of its last change here. */
const Synced = {
  /** The head's name for it (a Contact's, `CRM-LEAD-2026-00001`, `CRM-DEAL-2026-00001`); null until a head has it. */
  head_name: NullOr(S),
  /** The `seq` of its latest change in contact-changes: the version a head's edit is based on; 0 in a person's book. */
  version: N,
};

// ── contacts: Contact and CRM Organization ──────────────────────────────────────────────────

export const table_contacts = defineTable({
  id: "contacts",
  title: "Book entries: Frappe's Contacts and CRM Organizations",
  about:
    "One row per entry in one owner's book: the person's own book (`owner_kind` person, `owner_id` their person_id) or an " +
    "Organization's (`owner_kind` organization, `owner_id` its org_id). An entry is a Frappe Contact (`doctype` contact: a " +
    "person, an agent, a wallet) or a CRM Organization (`doctype` organization: a company). It names its Party when it has " +
    "one, and at most one entry per Party is in a book, so every locator for the same Party lands on it; an entry born from " +
    "a Party has the PartyId as its `contact_id`. A private entry (a company not on Capxul, a person with no mailbox) has no " +
    "Party and a `contact_<ulid>` id until the owner links one (decision contacts.private-entries). `added_at` says the " +
    "owner added it by hand; a row without it only curates a member's entry, so a member who leaves and returns keeps " +
    "their label and visibility. `label` is the owner's own words, Contact's `full_name` or CRM Organization's " +
    "`organization_name`; with none a reader shows the primary mailbox the owner typed, then the Party's display name, " +
    "handle, then the entry's id, never an address. The other columns are the doctypes' own fields under Frappe's names: " +
    "a person's `email_ids`, `phone_nos`, `designation` and `company_id` (Contact's `company_name`: the organization entry " +
    "they work for); a company's `website`, `industry`, `territory`, `no_of_employees`, `annual_revenue` with `currency`, " +
    "and `company_description`. Every mailbox and number here is one this owner typed, private to the book. `updated_at` " +
    "is the entry's last change, which the book reports as its last activity. In an Organization's book `version` and " +
    "`head_name` serve a connected head (contacts.change-log). Replaces the `contact` edges of old parties' `partyEdges`.",
  concept: concept_contacts,
  tenancy: "owner",
  tenantField: "owner_id",
  scope:
    "The owner is `owner_kind` with `owner_id`: a person_id for a person's book, an org_id for an Organization's. The " +
    "generated row-level security policy matches each kind to the session's person or Organization tenant.",
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    /** The entry's id: its PartyId when born from a Party, else `contact_<ulid>`; never changes. */
    contact_id: S,
    doctype: Doctype,
    /** The counterparty: a person (provisional or claimed), an agent, an Organization or an outside address; null on a private entry. */
    party_id: NullOr(S),
    /** Trimmed, 1 to 120 characters; null when the owner never named them. */
    label: NullOr(S),
    visibility: Visibility,
    /** When the owner added the entry by hand; null on a row that only curates a member's entry. */
    added_at: NullOr(N),
    /** Contact: Contact Email rows, at most 10, at most one primary. Empty on an organization. */
    email_ids: Schema.Array(ContactEmail),
    /** Contact: Contact Phone rows, at most 10, at most one primary phone and one primary mobile. Empty on an organization. */
    phone_nos: Schema.Array(ContactPhone),
    /** Contact: their job title. */
    designation: NullOr(S),
    /** Contact: the `contact_id` of the organization entry in this book they work for (Contact's `company_name`). */
    company_id: NullOr(S),
    /** CRM Organization: its website, a host or URL. */
    website: NullOr(S),
    /** CRM Organization: CRM Industry's name. */
    industry: NullOr(S),
    /** CRM Organization: CRM Territory's name. */
    territory: NullOr(S),
    no_of_employees: NullOr(EmployeeRange),
    /** CRM Organization: a non-negative decimal in `currency`. */
    annual_revenue: NullOr(S),
    /** An ISO 4217 code or a token's symbol: 3 to 10 capitals. */
    currency: NullOr(S),
    company_description: NullOr(S),
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_id", "owner_kind", "contact_id"],
  indexes: [
    {
      name: "contacts-by-activity",
      fields: ["owner_id", "owner_kind", "updated_at", "contact_id"],
      for:
        "contact list and the guided pickers: one book's entries, most recent change first, after the `--after` cursor, " +
        "hidden ones left out unless `--include-hidden`",
    },
    {
      name: "contacts-by-party",
      fields: ["owner_id", "owner_kind", "party_id"],
      unique: true,
      for:
        "The one entry for a Party in a book (contact add by any locator, the merge with an Organization's Seats, banking's " +
        "check that a Party is in the book); unique among rows that name a Party",
    },
    {
      name: "contacts-by-company",
      fields: ["owner_id", "owner_kind", "company_id", "updated_at"],
      for: "The people a book keeps at one of its organization entries, as Frappe CRM's Organization page lists them",
    },
    {
      name: "contacts-by-head-name",
      fields: ["owner_id", "owner_kind", "doctype", "head_name"],
      unique: true,
      for:
        "The entry a head's change names by its doctype and head name, when it carries no capxul_id yet; unique among " +
        "rows a head has, per doctype, because a Contact and a CRM Organization may share a name there",
    },
  ],
  retention:
    "Kept while its owner exists. No operation deletes an entry: hiding keeps it, and adding it again lists it again.",
  was: [
    `${OLD}/tables.ts:153`,
    `${OLD}/model.ts:53`,
    `${OLD}/contacts/reads.ts:1`,
    `${OLD}/contacts/rules.ts:36`,
    `${FRAPPE}/contact/contact.json`,
    `${CRM}/fcrm/doctype/crm_organization/crm_organization.json`,
  ],
});

// ── the change log a connected head follows ─────────────────────────────────────────────────

export const table_crm_settings = defineTable({
  id: "crm-settings",
  title: "An Organization's CRM settings: its change counter",
  about:
    "One row per Organization whose CRM has changed: `next_seq`, the counter every Organization-owned CRM write takes " +
    "its `contact-changes` seq from, under this row's lock, so seqs commit in order. The first CRM write of an " +
    "Organization inserts it. Frappe CRM's FCRM Settings has no field Capxul keeps yet; per-Organization status, source " +
    "and territory lists would live here (contacts.crm-statuses).",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({ org_id: S, next_seq: N, created_at: N, updated_at: N }),
  key: ["org_id"],
  indexes: [],
  retention: "Kept while the Organization exists.",
  was: [`${CRM}/fcrm/doctype/fcrm_settings/fcrm_settings.json`],
});

export const table_contact_changes = defineTable({
  id: "contact-changes",
  title: "CRM change log: every Organization-owned CRM write, in commit order",
  about:
    "One row per change to an Organization's CRM record (a Contact or CRM Organization entry of its book, a lead, a deal " +
    "with its people, and a conversation: an email, a WhatsApp message, a call log, a note or a task), appended in the writing transaction with the next `seq` from `crm-settings` under its lock, so a " +
    "later `seq` never commits before an earlier one and a reader paging by `seq` skips nothing. The changed row keeps " +
    "that `seq` as its `version`. A connected head's sync pushes from it in order; a change that came from the head notes " +
    "it (`origin` head), so the push only confirms its version there. It holds ids, not content: the push reads each " +
    "record as it stands. A person's own book has no head and logs nothing (contacts.change-log).",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    seq: N,
    /** The record's doctype; the conversation doctypes joined with the CRM's conversations (contacts.conversations-head-sync). */
    doctype: Schema.Literals([
      "Contact", "CRM Organization", "CRM Lead", "CRM Deal", "Communication", "WA Message", "CRM Call Log", "FCRM Note", "CRM Task",
    ]),
    doc_id: S,
    origin: Schema.Literals(["capxul", "head"]),
    /** The principal whose command made it, or the head user (by mailbox) whose edit was applied. */
    by: S,
    at: N,
  }),
  key: ["org_id", "seq"],
  indexes: [],
  retention: "Kept for good: it is the order every head of the Organization replays.",
});

// ── whether an entry is listed ──────────────────────────────────────────────────────────────

export const event_contact_transitioned = defineEvent({
  id: "contact_transitioned",
  about:
    "An address book entry was hidden, or listed again by `contact unhide` or by adding it again by hand. Carries whose " +
    "book it is and the entry's id; never a label, a mailbox or an address.",
  props: Schema.Struct({
    from: Visibility,
    to: Visibility,
    transition: Schema.Literals(["hide", "unhide", "add_again"]),
    owner_kind: OwnerKind,
    owner_id: S,
    contact_id: S,
  }),
  was: [`${OLD}/contacts/events.ts:66`, `${OLD}/contacts/rules.ts:40`],
});

export const machine_contact = defineMachine({
  id: "contact",
  title: "Whether an address book entry is listed",
  about:
    "An entry is born listed (contact add, a recorded entry, a lead's conversion, or the first label or hide of a member's " +
    "entry, which writes its curating row). Hiding takes it off the default list without deleting it; unhiding, or adding " +
    "the same Party again by hand, lists it again. Hiding a hidden entry or unhiding a listed one changes nothing and " +
    "returns the entry as it is. The old `hidden` boolean on the contact edge, written by add, hide and unhide.",
  table: table_contacts,
  field: "visibility",
  initial: "listed",
  states: [
    { id: "listed", about: "In the default `contact list`." },
    { id: "hidden", about: "Left out of `contact list` unless `--include-hidden`; `contact get` still reads it." },
  ],
  transitions: {
    hide: {
      from: ["listed"],
      to: "hidden",
      about: "contact hide.",
      guard: "the entry is in the book: added by hand or recorded, or a member of the Organization whose book it is",
      emits: [event_contact_transitioned],
    },
    unhide: {
      from: ["hidden"],
      to: "listed",
      about: "contact unhide.",
      guard: "the entry is in the book",
      emits: [event_contact_transitioned],
    },
    add_again: {
      from: ["hidden"],
      to: "listed",
      about: "contact add of a Party whose entry is hidden: adding someone back by hand is how a hidden entry returns.",
      emits: [event_contact_transitioned],
    },
  },
  was: [`${OLD}/tables.ts:170`, `${OLD}/contacts/operations/add.ts:21`, `${OLD}/contacts/operations/hide.ts:17`],
});

// ── leads: CRM Lead ─────────────────────────────────────────────────────────────────────────

// ── deals: CRM Deal and CRM Contacts ────────────────────────────────────────────────────────

// ── conversations: every exchange with a contact, lead or deal, on one timeline ─────────────
//
// The CRM tracks every conversation (Aaron's evening answer, 8 November 2026), in Frappe's shapes, one
// table per doctype (decision contacts.conversations-shape): Communication for email, the WhatsApp
// app's WA Message and WA Account, CRM Call Log, FCRM Note and CRM Task, and Frappe's Dynamic Link rows
// (Communication Link, a call log's links) as `timeline-links`, which put each item on every record's
// timeline it belongs to. Only an Organization keeps them. Every time here is the world's now when the
// row was written (aaron.world-clock, contacts.conversations-on-the-world-clock). Ids: `comm_`,
// `inmail_`, `wa_`, `wam_`, `call_`, `note_`, `ctask_`, each with a ULID.

const FRAPPE_CORE = "github.com/frappe/frappe@1a7ea577:frappe";
const WHATSAPP = "github.com/frappe/whatsapp@59bf368:whatsapp/whatsapp";

/** The CRM records a conversation can be about, and whose timelines it shows on: Frappe's doctype names. */
export const RecordDoctype = Schema.Literals(["Contact", "CRM Organization", "CRM Lead", "CRM Deal"]);
/** What a timeline holds besides the money the chain shows: the conversation doctypes. */
export const ItemDoctype = Schema.Literals(["Communication", "WA Message", "CRM Call Log", "FCRM Note", "CRM Task"]);
/** Frappe's Dynamic Link to the record a conversation is about (`reference_doctype`, `reference_name`). */
const Reference = { reference_doctype: RecordDoctype, reference_name: S };

/** A mailbox as an email's headers carry it: trimmed, lowercased, at most 254 characters. */
const Mailbox = S;
/** The names and sizes of an email's attachments; their bytes are not kept yet (contacts.attachments-later). */
const AttachmentNote = Schema.Struct({ file_name: S, content_type: S, size: N });

// ── communications: Frappe's Communication, medium Email ────────────────────────────────────

export const DELIVERY_STATES = ["sent", "delivered", "bounced", "spam", "received"] as const;
const DeliveryState = Schema.Literals(DELIVERY_STATES);

// ── inbound-mails: what reached the CRM mailbox, before it is threaded ──────────────────────

const INBOUND_STATES = ["received", "threaded", "dropped"] as const;
const InboundState = Schema.Literals(INBOUND_STATES);

// ── wa-accounts: the Organization's WhatsApp Business number (the WhatsApp app's WA Account) ─

const WA_ACCOUNT_STATES = ["active", "failing", "disconnected"] as const;
const WaAccountState = Schema.Literals(WA_ACCOUNT_STATES);

// ── wa-messages: the WhatsApp app's WA Message ──────────────────────────────────────────────

const WA_MESSAGE_STATES = ["sent", "delivered", "read", "failed", "received"] as const;
const WaMessageState = Schema.Literals(WA_MESSAGE_STATES);

// ── crm-call-logs: CRM Call Log, logged by hand ─────────────────────────────────────────────

export const CALL_STATUSES = ["Completed", "No Answer", "Busy", "Failed", "Canceled"] as const;

// ── crm-notes: FCRM Note ────────────────────────────────────────────────────────────────────

// ── crm-tasks: CRM Task ─────────────────────────────────────────────────────────────────────

/** CRM Task's statuses, each with the stage the `crm-task` machine runs on. */
export const TASK_STATUSES = { Backlog: "open", Todo: "open", "In Progress": "working", Done: "done", Canceled: "cancelled" } as const;
const TaskStatus = Schema.Literals(Object.keys(TASK_STATUSES) as [keyof typeof TASK_STATUSES, ...(keyof typeof TASK_STATUSES)[]]);
export const TaskStage = Schema.Literals(["open", "working", "done", "cancelled"]);

// ── timeline-links: which records each conversation shows on (Frappe's Dynamic Link) ───────


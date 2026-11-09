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
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
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

export const table_contact_head_syncs = defineTable({
  id: "contact-head-syncs",
  title: "The CRM's sync with one head",
  about:
    "One row per head connection the CRM syncs with: how far it has pushed the change log (`pushed_seq`), how far it has " +
    "read the head's own changes (`pulled_change`), when each last ran, and the conflicts and refusals it resolved (a " +
    "head edit based on an older version, or one Capxul's checks refuse, which Capxul's version overwrote). Its process " +
    "(`contacts.head.sync`) is the only writer.",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    head_id: S,
    pushed_seq: N,
    pulled_change: NullOr(S),
    pushed_at: NullOr(N),
    pulled_at: NullOr(N),
    conflicts: N,
    refused: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "head_id"],
  indexes: [],
  retention: "Kept while the Organization exists: the record of what each head was given.",
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

export const table_leads = defineTable({
  id: "leads",
  title: "An Organization's leads: Frappe CRM's CRM Lead",
  about:
    "One row per lead in an Organization's CRM: someone the Organization may sell to, not yet a deal. It holds what " +
    "CRM Lead holds, under its field names: the person (`first_name`, `last_name`, `email`, `mobile_no`, `phone`, " +
    "`job_title`), the company as typed (`organization`, `website`, `industry`, `territory`, `no_of_employees`, " +
    "`annual_revenue`, which CRM Lead keeps with no currency of its own: it is in the Organization's), where it came from " +
    "(`source`), who in the Organization works it (`lead_owner_party_id`, a member's Party, Frappe's `lead_owner`), its " +
    "`status` and the `stage` that status's type names, and why it was lost. A lead names no Party: it is the " +
    "Organization's private note about a prospect, so its mailbox enters the directory only when the lead is converted " +
    "and becomes a contact (decision contacts.lead-conversion). Stage `converted` is CRM Lead's `converted` check, with " +
    "status Qualified as Frappe's `mark_converted` sets it; `deal_id` is the deal its conversion made (Frappe links the " +
    "other way, by CRM Deal's `lead`), and a converted lead is kept as it was. A lead needs a person's name, a company's " +
    "name or a mailbox, as Frappe's `set_lead_name` requires.",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    lead_id: S,
    stage: LeadStage,
    status: LeadStatus,
    first_name: NullOr(S),
    last_name: NullOr(S),
    email: NullOr(S),
    mobile_no: NullOr(S),
    phone: NullOr(S),
    job_title: NullOr(S),
    /** The company's name as typed: CRM Lead's `organization` (Data), not a link. */
    organization: NullOr(S),
    website: NullOr(S),
    industry: NullOr(S),
    territory: NullOr(S),
    no_of_employees: NullOr(EmployeeRange),
    /** A non-negative decimal in the Organization's currency: CRM Lead's `annual_revenue` has no currency field. */
    annual_revenue: NullOr(S),
    /** CRM Lead Source's name. */
    source: NullOr(S),
    lead_owner_party_id: NullOr(S),
    lost_reason: NullOr(LostReason),
    lost_notes: NullOr(S),
    /** The deal its conversion made; set exactly when the stage is `converted`. */
    deal_id: NullOr(S),
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "lead_id"],
  indexes: [
    {
      name: "leads-by-activity",
      fields: ["org_id", "updated_at", "lead_id"],
      for: "The Organization's leads not converted, most recent change first, after a cursor, converted ones skipped: Frappe CRM's leads list",
    },
    {
      name: "leads-by-stage",
      fields: ["org_id", "stage", "updated_at", "lead_id"],
      for: "The leads at one stage, most recent change first: Frappe CRM's kanban and its open-leads list",
    },
    {
      name: "leads-by-head-name",
      fields: ["org_id", "head_name"],
      unique: true,
      for: "The lead a head's change names by its head name, when it carries no capxul_id yet",
    },
  ],
  retention: "Kept while the Organization exists: a lead that goes nowhere is lost, never deleted.",
  was: [`${CRM}/fcrm/doctype/crm_lead/crm_lead.json`, `${CRM}/fcrm/doctype/crm_lead/crm_lead.py:140`],
});

export const event_lead_transitioned = defineEvent({
  id: "lead_transitioned",
  about:
    "A lead was captured, or moved to another stage: worked, won, lost, reopened or converted. Carries the Organization " +
    "and the lead's id; never a name, a mailbox or a company.",
  props: Schema.Struct({
    from: NullOr(LeadStage),
    to: LeadStage,
    transition: Schema.Literals(["capture", "reopen", "engage", "qualify", "lose", "convert"]),
    org_id: S,
    lead_id: S,
  }),
});

export const machine_lead = defineMachine({
  id: "lead",
  title: "A lead's stage: Frappe CRM's lead status types",
  about:
    "A lead is born open (status New) and moves between the types of Frappe CRM's default lead statuses: ongoing " +
    "(Contacted, Nurture), won (Qualified, Converted), lost (Unqualified, Junk); and converted, CRM Lead's `converted` " +
    "check, which its conversion to a deal reaches and nothing leaves. A status change within one stage writes `status` " +
    "only. Frappe's On Hold type has no default status, so it is not booked (decision contacts.crm-statuses).",
  table: table_leads,
  field: "stage",
  initial: "open",
  states: [
    { id: "open", about: "New: captured, not yet worked." },
    { id: "ongoing", about: "Contacted or Nurture: someone is working it." },
    { id: "won", about: "Qualified or Converted (both of type Won): worth a deal, not yet converted." },
    { id: "lost", about: "Unqualified or Junk, with a lost reason." },
    { id: "converted", about: "CRM Lead's `converted` check, status Qualified: its deal, contact and organization exist; it changes no more.", terminal: true },
  ],
  transitions: {
    capture: {
      from: [],
      to: "open",
      about: "A lead is recorded in the Organization's CRM, with status New.",
      guard: "a person's name, a company's name or a mailbox is given",
      emits: [event_lead_transitioned],
    },
    reopen: {
      from: ["ongoing", "won", "lost"],
      to: "open",
      about: "Moved back to an open status; a lost reason is cleared.",
      emits: [event_lead_transitioned],
    },
    engage: {
      from: ["open", "won", "lost"],
      to: "ongoing",
      about: "Moved to an ongoing status (Contacted, Nurture); a lost reason is cleared.",
      emits: [event_lead_transitioned],
    },
    qualify: {
      from: ["open", "ongoing", "lost"],
      to: "won",
      about: "Moved to a won status (Qualified, Converted); a lost reason is cleared.",
      emits: [event_lead_transitioned],
    },
    lose: {
      from: ["open", "ongoing", "won"],
      to: "lost",
      about: "Moved to a lost status, with its reason.",
      guard: "a lost reason is given; `Other` also needs notes (Frappe's validate_lost_reason)",
      emits: [event_lead_transitioned],
    },
    convert: {
      from: ["open", "ongoing", "won"],
      to: "converted",
      about:
        "Converted to a deal, in the transaction that makes the deal and the contact and organization entries; status " +
        "Qualified and the `converted` check, as Frappe's `mark_converted` sets them.",
      guard: "not lost (Frappe: 'Cannot convert a lead with status' of type Lost)",
      emits: [event_lead_transitioned],
    },
  },
  was: [`${CRM}/install.py:46`, `${CRM}/fcrm/doctype/crm_lead/crm_lead.py:546`],
});

// ── deals: CRM Deal and CRM Contacts ────────────────────────────────────────────────────────

export const table_deals = defineTable({
  id: "deals",
  title: "An Organization's deals: Frappe CRM's CRM Deal",
  about:
    "One row per deal in an Organization's CRM: a sale the Organization is working towards with one company or person. " +
    "It holds what CRM Deal holds, under its field names: the company (`organization_id`, an organization entry of the " +
    "Organization's book, Frappe's `organization` link), the lead it came from (`lead_id`), who works it " +
    "(`deal_owner_party_id`, a member's Party, Frappe's `deal_owner`), its `status` and the `stage` that status's type " +
    "names, its `probability` (0 to 100, taken from the status when none is given), `deal_value` and " +
    "`expected_deal_value` with `currency`, `expected_closure_date` (a calendar date, YYYY-MM-DD), `closed_at` (the one " +
    "clock's now when it was last won, Frappe's `closed_date`), `next_step`, `source`, and why it was lost. Its people " +
    "are `deal-contacts`. A deal is a forecast, not money: it moves nothing and books nothing; a payment or request may " +
    "follow it, through their own commands.",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    deal_id: S,
    stage: DealStage,
    status: DealStatus,
    organization_id: NullOr(S),
    lead_id: NullOr(S),
    deal_owner_party_id: NullOr(S),
    probability: N,
    deal_value: NullOr(S),
    expected_deal_value: NullOr(S),
    currency: NullOr(S),
    expected_closure_date: NullOr(S),
    closed_at: NullOr(N),
    next_step: NullOr(S),
    source: NullOr(S),
    lost_reason: NullOr(LostReason),
    lost_notes: NullOr(S),
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "deal_id"],
  indexes: [
    {
      name: "deals-by-activity",
      fields: ["org_id", "updated_at", "deal_id"],
      for: "The Organization's deals, most recent change first, after a cursor: Frappe CRM's deals list",
    },
    {
      name: "deals-by-stage",
      fields: ["org_id", "stage", "updated_at", "deal_id"],
      for: "The deals at one stage, most recent change first: Frappe CRM's pipeline and kanban",
    },
    {
      name: "deals-by-lead",
      fields: ["org_id", "lead_id", "created_at"],
      for:
        "A lead's deals, first made first: the one its conversion made (also the lead's `deal_id`), and any more a head " +
        "made from it, as Frappe's `convert_to_deal` does by default ('Create'); a lead the head converts takes the first",
    },
    {
      name: "deals-by-organization",
      fields: ["org_id", "organization_id", "updated_at"],
      for: "One organization entry's deals, most recent change first, as Frappe CRM's Organization page lists them",
    },
    {
      name: "deals-by-head-name",
      fields: ["org_id", "head_name"],
      unique: true,
      for: "The deal a head's change names by its head name, when it carries no capxul_id yet",
    },
  ],
  retention: "Kept while the Organization exists: a deal that goes nowhere is lost, never deleted.",
  was: [`${CRM}/fcrm/doctype/crm_deal/crm_deal.json`, `${CRM}/fcrm/doctype/crm_deal/crm_deal.py:90`],
});

export const table_deal_contacts = defineTable({
  id: "deal-contacts",
  title: "A deal's people: Frappe CRM's CRM Contacts",
  about:
    "One row per person on a deal: a contact entry of the Organization's book (`contact_id`), one of them primary, as CRM " +
    "Deal's `contacts` child table keeps them. Written with its deal, in the deal's transaction. At most one is primary, " +
    "and a deal's only person is its primary, as Frappe's `set_primary_contact` and `set_primary_email_mobile_no` do. The " +
    "row carries the Organization itself, so a person's deals are read without a join.",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    deal_id: S,
    contact_id: S,
    is_primary: Schema.Boolean,
    created_at: N,
  }),
  key: ["org_id", "deal_id", "contact_id"],
  indexes: [
    {
      name: "deal-contacts-by-contact",
      fields: ["org_id", "contact_id", "deal_id"],
      for: "A contact's deals, as Frappe CRM's Contact page lists them (`get_linked_deals`)",
    },
  ],
  retention: "Kept with its deal; a person taken off a deal loses the row.",
  was: [`${CRM}/fcrm/doctype/crm_contacts/crm_contacts.json`, `${CRM}/fcrm/doctype/crm_deal/crm_deal.py:129`, `${CRM}/api/contact.py:46`],
});

export const event_deal_transitioned = defineEvent({
  id: "deal_transitioned",
  about:
    "A deal was opened, or moved to another stage: worked, won, lost or reopened. Carries the Organization, the deal's id " +
    "and the lead it came from; never a company, a person or a value.",
  props: Schema.Struct({
    from: NullOr(DealStage),
    to: DealStage,
    transition: Schema.Literals(["start", "reopen", "engage", "win", "lose"]),
    org_id: S,
    deal_id: S,
    lead_id: NullOr(S),
  }),
});

export const machine_deal = defineMachine({
  id: "deal",
  title: "A deal's stage: Frappe CRM's deal status types",
  about:
    "A deal is born open (status Qualification), from a lead's conversion or by hand, and moves between the types of " +
    "Frappe CRM's default deal statuses: ongoing (Demo/Making, Proposal/Quotation, Negotiation, Ready to Close), won (Won) " +
    "and lost (Lost). A status change within one stage writes `status` only. Won and lost can be reopened, as Frappe " +
    "allows; winning sets `closed_at`.",
  table: table_deals,
  field: "stage",
  initial: "open",
  states: [
    { id: "open", about: "Qualification: a deal is being shaped." },
    { id: "ongoing", about: "Demo, proposal, negotiation or ready to close." },
    { id: "won", about: "Won: `closed_at` is when it was won." },
    { id: "lost", about: "Lost, with a lost reason." },
  ],
  transitions: {
    start: {
      from: [],
      to: "open",
      about: "A deal is opened, by hand or by a lead's conversion, with status Qualification.",
      emits: [event_deal_transitioned],
    },
    reopen: {
      from: ["ongoing", "won", "lost"],
      to: "open",
      about: "Moved back to Qualification; a lost reason is cleared.",
      emits: [event_deal_transitioned],
    },
    engage: {
      from: ["open", "won", "lost"],
      to: "ongoing",
      about: "Moved to an ongoing status; a lost reason is cleared.",
      emits: [event_deal_transitioned],
    },
    win: {
      from: ["open", "ongoing", "lost"],
      to: "won",
      about: "Won: `closed_at` is set to now (Frappe sets `closed_date` when a status of type Won is set).",
      emits: [event_deal_transitioned],
    },
    lose: {
      from: ["open", "ongoing", "won"],
      to: "lost",
      about: "Lost, with its reason.",
      guard: "a lost reason is given; `Other` also needs notes (Frappe's validate_lost_reason)",
      emits: [event_deal_transitioned],
    },
  },
  was: [`${CRM}/install.py:97`, `${CRM}/fcrm/doctype/crm_deal/crm_deal.py:98`, `${CRM}/fcrm/doctype/crm_deal/crm_deal.py:247`],
});

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

export const table_communications = defineTable({
  id: "communications",
  title: "Emails: Frappe's Communication, each one sent or received by the CRM",
  about:
    "One row per email the Organization's CRM mailbox sent or received (Communication, `communication_medium` Email, " +
    "under its field names): `sent_or_received`, `subject`, `content` (the HTML, sanitized) and `text_content`, " +
    "`sender` with `sender_full_name`, `recipients`, `cc` and `bcc` (a sent email's only), `message_id` (its " +
    "Message-ID, without brackets), `in_reply_to` (the communication it answers, Frappe's Link), the record it is about " +
    "(`reference_doctype`, `reference_name`: a contact entry, a lead or a deal), `email_account` (the CRM mailbox) and " +
    "`delivery_status`. A sent email's Message-ID is Capxul's own (`<comm id>@<CRM_MAIL_DOMAIN>`), so a reply threads " +
    "back by it (contacts.mail-threading). `by_party_id` is the member who sent it; `provider_id` the mail provider's " +
    "id for it, which its delivery events name; `send_key` the SDK's send id, so a retried send is one email. " +
    "`communication_date` is the world's now when it was sent or received; a received email's own Date header is kept " +
    "as `envelope_date`, real time (time.real-elapsed). Attachments are named, not kept (contacts.attachments-later).",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    communication_id: S,
    communication_medium: Schema.Literal("Email"),
    sent_or_received: Schema.Literals(["Sent", "Received"]),
    delivery_status: DeliveryState,
    subject: S,
    content: NullOr(S),
    text_content: S,
    sender: Mailbox,
    sender_full_name: NullOr(S),
    recipients: Schema.Array(Mailbox),
    cc: Schema.Array(Mailbox),
    bcc: Schema.Array(Mailbox),
    message_id: S,
    in_reply_to: NullOr(S),
    ...Reference,
    email_account: Mailbox,
    by_party_id: NullOr(S),
    provider_id: NullOr(S),
    send_key: NullOr(S),
    attachments: Schema.Array(AttachmentNote),
    communication_date: N,
    envelope_date: NullOr(N),
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "communication_id"],
  indexes: [
    {
      name: "communications-by-message-id",
      fields: ["org_id", "message_id"],
      unique: true,
      for: "Threading: the communication an inbound email's In-Reply-To or References names, and a Message-ID received twice",
    },
    {
      name: "communications-by-provider-id",
      fields: ["provider_id"],
      unique: true,
      crossTenant: true,
      for: "A delivery event from the mail provider names only its own id: the sent email it moves, in whichever Organization",
    },
    {
      name: "communications-by-send-key",
      fields: ["org_id", "send_key"],
      unique: true,
      for: "A retried `org crm email send` finds the email its first call recorded, so it is sent once",
    },
    {
      name: "communications-by-reference",
      fields: ["org_id", "reference_name", "communication_date"],
      for: "The emails about one record, newest first: a reply's default recipients and the record's last email",
    },
  ],
  retention: "Kept while the Organization exists: an email is the CRM's record of what was said.",
  was: [
    `${FRAPPE_CORE}/core/doctype/communication/communication.json`,
    `${FRAPPE_CORE}/email/receive.py:738`,
    `${FRAPPE_CORE}/core/doctype/communication/communication.py:428`,
  ],
});

export const event_communication_transitioned = defineEvent({
  id: "communication_transitioned",
  about:
    "An email was sent or received by an Organization's CRM, or a sent one was delivered, bounced or marked as spam. " +
    "Carries the Organization, the email's id and the doctype it is about; never a mailbox, a subject or a body.",
  props: Schema.Struct({
    from: NullOr(DeliveryState),
    to: DeliveryState,
    transition: Schema.Literals(["send", "receive", "deliver", "bounce", "mark_spam"]),
    org_id: S,
    communication_id: S,
    reference_doctype: RecordDoctype,
  }),
});

export const machine_communication = defineMachine({
  id: "communication",
  title: "An email's delivery: Frappe's Communication delivery status",
  about:
    "communications.delivery_status, in Frappe's values lowercased (Sent, Bounced, Marked As Spam; Received for an " +
    "inbound email). A sent email is born `sent` once the mail provider took it, and its provider's delivery events " +
    "move it: delivered, bounced (also after delivered, as a late bounce comes), or spam when the recipient complains. " +
    "A received email is born `received` and never moves. Opens and clicks are not tracked.",
  table: table_communications,
  field: "delivery_status",
  initial: "sent",
  states: [
    { id: "sent", about: "The mail provider (or a devnet's mail sink) took it; it does not prove the inbox did." },
    { id: "delivered", about: "The recipient's server accepted it." },
    { id: "bounced", about: "The recipient's server refused it, at once or later.", terminal: true },
    { id: "spam", about: "The recipient marked it as spam (Frappe's Marked As Spam).", terminal: true },
    { id: "received", about: "An inbound email, threaded onto its record.", terminal: true },
  ],
  transitions: {
    send: { from: [], to: "sent", about: "Birth: `org crm email send`'s one write, once the provider took it.", emits: [event_communication_transitioned] },
    receive: { from: [], to: "received", about: "Birth: an inbound email, threaded by `contacts.mail.thread`.", emits: [event_communication_transitioned] },
    deliver: { from: ["sent"], to: "delivered", about: "The provider's delivered event.", emits: [event_communication_transitioned] },
    bounce: { from: ["sent", "delivered"], to: "bounced", about: "The provider's bounced event.", emits: [event_communication_transitioned] },
    mark_spam: { from: ["sent", "delivered"], to: "spam", about: "The provider's complained event.", emits: [event_communication_transitioned] },
  },
  was: [`${FRAPPE_CORE}/core/doctype/communication/communication.json`],
});

// ── inbound-mails: what reached the CRM mailbox, before it is threaded ──────────────────────

const INBOUND_STATES = ["received", "threaded", "dropped"] as const;
const InboundState = Schema.Literals(INBOUND_STATES);

export const table_inbound_mails = defineTable({
  id: "inbound-mails",
  title: "Inbound mail: each email the provider received for a CRM mailbox",
  about:
    "One row per email the mail provider received for an Organization's CRM mailbox, written by `contacts.mail.receive` " +
    "from the provider's signed event, before the email itself is read: the provider's id for it (`inbound_id`), the " +
    "mailbox it came to and its `status`. `contacts.mail.thread` then reads the email, threads it and stores it as a " +
    "communication (`communication_id`), or drops it with its reason (`drop_reason`: from the mailbox itself, a " +
    "Message-ID the CRM already holds, a member's email that names no record). It holds ids, never content, so a " +
    "repeated delivery of one event finds its row and changes nothing (Frappe's `is_exist_in_system`).",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    inbound_id: S,
    mailbox: Mailbox,
    status: InboundState,
    communication_id: NullOr(S),
    drop_reason: NullOr(Schema.Literals(["own-mailbox", "duplicate", "member-unmatched"])),
    received_at: N,
    updated_at: N,
  }),
  key: ["org_id", "inbound_id"],
  indexes: [],
  retention: "Kept while the Organization exists: ids only, the record of what reached its mailbox.",
  was: [`${FRAPPE_CORE}/email/receive.py:719`, `${FRAPPE_CORE}/email/receive.py:791`],
});

export const event_inbound_mail_transitioned = defineEvent({
  id: "inbound_mail_transitioned",
  about: "An email reached a CRM mailbox, or was threaded onto its record or dropped. Carries the Organization and the provider's id.",
  props: Schema.Struct({
    from: NullOr(InboundState),
    to: InboundState,
    transition: Schema.Literals(["receive", "thread", "drop"]),
    org_id: S,
    inbound_id: S,
  }),
});

export const machine_inbound_mail = defineMachine({
  id: "inbound-mail",
  title: "An inbound email: received, then threaded or dropped",
  about:
    "inbound-mails.status. Born `received` by the provider's signed event; its process reads the email and threads it " +
    "(`threaded`, with the communication it made) or drops it (`dropped`, with why). Nothing leaves either.",
  table: table_inbound_mails,
  field: "status",
  initial: "received",
  states: [
    { id: "received", about: "The provider said it has the email; Capxul has not read it yet." },
    { id: "threaded", about: "Stored as a communication on its record's timeline.", terminal: true },
    { id: "dropped", about: "Not the CRM's to keep: its reason says why.", terminal: true },
  ],
  transitions: {
    receive: { from: [], to: "received", about: "Birth: `contacts.mail.receive` stored the provider's event.", emits: [event_inbound_mail_transitioned] },
    thread: { from: ["received"], to: "threaded", about: "The email was read and stored on its record.", emits: [event_inbound_mail_transitioned] },
    drop: { from: ["received"], to: "dropped", about: "The email is not the CRM's to keep.", emits: [event_inbound_mail_transitioned] },
  },
});

// ── wa-accounts: the Organization's WhatsApp Business number (the WhatsApp app's WA Account) ─

const WA_ACCOUNT_STATES = ["active", "failing", "disconnected"] as const;
const WaAccountState = Schema.Literals(WA_ACCOUNT_STATES);

export const table_wa_accounts = defineTable({
  id: "wa-accounts",
  title: "WhatsApp accounts: the Business number an Organization connected",
  about:
    "One row per WhatsApp Business number an Organization connected through Meta's WhatsApp Business Cloud API, in the " +
    "WhatsApp app's WA Account shape: `phone_id` (Meta's phone number id), `display_number` (E.164), `business_id` (the " +
    "WhatsApp Business Account), `app_id`, and the access token, app secret and webhook verify token, each sealed " +
    "under record-bound encryption and never read back to a caller. Capxul's webhook for it is " +
    "`/v1/whatsapp/<account_id>`, which the Organization sets in its Meta app with the verify token; Meta's deliveries " +
    "there are checked against the app secret. `status` is its machine; `checked_at` and `last_error` its process's " +
    "last check of the number. At most one account per Organization is live (active or failing), and one number is " +
    "live in at most one Organization. A disconnected account is kept, so its messages keep their account.",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    account_id: S,
    status: WaAccountState,
    phone_id: S,
    display_number: S,
    business_id: S,
    app_id: S,
    /** Sealed: the system user's access token, the app secret and the verify token. */
    sealed_access_token: S,
    sealed_app_secret: S,
    sealed_verify_token: S,
    verified_name: NullOr(S),
    checked_at: NullOr(N),
    last_error: NullOr(Schema.Struct({ code: S, message: S })),
    connected_by: S,
    connected_at: N,
    disconnected_at: NullOr(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "account_id"],
  indexes: [
    {
      name: "wa-accounts-live",
      fields: ["org_id", "status"],
      for: "The Organization's live account (active or failing): at most one, the guard of `org crm whatsapp connect`",
    },
    {
      name: "wa-accounts-by-id",
      fields: ["account_id"],
      unique: true,
      crossTenant: true,
      for: "Meta's webhook names only the account in its path, with no session: the delivery's account and its Organization",
    },
    {
      name: "wa-accounts-by-number",
      fields: ["phone_id", "status"],
      crossTenant: true,
      for: "One number live in one Organization: a connect of a number another Organization has live is refused",
    },
  ],
  retention: "Kept while the Organization exists; a disconnected account's sealed secrets are erased at disconnect.",
  was: [`${WHATSAPP}/doctype/wa_account/wa_account.json`, `${WHATSAPP}/doctype/wa_settings/wa_settings.json`],
});

export const event_wa_account_transitioned = defineEvent({
  id: "wa_account_transitioned",
  about: "A WhatsApp number was connected, started or stopped failing, or was disconnected. Carries the Organization and the account's id; never a number or a secret.",
  props: Schema.Struct({
    from: NullOr(WaAccountState),
    to: WaAccountState,
    transition: Schema.Literals(["connect", "fail", "recover", "disconnect"]),
    org_id: S,
    account_id: S,
  }),
});

export const machine_wa_account = defineMachine({
  id: "wa-account",
  title: "A connected WhatsApp number: active, failing or disconnected",
  about:
    "wa-accounts.status, owned by the account's process (`contacts.whatsapp.account`). Born active once Meta answered " +
    "for the number with its token; failing while Meta refuses the token or the number (the daily check, or a send " +
    "Meta refused for its token), active again once it answers; disconnected for good by `org crm whatsapp disconnect`.",
  table: table_wa_accounts,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "Meta answers for the number: messages go and come." },
    { id: "failing", about: "Meta refuses the token or the number: nothing is sent; deliveries are still taken." },
    { id: "disconnected", about: "Disconnected: no send, no delivery taken, secrets erased; its messages are kept.", terminal: true },
  ],
  transitions: {
    connect: { from: [], to: "active", about: "Birth: `org crm whatsapp connect`, once Meta answered for the number.", emits: [event_wa_account_transitioned] },
    fail: { from: ["active"], to: "failing", about: "Meta refused the account's token or number.", emits: [event_wa_account_transitioned] },
    recover: { from: ["failing"], to: "active", about: "Meta answered again, or a signed delivery arrived.", emits: [event_wa_account_transitioned] },
    disconnect: { from: ["active", "failing"], to: "disconnected", about: "`org crm whatsapp disconnect`.", emits: [event_wa_account_transitioned] },
  },
  was: [`${WHATSAPP}/doctype/wa_account/wa_account.json`],
});

// ── wa-messages: the WhatsApp app's WA Message ──────────────────────────────────────────────

const WA_MESSAGE_STATES = ["sent", "delivered", "read", "failed", "received"] as const;
const WaMessageState = Schema.Literals(WA_MESSAGE_STATES);

export const table_wa_messages = defineTable({
  id: "wa-messages",
  title: "WhatsApp messages: the WhatsApp app's WA Message, either way",
  about:
    "One row per WhatsApp message the Organization's connected number sent or received, in WA Message's shape: " +
    "`direction` (Outgoing, Incoming), `counterpart` (the other party's E.164 number, which WA Message reaches through " +
    "its WA Profile), `kind` (text, template, media, interactive, reaction), `message` (the text, or a template's " +
    "rendered body), `template` with its `template_language` and `template_params`, `message_id` (Meta's wamid), " +
    "`context_message_id` and `reply_to_message` (the message it answers), the record it is about " +
    "(`reference_doctype`, `reference_name`), `status`, and Meta's `error_code` and `error_message` for a failed one. " +
    "A media message keeps its `media_id` and `mime_type`, not its bytes (contacts.attachments-later). `timestamp` is " +
    "the world's now when it was sent or received; the last Incoming message from a number opens the 24-hour window " +
    "in which a free-form text may go to it (contacts.whatsapp-window). `send_key` is the SDK's send id, so a retried " +
    "send is one message.",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    wa_message_id: S,
    account_id: S,
    direction: Schema.Literals(["Outgoing", "Incoming"]),
    status: WaMessageState,
    counterpart: S,
    kind: Schema.Literals(["text", "template", "media", "interactive", "reaction"]),
    message: NullOr(S),
    template: NullOr(S),
    template_language: NullOr(S),
    template_params: Schema.Array(S),
    message_id: S,
    context_message_id: NullOr(S),
    reply_to_message: NullOr(S),
    ...Reference,
    media_id: NullOr(S),
    mime_type: NullOr(S),
    error_code: NullOr(S),
    error_message: NullOr(S),
    by_party_id: NullOr(S),
    send_key: NullOr(S),
    timestamp: N,
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "wa_message_id"],
  indexes: [
    {
      name: "wa-messages-by-wamid",
      fields: ["org_id", "message_id"],
      unique: true,
      for: "A status webhook or a reply names Meta's wamid: the message it moves or answers, and a delivery received twice",
    },
    {
      name: "wa-messages-by-counterpart",
      fields: ["org_id", "account_id", "counterpart", "direction", "timestamp"],
      for: "One conversation: the last Incoming message from a number (its 24-hour window) and the record it threads to",
    },
    {
      name: "wa-messages-by-send-key",
      fields: ["org_id", "send_key"],
      unique: true,
      for: "A retried `org crm whatsapp send` finds the message its first call recorded, so it is sent once",
    },
  ],
  retention: "Kept while the Organization exists, through a disconnect: the CRM's record of what was said.",
  was: [`${WHATSAPP}/doctype/wa_message/wa_message.json`, `${WHATSAPP}/webhook.py:126`, `${CRM}/api/whatsapp.py:42`],
});

export const event_wa_message_transitioned = defineEvent({
  id: "wa_message_transitioned",
  about: "A WhatsApp message was sent or received, or a sent one was delivered, read or failed. Carries the Organization, the message's id and its direction; never a number or a text.",
  props: Schema.Struct({
    from: NullOr(WaMessageState),
    to: WaMessageState,
    transition: Schema.Literals(["send", "receive", "deliver", "read", "fail"]),
    org_id: S,
    wa_message_id: S,
    direction: Schema.Literals(["Outgoing", "Incoming"]),
  }),
});

export const machine_wa_message = defineMachine({
  id: "wa-message",
  title: "A WhatsApp message's status: WA Message's Sent, Delivered, Read, Failed",
  about:
    "wa-messages.status, in WA Message's values lowercased (its Pending is the send's own call, never stored). An " +
    "Outgoing message is born `sent` once Meta answered with its wamid, and Meta's status webhooks move it: delivered, " +
    "read (also straight from sent, as statuses can arrive out of order), or failed. An Incoming message is born " +
    "`received` and never moves.",
  table: table_wa_messages,
  field: "status",
  initial: "sent",
  states: [
    { id: "sent", about: "Meta accepted it and answered its wamid." },
    { id: "delivered", about: "It reached the recipient's phone." },
    { id: "read", about: "The recipient read it.", terminal: true },
    { id: "failed", about: "Meta could not deliver it; `error_code` says why.", terminal: true },
    { id: "received", about: "An Incoming message, threaded onto its record.", terminal: true },
  ],
  transitions: {
    send: { from: [], to: "sent", about: "Birth: `org crm whatsapp send`'s one write, once Meta answered its wamid.", emits: [event_wa_message_transitioned] },
    receive: { from: [], to: "received", about: "Birth: an Incoming message from Meta's signed webhook.", emits: [event_wa_message_transitioned] },
    deliver: { from: ["sent"], to: "delivered", about: "Meta's `delivered` status.", emits: [event_wa_message_transitioned] },
    read: { from: ["sent", "delivered"], to: "read", about: "Meta's `read` status.", emits: [event_wa_message_transitioned] },
    fail: { from: ["sent", "delivered"], to: "failed", about: "Meta's `failed` status, with its error.", emits: [event_wa_message_transitioned] },
  },
  was: [`${WHATSAPP}/doctype/wa_message/wa_message.json`, `${WHATSAPP}/webhook.py:242`],
});

// ── crm-call-logs: CRM Call Log, logged by hand ─────────────────────────────────────────────

export const CALL_STATUSES = ["Completed", "No Answer", "Busy", "Failed", "Canceled"] as const;

export const table_crm_call_logs = defineTable({
  id: "crm-call-logs",
  title: "Call logs: Frappe CRM's CRM Call Log, logged by hand",
  about:
    "One row per call a member logged, in CRM Call Log's shape with `telephony_medium` Manual: `type` (Incoming, " +
    "Outgoing), `status` (the call's outcome, one of CRM Call Log's final statuses: Completed, No Answer, Busy, Failed, " +
    "Canceled), `counterpart` (the other party's number, E.164), the member who took or made it (`member_party_id`: " +
    "CRM Call Log's `caller` for an outgoing call, `receiver` for an incoming one), `start_time`, `end_time` and " +
    "`duration` in seconds, the note it carries (`note_id`, an FCRM Note) and the record it is about (`reference_doctype`, " +
    "`reference_name`). A log records a call that is over, so its `end_time` is never after the world's now when it is " +
    "written (contacts.call-logs). The outcome is a fact written once, so it is no state machine. Telephony (Twilio, " +
    "Exotel) is not booked.",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    call_log_id: S,
    type: Schema.Literals(["Incoming", "Outgoing"]),
    status: Schema.Literals(CALL_STATUSES),
    counterpart: NullOr(S),
    member_party_id: S,
    start_time: N,
    end_time: N,
    duration: N,
    note_id: NullOr(S),
    ...Reference,
    telephony_medium: Schema.Literal("Manual"),
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "call_log_id"],
  indexes: [],
  retention: "Kept while the Organization exists.",
  was: [`${CRM}/fcrm/doctype/crm_call_log/crm_call_log.json`, `${CRM}/api/activities.py:448`],
});

// ── crm-notes: FCRM Note ────────────────────────────────────────────────────────────────────

export const table_crm_notes = defineTable({
  id: "crm-notes",
  title: "Notes: Frappe CRM's FCRM Note on a contact, lead or deal",
  about:
    "One row per note a member wrote on a record, in FCRM Note's shape: `title`, `content` (plain text or Markdown), " +
    "the record it is about (`reference_doctype`, `reference_name`), who wrote it (`added_by`, a member's Party, " +
    "Frappe's `owner`) and when. A call log's note is a note too. A note is changed, never deleted, so a record's " +
    "history stays whole (contacts.notes-kept); FCRM Note's pinning is not booked.",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    note_id: S,
    title: S,
    content: NullOr(S),
    ...Reference,
    added_by: S,
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "note_id"],
  indexes: [],
  retention: "Kept while the Organization exists.",
  was: [`${CRM}/fcrm/doctype/fcrm_note/fcrm_note.json`, `${CRM}/api/activities.py:556`],
});

// ── crm-tasks: CRM Task ─────────────────────────────────────────────────────────────────────

/** CRM Task's statuses, each with the stage the `crm-task` machine runs on. */
export const TASK_STATUSES = { Backlog: "open", Todo: "open", "In Progress": "working", Done: "done", Canceled: "cancelled" } as const;
const TaskStatus = Schema.Literals(Object.keys(TASK_STATUSES) as [keyof typeof TASK_STATUSES, ...(keyof typeof TASK_STATUSES)[]]);
export const TaskStage = Schema.Literals(["open", "working", "done", "cancelled"]);

export const table_crm_tasks = defineTable({
  id: "crm-tasks",
  title: "Tasks: Frappe CRM's CRM Task on a contact, lead or deal",
  about:
    "One row per task on a record, in CRM Task's shape: `title`, `description`, `status` (Backlog, Todo, In Progress, " +
    "Done, Canceled) and the `stage` it names, `priority` (Low, Medium, High), `start_date` (a day in the " +
    "Organization's time zone), `due_date` (an instant on the world's clock), who it is assigned to " +
    "(`assigned_to_party_id`, a member, CRM Task's `assigned_to`), the record it is about (`reference_doctype`, " +
    "`reference_name`), who made it (`added_by`) and `completed_at`, the world's now when it was last done. A due date " +
    "passing changes nothing: CRM Task has no overdue status, and `org crm task list` orders by it.",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    task_id: S,
    title: S,
    description: NullOr(S),
    status: TaskStatus,
    stage: TaskStage,
    priority: Schema.Literals(["Low", "Medium", "High"]),
    start_date: NullOr(S),
    due_date: NullOr(N),
    assigned_to_party_id: NullOr(S),
    ...Reference,
    added_by: S,
    completed_at: NullOr(N),
    ...Synced,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "task_id"],
  indexes: [
    {
      name: "crm-tasks-by-due",
      fields: ["org_id", "stage", "due_date", "task_id"],
      for: "`org crm task list`: the Organization's tasks by stage, soonest due first, as Frappe CRM's Tasks page lists them",
    },
    {
      name: "crm-tasks-by-assignee",
      fields: ["org_id", "assigned_to_party_id", "stage", "due_date"],
      for: "`org crm task list --assigned-to`: one member's tasks, soonest due first",
    },
  ],
  retention: "Kept while the Organization exists: a task that is dropped is cancelled, never deleted.",
  was: [`${CRM}/fcrm/doctype/crm_task/crm_task.json`, `${CRM}/fcrm/doctype/crm_task/crm_task.py:30`, `${CRM}/api/activities.py:621`],
});

export const event_crm_task_transitioned = defineEvent({
  id: "crm_task_transitioned",
  about: "A CRM task was made, started, done, cancelled or reopened. Carries the Organization and the task's id; never its title.",
  props: Schema.Struct({
    from: NullOr(TaskStage),
    to: TaskStage,
    transition: Schema.Literals(["create", "start", "complete", "cancel", "reopen"]),
    org_id: S,
    task_id: S,
  }),
});

export const machine_crm_task = defineMachine({
  id: "crm-task",
  title: "A CRM task's stage: CRM Task's statuses",
  about:
    "crm-tasks.stage, the stage of CRM Task's status: open (Backlog, Todo), working (In Progress), done (Done) and " +
    "cancelled (Canceled), as Frappe CRM's task board columns are. A move within one stage (Backlog to Todo) writes " +
    "`status` only. Done and Canceled can be reopened, as Frappe allows any status from any.",
  table: table_crm_tasks,
  field: "stage",
  initial: "open",
  states: [
    { id: "open", about: "Backlog or Todo: not started." },
    { id: "working", about: "In Progress." },
    { id: "done", about: "Done: `completed_at` is when." },
    { id: "cancelled", about: "Canceled: kept, not to be done." },
  ],
  transitions: {
    create: { from: [], to: "open", about: "Birth: `org crm task create`, Backlog or Todo.", emits: [event_crm_task_transitioned] },
    start: { from: ["open", "done", "cancelled"], to: "working", about: "Moved to In Progress.", emits: [event_crm_task_transitioned] },
    complete: { from: ["open", "working", "cancelled"], to: "done", about: "Moved to Done: `completed_at` is now.", emits: [event_crm_task_transitioned] },
    cancel: { from: ["open", "working", "done"], to: "cancelled", about: "Moved to Canceled.", emits: [event_crm_task_transitioned] },
    reopen: { from: ["working", "done", "cancelled"], to: "open", about: "Moved back to Backlog or Todo.", emits: [event_crm_task_transitioned] },
  },
  was: [`${CRM}/fcrm/doctype/crm_task/crm_task.json`],
});

// ── timeline-links: which records each conversation shows on (Frappe's Dynamic Link) ───────

export const table_timeline_links = defineTable({
  id: "timeline-links",
  title: "Timeline links: each conversation on each record's timeline it belongs to",
  about:
    "One row per conversation item and record whose timeline shows it, in the shape of Frappe's Dynamic Link rows " +
    "(Communication's `timeline_links`, CRM Call Log's `links`, WA Profile's `links`): the record (`record_doctype`, " +
    "`record_id`: a contact entry, a lead or a deal), the item (`item_doctype`, `item_id`) and `at`, the item's place " +
    "on the timeline (an email's or message's world time; a call's, note's or task's creation, as Frappe CRM orders " +
    "its activities by `creation`), with `item_ulid`, the ULID of `item_id` without its prefix, which orders items " +
    "written at one instant as they were written, whatever their kinds (time.read-once). Written with " +
    "its item, in the item's transaction: its reference always, and an email's or call's or message's every other " +
    "contact entry of the book whose kept mailbox or number it names (Frappe's `set_timeline_links`). A lead's links " +
    "stay on the lead: its deal's timeline reads them through the deal's `lead_id`, as Frappe CRM's deal timeline " +
    "gathers its lead's activities.",
  concept: concept_contacts,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    record_id: S,
    record_doctype: RecordDoctype,
    item_id: S,
    item_doctype: ItemDoctype,
    at: N,
    /** The ULID part of `item_id`: the tie-break among items written at one instant, never the prefix's alphabet. */
    item_ulid: S,
    created_at: N,
  }),
  key: ["org_id", "record_id", "item_id"],
  indexes: [
    {
      name: "timeline-links-by-record",
      fields: ["org_id", "record_id", "at", "item_ulid"],
      for: "`org crm timeline`: one record's conversations, newest first (ties as they were written), after the cursor",
    },
  ],
  retention: "Kept with its item.",
  was: [`${FRAPPE_CORE}/core/doctype/communication/communication.py:428`, `${CRM}/api/activities.py:16`],
});

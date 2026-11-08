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
    "with its people), appended in the writing transaction with the next `seq` from `crm-settings` under its lock, so a " +
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
    doctype: Schema.Literals(["Contact", "CRM Organization", "CRM Lead", "CRM Deal"]),
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
      for: "The Organization's leads, most recent change first, after a cursor: Frappe CRM's leads list",
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

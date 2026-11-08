// Contacts' first area, the book: reading it (list, get) and curating it (add, record, label, hide,
// unhide). Every rpc runs as the caller's book: their own (`{ kind: "person" }`), or an
// Organization's they hold a Seat in (`{ kind: "organization", orgId }`); a non-member is
// ROLE_PERMISSION_DENIED before anything is read. Every member may read an Organization's book;
// only a member whose Safe wears its People hat may change it (decision contacts.members-write).
// An entry is a Frappe Contact or CRM Organization (decision contacts.frappe-shape). It is in the
// book when its owner added or recorded it by hand (`manual`) or, in an Organization's book, when
// its Party holds an active Seat there (`member`, read from organizations' Seats at read time).
// Curating a member's entry writes the row that keeps its label and visibility. Nothing here is
// signed and no money moves.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import {
  ContactEmail,
  ContactPhone,
  Doctype,
  EMPLOYEE_RANGES,
  machine_contact,
  table_contact_changes,
  table_contacts,
  table_crm_settings,
} from "./data.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { table_hat_wearers } from "../indexing/data.ts";

const OLD = "packages/backend/src/parties/contacts";
const PROTOCOL = "packages/protocol/src/parties";
const FRAPPE = "github.com/frappe/frappe@1a7ea577:frappe/contacts/doctype";
const CRM = "github.com/frappe/crm@2cecd300:crm";

const S = Schema.String;
const NullOr = Schema.NullOr;

// ── wire shapes ─────────────────────────────────────────────────────────────────────────────

/** Whose book: the caller's own, or an Organization's they hold a Seat in (`--org`). */
export const Book = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person") }),
  Schema.Struct({ kind: Schema.Literal("organization"), orgId: S }),
]);

/** How a caller names a counterparty when adding them. */
export const Locator = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("handle"), handle: S }),
  Schema.Struct({ kind: Schema.Literal("email"), email: S }),
  Schema.Struct({ kind: Schema.Literal("address"), address: S }),
  Schema.Struct({ kind: Schema.Literal("party"), partyId: S }),
]);

/** How the owner knows them: added or recorded by hand, or a member of the Organization whose book it is. */
export const Relationship = Schema.Literals(["manual", "member"]);

/** The party locator the money path takes. */
export const PartyRef = Schema.Struct({ kind: Schema.Literal("party"), partyId: S });

/** One entry as every read and write returns it. */
export const Entry = Schema.Struct({
  /** The entry's id: its PartyId for every entry born from a Party, `contact_<ulid>` for a private one. */
  id: S,
  /** Its party locator, which the money path takes; null on a private entry, which cannot be paid until it has a Party. */
  ref: NullOr(PartyRef),
  /** The owner's label, else the primary mailbox the owner typed, then the Party's display name, handle, then the id. Never a mailbox the owner did not type, never an address. */
  label: S,
  /** Sorted. */
  relationship: Schema.Array(Relationship),
  hidden: Schema.Boolean,
  /** Epoch ms of the entry's last change: its row's, or its member's Seat's. */
  lastActivityAt: Schema.Number,
  /** Frappe's doctype: a Contact or a CRM Organization. */
  doctype: Doctype,
});

/** What the book keeps about an entry, in Contact's and CRM Organization's own fields (Frappe's names). */
export const Details = Schema.Struct({
  email_ids: Schema.Array(ContactEmail),
  phone_nos: Schema.Array(ContactPhone),
  designation: NullOr(S),
  /** The organization entry of this book they work for: Contact's `company_name`. */
  company: NullOr(S),
  website: NullOr(S),
  industry: NullOr(S),
  territory: NullOr(S),
  no_of_employees: NullOr(Schema.Literals(EMPLOYEE_RANGES)),
  annual_revenue: NullOr(S),
  currency: NullOr(S),
  company_description: NullOr(S),
});

/** An entry with what the book keeps about it. */
export const EntryWithDetails = Schema.Struct({ ...Entry.fields, details: Details });

/** The details a write may set: each one given replaces the stored one, null clears it; the rest are kept. */
export const DetailsInput = Schema.Struct({
  email_ids: Schema.optionalKey(Schema.Array(ContactEmail)),
  phone_nos: Schema.optionalKey(Schema.Array(ContactPhone)),
  designation: Schema.optionalKey(NullOr(S)),
  company: Schema.optionalKey(NullOr(S)),
  website: Schema.optionalKey(NullOr(S)),
  industry: Schema.optionalKey(NullOr(S)),
  territory: Schema.optionalKey(NullOr(S)),
  no_of_employees: Schema.optionalKey(NullOr(Schema.Literals(EMPLOYEE_RANGES))),
  annual_revenue: Schema.optionalKey(NullOr(S)),
  currency: Schema.optionalKey(NullOr(S)),
  company_description: Schema.optionalKey(NullOr(S)),
});

const OneEntry = Schema.Struct({ book: Book, contactId: S });

const errors = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT];
const READS = [table_contacts, table_org_members, table_parties];
/**
 * A write to an Organization's book also reads the People hat's id from the deployment, and whether the Seat's
 * Safe wears it from indexing's `hat-wearers` (decision contacts.members-write).
 */
export const WRITE_READS = [...READS, table_org_deployments, table_hat_wearers];
export const WHO_READ =
  "A signed-in person, for their own book; or a member of the Organization (an active Seat, a person's or an agent's), " +
  "for its book. Anyone else naming that Organization is ROLE_PERMISSION_DENIED.";
export const WHO_WRITE =
  "A signed-in person, for their own book; or, for an Organization's book, a member whose Safe wears the Organization's " +
  "People hat when the call is made (the founder's from setup, until the Board revokes it): the right goes with the " +
  "hat, never with a person. Any other member may read the book but not change it, and they and anyone outside are " +
  "ROLE_PERMISSION_DENIED with nothing written (decision contacts.members-write).";
/** The check every write runs first, before it reads or writes anything else. */
export const WRITE_GUARD =
  "For an Organization's book it first checks the caller's Seat wears the People hat (the deployment's people hat id, " +
  "wearers from indexing), else ROLE_PERMISSION_DENIED and nothing is written; a change it makes there is appended to " +
  "`contact-changes` and becomes the entry's `version` (contacts.change-log). ";
/** What a write to a book writes: the entry, and in an Organization's book its change and the counter. */
const BOOK_WRITES = [table_contacts, table_contact_changes, table_crm_settings];

// ── reads ───────────────────────────────────────────────────────────────────────────────────

export const rpc_contacts_book_list = defineRpc({
  id: "contacts.book.list",
  title: "List a book, most recent change first",
  about:
    "One page of the book: the owner's rows and, in an Organization's book, its active Seats (the `org_id` range of " +
    "organizations' `by_org_party`), merged by PartyId in one query with `contacts-by-activity`, newest change first, " +
    "each label falling back to the primary mailbox the owner typed, then the Party's display name, handle or id from " +
    "`parties`, hidden entries left out unless `includeHidden`. `doctype` keeps only Contacts or only CRM Organizations, " +
    "as Frappe CRM lists them apart. `limit` is 1 to 100 (25 when absent); `after` is the opaque cursor the last page " +
    "returned, bound to this book: a cursor from another book or a forged one is INVALID_INPUT. The page and its cursor " +
    "come from the server, so the CLI no longer reads the whole book to cut a page. Never reads another owner's rows (P8).",
  concept: concept_contacts,
  kind: "query",
  who: WHO_READ,
  input: Schema.Struct({
    book: Book,
    includeHidden: Schema.optionalKey(Schema.Boolean),
    doctype: Schema.optionalKey(Doctype),
    limit: Schema.optionalKey(Schema.Int),
    after: Schema.optionalKey(S),
  }),
  output: Schema.Struct({ items: Schema.Array(Entry), nextCursor: NullOr(S) }),
  errors,
  reads: READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${OLD}/operations/list.ts:13`, `${OLD}/reads.ts:140`, `${PROTOCOL}/operations.ts:86`, "apps/cli/src/runtime/paging.ts:82"],
});

export const rpc_contacts_book_get = defineRpc({
  id: "contacts.book.get",
  title: "Read one entry with what the book keeps about it, or null",
  about:
    "The entry for one id in the book (a PartyId, or a private entry's `contact_` id), hidden or not, from point reads " +
    "(the key, then `contacts-by-party` for a PartyId whose entry was born private, and the Seat by `by_org_party`), with " +
    "its details: the mailboxes, numbers, title and company a person's entry keeps, or a company's website, industry, " +
    "territory, size, revenue and description. A member's entry with no row has empty details. Null when the id is not " +
    "in this book, never an empty entry. An id that is not well formed is INVALID_INPUT.",
  concept: concept_contacts,
  kind: "query",
  who: WHO_READ,
  input: OneEntry,
  output: NullOr(EntryWithDetails),
  errors,
  reads: READS,
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${OLD}/operations/get.ts:1`, `${OLD}/reads.ts:121`, `${PROTOCOL}/operations.ts:93`],
});

// ── writes ──────────────────────────────────────────────────────────────────────────────────

export const rpc_contacts_book_add = defineRpc({
  id: "contacts.book.add",
  title: "Add a Party to a book",
  about:
    WRITE_GUARD +
    "Checks the label first (trimmed, 1 to 120 characters, else INVALID_INPUT), then resolves the locator to its Party " +
    "through `parties.resolve-recipient` in the same transaction (an `email` locator is parties' `mailbox`): a mailbox or " +
    "address no Party holds is named there, so the entry's PartyId is the one that Party keeps when the person signs up. " +
    "A locator that names nothing (malformed, the zero address, an unknown handle or Party id, a released Party) is " +
    "INVALID_INPUT, and so is the book's own Party (the caller's own, or the Organization's, found by `parties-by-owner`); " +
    "a refusal commits nothing, the named Party included. Then it writes the one entry for that Party " +
    "(`contacts-by-party`): born listed with `added_at`, the PartyId as its id and the doctype its Party's kind gives (an " +
    "Organization a CRM Organization; a person, an agent or an address a Contact); or, when the entry exists, keeps it, " +
    "sets `added_at` if it had none (a member's curating row), takes a label given, and drives `add_again` if it was " +
    "hidden. An `email` locator also keeps the mailbox the caller typed among the entry's `email_ids`, primary when it " +
    "has none, so with no label the entry shows it. Returns the entry as the write left it, with no Safe address or " +
    "other custody detail.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_WRITE,
  input: Schema.Struct({ book: Book, ref: Locator, label: Schema.optionalKey(S) }),
  output: Entry,
  errors,
  reads: WRITE_READS,
  writes: BOOK_WRITES,
  drives: [machine_contact.t.add_again],
  invokes: [procedure_parties_resolve_recipient],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [
    `${OLD}/operations/add.ts:13`,
    `${OLD}/writes.ts:29`,
    `${OLD}/writes.ts:62`,
    `${OLD}/rules.ts:26`,
    `${OLD}/errors.ts:17`,
    "packages/backend/src/parties/rules.ts:19",
  ],
});

export const rpc_contacts_book_record = defineRpc({
  id: "contacts.book.record",
  title: "Record a person or company in a book, change its details, or link its Party",
  about:
    WRITE_GUARD +
    "One write for three commands (contacts.book-verbs). With no `contactId` (`contact create`) it records a new " +
    "entry: a `doctype` and a label (trimmed, 1 to 120 characters). A new person given a primary mailbox " +
    "is named through `parties.resolve-recipient`, as `contact add` by email names them, and born with that PartyId as " +
    "its id; if that Party already has an entry here it is INVALID_INPUT naming it, never merged. Any other new entry " +
    "is private, with a `contact_<ulid>` id and no Party. With `contactId` and `details` (`contact change`) it never " +
    "names a Party: a private person's mailbox is only a detail. With `contactId` and `link` (`contact link`) it names " +
    "a private entry's Party once: a handle, an address, a Party id, or for a person a mailbox. A link on an entry with " +
    "a Party, or to a Party already in the book, the book's own, nobody, or one of the other kind (an Organization's " +
    "for a person; a person's or agent's for a company) is INVALID_INPUT: an entry's Party never changes. `details` " +
    "sets the fields given and keeps the rest: a person's `email_ids` and `phone_nos` (each replaced whole, at most " +
    "10, one primary of each kind; a lone one is primary), `designation` (140) and `company` (an organization entry " +
    "of this book); a company's `website` (255), `industry` and `territory` (140), `no_of_employees` (Frappe's " +
    "ranges), `annual_revenue` (a non-negative decimal, in a `currency` of 3 to 10 capitals) and " +
    "`company_description` (2000); null clears one. A field of the other doctype, an id not in the book or a bad " +
    "value is INVALID_INPUT naming the field; nothing is written. A change to a member's entry with no row writes its " +
    "curating row. Returns the entry with details.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_WRITE,
  input: Schema.Struct({
    book: Book,
    contactId: Schema.optionalKey(S),
    doctype: Schema.optionalKey(Doctype),
    label: Schema.optionalKey(S),
    link: Schema.optionalKey(Locator),
    details: Schema.optionalKey(DetailsInput),
  }),
  output: EntryWithDetails,
  errors,
  reads: WRITE_READS,
  writes: BOOK_WRITES,
  drives: [],
  invokes: [procedure_parties_resolve_recipient],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [
    `${FRAPPE}/contact/contact.json`,
    `${FRAPPE}/contact_email/contact_email.json`,
    `${FRAPPE}/contact_phone/contact_phone.json`,
    `${CRM}/fcrm/doctype/crm_organization/crm_organization.json`,
    `${CRM}/api/contact.py:73`,
  ],
});

export const rpc_contacts_book_label = defineRpc({
  id: "contacts.book.label",
  title: "Rename one entry",
  about:
    WRITE_GUARD +
    "Sets the label of the entry for one id: trimmed, 1 to 120 characters, else INVALID_INPUT and the entry is " +
    "unchanged. Only that entry's row changes, whatever other entries share the label. An id not in the book is " +
    "INVALID_INPUT; curation never adds one. A member's entry with no row gets its curating row, born listed.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_WRITE,
  input: Schema.Struct({ book: Book, contactId: S, label: S }),
  output: Entry,
  errors,
  reads: WRITE_READS,
  writes: BOOK_WRITES,
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${OLD}/operations/label.ts:12`, `${OLD}/rules.ts:12`, `${OLD}/writes.ts:42`, `${OLD}/errors.ts:14`],
});

export const rpc_contacts_book_hide = defineRpc({
  id: "contacts.book.hide",
  title: "Hide one entry",
  about:
    WRITE_GUARD +
    "Drives `hide` on the entry for one id, keeping every field; a hidden entry is returned as it is. An id not in " +
    "the book is INVALID_INPUT. A member's entry with no row gets its curating row, born listed, then hidden in the same " +
    "transaction.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_WRITE,
  input: OneEntry,
  output: Entry,
  errors,
  reads: WRITE_READS,
  writes: BOOK_WRITES,
  drives: [machine_contact.t.hide],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${OLD}/operations/hide.ts:11`, `${OLD}/writes.ts:42`, `${PROTOCOL}/operations.ts:111`],
});

export const rpc_contacts_book_unhide = defineRpc({
  id: "contacts.book.unhide",
  title: "List a hidden entry again",
  about:
    WRITE_GUARD +
    "Drives `unhide` on the entry for one id, keeping its identity and fields; an entry already listed is returned " +
    "as it is. An id not in the book is INVALID_INPUT.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_WRITE,
  input: OneEntry,
  output: Entry,
  errors,
  reads: WRITE_READS,
  writes: BOOK_WRITES,
  drives: [machine_contact.t.unhide],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${OLD}/operations/unhide.ts:1`, `${OLD}/writes.ts:42`, `${PROTOCOL}/operations.ts:118`],
});

// Contacts' one area, the book: reading it (list, get) and curating it (add, label, hide, unhide).
// Every rpc runs as the caller's book: their own (`{ kind: "person" }`), or an Organization's they
// hold a Seat in (`{ kind: "organization", orgId }`); a non-member is ROLE_PERMISSION_DENIED before
// anything is read. Every member may read an Organization's book; only a member whose Safe wears its
// People hat may change it (Aaron's ruling aaron.contacts-permissions; decision contacts.members-write).
// An entry is in the book when its owner added it by hand (`manual`) or, in an
// Organization's book, when its Party holds an active Seat there (`member`, read from
// organizations' Seats at read time). Curating a member's entry writes the row that keeps its label
// and visibility. Nothing here is signed and no money moves.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../shared/vocabulary.ts";
import { table_contacts, machine_contact } from "./data.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";

const OLD = "packages/backend/src/parties/contacts";
const PROTOCOL = "packages/protocol/src/parties";

// ── wire shapes ─────────────────────────────────────────────────────────────────────────────

/** Whose book: the caller's own, or an Organization's they hold a Seat in (`--org`). */
export const Book = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person") }),
  Schema.Struct({ kind: Schema.Literal("organization"), orgId: Schema.String }),
]);

/** How a caller names a counterparty when adding them. */
export const Locator = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("handle"), handle: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("email"), email: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("address"), address: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("party"), partyId: Schema.String }),
]);

/** How the owner knows them: added by hand, or a member of the Organization whose book it is. */
export const Relationship = Schema.Literals(["manual", "member"]);

/** One entry as every read and write returns it. Its `ref` is the party locator the money path takes. */
export const Entry = Schema.Struct({
  id: Schema.String,
  ref: Schema.Struct({ kind: Schema.Literal("party"), partyId: Schema.String }),
  /** The owner's label, else the Party's display name, then its handle, then its PartyId. Never a mailbox the owner did not type, never an address. */
  label: Schema.String,
  /** Sorted. */
  relationship: Schema.Array(Relationship),
  hidden: Schema.Boolean,
  /** Epoch ms of the entry's last change: its row's, or its member's Seat's. */
  lastActivityAt: Schema.Number,
});

const OneEntry = Schema.Struct({ book: Book, partyId: Schema.String });

const errors = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT];
const READS = [table_contacts, table_org_members, table_parties];
/**
 * A write to an Organization's book also reads the People hat's id from the deployment, and whether the Seat's
 * Safe wears it from indexing's `hat-wearers`, which joins this list once contacts depends on indexing (asked of
 * shared/foundation.ts and dependencies.of-contacts; decision contacts.members-write).
 */
const WRITE_READS = [...READS, table_org_deployments];
const WHO_READ =
  "A signed-in person, for their own book; or a member of the Organization (an active Seat, a person's or an agent's), " +
  "for its book. Anyone else naming that Organization is ROLE_PERMISSION_DENIED.";
const WHO_WRITE =
  "A signed-in person, for their own book; or, for an Organization's book, a member whose Safe wears the Organization's " +
  "People hat (the founder does from setup). Any other member may read the book but not change it, and they and " +
  "anyone outside are ROLE_PERMISSION_DENIED with nothing written (decision contacts.members-write).";
/** The check every write runs first, before it reads or writes anything else. */
const WRITE_GUARD =
  "For an Organization's book it first checks the caller's Seat wears the People hat (the deployment's people hat id, " +
  "wearers from indexing), else ROLE_PERMISSION_DENIED and nothing is written. ";

// ── reads ───────────────────────────────────────────────────────────────────────────────────

export const rpc_contacts_book_list = defineRpc({
  id: "contacts.book.list",
  title: "List a book, most recent change first",
  about:
    "One page of the book: the owner's rows and, in an Organization's book, its active Seats (the `org_id` range of " +
    "organizations' `by_org_party`), merged by PartyId in one query with `contacts-by-activity`, newest change first, " +
    "each label falling back to the Party's display name, handle or id from `parties`, hidden entries left out " +
    "unless `includeHidden`. `limit` is 1 to 100 (25 when absent); `after` is the opaque cursor the last page returned, " +
    "bound to this book: a cursor from another book or a forged one is INVALID_INPUT. The page and its cursor come from " +
    "the server, so the CLI no longer reads the whole book to cut a page. Never reads another owner's rows (P8).",
  concept: concept_contacts,
  kind: "query",
  who: WHO_READ,
  input: Schema.Struct({
    book: Book,
    includeHidden: Schema.optionalKey(Schema.Boolean),
    limit: Schema.optionalKey(Schema.Int),
    after: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Struct({ items: Schema.Array(Entry), nextCursor: Schema.NullOr(Schema.String) }),
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
  title: "Read one entry, or null",
  about:
    "The entry for one PartyId in the book, hidden or not, from point reads (the key, and the Seat by `by_org_party`); " +
    "null when the Party is not in this book, never an empty entry. A PartyId that is not well formed is INVALID_INPUT.",
  concept: concept_contacts,
  kind: "query",
  who: WHO_READ,
  input: OneEntry,
  output: Schema.NullOr(Entry),
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
    "a refusal commits nothing, the named Party included. Then it writes the one row for that Party: born listed with " +
    "`added_at`, or, when the row exists, keeps it, sets `added_at` if it had none (a member's curating row), takes a " +
    "label given, and drives `add_again` if it was hidden. With no label, an " +
    "`email` locator keeps the mailbox the caller typed as the label. Returns the entry as the write left it, with no " +
    "Safe address or other custody detail.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_WRITE,
  input: Schema.Struct({ book: Book, ref: Locator, label: Schema.optionalKey(Schema.String) }),
  output: Entry,
  errors,
  reads: WRITE_READS,
  writes: [table_contacts],
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

export const rpc_contacts_book_label = defineRpc({
  id: "contacts.book.label",
  title: "Rename one entry",
  about:
    WRITE_GUARD +
    "Sets the label of the entry for one PartyId: trimmed, 1 to 120 characters, else INVALID_INPUT and the entry is " +
    "unchanged. Only that PartyId's row changes, whatever other entries share the label. A Party not in the book is " +
    "INVALID_INPUT; curation never adds one. A member's entry with no row gets its curating row, born listed.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_WRITE,
  input: Schema.Struct({ book: Book, partyId: Schema.String, label: Schema.String }),
  output: Entry,
  errors,
  reads: WRITE_READS,
  writes: [table_contacts],
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
    "Drives `hide` on the entry for one PartyId, keeping every field; a hidden entry is returned as it is. A Party not in " +
    "the book is INVALID_INPUT. A member's entry with no row gets its curating row, born listed, then hidden in the same " +
    "transaction.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_WRITE,
  input: OneEntry,
  output: Entry,
  errors,
  reads: WRITE_READS,
  writes: [table_contacts],
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
    "Drives `unhide` on the entry for one PartyId, keeping its identity and fields; an entry already listed is returned " +
    "as it is. A Party not in the book is INVALID_INPUT.",
  concept: concept_contacts,
  kind: "mutation",
  who: WHO_WRITE,
  input: OneEntry,
  output: Entry,
  errors,
  reads: WRITE_READS,
  writes: [table_contacts],
  drives: [machine_contact.t.unhide],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${OLD}/operations/unhide.ts:1`, `${OLD}/writes.ts:42`, `${PROTOCOL}/operations.ts:118`],
});

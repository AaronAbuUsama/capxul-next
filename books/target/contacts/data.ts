// Contacts' data: one table, the address book of whoever you act as (a person or an Organization),
// and the one state machine on it, whether an entry is listed or hidden, with its event.
//
// An entry is in a book when its owner added the Party by hand (relationship `manual`, a row with
// `added_at`) or, in an Organization's book, when the Party holds a Seat in it (relationship
// `member`, derived at read time from organizations' Seats, never copied). A row with no
// `added_at` only curates a member's entry: its label and whether it is hidden. Bank accounts are
// banking's, a contact's wallet is its Party's Safe (parties). Decisions: ./decisions.ts.
//
// Times are epoch milliseconds, as organizations' are; PartyIds are parties' `party_<ulid>`.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_contacts } from "../shared/foundation.ts";

const OLD = "packages/backend/src/parties";

/** Whose book a row is in. Each kind's id is the tenant column of that kind (P8). */
export const OwnerKind = Schema.Literals(["person", "organization"]);
export const Visibility = Schema.Literals(["listed", "hidden"]);

// ── contacts ────────────────────────────────────────────────────────────────────────────────

export const table_contacts = defineTable({
  id: "contacts",
  title: "Address book entries",
  about:
    "One row per Party in one owner's book: the person's own book (`owner_kind` person, `owner_id` their person_id) or an " +
    "Organization's (`owner_kind` organization, `owner_id` its org_id). The key is the owner and the counterparty's " +
    "PartyId, so every locator for the same Party lands on the one entry. `added_at` says the owner added the Party by hand " +
    "(relationship `manual`); a row without it only keeps a member's label and visibility, so a member who leaves and " +
    "returns gets them back. `label` is the owner's own words: a label they gave, or the mailbox they typed when they added " +
    "the Party by email with no label; with none, a reader shows the Party's display name, then its handle, then its id, " +
    "never a mailbox or an address. `updated_at` is the entry's last change, which the book reports as its last activity. " +
    "Replaces the `contact` edges of old parties' `partyEdges`, keyed by the owner's Party, which also carried the payment " +
    "and invoice provenance other concepts wrote and payroll's `employed` engagements.",
  concept: concept_contacts,
  tenancy: "owner",
  tenantField: "owner_id",
  scope:
    "The owner is `owner_kind` with `owner_id`: a person_id for a person's book, an org_id for an Organization's. The " +
    "generated row-level security policy matches each kind to the session's person or Organization tenant.",
  fields: Schema.Struct({
    owner_id: Schema.String,
    owner_kind: OwnerKind,
    /** The counterparty: a person (provisional or claimed), an agent, an Organization or an outside address. */
    party_id: Schema.String,
    /** Trimmed, 1 to 120 characters; null when the owner never named them. */
    label: Schema.NullOr(Schema.String),
    visibility: Visibility,
    /** When the owner added the Party by hand; null on a row that only curates a member's entry. */
    added_at: Schema.NullOr(Schema.Number),
    created_at: Schema.Number,
    updated_at: Schema.Number,
  }),
  key: ["owner_id", "owner_kind", "party_id"],
  indexes: [
    {
      name: "contacts-by-activity",
      fields: ["owner_id", "owner_kind", "updated_at", "party_id"],
      for:
        "contact list and the guided pickers: one book's entries, most recent change first, after the `--after` cursor; " +
        "hidden ones filtered out unless `--include-hidden`",
    },
  ],
  retention:
    "Kept while its owner exists. No operation deletes an entry: hiding keeps it, and adding it again lists it again.",
  was: [`${OLD}/tables.ts:153`, `${OLD}/model.ts:53`, `${OLD}/contacts/reads.ts:1`, `${OLD}/contacts/rules.ts:36`],
});

// ── whether an entry is listed ──────────────────────────────────────────────────────────────

export const event_contact_transitioned = defineEvent({
  id: "contact_transitioned",
  about:
    "An address book entry was hidden, or listed again by `contact unhide` or by adding it again by hand. Carries whose " +
    "book it is and the counterparty's PartyId; never a label, a mailbox or an address.",
  props: Schema.Struct({
    from: Visibility,
    to: Visibility,
    transition: Schema.Literals(["hide", "unhide", "add_again"]),
    owner_kind: OwnerKind,
    owner_id: Schema.String,
    party_id: Schema.String,
  }),
  was: [`${OLD}/contacts/events.ts:66`, `${OLD}/contacts/rules.ts:40`],
});

export const machine_contact = defineMachine({
  id: "contact",
  title: "Whether an address book entry is listed",
  about:
    "An entry is born listed (contact add, or the first label or hide of a member's entry, which writes its curating row). " +
    "Hiding takes it off the default list without deleting it; unhiding, or adding the same Party again by hand, lists it " +
    "again. Hiding a hidden entry or unhiding a listed one changes nothing and returns the entry as it is. The old " +
    "`hidden` boolean on the contact edge, written by add, hide and unhide.",
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
      guard: "the Party is in the book: added by hand, or a member of the Organization whose book it is",
      emits: [event_contact_transitioned],
    },
    unhide: {
      from: ["hidden"],
      to: "listed",
      about: "contact unhide.",
      guard: "the Party is in the book",
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

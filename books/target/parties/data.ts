// Parties' tables and the one state machine on them: the directory of every identity Capxul can
// name and pay, and a person's private profile. Every judgment here is a record in ./decisions.ts.
//
// The directory (`parties`) is what any counterparty may see of a Party: its kind, handle, display
// name, photo and the Safe its money lands in, with its owner. It is the Safe-ownership table P8
// scopes every chain view by. It never holds a mailbox: a person is found by a digest of theirs.
// The profile (`profiles`) is what only the person sees: their country.
//
// In Frappe's shapes the directory is the identity half of Frappe CRM's two party doctypes: a Party
// is what a Contact (a person, an agent, a wallet) or a CRM Organization (a Capxul Organization)
// stands for, and the one key a connected Frappe head's Contact, CRM Organization, Customer,
// Supplier, Employee and User carry. What a business knows about a Party is in its own book, in the
// same doctypes' fields (contacts). Decisions parties.frappe-identity, parties.outside-companies
// and parties.mailbox-for-life.
//
// Ids: `party_<ulid>`; a person's `person_id` is access' principal id. Times are epoch milliseconds.
// Addresses are lowercase hex strings.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_parties } from "../shared/foundation.ts";

const OLD = "packages/backend/src";

// ── shared columns ──────────────────────────────────────────────────────────────────────────

const PARTY_KINDS = ["person", "agent", "organization", "address"] as const;
const PARTY_STATES = ["provisional", "outside", "pending", "active", "released"] as const;
const PARTY_TRANSITIONS = [
  "name_person",
  "name_address",
  "adopt_mailbox",
  "onboard",
  "claim",
  "register",
  "activate",
  "release",
] as const;

const PartyKind = Schema.Literals(PARTY_KINDS);
const PartyState = Schema.Literals(PARTY_STATES);
const OwnerKind = Schema.Literals(["person", "organization"]);

// ── parties: the directory ──────────────────────────────────────────────────────────────────

export const table_parties = defineTable({
  id: "parties",
  title: "The directory: one Party per identity Capxul can name and pay",
  about:
    "One row per Party: a person (found by the digest of their mailbox), an agent, an Organization, or an outside address " +
    "nobody in Capxul owns. `party_id` (`party_<ulid>`) never changes: a person's claim and an adoption keep the id someone " +
    "else's record already points at. `safe_address` is where money sent to the Party lands: a person's email-derived Safe " +
    "(CompaniesHouseClaimer's pure `safeAddressFor`, computed in the backend), an agent's or Organization's predicted Safe, " +
    "or the outside address itself. `handle` is one namespace for agents and Organizations (3 to 30 of a-z, 0-9, `_`, " +
    "`-`; never a reserved word); people are named by mailbox. `owner_kind` and `owner_id` say which tenant owns the Party " +
    "and its Safe: the person for their own Party, the person or Organization that owns an agent, the Organization for " +
    "its own; none for a provisional person or an outside address. Indexing's chain views join this table on " +
    "`safe_address` to scope every chain read to the Safes the caller's tenant owns (P8). One Party per mailbox, Safe and " +
    "handle: the unique indexes are the guard (a released Party gives up its handle and no longer counts for its Safe, so " +
    "a retried birth at the same predicted Safe can register again). Written only by parties' own procedures and rpcs; " +
    "every concept that depends on parties reads it to resolve or show a counterparty, skipping released Parties. In " +
    "Frappe's shapes a Party is the identity behind a Contact or CRM Organization: `display_name` is the name a " +
    "Contact (`full_name`) or CRM Organization (`organization_name`) shows when its book gives it no label of its own, " +
    "`photo_file_id` their `image` or `organization_logo`, and `party_id` the key every Frappe record of it carries " +
    "(parties.frappe-identity); a head never changes them. It names people whether or not they have joined, and " +
    "companies once they are on Capxul (parties.outside-companies).",
  concept: concept_parties,
  tenancy: "global",
  fields: Schema.Struct({
    party_id: Schema.String,
    kind: PartyKind,
    state: PartyState,
    handle: Schema.NullOr(Schema.String),
    display_name: Schema.NullOr(Schema.String),
    photo_file_id: Schema.NullOr(Schema.String),
    safe_address: Schema.String,
    mailbox_digest: Schema.NullOr(Schema.String),
    owner_kind: Schema.NullOr(OwnerKind),
    owner_id: Schema.NullOr(Schema.String),
    created_at: Schema.Number,
    updated_at: Schema.Number,
  }),
  key: ["party_id"],
  indexes: [
    {
      name: "parties-by-handle",
      fields: ["handle"],
      unique: true,
      crossTenant: true,
      for: "Resolve an `@handle` to its agent or Organization, and refuse a taken handle at registration; a released Party's handle is cleared, so it is free.",
    },
    {
      name: "parties-by-safe",
      fields: ["safe_address"],
      unique: true,
      crossTenant: true,
      for: "Resolve a 0x address to its Party, adopt an outside Party at a mailbox's Safe, and the chain views' scope join; unique among Parties not released.",
    },
    {
      name: "parties-by-mailbox",
      fields: ["mailbox_digest"],
      unique: true,
      crossTenant: true,
      for: "Resolve a mailbox to its person Party, and find the Party a person claims when they complete their profile.",
    },
    {
      name: "parties-by-owner",
      fields: ["owner_kind", "owner_id", "kind"],
      for: "A tenant's own Parties: a person's own Party and the agents they own, an Organization's own Party and agents.",
    },
  ],
  retention:
    "Kept for good: payments, requests, contacts and documents point at a Party id, so a Party is never deleted; a released one keeps its id with its handle cleared.",
  was: [
    `${OLD}/parties/tables.ts:131`,
    `${OLD}/parties/writes/parties.ts:79`,
    `${OLD}/parties/writes/parties.ts:121`,
    `${OLD}/parties/writes/parties.ts:218`,
    `${OLD}/parties/reads/recipients.ts:73`,
    "packages/protocol/src/parties/model.ts:5",
  ],
});

// ── profiles: what only the person sees ─────────────────────────────────────────────────────

export const table_profiles = defineTable({
  id: "profiles",
  title: "A person's profile: the private half of their Party",
  about:
    "One row per person who has completed their profile, written in the same transaction that claims or births their " +
    "Party, so a profile always has its Party and a claimed person Party always has its profile. Its public half (display " +
    "name and photo) is on the Party; this row holds what only the person and the concepts acting for them read: the " +
    "country they gave (ISO 3166-1 alpha-2), which banking's verification prefills. A person with no row has not set up " +
    "their profile yet: accounts answers `PROFILE_NOT_FOUND` for them and sends them to the setup page.",
  concept: concept_parties,
  tenancy: "person",
  tenantField: "person_id",
  fields: Schema.Struct({
    person_id: Schema.String,
    party_id: Schema.String,
    country: Schema.String,
    created_at: Schema.Number,
    updated_at: Schema.Number,
  }),
  key: ["person_id"],
  indexes: [],
  retention: "Kept while the person's principal exists.",
  was: [`${OLD}/profiles/tables.ts:5`, `${OLD}/profiles/rules.ts:14`, `${OLD}/profiles/README.md:3`],
});

// ── the Party's life ────────────────────────────────────────────────────────────────────────

export const event_party_transitioned = defineEvent({
  id: "party_transitioned",
  about:
    "A Party changed state: it was named, onboarded, claimed, registered, activated or released. `from` is null at a birth. " +
    "`owner_kind` and `owner_id` are the Party's tenant once it has one. It never carries a mailbox, a handle or a name.",
  props: Schema.Struct({
    from: Schema.NullOr(PartyState),
    to: PartyState,
    transition: Schema.Literals(PARTY_TRANSITIONS),
    party_id: Schema.String,
    kind: PartyKind,
    owner_kind: Schema.NullOr(OwnerKind),
    owner_id: Schema.NullOr(Schema.String),
  }),
});

export const machine_party = defineMachine({
  id: "party",
  title: "A Party: named, taken up by its owner, or released",
  about:
    "A Party is born in one of four states, by the transition that first names it: a mailbox (provisional), a bare " +
    "address (outside), an Organization's or agent's birth (pending), or a person completing a profile nobody named " +
    "before (active). A person's Party becomes theirs when they complete their profile; an Organization's or agent's when " +
    "its Safe is live. A birth that fails for good releases its Party and frees its handle. Nothing else changes `state`.",
  table: table_parties,
  field: "state",
  initial: "provisional",
  states: [
    { id: "provisional", about: "A person known only by their mailbox: someone named them; no owner yet." },
    { id: "outside", about: "An outside address someone named; nobody in Capxul owns it." },
    { id: "pending", about: "An Organization or agent registered at birth: its handle is taken, its Safe is not live yet." },
    { id: "active", about: "Owned and live: a person who completed their profile, or a live Organization or agent." },
    { id: "released", about: "A birth that failed for good: its handle is cleared and it routes no money.", terminal: true },
  ],
  transitions: {
    name_person: {
      from: [],
      to: "provisional",
      about: "A record names a mailbox no Party holds yet: a provisional person Party at the mailbox's derived Safe.",
      emits: [event_party_transitioned],
    },
    name_address: {
      from: [],
      to: "outside",
      about: "A record names a 0x address no Party holds: an outside Party at that address.",
      guard: "Not the zero address; a well-formed address.",
      emits: [event_party_transitioned],
    },
    adopt_mailbox: {
      from: ["outside"],
      to: "provisional",
      about: "A mailbox is named whose derived Safe already has an outside Party: that Party becomes the person's, id kept.",
      emits: [event_party_transitioned],
    },
    onboard: {
      from: [],
      to: "active",
      about: "A person nobody named completes their profile: their Party is born theirs, with its profile.",
      emits: [event_party_transitioned],
    },
    claim: {
      from: ["provisional", "outside"],
      to: "active",
      about: "A person completes their profile: the Party at their mailbox or their Safe becomes theirs, id kept.",
      guard: "The session's mailbox digests to the Party's, or its derived Safe is the Party's Safe.",
      emits: [event_party_transitioned],
    },
    register: {
      from: [],
      to: "pending",
      about: "An Organization or agent is born with its Party: handle, name, predicted Safe and owner.",
      guard: "The handle is valid, not reserved and not taken; no Party holds the Safe.",
      emits: [event_party_transitioned],
    },
    activate: {
      from: ["pending"],
      to: "active",
      about: "The Organization's or agent's Safe is live: from now its handle routes money to it.",
      emits: [event_party_transitioned],
    },
    release: {
      from: ["pending"],
      to: "released",
      about: "The birth failed for good (the chain refused it, or its approval lapsed unsent): the handle is cleared.",
      emits: [event_party_transitioned],
    },
  },
  was: [
    `${OLD}/parties/tables.ts:131`,
    `${OLD}/parties/writes/parties.ts:79`,
    `${OLD}/parties/writes/parties.ts:105`,
    `${OLD}/parties/writes/parties.ts:159`,
    `${OLD}/parties/writes/parties.ts:218`,
    `${OLD}/parties/writes/parties.ts:246`,
    `${OLD}/parties/writes/parties.ts:257`,
  ],
});

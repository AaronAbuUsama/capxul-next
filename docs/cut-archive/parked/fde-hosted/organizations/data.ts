// Moved out of the built book by the cut, 10 November 2026, from books/target/organizations/data.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";

export const table_org_fde_payments = defineTable({
  id: "org-fde-payments",
  title: "FDE hosting payments: the months paid, one row per settled Payment",
  about:
    "One row per Payment that paid for the hosted FDE (`org fde pay`, payments'; organizations.fde-hosting). Payments " +
    "births the command at the deployment's FDE_HOSTING_PRICE times the months and settles it on its terms; in the " +
    "settling transaction it invokes `organizations.extend-fde-hosting`, which records the months here and moves the " +
    "hosting's `paid_through` on by them, so the months count exactly when the payment settles. A reorg below finality " +
    "that reopens the Payment takes them back (`organizations.return-fde-hosting`): exactly the span this payment added, " +
    "`paid_through_after` less `paid_through_before`, since calendar months from a later start do not subtract back; " +
    "the same Payment settling again adds them again, from that settlement. The amount, token and settling transaction are copied from the settled Payment so `org fde show` " +
    "can say what was paid without reading payments, which sits above. `org_id` is the paying command's owner.",
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    payment_id: S,
    command_id: S,
    /** Calendar months it paid for, 1 to 12. */
    months: N,
    status: Schema.Literals(["counted", "returned"]),
    chain_id: N,
    token_address: S,
    asset: S,
    amount_raw: S,
    /** The member who paid (their Party): a person, never an agent. */
    paid_by_party_id: S,
    /**
     * The hosting's paid-through instant just before and just after these months were counted (the later of the old
     * `paid_through` and the settlement's now, then on by the months): a reorg's return takes back exactly that span.
     */
    paid_through_before: N,
    paid_through_after: N,
    tx_hash: S,
    block_number: N,
    counted_at: N,
    returned_at: NullOr(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "payment_id"],
  indexes: [
    {
      name: "by_org_counted",
      fields: ["org_id", "counted_at", "payment_id"],
      for: "The Organization's hosting payments in the order they were counted: what `org fde show` reports as paid.",
    },
  ],
  retention: KEPT,
});

export const table_org_fde_guests = defineTable({
  id: "org-fde-guests",
  title: "FDE guests: outside people the management names to talk to its FDE",
  about:
    "One row per person outside the Organization whom its management (People or Director) names as someone it works " +
    "with, so they may talk to its hosted FDE (aaron.fde-anyone; organizations.fde-guests): a customer, a supplier, an " +
    "accountant, someone it may hire. A guest holds no Seat and wears none of the Organization's hats, so the FDE does " +
    "for them only what their own Party may do here: read what a counterparty is admitted to (their own Payments and " +
    "requests with the Organization), never a member's records. Named by email or a person's @handle, resolved to a " +
    "person's Party (one named by email nobody has yet is born provisional at its email-derived Safe, as an invitee's " +
    "is) and admitted to the beta so they can sign in. A member, an agent or an Organization is never a guest. Removing " +
    "a guest ends their asks at once; naming them again makes the same row active again. `email` is the mailbox the " +
    "guest signs in with, kept so their own asks can be read back to them.",
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  admits: [
    {
      match: "email",
      field: "email",
      reads: true,
      writes: false,
      about: "The guest reads their own row, signed in with its mailbox: the guard of `org fde ask --org` (organizations.fde-guests).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    /** `gst_` and a ULID. */
    guest_id: S,
    party_id: S,
    email: S,
    /** Who they are to the Organization, in the namer's words (up to 200 characters); null when not given. */
    note: NullOr(S),
    status: Schema.Literals(["active", "removed"]),
    /** The member who named them last, and who removed them. */
    named_by_member_id: S,
    removed_by_member_id: NullOr(S),
    named_at: N,
    removed_at: NullOr(N),
    updated_at: N,
  }),
  key: ["org_id", "guest_id"],
  indexes: [
    {
      name: "by_org_party",
      fields: ["org_id", "party_id"],
      unique: true,
      for: "Whether a Party is a guest here: the ask guard, and a second `org fde guest add` that names the same person again.",
    },
    {
      name: "by_org_status",
      fields: ["org_id", "status", "named_at", "guest_id"],
      for: "`org fde guest list`: the active guests, newest named first, then the removed ones.",
    },
  ],
  retention: KEPT,
});

export const table_org_fde_asks = defineTable({
  id: "org-fde-asks",
  title: "FDE asks: who asked the hosted FDE what, and for how long it acts for them",
  about:
    "One row per message someone sent the hosted FDE (`org fde ask`; aaron.fde-anyone, organizations.fde-commands): any " +
    "member, or a guest the management named. Written in the ask's own transaction once the host has taken the message " +
    "and answered the turn's id (a host that does not answer leaves no row). An ask is also what the FDE acts with: it " +
    "carries the hash of a fresh act-for token that the host gives the FDE's CLI for that turn only, and while the ask " +
    "is open (until its turn ends, at most FDE_ASK_HOURS on the world's clock) every call the FDE makes with it is the " +
    "asker's: the tenant guard every concept runs finds the asker's Seat, Safe and hats, never the FDE's own, and a " +
    "write that needs a signature opens its approval for the asker's own Safe (organizations.fde-for-the-asker). A " +
    "guest's ask finds no Seat. It keeps the host's turn id, the asker and the message's length and SHA-256, never the " +
    "message, which is the host's conversation. `ended_at` is stamped once, when Capxul reads the turn ended or failed; " +
    "nothing else changes a row.",
  concept: concept_organizations,
  tenancy: "organization",
  tenantField: "org_id",
  admits: [
    {
      match: "email",
      field: "asker_guest_id",
      via: { table: table_org_fde_guests, on: "guest_id", field: "email" },
      reads: true,
      writes: false,
      about: "A guest reads their own asks, matched through their guest row's mailbox: `org fde ask` and `org fde turn get` (organizations.fde-guests).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    /** `ask_` and a ULID. */
    ask_id: S,
    /** The host's id for the FDE's turn that answers it. */
    host_turn_id: S,
    asker_kind: Schema.Literals(["member", "guest"]),
    /** The asker's Seat for a member; null for a guest. */
    asker_member_id: NullOr(S),
    /** The guest row for a guest; null for a member. */
    asker_guest_id: NullOr(S),
    asker_party_id: S,
    /** The asker's access principal, a person's or an agent's, as they signed in to ask; the tenant guard resolves the act-for call to it. */
    asker_principal_id: S,
    /** SHA-256 of the act-for token; the token itself is only ever the host's, for this turn. */
    token_hash: S,
    message_chars: N,
    message_sha256: S,
    asked_at: N,
    /** `asked_at` plus FDE_ASK_HOURS: no call acts for the asker after it, whatever the turn does. */
    expires_at: N,
    /** When Capxul read the turn ended or failed: no call acts for the asker after it. */
    ended_at: NullOr(N),
  }),
  key: ["org_id", "ask_id"],
  indexes: [
    {
      name: "by_org_asked",
      fields: ["org_id", "asked_at", "ask_id"],
      for: "The Organization's asks, newest first: who asked its FDE last, as `org fde show` prints it.",
    },
    {
      name: "by_org_turn",
      fields: ["org_id", "host_turn_id"],
      unique: true,
      for: "`org fde turn get` and the ask flow's poll find the ask a turn id names, and check its asker.",
    },
    {
      name: "by_token",
      fields: ["token_hash"],
      unique: true,
      crossTenant: true,
      for: "The tenant guard resolves a call the hosted FDE makes with an act-for token to its open ask, and so to its asker.",
    },
  ],
  retention: KEPT,
});

export const event_fde_payment_transitioned = defineEvent({
  id: "fde_payment_transitioned",
  about: "A hosting payment's months were counted (its Payment settled), taken back by a reorg, or counted again.",
  props: Schema.Struct({ from: From, to: S, transition: S, org_id: S, payment_id: S, months: N }),
});

export const machine_fde_payment = defineMachine({
  id: "fde-payment",
  title: "FDE hosting payment",
  about:
    "org-fde-payments.status, driven only by organizations' two hosting doors inside payments' transactions. Born counted " +
    "when its Payment settles, which moves `paid_through` on; returned when a reorg reopens that Payment, which moves it " +
    "back by exactly the span it added; counted again when the Payment settles once more. The hosting's process re-reads " +
    "`paid_through` on each.",
  table: table_org_fde_payments,
  field: "status",
  initial: "counted",
  states: [
    { id: "counted", about: "Its Payment is settled: its months are in `paid_through`." },
    { id: "returned", about: "A reorg took its PaymentSent away: its months are out of `paid_through` until it settles again." },
  ],
  transitions: {
    add: { from: [], to: "counted", about: "Birth: the Payment settled; `paid_through` moves on by its months.", emits: [event_fde_payment_transitioned] },
    take_back: {
      from: ["counted"],
      to: "returned",
      about: "A reorg below finality reopened the Payment; `paid_through` moves back by the span its count added.",
      emits: [event_fde_payment_transitioned],
    },
    add_again: {
      from: ["returned"],
      to: "counted",
      about: "The reopened Payment settled again; `paid_through` moves on by its months once more.",
      emits: [event_fde_payment_transitioned],
    },
  },
});

export const event_fde_guest_transitioned = defineEvent({
  id: "fde_guest_transitioned",
  about:
    "The management named an outside person as a guest who may talk to its hosted FDE, removed them, or named them " +
    "again (aaron.fde-anyone). Notices tells a newly named guest how to sign in and ask.",
  props: Schema.Struct({ from: From, to: S, transition: S, org_id: S, guest_id: S, party_id: S }),
});

export const machine_fde_guest = defineMachine({
  id: "fde-guest",
  title: "FDE guest",
  about:
    "org-fde-guests.status. Born active when the management names a person (`org fde guest add`); removed when it " +
    "stops working with them (`org fde guest remove`), which ends every ask of theirs at once; active again when named " +
    "again, on the same row.",
  table: table_org_fde_guests,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "They may talk to the FDE, which does for them only what their own Party may do here." },
    { id: "removed", about: "They may not; their open asks act for them no longer." },
  ],
  transitions: {
    name: { from: [], to: "active", about: "Birth: People or a Director names them.", emits: [event_fde_guest_transitioned] },
    remove: { from: ["active"], to: "removed", about: "People or a Director removes them.", emits: [event_fde_guest_transitioned] },
    name_again: { from: ["removed"], to: "active", about: "Named again.", emits: [event_fde_guest_transitioned] },
  },
});

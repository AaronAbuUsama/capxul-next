// Banking's tables, state machines and each machine's one event (P7): Bridge verification, bank
// details (receiving accounts), saved bank accounts, bank deposits, bank payouts, and Bridge's
// event inbox with its catch-up cursor. Every judgment here is a decision record in ./decisions.ts.
//
// Every tenant table is an owner's (tenancy `owner`, `owner_id` first in the key and every index
// but the few marked crossTenant): `owner_kind` person with `owner_id` a person_id, or
// `owner_kind` organization with `owner_id` an org_id, as contacts' book is. The inbox and the
// cursor are Bridge's feed for the whole deployment (`global`).
//
// Ids: `vrf_`, `vpp_` (and `inv_kyb_` for a person's invitation), `bdt_`, `bac_`, `bdp_`, `bpo_`,
// each with a ulid. Times are epoch milliseconds; amounts are base-unit strings; addresses are
// lowercase hex. Columns ending `_enc` are encrypted with RECORD_ENCRYPTION_KEY, bound to their
// row (`<table>:<id>` as associated data), so a value copied to another row does not decrypt.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";

const OLD = "packages/backend/src";
const B = `${OLD}/banking`;
const P = `${OLD}/parties`;
const AS_IS = "books/as-is/banking/data.ts";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;

// ── shared columns ──────────────────────────────────────────────────────────────────────────

export const OwnerKind = Schema.Literals(["person", "organization"]);
/** The bank currencies Bridge serves (banking/model.ts:14). */
export const Currency = Schema.Literals(["usd", "eur", "gbp"]);
/** The tokens a deposit can become and a payout can be funded in (banking/model.ts:15). */
export const Token = Schema.Literals(["usdc", "eurc"]);
/** The bank rail of a deposit or a payout (banking/model.ts:16). */
export const Rail = Schema.Literals(["ach", "wire", "sepa", "faster_payments"]);
/** One currency's verification decision, as Bridge reports it. */
export const CurrencyStatus = Schema.Literals(["not_started", "pending", "approved", "rejected", "restricted"]);

const OWNER_SCOPE =
  "The owner is `owner_kind` with `owner_id`: a person_id for a person's row, an org_id for an Organization's. The " +
  "generated row-level security policy matches each kind to the session's person or Organization tenant.";
const KEPT = "Kept for good: it is part of the record of money that moved, or could have.";

// ── verification ────────────────────────────────────────────────────────────────────────────

const VERIFICATION_STATES = ["needs_answers", "needs_person", "in_review", "approved", "rejected", "restricted"] as const;
const VerificationStatus = Schema.Literals(VERIFICATION_STATES);

export const table_verifications = defineTable({
  id: "verifications",
  title: "Bridge verifications: one KYC or KYB per person or Organization",
  about:
    "One verification per owner on the Bridge rail: a person's KYC (`subject` person) or an Organization's KYB (`subject` " +
    "business). `creation_key` is the Idempotency-Key of the Bridge customer, derived from the owner, so a retried first " +
    "start reaches the same customer and a second `verify start` continues it; neither makes a second customer. `status` is " +
    "the next step or the decision; `currencies` is the decision per USD, EUR and GBP, written only by a `verification` " +
    "transition. `next_step` holds what the person must do next, without any answer: the questions still open, or Bridge's " +
    "hosted link for terms and liveness. `bridge_updated_at` orders Bridge's snapshots, so an older one never overwrites " +
    "a newer one. Answers and documents go to Bridge and are not kept; the eight liveness prefill values Bridge asks to " +
    "keep are in `prefill_enc`. `business_contact_email` is the business's contact for Bridge, distinct from the " +
    "Director's own. Old parties' `partyVerifications`, less the observation context, journey and surface columns.",
  concept: concept_banking,
  tenancy: "owner",
  tenantField: "owner_id",
  scope: OWNER_SCOPE,
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    verification_id: S,
    party_id: S,
    subject: Schema.Literals(["person", "business"]),
    creation_key: S,
    bridge_customer_id: NullOr(S),
    status: VerificationStatus,
    currencies: Schema.Struct({ usd: CurrencyStatus, eur: CurrencyStatus, gbp: CurrencyStatus }),
    next_step: NullOr(
      Schema.Union([
        Schema.Struct({ kind: Schema.Literal("answers"), questions: Schema.Array(S) }),
        Schema.Struct({ kind: Schema.Literal("person"), url: S, purpose: Schema.Literals(["terms", "liveness", "documents"]) }),
      ]),
    ),
    business_contact_email: NullOr(S),
    prefill_enc: NullOr(S),
    bridge_updated_at: NullOr(N),
    started_by: S,
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_id", "verification_id"],
  indexes: [
    {
      name: "verifications-by-owner",
      fields: ["owner_id", "owner_kind"],
      unique: true,
      for: "The owner's one verification: `verify start` continues it, `verify status`, and every check that an owner is verified for a currency.",
    },
    {
      name: "verifications-by-customer",
      fields: ["bridge_customer_id"],
      unique: true,
      crossTenant: true,
      for: "The verification a Bridge customer event names, when the inbox applies it.",
    },
  ],
  retention: "Kept while its owner exists: a decision is what lets the owner keep receiving and paying by bank.",
  was: [`${P}/tables.ts:70`, `${P}/verifications/README.md:1`, `${P}/verifications/writes.ts:1`],
});

export const event_verification_transitioned = defineEvent({
  id: "verification_transitioned",
  about:
    "A verification moved to its next step or to Bridge's decision. Carries the owner, the subject and the currencies " +
    "approved; never an answer, a document or a name.",
  props: Schema.Struct({
    from: Schema.NullOr(VerificationStatus),
    to: VerificationStatus,
    transition: Schema.Literals(["begin", "ask", "hand_to_person", "submit", "approve", "reject", "restrict"]),
    verification_id: S,
    owner_kind: OwnerKind,
    owner_id: S,
    subject: Schema.Literals(["person", "business"]),
    approved_currencies: Schema.Array(Currency),
  }),
  was: [`${P}/verifications/events.ts:1`],
});

export const machine_verification = defineMachine({
  id: "verification",
  title: "A verification's next step and Bridge's decision",
  about:
    "Born `needs_answers` by the first `verify start`; Bridge's answer to each submission, and each customer snapshot " +
    "Bridge sends later, moves it in Bridge's order. Bridge sets the questions and makes the decision; Capxul only follows. " +
    "A rejection or a restriction can be reopened by Bridge (a correction asked), so no state is final. The " +
    "verification's process drives every transition while it runs; the inbox applies Bridge's later changes to an ended " +
    "one (decision banking.verification-process).",
  table: table_verifications,
  field: "status",
  initial: "needs_answers",
  states: [
    { id: "needs_answers", about: "Bridge needs answers or documents the person has not given; `next_step` lists the questions." },
    { id: "needs_person", about: "The person must act on Bridge's page (terms, liveness, a document); `next_step` holds the link." },
    { id: "in_review", about: "Everything is submitted and Bridge is reviewing; for a business, every named person has submitted too." },
    { id: "approved", about: "Bridge approved at least one currency; `currencies` says which. Bank details open for each." },
    { id: "rejected", about: "Bridge rejected the verification; it can ask for a correction, which reopens it." },
    { id: "restricted", about: "Bridge restricted the customer; deposits and payouts stop until Bridge lifts it." },
  ],
  transitions: {
    begin: {
      from: [],
      to: "needs_answers",
      about: "The first `verify start` for an owner, written with Bridge's first answer; the key derived from the owner makes a retry reach the same customer.",
      emits: [event_verification_transitioned],
    },
    ask: {
      from: ["needs_person", "in_review", "rejected", "restricted"],
      to: "needs_answers",
      about: "Bridge asks a question again or a new one (a correction, a tax question after accepted ID answers).",
      emits: [event_verification_transitioned],
    },
    hand_to_person: {
      from: ["needs_answers", "in_review"],
      to: "needs_person",
      about: "Bridge needs the person on its own page: its terms, the liveness check, or a document it collects itself.",
      emits: [event_verification_transitioned],
    },
    submit: {
      from: ["needs_answers", "needs_person"],
      to: "in_review",
      about: "Bridge has every answer it asked for and is reviewing.",
      guard: "for a business, every named person has submitted their own details",
      emits: [event_verification_transitioned],
    },
    approve: {
      from: ["needs_answers", "needs_person", "in_review", "approved", "restricted"],
      to: "approved",
      about: "Bridge approved a currency; from `approved` it is a further currency's approval, so each approval is one event.",
      guard: "Bridge's snapshot is newer than `bridge_updated_at`, and approves a currency `currencies` did not have",
      emits: [event_verification_transitioned],
    },
    reject: {
      from: ["needs_answers", "needs_person", "in_review"],
      to: "rejected",
      about: "Bridge rejected the verification.",
      emits: [event_verification_transitioned],
    },
    restrict: {
      from: ["approved", "in_review"],
      to: "restricted",
      about: "Bridge restricted the customer after or during review.",
      emits: [event_verification_transitioned],
    },
  },
  was: [`${P}/verifications/views.ts:49`, `${P}/verifications/rules/snapshot.ts:1`],
});

// ── the people a business verification names ────────────────────────────────────────────────

const PERSON_STATES = ["invited", "submitted"] as const;
const PersonStatus = Schema.Literals(PERSON_STATES);

export const table_verification_people = defineTable({
  id: "verification-people",
  title: "The people a business verification names, each with their invitation",
  about:
    "One row per person a Director names in a business verification: their name, email and legal roles (owner with a " +
    "percentage, controller, signer, director), and the `inv_kyb_` invitation that lets them submit their own identity " +
    "details. A Director can submit only these fields for another person; the person signs in with the invited email and " +
    "submits the rest with `verify start --invitation` or `invite accept`. The invitation grants no Organization " +
    "permission. `bridge_person_id` is Bridge's associated person once they submit. Old parties' `verificationPeople`, " +
    "less the email delivery state (notices keeps that) and the surface column.",
  concept: concept_banking,
  tenancy: "owner",
  tenantField: "owner_id",
  scope:
    "The owner is the Organization being verified (`owner_kind` organization, `owner_id` its org_id). The invited person " +
    "reaches only their own row, through its invitation id and their signed-in email.",
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: Schema.Literal("organization"),
    person_entry_id: S,
    verification_id: S,
    invitation_id: S,
    email: S,
    first_name: S,
    last_name: S,
    roles: Schema.Struct({
      owner_percent: NullOr(N),
      controller: Schema.Boolean,
      signer: Schema.Boolean,
      director: Schema.Boolean,
      title: NullOr(S),
    }),
    status: PersonStatus,
    person_id: NullOr(S),
    bridge_person_id: NullOr(S),
    invited_by: S,
    created_at: N,
    submitted_at: NullOr(N),
  }),
  key: ["owner_id", "person_entry_id"],
  indexes: [
    {
      name: "verification-people-by-verification",
      fields: ["owner_id", "verification_id", "email"],
      unique: true,
      for: "A business verification's people, one per email: the Director's list, the readiness check before `submit`.",
    },
    {
      name: "verification-people-by-invitation",
      fields: ["invitation_id"],
      unique: true,
      crossTenant: true,
      for: "The invited person's own submission finds their row by the `inv_kyb_` id they were sent, checked against their signed-in email.",
    },
  ],
  retention: "Kept while the verification exists: Bridge's decision rests on who was named.",
  was: [`${P}/tables.ts:35`, `${P}/verifications/writes/people.ts:1`, `${P}/verifications/operations/invite.ts:1`],
});

export const event_verification_person_transitioned = defineEvent({
  id: "verification_person_transitioned",
  about:
    "A person named in a business verification was invited, or submitted their own details. Notices sends the invitation " +
    "email from `invite`. Carries the ids; never the name, the email or the roles.",
  props: Schema.Struct({
    from: Schema.NullOr(PersonStatus),
    to: PersonStatus,
    transition: Schema.Literals(["invite", "submit"]),
    person_entry_id: S,
    verification_id: S,
    invitation_id: S,
    owner_kind: Schema.Literal("organization"),
    owner_id: S,
  }),
  was: [`${P}/verifications/operations/deliver-person-invite.ts:1`],
});

export const machine_verification_person = defineMachine({
  id: "verification-person",
  title: "Whether a named person has submitted their own details",
  about:
    "Born `invited` when a Director names the person in `verify start`; `submitted` once that person, signed in with the " +
    "invited email, submits their own identity details to Bridge. A business verification goes to review only when every " +
    "named person has submitted.",
  table: table_verification_people,
  field: "status",
  initial: "invited",
  states: [
    { id: "invited", about: "Named by a Director; the invitation email is sent by notices." },
    { id: "submitted", about: "The person submitted their own details; Bridge holds them as an associated person.", terminal: true },
  ],
  transitions: {
    invite: {
      from: [],
      to: "invited",
      about: "A Director names the person in a business verification.",
      emits: [event_verification_person_transitioned],
    },
    submit: {
      from: ["invited"],
      to: "submitted",
      about: "The invited person's own `verify start --invitation` or `invite accept` submitted their details.",
      guard: "the signed-in person's email is the invited email",
      emits: [event_verification_person_transitioned],
    },
  },
  was: [`${P}/verifications/operations/person.ts:1`],
});

// ── bank details: receiving accounts ────────────────────────────────────────────────────────

const DETAILS_STATES = ["requested", "active", "deactivated", "closed", "failed"] as const;
const DetailsState = Schema.Literals(DETAILS_STATES);

export const table_bank_details = defineTable({
  id: "bank-details",
  title: "Bank details: one Bridge virtual account per owner and currency",
  about:
    "The bank details people pay the owner by: one Bridge virtual account per owner and currency, paying into the owner's " +
    "Safe in the chosen token. `bank_details_id` with `attempts` is the Idempotency-Key of Bridge's create, so a retry opens " +
    "the same account. The Safe is the owner's Party's (parties), never the caller's word. `public_fields` holds what a masked " +
    "overview shows (bank name, payee name, rail, the last digits, the minimum deposit and Capxul's fee); `secret_fields_enc` " +
    "the full numbers, shown only for one explicit currency. `bridge_updated_at` orders Bridge's lifecycle events. Old " +
    "banking's `railReceivingAccounts`, less the duplicate actor columns, the surface and the observation context; one " +
    "row per owner and currency is now a unique index, not a read before the insert.",
  concept: concept_banking,
  tenancy: "owner",
  tenantField: "owner_id",
  scope: OWNER_SCOPE,
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    bank_details_id: S,
    party_id: S,
    currency: Currency,
    state: DetailsState,
    attempts: N,
    bridge_virtual_account_id: NullOr(S),
    rail: NullOr(Rail),
    settlement_token: Token,
    chain_id: N,
    safe_address: S,
    public_fields: NullOr(
      Schema.Struct({
        bank_name: S,
        payee_name: S,
        last4: S,
        rails: Schema.Array(Rail),
        minimum_deposit: NullOr(S),
        developer_fee_percent: NullOr(S),
      }),
    ),
    secret_fields_enc: NullOr(S),
    bridge_updated_at: NullOr(N),
    opened_by: S,
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_id", "bank_details_id"],
  indexes: [
    {
      name: "bank-details-by-currency",
      fields: ["owner_id", "currency"],
      unique: true,
      for: "The owner's details for one currency (open, settle, show in full) or all three (the masked overview).",
    },
    {
      name: "bank-details-by-virtual-account",
      fields: ["bridge_virtual_account_id"],
      unique: true,
      crossTenant: true,
      for: "The details a Bridge virtual account event or deposit names, when the inbox applies it.",
    },
  ],
  retention: KEPT,
  was: [`${B}/tables.ts:20`, `${B}/bank-details/README.md:1`, `${AS_IS}:181`],
});

export const event_bank_details_transitioned = defineEvent({
  id: "bank_details_transitioned",
  about:
    "Bank details were opened, activated, deactivated, closed or failed at Bridge, or their settlement token changed " +
    "(`change_token`, which stays `active`). Carries the owner, the currency and the token; never a bank number.",
  props: Schema.Struct({
    from: Schema.NullOr(DetailsState),
    to: DetailsState,
    transition: Schema.Literals(["open", "activate", "deactivate", "close", "fail", "reopen", "change_token"]),
    bank_details_id: S,
    owner_kind: OwnerKind,
    owner_id: S,
    currency: Currency,
    settlement_token: Token,
  }),
  was: [`${B}/bank-details/README.md:1`],
});

export const machine_bank_details = defineMachine({
  id: "bank-details",
  title: "Bank details' state at Bridge",
  about:
    "Born `requested` with Bridge's answer to opening the virtual account (its Idempotency-Key is `bank_details_id`, derived " +
    "from the owner and currency, with the attempt), and `active` in the same transaction when Bridge activated it at once; a later virtual account " +
    "event, moves it in Bridge's order. Choosing the token deposits become is the one change an owner makes, and it is a " +
    "transition of its own on an active account so that it is recorded once. Old banking's `bank-details` machine, with " +
    "`failed` now reached (Bridge refusing to open the account) and left again by asking once more (`reopen`).",
  table: table_bank_details,
  field: "state",
  initial: "requested",
  states: [
    { id: "requested", about: "Capxul asked Bridge to open it; Bridge has not activated it yet." },
    { id: "active", about: "Bridge's virtual account takes deposits into the owner's Safe." },
    { id: "deactivated", about: "Bridge deactivated it; a later Bridge event can activate it again." },
    { id: "closed", about: "Bridge closed it; every later lifecycle event is refused.", terminal: true },
    { id: "failed", about: "Bridge refused to open it; the next `bank details` asks Bridge again while the owner is verified." },
  ],
  transitions: {
    open: {
      from: [],
      to: "requested",
      about: "`bank details` for an approved currency with no details: Bridge is asked under the row's own id as key, then the row is written.",
      guard: "the owner's verification approves the currency, and the caller may manage the owner",
      emits: [event_bank_details_transitioned],
    },
    activate: {
      from: ["requested", "deactivated"],
      to: "active",
      about: "Bridge's answer or a later event says the virtual account is activated.",
      emits: [event_bank_details_transitioned],
    },
    deactivate: {
      from: ["requested", "active"],
      to: "deactivated",
      about: "A Bridge event deactivated it.",
      emits: [event_bank_details_transitioned],
    },
    close: {
      from: ["requested", "active", "deactivated"],
      to: "closed",
      about: "A Bridge event closed it.",
      emits: [event_bank_details_transitioned],
    },
    fail: {
      from: ["requested"],
      to: "failed",
      about: "Bridge refused to open the account (mode refused).",
      emits: [event_bank_details_transitioned],
    },
    reopen: {
      from: ["failed"],
      to: "requested",
      about: "`bank details` asks Bridge again for a failed currency, under the next attempt's key.",
      guard: "the owner's verification still approves the currency, and the caller may manage the owner",
      emits: [event_bank_details_transitioned],
    },
    change_token: {
      from: ["active"],
      to: "active",
      about: "`bank settle` changed the token deposits become; deposits already completed keep theirs.",
      guard: "the new token differs from `settlement_token`; the same token changes nothing and sends nothing",
      emits: [event_bank_details_transitioned],
    },
  },
  was: [`${AS_IS}:693`, `${B}/bank-details/writes/lifecycle.ts:35`],
});

// ── saved bank accounts: where payouts go ───────────────────────────────────────────────────

const ACCOUNT_STATES = ["saved", "active", "inactive", "removed"] as const;
const AccountState = Schema.Literals(ACCOUNT_STATES);

export const table_bank_accounts = defineTable({
  id: "bank-accounts",
  title: "Saved bank accounts: where an owner's bank payouts go",
  about:
    "One row per bank account an owner saved to pay out to: their own (`scope` self, its Party the owner's), a contact's " +
    "(`scope` contact, its Party the contact's), or a payee known only by name from `bank pay --input` (`scope` payee, " +
    "no Party). `bank_account_id` is the frozen `partyAccountId`. `holder_name`, `bank_name` and `last4` are what lists " +
    "show; the full numbers are in `secret_fields_enc`. `request_key` and `request_digest` make a repeated save return the " +
    "same account and a different save under the same key refused. An account is `saved` until Bridge holds it as an " +
    "external account (`bridge_external_account_id`), which happens at the save when the owner is already verified for " +
    "the currency, or at its first payout. Removal keeps the row: payouts already made to it point at it. This one table " +
    "replaces old parties' `partyAccounts` and the bank kind of its `counterpartyDestinations`.",
  concept: concept_banking,
  tenancy: "owner",
  tenantField: "owner_id",
  scope: OWNER_SCOPE,
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    bank_account_id: S,
    scope: Schema.Literals(["self", "contact", "payee"]),
    party_id: NullOr(S),
    currency: Currency,
    holder_name: S,
    bank_name: NullOr(S),
    last4: S,
    state: AccountState,
    secret_fields_enc: S,
    request_key: S,
    request_digest: S,
    bridge_external_account_id: NullOr(S),
    bridge_updated_at: NullOr(N),
    saved_by: S,
    created_at: N,
    updated_at: N,
    removed_at: NullOr(N),
  }),
  key: ["owner_id", "bank_account_id"],
  indexes: [
    {
      name: "bank-accounts-by-request",
      fields: ["owner_id", "request_key"],
      unique: true,
      for: "A repeated `--request-key` finds its account: the same digest returns it, another digest is refused.",
    },
    {
      name: "bank-accounts-by-scope",
      fields: ["owner_id", "scope", "state", "created_at"],
      for: "`bank accounts` (the owner's own, `scope` self, not removed, newest first) and a contact's accounts (`contact get`).",
    },
    {
      name: "bank-accounts-by-party",
      fields: ["owner_id", "party_id"],
      for: "The accounts saved on one contact, for `contact get` and for `bank pay <contact>`.",
    },
    {
      name: "bank-accounts-by-external-account",
      fields: ["bridge_external_account_id"],
      unique: true,
      crossTenant: true,
      for: "The account a Bridge external account event names, when the inbox applies it.",
    },
  ],
  retention: KEPT,
  was: [`${P}/tables.ts:9`, `${P}/tables.ts:215`, `${P}/accounts/README.md:1`],
});

export const event_bank_account_transitioned = defineEvent({
  id: "bank_account_transitioned",
  about:
    "A saved bank account was saved, registered at Bridge, deactivated or reactivated by Bridge, or removed. Carries the " +
    "owner, the scope, the Party and the currency; never the holder name, the bank name, the numbers or the last digits.",
  props: Schema.Struct({
    from: Schema.NullOr(AccountState),
    to: AccountState,
    transition: Schema.Literals(["save", "register", "deactivate", "reactivate", "remove"]),
    bank_account_id: S,
    owner_kind: OwnerKind,
    owner_id: S,
    scope: Schema.Literals(["self", "contact", "payee"]),
    party_id: Schema.NullOr(S),
    currency: Currency,
  }),
  was: [`${P}/accounts/events.ts:1`, `${P}/accounts/README.md:42`],
});

export const machine_bank_account = defineMachine({
  id: "bank-account",
  title: "A saved bank account's life",
  about:
    "Born `saved` (or straight to `active` in the same rpc, when the owner is verified for the currency and Bridge takes " +
    "the account). Bridge's external account events deactivate and reactivate it; removal is final and no Bridge event " +
    "brings a removed account back. Replaces old parties' account states and the `bank_account_changed` event, which the " +
    "transitions now send.",
  table: table_bank_accounts,
  field: "state",
  initial: "saved",
  states: [
    { id: "saved", about: "Stored with its numbers encrypted; Bridge does not hold it yet." },
    { id: "active", about: "Bridge holds it as an external account; payouts can go to it." },
    { id: "inactive", about: "Bridge deactivated it; payouts to it are refused until Bridge reactivates it." },
    { id: "removed", about: "The owner removed it; it is left out of every list and no Bridge event revives it.", terminal: true },
  ],
  transitions: {
    save: {
      from: [],
      to: "saved",
      about: "`bank accounts add`, `contact bank add` or a new payee in `bank pay --input`.",
      guard: "the request key is new for the owner; a repeat with the same digest returns the account and sends nothing",
      emits: [event_bank_account_transitioned],
    },
    register: {
      from: ["saved"],
      to: "active",
      about: "Bridge accepted the account as an external account, at the save or at its first payout.",
      guard: "the owner is verified for the account's currency",
      emits: [event_bank_account_transitioned],
    },
    deactivate: {
      from: ["active"],
      to: "inactive",
      about: "A Bridge external account event deactivated it.",
      emits: [event_bank_account_transitioned],
    },
    reactivate: {
      from: ["inactive"],
      to: "active",
      about: "A Bridge external account event activated it again.",
      emits: [event_bank_account_transitioned],
    },
    remove: {
      from: ["saved", "active", "inactive"],
      to: "removed",
      about: "`bank accounts remove`; removing it again returns it unchanged and sends nothing.",
      emits: [event_bank_account_transitioned],
    },
  },
  was: [`${P}/accounts/operations/add.ts:1`, `${P}/accounts/operations/remove.ts:1`, `${P}/accounts/writes.ts:1`],
});

// ── bank deposits ───────────────────────────────────────────────────────────────────────────

const DEPOSIT_STATES = ["processing", "arriving", "credited", "below_minimum", "returned"] as const;
const DepositStatus = Schema.Literals(DEPOSIT_STATES);
const MATCH_STATES = ["unmatched", "request", "not_request"] as const;
const MatchState = Schema.Literals(MATCH_STATES);

export const table_bank_deposits = defineTable({
  id: "bank-deposits",
  title: "Bank deposits: money paid in by bank to an owner's bank details",
  about:
    "One row per Bridge deposit into an owner's bank details, keyed by Capxul's `bank_deposit_id` and found by Bridge's " +
    "`bridge_deposit_id`. It snapshots its bank details, owner and Safe at birth. `status` is the public status itself " +
    "(processing, arriving, credited, below minimum, returned): the old row kept Bridge's finer bank states and a refund " +
    "state and derived it. `gross_amount` is the bank money, `net_amount` the tokens after fees, frozen with " +
    "`settlement_token` when Bridge sends them, with Bridge's `tx_hash`. It is credited only when the indexer shows that " +
    "transaction's exact Transfer into the Safe at finality, and the credit writes its book fact. `match_state` and " +
    "`match` say whether a request was paid by it (requests drives them through `banking.match-deposit`). `sender_enc` " +
    "and `reference_enc` are the payer's private data. Old banking's `railDeposits`, less the staging mint, the back-off " +
    "and park columns and the journey and correlation ids.",
  concept: concept_banking,
  tenancy: "owner",
  tenantField: "owner_id",
  scope: OWNER_SCOPE,
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    bank_deposit_id: S,
    bridge_deposit_id: S,
    bank_details_id: S,
    party_id: S,
    currency: Currency,
    rail: Rail,
    chain_id: N,
    safe_address: S,
    settlement_token: Token,
    status: DepositStatus,
    gross_amount: S,
    net_amount: NullOr(S),
    tx_hash: NullOr(S),
    transfer_log_index: NullOr(N),
    book_fact_id: NullOr(S),
    sender_enc: NullOr(S),
    reference_enc: NullOr(S),
    match_state: MatchState,
    match: NullOr(
      Schema.Union([
        Schema.Struct({ kind: Schema.Literal("request"), request_id: S, reference: S, how: Schema.Literals(["reference", "manual"]) }),
        Schema.Struct({ kind: Schema.Literal("not_request") }),
      ]),
    ),
    bridge_updated_at: N,
    received_at: N,
    credited_at: NullOr(N),
    updated_at: N,
  }),
  key: ["owner_id", "bank_deposit_id"],
  indexes: [
    {
      name: "bank-deposits-by-received",
      fields: ["owner_id", "received_at", "bank_deposit_id"],
      for: "`bank deposits`: the owner's deposits newest first, 20 a page after the cursor; `--unmatched` filters on `match_state`.",
    },
    {
      name: "bank-deposits-by-match",
      fields: ["owner_id", "match_state", "status", "received_at"],
      for: "The owner's credited deposits still unmatched: `bank match` choices and the `Needs you` count.",
    },
    {
      name: "bank-deposits-by-bridge-deposit",
      fields: ["bridge_deposit_id"],
      unique: true,
      crossTenant: true,
      for: "The deposit a Bridge deposit event names, when the inbox applies it.",
    },
  ],
  retention: KEPT,
  was: [`${B}/tables.ts:84`, `${B}/deposits/README.md:1`, `${B}/deposits/rules.ts:187`, `${AS_IS}:334`],
});

export const event_bank_deposit_transitioned = defineEvent({
  id: "bank_deposit_transitioned",
  about:
    "A bank deposit reached a new public status: received, arriving with its tokens, credited into the Safe, below Bridge's " +
    "minimum, or returned to the sender. Carries the owner, the currency, the token and the amounts; never the sender or " +
    "the reference.",
  props: Schema.Struct({
    from: Schema.NullOr(DepositStatus),
    to: DepositStatus,
    transition: Schema.Literals(["receive", "mark_arriving", "credit", "mark_below_minimum", "mark_returned"]),
    bank_deposit_id: S,
    owner_kind: OwnerKind,
    owner_id: S,
    currency: Currency,
    settlement_token: Token,
    gross_amount: S,
    net_amount: Schema.NullOr(S),
  }),
  was: [`${B}/deposits/events.ts:1`],
});

export const machine_bank_deposit = defineMachine({
  id: "bank-deposit",
  title: "A bank deposit's public status",
  about:
    "Born `processing` by the first Bridge event about it (scheduled, received or in review all read as processing). " +
    "`arriving` once Bridge has sent the tokens and named the transaction; `credited` once the indexer shows that " +
    "transaction's Transfer into the Safe at finality, which writes the deposit's book fact in the same transaction. A " +
    "deposit below Bridge's minimum, or returned by Bridge to the sender, ends there. A refund in flight or failed is " +
    "Bridge's and reads as processing. Bridge's events can come out of order: the inbox applies one only when it is " +
    "newer than `bridge_updated_at` and moves the status forward.",
  table: table_bank_deposits,
  field: "status",
  initial: "processing",
  states: [
    { id: "processing", about: "Bridge has the bank money (scheduled, received or in review) and has not sent tokens yet." },
    { id: "arriving", about: "Bridge sent the tokens in a named transaction; Capxul waits for the indexer to show it at finality." },
    { id: "credited", about: "The exact Transfer is in the Safe at finality and the book fact is written; a request can be matched to it." },
    { id: "below_minimum", about: "Below Bridge's minimum deposit; Bridge keeps or returns it, Capxul credits nothing.", terminal: true },
    { id: "returned", about: "Bridge returned the money to the sender; nothing was credited.", terminal: true },
  ],
  transitions: {
    receive: {
      from: [],
      to: "processing",
      about: "The inbox applies the first Bridge event for a deposit into known bank details.",
      emits: [event_bank_deposit_transitioned],
    },
    mark_arriving: {
      from: ["processing"],
      to: "arriving",
      about: "Bridge sent the tokens: it freezes `net_amount`, `settlement_token` and `tx_hash`.",
      emits: [event_bank_deposit_transitioned],
    },
    credit: {
      from: ["arriving"],
      to: "credited",
      about: "The indexer shows the exact Transfer of `net_amount` into the Safe at finality; the book fact commits with it.",
      guard: "token, amount and recipient are the deposit's own; another Transfer leaves it arriving",
      emits: [event_bank_deposit_transitioned],
    },
    mark_below_minimum: {
      from: ["processing"],
      to: "below_minimum",
      about: "Bridge says the deposit is below its minimum.",
      emits: [event_bank_deposit_transitioned],
    },
    mark_returned: {
      from: ["processing"],
      to: "returned",
      about: "Bridge completed returning the money to the sender.",
      emits: [event_bank_deposit_transitioned],
    },
  },
  was: [`${AS_IS}:746`, `${B}/deposits/rules.ts:160`],
});

export const event_bank_deposit_match_transitioned = defineEvent({
  id: "bank_deposit_match_transitioned",
  about:
    "A credited deposit was matched to the request it paid, or marked as not a request. Requests marks the request paid " +
    "in the same transaction. Carries the owner, the deposit and the request; never the sender or the reference.",
  props: Schema.Struct({
    from: MatchState,
    to: MatchState,
    transition: Schema.Literals(["match_request", "mark_not_request"]),
    bank_deposit_id: S,
    owner_kind: OwnerKind,
    owner_id: S,
    request_id: Schema.NullOr(S),
  }),
  was: [`${B}/deposits/events/matching.ts:1`],
});

export const machine_bank_deposit_match = defineMachine({
  id: "bank-deposit-match",
  title: "Whether a credited deposit paid a request",
  about:
    "Every deposit is born `unmatched`. Requests' `bank match` (and its own reference match) moves a credited deposit to " +
    "`request` or `not_request` once, through `banking.match-deposit`; the same match again changes nothing, and a deposit " +
    "matched once never moves to another request or to `not_request`, nor the reverse.",
  table: table_bank_deposits,
  field: "match_state",
  initial: "unmatched",
  states: [
    { id: "unmatched", about: "No request is linked yet; `bank deposits --unmatched` lists it once credited." },
    { id: "request", about: "Linked to the request it paid, with the request's id and reference.", terminal: true },
    { id: "not_request", about: "Marked by its owner as paying no request.", terminal: true },
  ],
  transitions: {
    match_request: {
      from: ["unmatched"],
      to: "request",
      about: "`bank match <deposit> <request>`, or requests' match by an unambiguous reference.",
      guard: "the deposit is credited",
      emits: [event_bank_deposit_match_transitioned],
    },
    mark_not_request: {
      from: ["unmatched"],
      to: "not_request",
      about: "`bank match <deposit> none`.",
      guard: "the deposit is credited",
      emits: [event_bank_deposit_match_transitioned],
    },
  },
  was: [`${B}/deposits/operations/match.ts:1`, `${B}/deposits/writes/matching.ts:1`],
});

// ── bank payouts ────────────────────────────────────────────────────────────────────────────

const PAYOUT_STATES = ["quoted", "in_transit", "delivered", "returning", "refunded", "expired", "needs_attention"] as const;
const PayoutState = Schema.Literals(PAYOUT_STATES);
/** Why a payout ended unfunded, was returned, or needs a person (old ATTENTION_REASONS and END_REASONS, kept where reachable). */
export const PayoutReason = Schema.Literals([
  "quote_expired_unpaid",
  "bank_account_changed",
  "bank_returned",
  "bridge_refunded",
  "bridge_undeliverable",
  "bridge_moved_unfunded",
  "funding_short",
  "delivered_amount_wrong",
  "delivery_stalled",
  "refund_missing",
]);

export const table_bank_payouts = defineTable({
  id: "bank-payouts",
  title: "Bank payouts: one Bridge transfer and the quote it began as",
  about:
    "One row per bank payout an owner makes: the saved bank account, Bridge's transfer (`bridge_transfer_id`) and its " +
    "deposit address, the quote's terms written once (what reaches the bank, what leaves the Safe, the rate, the slippage " +
    "buffer and the deadline), and the Payment born for it through `payments.prepare-command`. `payout_id` is also " +
    "Bridge's client reference and the Idempotency-Key of the transfer, derived from the owner and the request key, so a " +
    "replay finds the same payout and the same transfer. `budget_id` is the budget an Organization pays from. Bridge's " +
    "delivery (`delivered_amount`) and a return's refund (`refund_tx_hash`, `refund_amount`, its book fact) are written by " +
    "the payout's own process. Replaces old banking's `payouts` with its `quotes` and `railOperations`; the dispatcher's " +
    "saved calls, leases, timers, the version and the `payoutTransitions` log are the workflow engine's now.",
  concept: concept_banking,
  tenancy: "owner",
  tenantField: "owner_id",
  scope: OWNER_SCOPE,
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    payout_id: S,
    request_key: S,
    request_digest: S,
    bank_account_id: S,
    currency: Currency,
    rail: Rail,
    funding_token: Token,
    fixed: Schema.Literals(["receive", "send"]),
    budget_id: NullOr(S),
    source_safe: S,
    chain_id: N,
    quote: Schema.Struct({
      receive_amount: S,
      send_amount: S,
      slippage_amount: S,
      rate: S,
      fee_amount: S,
      expires_at: N,
    }),
    bridge_transfer_id: S,
    deposit_address: S,
    payment_id: S,
    state: PayoutState,
    reason: NullOr(PayoutReason),
    delivered_amount: NullOr(S),
    refund_tx_hash: NullOr(S),
    refund_amount: NullOr(S),
    refund_book_fact_id: NullOr(S),
    resolved_by: NullOr(Schema.Struct({ who: S, why: S })),
    bridge_updated_at: NullOr(N),
    created_by: S,
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_id", "payout_id"],
  indexes: [
    {
      name: "bank-payouts-by-request",
      fields: ["owner_id", "request_key"],
      unique: true,
      for: "A replay of the payer's `--request-key` finds its payout; a different request under the same key is refused.",
    },
    {
      name: "bank-payouts-by-account",
      fields: ["owner_id", "bank_account_id", "state"],
      for: "The quoted payouts to one account, which its removal or deactivation ends before they are funded.",
    },
    {
      name: "bank-payouts-by-transfer",
      fields: ["bridge_transfer_id"],
      unique: true,
      crossTenant: true,
      for: "The payout a Bridge transfer event names, when the inbox signals its process.",
    },
  ],
  retention: KEPT,
  was: [`${B}/tables/payouts.ts:131`, `${B}/payouts/README.md:6`, `${AS_IS}:428`, `${AS_IS}:611`, `${AS_IS}:660`],
});

export const event_bank_payout_transitioned = defineEvent({
  id: "bank_payout_transitioned",
  about:
    "A bank payout reached a new stage: quoted, in transit to the bank, delivered, returning, refunded into the Safe, " +
    "expired unfunded, or handed to a person. Carries the owner, the Payment, the currency and the reason; never a bank " +
    "number or a holder name.",
  props: Schema.Struct({
    from: Schema.NullOr(PayoutState),
    to: PayoutState,
    transition: Schema.Literals(["quote", "fund", "deliver", "mark_returning", "refund", "expire", "flag"]),
    payout_id: S,
    owner_kind: OwnerKind,
    owner_id: S,
    payment_id: S,
    currency: Currency,
    reason: Schema.NullOr(PayoutReason),
  }),
  was: [`${B}/payouts/README.md:20`],
});

export const machine_bank_payout = defineMachine({
  id: "bank-payout",
  title: "A bank payout from quote to the bank, or back",
  about:
    "Born `quoted` with its Bridge transfer and its Payment in one transaction. The payout's process owns every move after " +
    "that: the Payment settling at Bridge's deposit address puts it `in_transit`; Bridge's events deliver it or return it; " +
    "a return's refund arriving in the Safe ends it `refunded`. Unfunded at the quote's deadline it ends `expired`. " +
    "Anything only a person can settle (Bridge moved the transfer without the funding, a short or wrong amount, a delivery " +
    "or refund past its limit) is `needs_attention`, with one reason. A bank can return a payout after delivery (K13), so " +
    "`delivered` is not final. Replaces old banking's twelve PascalCase states: `Creating`, `Funding`, `Cancelling` and " +
    "`Refused` are gone with the dispatcher and the synchronous quote, `ClosedUnfunded` is a reason.",
  table: table_bank_payouts,
  field: "state",
  initial: "quoted",
  states: [
    { id: "quoted", about: "Bridge's transfer and the quote are fixed and the Payment waits for the payer's approval." },
    { id: "in_transit", about: "The Payment settled at Bridge's deposit address; Bridge is delivering to the bank." },
    { id: "delivered", about: "Bridge delivered the quoted bank amount; a bank can still return it." },
    { id: "returning", about: "Bridge reports the transfer returned, refunded or undeliverable; its refund is on its way to the Safe." },
    { id: "refunded", about: "The refund arrived in the Safe and its book fact is written; `reason` says why it failed.", terminal: true },
    { id: "expired", about: "Unfunded at the quote's deadline, or its account changed before approval; nothing was sent.", terminal: true },
    { id: "needs_attention", about: "A person owns it, with one reason; Bridge's later events and an operator's resolution still apply." },
  ],
  transitions: {
    quote: {
      from: [],
      to: "quoted",
      about: "`bank pay`: Bridge's transfer is created, then the payout and its Payment command commit together.",
      emits: [event_bank_payout_transitioned],
    },
    fund: {
      from: ["quoted", "needs_attention"],
      to: "in_transit",
      about: "The payout's Payment settled: its PaymentSent to the deposit address, of the quoted token and amount, is indexed.",
      guard: "the Payment's token, amount and recipient are the quote's",
      emits: [event_bank_payout_transitioned],
    },
    deliver: {
      from: ["in_transit", "needs_attention"],
      to: "delivered",
      about: "Bridge's event says the bank received `delivered_amount`, the quote's receive amount, or an operator resolved it so.",
      guard: "the delivered amount is the quote's receive amount; any other is `needs_attention` (delivered_amount_wrong)",
      emits: [event_bank_payout_transitioned],
    },
    mark_returning: {
      from: ["in_transit", "delivered", "needs_attention"],
      to: "returning",
      about: "Bridge's event says the transfer was returned, refunded, cancelled or undeliverable after it was funded.",
      emits: [event_bank_payout_transitioned],
    },
    refund: {
      from: ["returning", "needs_attention"],
      to: "refunded",
      about: "The refund's Transfer into the source Safe is indexed at finality; its book fact commits with it.",
      emits: [event_bank_payout_transitioned],
    },
    expire: {
      from: ["quoted"],
      to: "expired",
      about: "The quote's deadline passed with no settled Payment, or its account was removed or deactivated before funding.",
      emits: [event_bank_payout_transitioned],
    },
    flag: {
      from: ["quoted", "in_transit", "delivered", "returning"],
      to: "needs_attention",
      about: "Something only a person can settle: Bridge moved it unfunded, a short or wrong amount, a delivery or refund past its limit.",
      emits: [event_bank_payout_transitioned],
    },
  },
  was: [`${AS_IS}:888`, `${B}/payouts/rules/transition.ts:16`, `${B}/payouts/README.md:58`],
});

// ── Bridge's event inbox ────────────────────────────────────────────────────────────────────

const INBOX_STATES = ["pending", "applied", "ignored", "refused"] as const;
const InboxStatus = Schema.Literals(INBOX_STATES);

export const table_bridge_events = defineTable({
  id: "bridge-events",
  title: "Bridge's inbox: one encrypted row per Bridge event",
  about:
    "Every event Bridge sends, from its signed webhook or the catch-up, once by `event_id`: a repeat changes nothing. " +
    "`payload_enc` is the whole body, encrypted with `bridge-events:<event_id>` as associated data, because it carries " +
    "people's names and bank data. The event is applied to the verification, bank details, deposit, bank account or " +
    "payout it names in the transaction that stores it; one whose object Capxul does not hold yet stays `pending` for the " +
    "catch-up to apply again, and `attempts` counts those tries. `refusal` names the field of a body no retry can change. " +
    "Old banking's `railEvents`, less the back-off, park and run columns (the catch-up's schedule is the retry) and the " +
    "broken-row outcome.",
  concept: concept_banking,
  tenancy: "global",
  fields: Schema.Struct({
    event_id: S,
    category: Schema.Literals(["customer", "virtual_account", "deposit", "external_account", "transfer", "other"]),
    type: S,
    object_id: S,
    payload_enc: S,
    source: Schema.Literals(["webhook", "catch_up"]),
    status: InboxStatus,
    attempts: N,
    refusal: NullOr(Schema.Struct({ field: S, problem: S })),
    bridge_created_at: N,
    received_at: N,
    applied_at: NullOr(N),
  }),
  key: ["event_id"],
  indexes: [
    {
      name: "bridge-events-by-pending",
      fields: ["status", "received_at"],
      for: "The catch-up's retry read: events still pending, oldest first.",
    },
  ],
  retention: "The catch-up deletes applied, ignored and refused rows after 90 days; a pending row is kept until it applies or is refused.",
  was: [`${B}/tables.ts:59`, `${B}/webhooks/README.md:3`, `${AS_IS}:246`],
});

export const event_bridge_event_transitioned = defineEvent({
  id: "bridge_event_transitioned",
  about:
    "A Bridge event was stored, then applied to what it names, ignored as of no use to Capxul, or refused as unusable. " +
    "Carries the event's id, category and type; never its body.",
  props: Schema.Struct({
    from: Schema.NullOr(InboxStatus),
    to: InboxStatus,
    transition: Schema.Literals(["store", "apply", "ignore", "refuse"]),
    event_id: S,
    category: S,
    type: S,
  }),
  was: [`${B}/webhooks/README.md:3`],
});

export const machine_bridge_event = defineMachine({
  id: "bridge-event",
  title: "Whether a Bridge event has been applied",
  about:
    "Born `pending` when the webhook route or the catch-up stores it. Applying it moves it to `applied`; an event Capxul has " +
    "no use for (a kind it does not follow) is `ignored`; a body that does not decode, or names a field Capxul cannot " +
    "accept, is `refused` with that field, once.",
  table: table_bridge_events,
  field: "status",
  initial: "pending",
  states: [
    { id: "pending", about: "Stored; not applied yet, because its object is not known yet or applying it failed." },
    { id: "applied", about: "Applied to the verification, bank details, deposit, bank account or payout it names.", terminal: true },
    { id: "ignored", about: "An event kind Capxul does not follow.", terminal: true },
    { id: "refused", about: "A body no retry can change; `refusal` names the field.", terminal: true },
  ],
  transitions: {
    store: { from: [], to: "pending", about: "The webhook route or the catch-up stored a new event id.", emits: [event_bridge_event_transitioned] },
    apply: { from: ["pending"], to: "applied", about: "Applied in the transaction that stored it, or by a later catch-up.", emits: [event_bridge_event_transitioned] },
    ignore: { from: ["pending"], to: "ignored", about: "Of a kind Capxul does not follow.", emits: [event_bridge_event_transitioned] },
    refuse: { from: ["pending"], to: "refused", about: "Its body does not decode, or names a field Capxul cannot accept.", emits: [event_bridge_event_transitioned] },
  },
  was: [`${AS_IS}:856`, `${B}/webhooks/writes.ts:23`],
});

export const table_bridge_sync = defineTable({
  id: "bridge-sync",
  title: "Bridge catch-up cursor",
  about:
    "One row: the id of the last Bridge event the catch-up has read, so the next run asks Bridge only for later ones. Only " +
    "the catch-up moves it; a webhook delivery never does, so a gap in deliveries is always read. Old banking's " +
    "`railSyncState`, less its lease (the catch-up is a singleton workflow) and the devnet's `readsFrom`.",
  concept: concept_banking,
  tenancy: "global",
  fields: Schema.Struct({
    rail: Schema.Literal("bridge"),
    cursor: NullOr(S),
    read_at: NullOr(N),
    updated_at: N,
  }),
  key: ["rail"],
  indexes: [],
  retention: "One row for good.",
  was: [`${B}/tables.ts:136`, `${B}/reconcile/README.md:3`, `${AS_IS}:302`],
});

// Payroll's tables, its two state machines and each machine's one event (P7).
//
// Payroll owns pay agreements on Protocol v4's Agreements (concepts.payroll): a salary, stream or
// retainer offered from a budget by its office holder or anyone above, accepted by the payee, changed,
// paused, resumed, ended or withdrawn by a holder, and collected by the payee. Two tables:
//
// - `agreements`: one row per agreement, with what the chain cannot name (the department, the payee's
//   mailbox or Organization, who offered it, the terms document) and the status its durable process
//   keeps from the chain's facts and its own timers. Earned, collectable and the current rate are read
//   from Agreements when a reader asks, never copied.
// - `agreement-writes`: one row per write a holder or the payee makes (an offer, a withdrawal, a rate
//   change, a pause, a resume, an end, an acceptance, a collection), with the approval or Board
//   proposal that carries it, until the chain decides it.
//
// Old payroll's runs, items, groups, terms and departments are not here (concepts.payroll, landings):
// departments are budgets', and the rest has no frozen operation (P2). The old notice-claim table goes
// with the notices themselves (payroll.notices-elsewhere).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";

const OLD = "packages/backend/src/payroll";
const PROTOCOL = "packages/protocol/src/payroll";

const S = Schema.String;
const N = Schema.Number;
const Null = Schema.NullOr;
const opt = Schema.optionalKey;

/** The nine statuses `--status` takes (agreement list, org agreement list): surface, kept by name. */
export const AGREEMENT_STATUSES = [
  "prepared",
  "offered",
  "active",
  "paused",
  "ending",
  "ended",
  "lapsed",
  "withdrawn",
  "abandoned",
] as const;

/** What an agreement pays: an end date makes any offer a fixed term. */
export const AGREEMENT_KINDS = ["salary", "stream", "retainer", "fixed_term"] as const;

/** The change a write makes on chain when it lands: the names the frozen claims report (`rate_changed`, `accepted`). */
export const WRITE_CHANGES = [
  "offered",
  "withdrawn",
  "rate_changed",
  "rate_change_cancelled",
  "paused",
  "resumed",
  "ended",
  "accepted",
  "collected",
] as const;

export const WRITE_STATUSES = ["awaiting", "landed", "failed", "abandoned"] as const;

/** Why a write failed (reverted, beaten) or was abandoned (the rest): what became of its approval or proposal. */
export const WRITE_FAILURES = [
  "reverted",
  "beaten",
  "refused",
  "declined",
  "expired",
  "displaced",
  "withdrawn",
  "rejected",
  "replaced",
  "execution_failed",
] as const;

const RETAINED =
  "Kept for the Organization's life: an agreement and its writes are the record of what was offered, accepted and collected.";

// ── tables ──────────────────────────────────────────────────────────────────────────────────

export const table_agreements = defineTable({
  id: "agreements",
  title: "Agreements: one pay agreement from a budget to a payee",
  about:
    "One v4 agreement a holder offered from a department's budget, from the moment the offer is prepared. It keeps what " +
    "Agreements cannot name: the department (`budget_ref`, budgets' `dep_` id, and `budget_id`, its uint256 in Budgets), the payee as offered (a person's mailbox, or an " +
    "Organization by its handle) and the Safe it pays, who offered it, and the terms document whose hash the offer commits " +
    "to (stored with the offer through `documents.store`). `rate`, `period`, `release`, `starts_at`, `ends_at` and " +
    "`offer_expires_at` are the terms as offered; the current rate, a waiting lowering, earned, collectable and collected " +
    "are read from Agreements (`agreementOf`, `availableOf`) when a reader asks. `status` is one of the nine `--status` " +
    "names; only the agreement's durable process moves it, from Agreements' events and its own timers. " +
    "`roles_address` is the payer's Roles modifier, copied from its deployment at the offer (it never changes), so a " +
    "payee's collection reads the payout ceiling without reading the payer's tenant. " +
    "`chain_agreement_id` is the uint256 the offer got on chain, null while prepared. `ends_at` is the exclusive end: a " +
    "fixed term's from the offer, else a holder's end; `end_by_holder` says a holder set it, which is what makes an " +
    "agreement `ending`. Amounts are raw token units as decimal strings; times are Unix ms.",
  was: [`${OLD}/tables.ts:38`, `${OLD}/tables.ts:55`, `${PROTOCOL}/agreement-schema.ts:33`, "books/as-is/payroll/data.ts"],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  scope:
    "org_id is the paying Organization. The payee, a person or another Organization, reads the agreements that pay its " +
    "Safe through by_payee_safe, under a second policy on payee_safe (payroll.payee-reads).",
  admits: [
    {
      match: "safe",
      field: "payee_safe",
      reads: true,
      writes: false,
      about:
        "The payee (a person, or an Organization's members) reads the agreements that pay its Safe (`by_payee_safe`); " +
        "only the agreement's process moves the row (payroll.payee-reads).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    agreement_id: S,
    budget_ref: S,
    budget_id: S,
    company_safe: S,
    roles_address: S,
    chain_agreement_id: Null(S),
    kind: Schema.Literals(AGREEMENT_KINDS),
    token: S,
    rate: S,
    period: Schema.Literals(["year", "month", "week"]),
    release: Schema.Literals(["1mo", "7d", "1d", "1s"]),
    starts_at: Null(N),
    ends_at: Null(N),
    end_by_holder: Schema.Boolean,
    offer_expires_at: N,
    terms_document_id: S,
    terms_hash: S,
    payee_kind: Schema.Literals(["person", "organization"]),
    payee_party_id: Null(S),
    payee_email: Null(S),
    payee_org_id: Null(S),
    payee_safe: S,
    offered_by: S,
    offered_by_safe: S,
    status: Schema.Literals(AGREEMENT_STATUSES),
    accepted_at: Null(N),
    paused_at: Null(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "agreement_id"],
  indexes: [
    {
      name: "by_status",
      fields: ["org_id", "status", "created_at"],
      for: "An Organization's agreements in the statuses a list shows, oldest first (org agreement list, with or without `--status`).",
    },
    {
      name: "by_budget",
      fields: ["org_id", "budget_ref", "created_at"],
      for: "One department's agreements (org agreement list `--department`), and its open ones before an offer (at most 64).",
    },
    {
      name: "by_payee_safe",
      fields: ["payee_safe", "created_at"],
      crossTenant: true,
      for: "The agreements that pay one Safe, from every Organization, newest first: agreement list and show, for a person or with `--org`.",
    },
    {
      name: "by_terms_hash",
      fields: ["terms_hash"],
      unique: true,
      crossTenant: true,
      for: "An indexed AgreementOffered, which carries only its document hash, to the prepared offer it lands.",
    },
    {
      name: "by_chain_id",
      fields: ["company_safe", "chain_agreement_id"],
      unique: true,
      crossTenant: true,
      for: "Any later Agreements event, keyed by the company Safe and the agreement's uint256, to its agreement's process.",
    },
  ],
  retention: RETAINED,
});

export const table_agreement_writes = defineTable({
  id: "agreement-writes",
  title: "Agreement writes: each holder's or payee's call until the chain decides it",
  about:
    "One write on an agreement: the one Agreements call a holder (offer, withdraw, change the rate or cancel a lowering, " +
    "pause, resume, end) or the payee (accept, collect) makes. `change` names what it does when it lands, in the words the " +
    "frozen claims report. A person's or an agent's write is carried by an approval from its own Safe (`approval_id`, " +
    "opened through `approvals.open` in the same transaction); an Organization payee's by a Board proposal on its Safe " +
    "(`proposal_id`, through `board.propose`). `signer_safe` is the Safe whose call it is. `args` holds what the call " +
    "carries: the pinned terms hash, the new rate and its date, the last day, the collection's amount and the window it " +
    "covers. Once landed it keeps the transaction, the block's time and, for a collection, the PaymentSent id payments " +
    "settles. `failure` says why a write failed or was abandoned. Its status moves only in the agreement's process.",
  was: [`${OLD}/tables.ts:19`, `${OLD}/tables.ts:112`, `${OLD}/agreements/writes/records.ts:40`, `${OLD}/agreements/writes/payees.ts:40`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  scope:
    "org_id is the paying Organization, even for the payee's own accept and collect, which the payee policy on the " +
    "agreement's payee_safe admits it to open and read (payroll.payee-reads).",
  admits: [
    {
      match: "safe",
      field: "agreement_id",
      via: { table: table_agreements, on: "agreement_id", field: "payee_safe" },
      where: { side: "payee" },
      reads: true,
      writes: true,
      about:
        "The agreement's payee opens and reads its own accept and collect: a payee-side write whose agreement pays a " +
        "Safe its tenant owns (payroll.payee-reads).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    write_id: S,
    agreement_id: S,
    change: Schema.Literals(WRITE_CHANGES),
    side: Schema.Literals(["holder", "payee"]),
    signer_safe: S,
    prepared_by: S,
    approval_id: Null(S),
    proposal_id: Null(S),
    args: Schema.Struct({
      terms_hash: opt(S),
      rate: opt(S),
      period: opt(Schema.Literals(["year", "month", "week"])),
      effective_at: opt(N),
      cancel: opt(Schema.Boolean),
      ends_at: opt(N),
      amount: opt(S),
      period_start: opt(N),
      period_end: opt(N),
    }),
    status: Schema.Literals(WRITE_STATUSES),
    tx_hash: Null(S),
    landed_at: Null(N),
    payment_id: Null(S),
    failure: Null(Schema.Literals(WRITE_FAILURES)),
    opened_at: N,
    updated_at: N,
  }),
  key: ["org_id", "write_id"],
  indexes: [
    {
      name: "by_agreement",
      fields: ["org_id", "agreement_id", "opened_at"],
      for: "An agreement's writes, oldest first: the one on its way, the last collection's window, a write's outcome for its flow.",
    },
    {
      name: "one_awaiting_per_signer",
      fields: ["org_id", "agreement_id", "signer_safe"],
      unique: true,
      for: "Partial on status = awaiting: at most one write on its way per Safe and agreement (WRONG_STATE `still on its way`).",
    },
    {
      name: "by_approval",
      fields: ["approval_id"],
      unique: true,
      crossTenant: true,
      for: "An approval's outcome, delivered with only its approval id, to the write it carries.",
    },
    {
      name: "by_proposal",
      fields: ["proposal_id"],
      unique: true,
      crossTenant: true,
      for: "A Board proposal's outcome, delivered with only its proposal id, to the Organization payee's write it carries.",
    },
  ],
  retention: RETAINED,
});

// ── the agreement ───────────────────────────────────────────────────────────────────────────

export const event_agreement_transitioned = defineEvent({
  id: "agreement_transitioned",
  about:
    "An agreement's status changed: prepared, on chain, accepted, paused, resumed, ending, ended, lapsed, withdrawn or " +
    "abandoned. `prepared_by` is the principal whose write made the change (null for a timer: a lapse, an end reached); " +
    "`occurred_at` is the block's time of the chain fact, or the chain time the timer fired at.",
  props: Schema.Struct({
    from: Null(Schema.Literals(AGREEMENT_STATUSES)),
    to: Schema.Literals(AGREEMENT_STATUSES),
    transition: S,
    agreement_id: S,
    org_id: S,
    kind: Schema.Literals(AGREEMENT_KINDS),
    payee_kind: Schema.Literals(["person", "organization"]),
    payee_org_id: Null(S),
    prepared_by: Null(S),
    occurred_at: N,
  }),
  was: [`${OLD}/agreements/events.ts:28`, "packages/observability/src/catalog/domains/payroll.ts"],
});

export const machine_agreement = defineMachine({
  id: "agreement",
  title: "Agreement status",
  about:
    "The nine statuses of an agreement. `prepared` and `abandoned` are Capxul's (the offer's write never reached the " +
    "chain); the rest follow Agreements: an offer waits for its payee until it lapses or is withdrawn; an accepted " +
    "agreement pays while `active` or `ending` (a holder set its end), stops building pay while `paused`, and is `ended` " +
    "from its end, a fixed term's own or a holder's. Pay already earned stays collectable in every accepted status. Every " +
    "move after `prepare` is made by the agreement's process, from an indexed Agreements event or its own timer at chain " +
    "time, never by an rpc.",
  was: [`${OLD}/agreements/rules.ts:64`, `${PROTOCOL}/agreement-schema.ts:27`, `${OLD}/tables.ts:96`],
  table: table_agreements,
  field: "status",
  initial: "prepared",
  states: [
    { id: "prepared", about: "The holder's offer is prepared and its approval open; nothing is on chain." },
    { id: "offered", about: "The offer is on chain, reserving its figure in the budget, and waits for the payee." },
    { id: "active", about: "Accepted and paying, with no end a holder set." },
    { id: "paused", about: "Accepted and paused: no pay builds up; earned pay stays collectable and the reservation stays." },
    { id: "ending", about: "Accepted and paying until the end a holder set." },
    { id: "ended", about: "Its end has come: nothing more builds up, what was earned stays collectable.", terminal: true },
    { id: "lapsed", about: "The offer expired unaccepted; its reservation frees.", terminal: true },
    { id: "withdrawn", about: "A holder withdrew the offer before it was accepted; its reservation frees.", terminal: true },
    { id: "abandoned", about: "The offer's write ended without reaching the chain: declined, expired or refused.", terminal: true },
  ],
  transitions: {
    prepare: {
      from: [],
      to: "prepared",
      about: "Born by payroll.holders.offer with its offer write, its terms document and its approval, in one transaction.",
      emits: [event_agreement_transitioned],
    },
    offer: {
      from: ["prepared"],
      to: "offered",
      about: "The indexed AgreementOffered carries the offer's terms hash; it records the agreement's uint256 id.",
      emits: [event_agreement_transitioned],
    },
    abandon: {
      from: ["prepared"],
      to: "abandoned",
      about: "The offer's write failed or was abandoned: its approval was declined or expired, or its operation reverted.",
      emits: [event_agreement_transitioned],
    },
    accept: {
      from: ["offered"],
      to: "active",
      about: "The indexed AgreementAccepted, at the block's time.",
      emits: [event_agreement_transitioned],
    },
    withdraw: {
      from: ["offered"],
      to: "withdrawn",
      about: "The indexed OfferWithdrawn.",
      emits: [event_agreement_transitioned],
    },
    lapse: {
      from: ["offered"],
      to: "lapsed",
      about: "The process's timer at offer_expires_at, by the chain's clock.",
      guard: "No AgreementAccepted or OfferWithdrawn for it was indexed by then.",
      emits: [event_agreement_transitioned],
    },
    pause: {
      from: ["active", "ending"],
      to: "paused",
      about: "The indexed AgreementPaused.",
      emits: [event_agreement_transitioned],
    },
    resume: {
      from: ["paused"],
      to: "active",
      about: "The indexed AgreementResumed.",
      guard: "No end a holder set is still ahead.",
      emits: [event_agreement_transitioned],
    },
    resume_ending: {
      from: ["paused"],
      to: "ending",
      about: "The indexed AgreementResumed of an agreement whose holder-set end is still ahead.",
      guard: "end_by_holder and ends_at is after the block's time.",
      emits: [event_agreement_transitioned],
    },
    set_end: {
      from: ["active"],
      to: "ending",
      about: "The indexed AgreementEnded on a running agreement; on a paused or ending one it only moves ends_at, with no change of status.",
      emits: [event_agreement_transitioned],
    },
    finish: {
      from: ["active", "ending", "paused"],
      to: "ended",
      about: "The process's timer at ends_at (00:00 UTC after the last day paid), by the chain's clock.",
      guard: "ends_at is set and the chain's time has reached it.",
      emits: [event_agreement_transitioned],
    },
  },
});

// ── the agreement's writes ──────────────────────────────────────────────────────────────────

export const event_agreement_write_transitioned = defineEvent({
  id: "agreement_write_transitioned",
  about:
    "A write on an agreement was opened or decided. `to: landed` with its `change` is what the frozen claims call a " +
    "report (`reports accepted once`): exactly one per write that reaches the chain, at the block's time, attributed to " +
    "`prepared_by`, the holder or payee who prepared it (payroll.reports).",
  props: Schema.Struct({
    from: Null(Schema.Literals(WRITE_STATUSES)),
    to: Schema.Literals(WRITE_STATUSES),
    transition: S,
    write_id: S,
    agreement_id: S,
    org_id: S,
    change: Schema.Literals(WRITE_CHANGES),
    side: Schema.Literals(["holder", "payee"]),
    prepared_by: S,
    occurred_at: N,
  }),
  was: [`${OLD}/agreements/events.ts:96`, `${OLD}/agreements/events.ts:147`],
});

export const machine_agreement_write = defineMachine({
  id: "agreement-write",
  title: "Agreement write status",
  about:
    "A write is born `awaiting` with the approval or proposal that carries it. Only chain proof lands or fails it: it " +
    "lands when the transaction of its approval or proposal carries its own Agreements event for this agreement, and " +
    "fails when that transaction reverted or ran without it (another write beat it to the chain, or the company Safe " +
    "reported its Board proposal's execution failed: board's `fail`). It is abandoned when " +
    "its approval ended unsent (declined or expired) or its proposal was rejected or replaced. A bundler refusal before " +
    "sending is the approval's own business: the write stays awaiting while its approval does.",
  was: [`${OLD}/agreements/writes/records.ts:100`, `${OLD}/agreements/writes/payees.ts:167`, `${OLD}/agreements/writes/organization-payees.ts:62`],
  table: table_agreement_writes,
  field: "status",
  initial: "awaiting",
  states: [
    { id: "awaiting", about: "Its approval or Board proposal is open, or its operation is on its way; nothing is decided." },
    { id: "landed", about: "Its transaction carried its own Agreements event for this agreement.", terminal: true },
    { id: "failed", about: "Its transaction reverted, ran without its event because another write beat it, or was a Board proposal that ran and failed.", terminal: true },
    { id: "abandoned", about: "Its approval was declined or expired unsent, or its proposal was rejected or replaced.", terminal: true },
  ],
  transitions: {
    open: {
      from: [],
      to: "awaiting",
      about: "Born by the rpc that prepares it, with its approval (approvals.open) or proposal (board.propose).",
      guard: "No other write of the same Safe on this agreement is awaiting.",
      emits: [event_agreement_write_transitioned],
    },
    land: {
      from: ["awaiting"],
      to: "landed",
      about: "Its approval or proposal ended landed, and the transaction's indexed facts hold its own event.",
      emits: [event_agreement_write_transitioned],
    },
    fail: {
      from: ["awaiting"],
      to: "failed",
      about: "Its operation reverted, its transaction landed without its own event, or its Board proposal ended `failed` (execution_failed).",
      emits: [event_agreement_write_transitioned],
    },
    abandon: {
      from: ["awaiting"],
      to: "abandoned",
      about: "Its approval ended unsent (declined, expired) or its Board proposal was rejected or replaced.",
      emits: [event_agreement_write_transitioned],
    },
  },
});

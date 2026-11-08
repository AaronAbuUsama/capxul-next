// Payroll's tables, its state machines and each machine's one event (P7).
//
// Payroll is Frappe HR's payroll, kept by Capxul from an Organization's first day, with or without a
// Frappe head (aaron.frappe-shape, aaron.erp-on-capxul; decision payroll.scope). Two families of tables:
//
// Pay that starts on chain, v4 Agreements: a salary, stream or retainer offered from a budget by its
// office holder or anyone above, accepted by the payee, changed, paused, resumed, ended or withdrawn by
// a holder, and collected by the payee.
// - `agreements`: one row per agreement, with what the chain cannot name (the department, the payee's
//   mailbox or Organization, who offered it, the terms document) and the status its durable process
//   keeps from the chain's facts and its own timers. Earned, collectable and the current rate are read
//   from Agreements when a reader asks, never copied.
// - `agreement-writes`: one row per write a holder or the payee makes (an offer, a withdrawal, a rate
//   change, a pause, a resume, an end, an acceptance, a collection), with the approval or Board
//   proposal that carries it, until the chain decides it.
//
// Frappe HR's doctypes, one table each, with Frappe's own field names (payroll.frappe-doctypes):
// - `employees` (Employee), `salary-components` (Salary Component), `salary-structures` (Salary
//   Structure, its Salary Detail rows embedded), `salary-structure-assignments` (Salary Structure
//   Assignment), `payroll-entries` (Payroll Entry) and `salary-slips` (Salary Slip).
// An accepted agreement to a person is an Employee and an assignment of the Organization's agreement
// structure, and each landed collection is a paid Salary Slip (payroll.agreements-in-frappe-shape).
// `payroll-settings`, `payroll-changes` and `payroll-head-syncs` carry payroll's own sync with a connected
// head (payroll.head-sync).
//
// Old payroll's saved groups and terms are not here, and departments are budgets' (landings). The old
// notice-claim table goes with the notices themselves (payroll.notices-elsewhere).

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
  was: [`${OLD}/tables.ts:38`, `${OLD}/tables.ts:55`, `${PROTOCOL}/agreement-schema.ts:33`, "docs/as-is/archive/payroll/data.ts"],
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
    /** The payee's Employee once a person accepts (payroll.agreements-in-frappe-shape); null for an Organization payee. */
    employee_id: Null(S),
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

// ── Frappe HR's doctypes ────────────────────────────────────────────────────────────────────
//
// One table per Frappe HR doctype, with Frappe's field names, so an Organization's payroll is in Frappe's
// shape from its first day and a head syncs it field for field (payroll.frappe-doctypes). Capxul's own ids
// (`emp_`, `sc_`, `sst_`, `ssa_`, `pe_`, `slip_` and a ULID) are the sync key, kept on the head in a Custom
// Field `capxul_id`; `head_name` is the head's own `name`, null until a head is connected (payroll.head-sync).
// Frappe's Date fields are `YYYY-MM-DD` days; its Currency fields are decimal strings at the token's display
// precision (2 places), rounded half to even, Frappe's "Banker's Rounding" (payroll.money-and-rounding).

const FRAPPE_HR = "/tmp/hrms/hrms/payroll/doctype";
const FRAPPE_EMPLOYEE = "/tmp/erpnext/erpnext/setup/doctype/employee/employee.json";
const HR_RETAINED =
  "Kept for the Organization's life: payroll records are the employer's statutory record of what was owed and paid.";

/** Frappe's `payroll_frequency` options, lowercased; null is Frappe's empty option (a stream pays every second). */
export const PAYROLL_FREQUENCIES = ["monthly", "fortnightly", "bimonthly", "weekly", "daily"] as const;
const Frequency = Schema.Literals(PAYROLL_FREQUENCIES);

/** Frappe's Employment Type records as an Organization starts with them. */
export const EMPLOYMENT_TYPES = ["full-time", "part-time", "contract", "intern", "apprentice", "probation", "commission", "piecework"] as const;

/** Frappe's Employee `status` options, lowercased. */
export const EMPLOYEE_STATUSES = ["active", "inactive", "suspended", "left"] as const;

/** Salary Component `type`: what a component's rows are on a structure and a slip. */
export const COMPONENT_TYPES = ["earning", "deduction", "employer_contribution"] as const;

/** Frappe's docstatus for a submittable doctype that Capxul writes submitted: 1 submitted, 2 cancelled. */
export const DOC_STATUSES = ["submitted", "cancelled"] as const;

/** Payroll Entry status: Frappe's Draft, Submitted and Cancelled, and Capxul's paying and paid (payroll.run-machine). */
export const PAYROLL_ENTRY_STATUSES = ["draft", "submitted", "paying", "paid", "cancelled"] as const;

/**
 * Salary Slip status: Frappe's Draft, Submitted, Withheld and Cancelled, and Capxul's paying, escrowed and paid. On a
 * head, paying, escrowed and paid are Frappe's Submitted with the Custom Field `capxul_status` (payroll.slip-machine).
 */
export const SALARY_SLIP_STATUSES = ["draft", "submitted", "withheld", "paying", "escrowed", "paid", "cancelled"] as const;

/** One Salary Detail row of a structure: a component's fixed amount, or its formula and condition (payroll.portable-formulas). */
export const StructureRow = Schema.Struct({
  salary_component: S,
  abbr: S,
  amount: S,
  amount_based_on_formula: Schema.Boolean,
  formula: Null(S),
  condition: Null(S),
  depends_on_payment_days: Schema.Boolean,
  statistical_component: Schema.Boolean,
  do_not_include_in_total: Schema.Boolean,
});

/** One Salary Detail row of a slip: the amount for the slip's payment days, the full-period amount, and where it came from. */
export const SlipRow = Schema.Struct({
  salary_component: S,
  abbr: S,
  amount: S,
  default_amount: S,
  additional_amount: S,
  statistical_component: Schema.Boolean,
  do_not_include_in_total: Schema.Boolean,
  /** `structure`: the assignment's structure; `collection`: an agreement collection, pushed to a head as its own slip, never an Additional Salary. */
  source: Schema.Literals(["structure", "collection"]),
});

/** The token a structure, an assignment, a run and a slip are in: Frappe's `currency` is its symbol. */
const Token = { currency: S, token_address: S, decimals: Schema.Int } as const;

// ── tables ──────────────────────────────────────────────────────────────────────────────────

export const table_employees = defineTable({
  id: "employees",
  title: "Employees: the people an Organization pays (Frappe's Employee)",
  about:
    "One person an Organization employs or contracts, in Frappe's Employee shape: `employee_name`, `first_name`, " +
    "`last_name`, `status`, `date_of_joining`, `relieving_date`, `department`, `designation`, `employment_type`, " +
    "`salary_currency`, `salary_mode` and `personal_email`. `party_id` is the person's Party in the global directory, " +
    "the one identity every Organization that pays them shares (aaron.crm-frappe-shape); `payee_safe` is that Party's " +
    "Safe, derived from `personal_email` when they have no account yet, so pay is always routed by the mailbox the " +
    "person keeps, never a work address (payroll.mailbox-for-pay). `department` is the budget that pays them (budgets' " +
    "`budget_ref`; Frappe's Department). Frappe's mandatory `gender` and `date_of_birth` are null unless the head holds " +
    "them: Capxul needs neither to pay. Born by `payroll.employees.add` or by an agreement's acceptance; `status` moves " +
    "only through machine `employee`.",
  was: [FRAPPE_EMPLOYEE, "packages/backend/src/payroll/tables.ts:167"],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    employee_id: S,
    party_id: S,
    payee_safe: S,
    personal_email: Null(S),
    employee_name: S,
    first_name: S,
    last_name: Null(S),
    status: Schema.Literals(EMPLOYEE_STATUSES),
    date_of_joining: S,
    relieving_date: Null(S),
    department: Null(S),
    designation: Null(S),
    employment_type: Schema.Literals(EMPLOYMENT_TYPES),
    salary_currency: Null(S),
    salary_mode: Schema.Literal("capxul"),
    gender: Null(S),
    date_of_birth: Null(S),
    head_name: Null(S),
    /** The `seq` of its last change in `payroll-changes`: the version a head sync pushes and compares (payroll.head-sync). */
    version: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "employee_id"],
  indexes: [
    {
      name: "by_party",
      fields: ["org_id", "party_id"],
      unique: true,
      for:
        "Partial on status <> left: one live Employee per person and Organization, which the agreement's acceptance and " +
        "`employees.add` find. A person who left and comes back is a new Employee, as in Frappe, whose duplicate check " +
        "counts only Active ones (payroll.one-live-employee).",
    },
    {
      name: "by_department",
      fields: ["org_id", "department", "status"],
      for: "A run's employees: the active people of one department (Payroll Entry's `department` filter).",
    },
    {
      name: "by_head_name",
      fields: ["org_id", "head_name"],
      for: "The head's sync finds an Employee by the head's own name.",
    },
  ],
  retention: HR_RETAINED,
});

export const table_salary_components = defineTable({
  id: "salary-components",
  title: "Salary components: each earning, deduction and employer contribution",
  about:
    "One Salary Component: `salary_component` (its name), `salary_component_abbr`, `type`, and how it is worked out " +
    "(`amount`, or `formula` and `condition` with `amount_based_on_formula`), with Frappe's flags " +
    "(`depends_on_payment_days`, `statistical_component`, `do_not_include_in_total`, `is_tax_applicable`, " +
    "`remove_if_zero_valued`, `disabled`). `accounts` are Frappe's Salary Component Account: the expense `account` " +
    "and, for a deduction or employer contribution, its `liability_account`, as books' account ids (null: the line's " +
    "role's account, books.payroll-defaults). `payee_party_id` is " +
    "Capxul's own field (a Custom Field on a head): the Party a deduction's or employer contribution's liability is owed " +
    "to (a tax office, a pension fund), paid when due by an ordinary budget payment, never in a run's command; null when " +
    "none is named (payroll.deduction-remittance). `portable` says the formula and condition are in the subset Capxul " +
    "evaluates as Frappe does; a component that is not can be used only by a run its head computes " +
    "(payroll.portable-formulas). `origin` `agreement` is the one component an Organization's agreement collections " +
    "are paid under, made when its first agreement is accepted: an earning with no amount, `depends_on_payment_days` " +
    "and `is_tax_applicable` off and `remove_if_zero_valued` on, so a head never prorates, taxes or adds a zero row for " +
    "it, and no run pays it (payroll.agreements-in-frappe-shape).",
  was: [`${FRAPPE_HR}/salary_component/salary_component.json`, `${FRAPPE_HR}/salary_component_account/salary_component_account.json`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    component_id: S,
    salary_component: S,
    salary_component_abbr: S,
    type: Schema.Literals(COMPONENT_TYPES),
    description: Null(S),
    amount: S,
    amount_based_on_formula: Schema.Boolean,
    formula: Null(S),
    condition: Null(S),
    depends_on_payment_days: Schema.Boolean,
    statistical_component: Schema.Boolean,
    do_not_include_in_total: Schema.Boolean,
    is_tax_applicable: Schema.Boolean,
    remove_if_zero_valued: Schema.Boolean,
    disabled: Schema.Boolean,
    accounts: Schema.Struct({ account: Null(S), liability_account: Null(S) }),
    payee_party_id: Null(S),
    portable: Schema.Boolean,
    origin: Schema.Literals(["capxul", "agreement", "head"]),
    head_name: Null(S),
    /** The `seq` of its last change in `payroll-changes`: the version a head sync pushes and compares (payroll.head-sync). */
    version: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "component_id"],
  indexes: [
    {
      name: "by_abbr",
      fields: ["org_id", "salary_component_abbr"],
      unique: true,
      for: "A formula names components by abbreviation, unique per Organization as Frappe requires; and the agreement component by its abbr.",
    },
  ],
  retention: HR_RETAINED,
});

export const table_salary_structures = defineTable({
  id: "salary-structures",
  title: "Salary structures: the components a group of people is paid by",
  about:
    "One Salary Structure, written submitted (Frappe's docstatus 1) and immutable from then: a change is a new " +
    "structure that names this one in `amended_from`, and this one is cancelled. `earnings`, `deductions` and " +
    "`employer_contributions` are its Salary Detail rows, embedded (a child table in Frappe), in order. " +
    "`payroll_frequency` is how often a run pays it; `currency` with its token is the stablecoin it pays in. `is_active` " +
    "is Frappe's Yes or No. `origin` `agreement` is the Organization's one agreement structure: one earning, the " +
    "agreement component, at no fixed amount, so an agreement's collections are its only pay " +
    "(payroll.agreements-in-frappe-shape). `docstatus` moves only through machine `salary-structure`.",
  was: [`${FRAPPE_HR}/salary_structure/salary_structure.json`, `${FRAPPE_HR}/salary_detail/salary_detail.json`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    structure_id: S,
    name: S,
    is_active: Schema.Boolean,
    payroll_frequency: Null(Frequency),
    ...Token,
    earnings: Schema.Array(StructureRow),
    deductions: Schema.Array(StructureRow),
    employer_contributions: Schema.Array(StructureRow),
    origin: Schema.Literals(["capxul", "agreement", "head"]),
    amended_from: Null(S),
    docstatus: Schema.Literals(DOC_STATUSES),
    head_name: Null(S),
    /** The `seq` of its last change in `payroll-changes`: the version a head sync pushes and compares (payroll.head-sync). */
    version: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "structure_id"],
  indexes: [
    {
      name: "by_origin",
      fields: ["org_id", "origin", "docstatus"],
      for: "The Organization's agreement structure, found at each acceptance; and the submitted structures a list shows.",
    },
  ],
  retention: HR_RETAINED,
});

export const table_salary_structure_assignments = defineTable({
  id: "salary-structure-assignments",
  title: "Salary structure assignments: who is paid by which structure, from when",
  about:
    "One Salary Structure Assignment, written submitted: an Employee is paid by a structure from `from_date`, with " +
    "`base` and `variable` (the values formulas read) in its token; the latest submitted assignment on or before a " +
    "period's end is the one that period uses, as in Frappe. `payroll_payable_account` is books' account the net is owed " +
    "on until paid: its `payroll_payable` role account, null before the chart (payroll.books-accounts). `budget_ref` and `budget_id` are Capxul's (Custom Fields on a head): the department budget the pay " +
    "comes from, which decides who may pay it. `agreement_id` is set when the assignment mirrors an accepted agreement: " +
    "its `base` is the agreement's rate in its period, and no run ever pays it, because the agreement pays itself on " +
    "chain (payroll.agreements-in-frappe-shape). `docstatus` moves only through machine `salary-structure-assignment`.",
  was: [`${FRAPPE_HR}/salary_structure_assignment/salary_structure_assignment.json`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    assignment_id: S,
    employee_id: S,
    structure_id: S,
    from_date: S,
    base: S,
    variable: S,
    ...Token,
    payroll_payable_account: Null(S),
    budget_ref: S,
    budget_id: Null(S),
    agreement_id: Null(S),
    docstatus: Schema.Literals(DOC_STATUSES),
    head_name: Null(S),
    /** The `seq` of its last change in `payroll-changes`: the version a head sync pushes and compares (payroll.head-sync). */
    version: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "assignment_id"],
  indexes: [
    {
      name: "by_employee",
      fields: ["org_id", "employee_id", "docstatus", "from_date"],
      for: "An Employee's assignment for a period: the latest submitted one on or before its end.",
    },
    {
      name: "by_agreement",
      fields: ["org_id", "agreement_id", "from_date"],
      for: "The assignments that mirror one agreement: the one a rate change supersedes, and the run's check that it pays none of them.",
    },
  ],
  retention: HR_RETAINED,
});

export const table_payroll_entries = defineTable({
  id: "payroll-entries",
  title: "Payroll entries: one payroll run for a department and period",
  about:
    "One Payroll Entry: the run of a department's (`department`, a budget) pay for `start_date` to `end_date` at " +
    "`payroll_frequency`, posted on `posting_date`, in one token, owed on `payroll_payable_account` and paid from the " +
    "company Safe (`payment_account` is books' treasury account of that Safe and token); both are books' role accounts, " +
    "null before the chart (payroll.books-accounts). `employees` is Frappe's Payroll " +
    "Employee Detail rows: who the run covers, and whether each is withheld. `computed_by` says which side worked its " +
    "slips out: Capxul, or a connected head (payroll.one-computer-per-run). Once paying, `request_key` (`payroll:`, the " +
    "entry's id and the attempt) is the payment command its slips' nets go out under, with one approval " +
    "(payroll.run-one-approval); `attempt`, `request_key`, `command_id` and `approval_id` name the latest. A lapsed " +
    "command is resumed under its own key; only slips that hold no Payment (released, or refunded from escrow) go out " +
    "under the next attempt. Each slip keeps its own command, by which a Payment's transition finds it. `head_name` is " +
    "the head's Payroll Entry for a run taken in, unique, so a run is taken in once; for a run Capxul made, the head's name for its copy. `status` moves only through " +
    "machine `payroll-entry`.",
  was: [`${FRAPPE_HR}/payroll_entry/payroll_entry.json`, `${FRAPPE_HR}/payroll_employee_detail/payroll_employee_detail.json`, "packages/backend/src/payroll/tables.ts:167"],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    payroll_entry_id: S,
    posting_date: S,
    payroll_frequency: Frequency,
    start_date: S,
    end_date: S,
    department: S,
    budget_id: Null(S),
    ...Token,
    payroll_payable_account: Null(S),
    payment_account: Null(S),
    company_safe: S,
    employees: Schema.Array(Schema.Struct({ employee: S, employee_name: S, is_salary_withheld: Schema.Boolean })),
    number_of_employees: Schema.Int,
    computed_by: Schema.Literals(["capxul", "head"]),
    status: Schema.Literals(PAYROLL_ENTRY_STATUSES),
    attempt: Schema.Int,
    request_key: Null(S),
    command_id: Null(S),
    approval_id: Null(S),
    created_by: S,
    head_name: Null(S),
    /** The `seq` of its last change in `payroll-changes`: the version a head sync pushes and compares (payroll.head-sync). */
    version: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "payroll_entry_id"],
  indexes: [
    {
      name: "by_department_period",
      fields: ["org_id", "department", "start_date"],
      for: "A department's runs by period, newest first; and the check that no live run of it overlaps a new one's period.",
    },
    {
      name: "by_status",
      fields: ["org_id", "status", "posting_date"],
      for: "The runs a list shows by status: drafts to submit, submitted ones to pay, paying ones still waiting.",
    },
    {
      name: "by_head_name",
      fields: ["org_id", "head_name"],
      unique: true,
      for: "A head's Payroll Entry is taken in once: the head sync finds it by its head name, and a second run to pay can never be born for it.",
    },
  ],
  retention: HR_RETAINED,
});

export const table_salary_slips = defineTable({
  id: "salary-slips",
  title: "Salary slips: one person's pay for one period",
  about:
    "One Salary Slip in Frappe's shape: the Employee, the period (`start_date`, `end_date`, `posting_date`), " +
    "`total_working_days`, `payment_days` and `leave_without_pay`, the Salary Detail rows (`earnings`, `deductions`, " +
    "`employer_contributions`), `gross_pay`, `total_deduction` and `net_pay` (gross less deductions, never below zero), " +
    "in one token. `source` `run` is a slip of a Payroll Entry, computed by `computed_by`; `collection` is a landed " +
    "agreement collection, born paid, with no deductions (payroll.collection-slips). `document_id` and `document_hash` " +
    "are its payslip document, whose hash a run slip's Payment carries on chain; a collection slip names the agreement's " +
    "terms document, the hash its collection carried. From its pay it keeps its Payment: `payment_id` (as `payment " +
    "get` takes it), `command_id` and `attempt`, the run command it went out under, kept through a lapse so a retry " +
    "resumes that same Payment and cleared when an escrow refund cancels it; once paid, the settled facts " +
    "`chain_payment_id`, `tx_hash`, `block_number` and `paid_at`, the block's time. `net_pay_raw` is the net in the " +
    "token's raw units, the amount the chain moves. `status` moves only through machine `salary-slip`.",
  was: [`${FRAPPE_HR}/salary_slip/salary_slip.json`, `${FRAPPE_HR}/salary_detail/salary_detail.json`, "packages/backend/src/payroll/tables.ts:167"],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  scope:
    "org_id is the paying Organization. The employee reads their own slips, from every Organization that pays them, " +
    "through by_payee_safe (payroll.payee-reads).",
  admits: [
    {
      match: "safe",
      field: "payee_safe",
      reads: true,
      writes: false,
      about:
        "The employee reads the slips that pay their Safe (`by_payee_safe`); only payroll's rpcs and processes write " +
        "them (payroll.payee-reads, payroll.slip-machine).",
    },
  ],
  fields: Schema.Struct({
    org_id: S,
    salary_slip_id: S,
    employee_id: S,
    employee_name: S,
    payee_safe: S,
    payroll_entry_id: Null(S),
    structure_id: S,
    assignment_id: S,
    source: Schema.Literals(["run", "collection"]),
    computed_by: Schema.Literals(["capxul", "head", "chain"]),
    agreement_id: Null(S),
    write_id: Null(S),
    posting_date: S,
    start_date: S,
    end_date: S,
    payroll_frequency: Null(Frequency),
    total_working_days: N,
    payment_days: N,
    leave_without_pay: N,
    earnings: Schema.Array(SlipRow),
    deductions: Schema.Array(SlipRow),
    employer_contributions: Schema.Array(SlipRow),
    gross_pay: S,
    total_deduction: S,
    net_pay: S,
    ...Token,
    net_pay_raw: S,
    document_id: Null(S),
    document_hash: Null(S),
    status: Schema.Literals(SALARY_SLIP_STATUSES),
    withholding_reason: Null(S),
    payment_id: Null(S),
    command_id: Null(S),
    attempt: Null(Schema.Int),
    chain_payment_id: Null(S),
    tx_hash: Null(S),
    block_number: Null(Schema.Int),
    paid_at: Null(N),
    head_name: Null(S),
    /** The `seq` of its last change in `payroll-changes`: the version a head sync pushes and compares (payroll.head-sync). */
    version: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "salary_slip_id"],
  indexes: [
    {
      name: "by_entry",
      fields: ["org_id", "payroll_entry_id", "employee_id"],
      for: "A run's slips, in employee order: what it shows, submits, pays and settles.",
    },
    {
      name: "by_employee_period",
      fields: ["org_id", "employee_id", "start_date"],
      for: "An Employee's slips by period; and Frappe's check that no live slip of theirs overlaps a new one's period.",
    },
    {
      name: "by_payee_safe",
      fields: ["payee_safe", "start_date"],
      crossTenant: true,
      for: "The slips that pay one Safe, from every Organization, newest first: the employee's own payslips.",
    },
    {
      name: "by_write",
      fields: ["org_id", "write_id"],
      unique: true,
      for: "A landed collection makes exactly one slip: its write's id.",
    },
    {
      name: "by_chain_payment",
      fields: ["chain_payment_id"],
      unique: true,
      crossTenant: true,
      for: "A settled Payment, by its v4 payment id, to the one slip it paid.",
    },
    {
      name: "by_command",
      fields: ["command_id", "payment_id"],
      crossTenant: true,
      for:
        "A Payment's transition, which names its command and its payment id, to the slip it pays and so to its run's " +
        "process; a run may have several commands (a resumed one, a released or refunded slip's), and each slip keeps its own.",
    },
  ],
  retention: HR_RETAINED,
});

// ── Payroll Settings, the change log and the head sync ──────────────────────────────────────
//
// A connected head is synced by payroll itself, as every concept that holds a fundamental app's records
// syncs them (integration frappe-head, organizations.head-ownership, organizations.head-doorbell): Capxul
// pushes its changes in order and pulls the head's, and the head only rings. The pattern is contacts' and
// projects' (payroll.head-sync).

export const table_payroll_settings = defineTable({
  id: "payroll-settings",
  title: "Payroll Settings: an Organization's payroll settings and its change counter",
  about:
    "Frappe HR's Payroll Settings, one row per Organization, born by payroll's start-up at the setup's begin " +
    "(payroll.startup.open); a payroll write that finds none (the start-up not yet run) births it. Its " +
    "values are the same for every Organization, because they are what Capxul computes by and what a head must match: " +
    "`payroll_based_on` leave, `include_holidays_in_total_working_days` on, `disable_rounded_total` on and " +
    "`email_salary_slip_to_employee` off (notices sends mail). `last_seq` is the counter of `payroll-changes`: a payroll " +
    "write takes the next number under this row's lock, so the log has no gap (payroll.startup, payroll.head-sync).",
  was: [`${FRAPPE_HR}/payroll_settings/payroll_settings.json`],
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    payroll_based_on: Schema.Literal("leave"),
    include_holidays_in_total_working_days: Schema.Literal(true),
    disable_rounded_total: Schema.Literal(true),
    email_salary_slip_to_employee: Schema.Literal(false),
    last_seq: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id"],
  indexes: [],
  retention: HR_RETAINED,
});

export const table_payroll_changes = defineTable({
  id: "payroll-changes",
  title: "Payroll change log: every write to a Frappe-shaped record, in commit order",
  about:
    "One row per change to an Employee, Salary Component, Salary Structure, Salary Structure Assignment, Payroll Entry " +
    "or Salary Slip, appended in the writing transaction with the next `seq` from `payroll-settings` under its lock, so " +
    "a later `seq` never commits before an earlier one and a reader paging by `seq` skips nothing. The changed row keeps " +
    "that `seq` as its `version`. A connected head's sync pushes from it in order (a draft run is not pushed); a change " +
    "that came from the head notes it (`origin` head), so the push only confirms its version there. It holds ids, not " +
    "content: the push reads each record as it stands (payroll.head-sync).",
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    seq: N,
    doctype: Schema.Literals(["Employee", "Salary Component", "Salary Structure", "Salary Structure Assignment", "Payroll Entry", "Salary Slip"]),
    doc_id: S,
    origin: Schema.Literals(["capxul", "head"]),
    /** The principal whose command made it, the agreement's process, or the head user (by mailbox) whose edit was applied. */
    by: S,
    at: N,
  }),
  key: ["org_id", "seq"],
  indexes: [],
  retention: "Kept for good: it is the order every head of the Organization replays.",
});

export const table_payroll_head_syncs = defineTable({
  id: "payroll-head-syncs",
  title: "Payroll's sync with one head",
  about:
    "One row per head connection payroll syncs with: how far it has pushed the change log (`pushed_seq`), how far it has " +
    "read the head's own changes (`pulled_change`), when each last ran, and the conflicts and refusals it pushed back " +
    "(a head edit based on an older version, or one payroll's checks refuse). Its process (`payroll.head.sync`) is the " +
    "only writer.",
  concept: concept_payroll,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    head_id: S,
    pushed_seq: N,
    pulled_change: Null(S),
    pushed_at: Null(N),
    pulled_at: Null(N),
    conflicts: N,
    refused: N,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "head_id"],
  indexes: [],
  retention: HR_RETAINED,
});

// ── employee ────────────────────────────────────────────────────────────────────────────────

export const event_employee_transitioned = defineEvent({
  id: "employee_transitioned",
  about: "An Employee was hired, suspended, made inactive, reinstated or left. `occurred_at` is the backend's now, or the block's time when an agreement's acceptance or end moved it.",
  props: Schema.Struct({
    from: Null(Schema.Literals(EMPLOYEE_STATUSES)),
    to: Schema.Literals(EMPLOYEE_STATUSES),
    transition: S,
    employee_id: S,
    org_id: S,
    party_id: S,
    occurred_at: N,
  }),
  was: [FRAPPE_EMPLOYEE],
});

export const machine_employee = defineMachine({
  id: "employee",
  title: "Employee status",
  about:
    "Frappe's four Employee statuses. An Employee is hired `active`; a People hat wearer suspends, deactivates, " +
    "reinstates or lets them go; leaving sets `relieving_date`, after which no run pays them. An agreement's " +
    "acceptance hires its payee when they are not a live Employee, and its end lets them go when nothing else pays them. " +
    "`left` is final for the record: a person who comes back is hired as a new Employee (payroll.one-live-employee).",
  table: table_employees,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "Employed: runs pay them, from `date_of_joining`." },
    { id: "inactive", about: "Kept on the books but not paid by runs." },
    { id: "suspended", about: "Not paid by runs while suspended." },
    { id: "left", about: "Gone from `relieving_date`; their slips and agreements' earned pay stay theirs.", terminal: true },
  ],
  transitions: {
    hire: {
      from: [],
      to: "active",
      about: "Born by payroll.employees.add, or by an agreement's acceptance.",
      guard: "The person has no live (not left) Employee in the Organization.",
      emits: [event_employee_transitioned],
    },
    suspend: { from: ["active"], to: "suspended", emits: [event_employee_transitioned] },
    deactivate: { from: ["active", "suspended"], to: "inactive", emits: [event_employee_transitioned] },
    reinstate: { from: ["inactive", "suspended"], to: "active", emits: [event_employee_transitioned] },
    leave: {
      from: ["active", "inactive", "suspended"],
      to: "left",
      about: "A People hat wearer sets the last day, or the only agreement that paid them ended.",
      guard: "No slip of theirs is paying or escrowed; a withheld slip stays withheld, to be released and paid after they leave, as Frappe HR does.",
      emits: [event_employee_transitioned],
    },
  },
});

// ── salary structure and its assignment ─────────────────────────────────────────────────────

export const event_salary_structure_transitioned = defineEvent({
  id: "salary_structure_transitioned",
  about: "A Salary Structure was submitted or cancelled.",
  props: Schema.Struct({
    from: Null(Schema.Literals(DOC_STATUSES)),
    to: Schema.Literals(DOC_STATUSES),
    transition: S,
    structure_id: S,
    org_id: S,
    origin: Schema.Literals(["capxul", "agreement", "head"]),
  }),
  was: [`${FRAPPE_HR}/salary_structure/salary_structure.json`],
});

export const machine_salary_structure = defineMachine({
  id: "salary-structure",
  title: "Salary structure docstatus",
  about: "Frappe's docstatus for a structure Capxul writes submitted: it is cancelled only when no submitted assignment uses it.",
  table: table_salary_structures,
  field: "docstatus",
  initial: "submitted",
  states: [
    { id: "submitted", about: "In force: assignments may name it." },
    { id: "cancelled", about: "Replaced or withdrawn; slips already made with it keep it.", terminal: true },
  ],
  transitions: {
    submit: { from: [], to: "submitted", about: "Born by payroll.structures.create, or as the agreement structure at a first acceptance.", emits: [event_salary_structure_transitioned] },
    cancel: { from: ["submitted"], to: "cancelled", guard: "No submitted assignment names it.", emits: [event_salary_structure_transitioned] },
  },
});

export const event_salary_structure_assignment_transitioned = defineEvent({
  id: "salary_structure_assignment_transitioned",
  about: "A Salary Structure Assignment was submitted or cancelled.",
  props: Schema.Struct({
    from: Null(Schema.Literals(DOC_STATUSES)),
    to: Schema.Literals(DOC_STATUSES),
    transition: S,
    assignment_id: S,
    employee_id: S,
    org_id: S,
    agreement_id: Null(S),
  }),
  was: [`${FRAPPE_HR}/salary_structure_assignment/salary_structure_assignment.json`],
});

export const machine_salary_structure_assignment = defineMachine({
  id: "salary-structure-assignment",
  title: "Salary structure assignment docstatus",
  about: "Frappe's docstatus for an assignment Capxul writes submitted. A later assignment supersedes it by date; cancelling it is for a mistake.",
  table: table_salary_structure_assignments,
  field: "docstatus",
  initial: "submitted",
  states: [
    { id: "submitted", about: "In force from its `from_date` until a later one." },
    { id: "cancelled", about: "Withdrawn; no run uses it.", terminal: true },
  ],
  transitions: {
    submit: { from: [], to: "submitted", about: "Born by payroll.structures.assign, or for an agreement's acceptance or landed rate change.", emits: [event_salary_structure_assignment_transitioned] },
    cancel: { from: ["submitted"], to: "cancelled", guard: "No slip that is not cancelled names it, and it mirrors no agreement.", emits: [event_salary_structure_assignment_transitioned] },
  },
});

// ── payroll entry ───────────────────────────────────────────────────────────────────────────

export const event_payroll_entry_transitioned = defineEvent({
  id: "payroll_entry_transitioned",
  about: "A payroll run was drafted, imported, submitted, sent to be paid, lapsed, paid, reopened or cancelled.",
  props: Schema.Struct({
    from: Null(Schema.Literals(PAYROLL_ENTRY_STATUSES)),
    to: Schema.Literals(PAYROLL_ENTRY_STATUSES),
    transition: S,
    payroll_entry_id: S,
    org_id: S,
    department: S,
    computed_by: Schema.Literals(["capxul", "head"]),
    number_of_employees: Schema.Int,
  }),
  was: [`${FRAPPE_HR}/payroll_entry/payroll_entry.py:104`],
});

export const machine_payroll_entry = defineMachine({
  id: "payroll-entry",
  title: "Payroll entry status",
  about:
    "A run is drafted with its slips worked out, submitted (its slips are then fixed and their payslips stored), sent " +
    "to be paid as one payment command, and paid once every slip that is not withheld is paid. Frappe's Queued and " +
    "Failed are its background jobs' states, which a run Capxul computes in one transaction never has. Paying, its " +
    "lapse, settling and reopening wait on payments (payroll.pays-through-payments).",
  table: table_payroll_entries,
  field: "status",
  initial: "draft",
  states: [
    { id: "draft", about: "Its slips are worked out and may be redone; nothing is owed yet." },
    { id: "submitted", about: "Its slips are fixed and owed on Payroll Payable; nothing is paid." },
    { id: "paying", about: "Its nets went out as one payment command; some slip is still paying or escrowed." },
    { id: "paid", about: "Every slip that is not withheld is paid." },
    { id: "cancelled", about: "Cancelled before anything was paid; its slips with it.", terminal: true },
  ],
  transitions: {
    create: { from: [], to: "draft", about: "Born by payroll.runs.create with its computed slips.", emits: [event_payroll_entry_transitioned] },
    import: { from: [], to: "submitted", about: "A run a connected head computed and submitted, taken in by payroll's head sync (payroll.head.sync).", emits: [event_payroll_entry_transitioned] },
    submit: { from: ["draft"], to: "submitted", emits: [event_payroll_entry_transitioned] },
    cancel: {
      from: ["draft", "submitted"],
      to: "cancelled",
      guard: "No slip of it holds a Payment (paying, escrowed, paid, or lapsed and still retryable), and Capxul computed it or its head cancelled it.",
      emits: [event_payroll_entry_transitioned],
    },
    pay: {
      from: ["submitted"],
      to: "paying",
      about: "Its payment command is born, or its lapsed command resumed under the same key, with one approval for every slip's net.",
      emits: [event_payroll_entry_transitioned],
    },
    lapse: {
      from: ["paying"],
      to: "submitted",
      about: "The command's approval lapsed before anything was sent; `runs.pay` resumes that command, same key and payment ids.",
      guard: "No slip of it is paid or escrowed: a later command's lapse returns only its own slips and leaves the run paying.",
      emits: [event_payroll_entry_transitioned],
    },
    settle: { from: ["paying"], to: "paid", guard: "Every slip that is not withheld is paid.", emits: [event_payroll_entry_transitioned] },
    reopen: {
      from: ["paid"],
      to: "paying",
      about: "A reorg took a slip's payment back, or a released slip is paid under the next attempt.",
      emits: [event_payroll_entry_transitioned],
    },
  },
});

// ── salary slip ─────────────────────────────────────────────────────────────────────────────

export const event_salary_slip_transitioned = defineEvent({
  id: "salary_slip_transitioned",
  about:
    "A Salary Slip was computed, imported, submitted, withheld, released, sent, escrowed, paid, lapsed, refunded, " +
    "reversed or cancelled, or a collection's slip was recorded. `occurred_at` is the block's time when the chain moved it.",
  props: Schema.Struct({
    from: Null(Schema.Literals(SALARY_SLIP_STATUSES)),
    to: Schema.Literals(SALARY_SLIP_STATUSES),
    transition: S,
    salary_slip_id: S,
    org_id: S,
    employee_id: S,
    payroll_entry_id: Null(S),
    source: Schema.Literals(["run", "collection"]),
    occurred_at: N,
  }),
  was: [`${FRAPPE_HR}/salary_slip/salary_slip.py:355`],
});

export const machine_salary_slip = defineMachine({
  id: "salary-slip",
  title: "Salary slip status",
  about:
    "Frappe's Draft, Submitted, Withheld and Cancelled, and Capxul's paying, escrowed and paid, which a head reads as " +
    "Submitted with `capxul_status`. A run slip is paid only from payments' settlement of its Payment: paying, escrowed " +
    "(the net waits in a claim escrow for a new hire with no account, aaron.budget-pay-unclaimed), paid, and back when " +
    "an approval lapses, an escrow is refunded or a reorg takes the payment back. A collection's slip is born paid from " +
    "its landed write (payroll.slip-machine).",
  table: table_salary_slips,
  field: "status",
  initial: "draft",
  states: [
    { id: "draft", about: "Worked out with its run; may be redone." },
    { id: "submitted", about: "Fixed and owed; its payslip is stored." },
    { id: "withheld", about: "Held back from its run's payment (Frappe's Salary Withholding)." },
    { id: "paying", about: "Its net is a Payment of its run's command, on its way." },
    { id: "escrowed", about: "Its net waits in a claim escrow until the employee claims their account." },
    { id: "paid", about: "Its Payment settled to the employee: the settled facts are on the slip." },
    { id: "cancelled", about: "Cancelled with its run, before anything was paid.", terminal: true },
  ],
  transitions: {
    compute: { from: [], to: "draft", about: "Born by payroll.runs.create.", emits: [event_salary_slip_transitioned] },
    import: { from: [], to: "submitted", about: "A head's submitted slip, taken in with its run by payroll.head.sync.", emits: [event_salary_slip_transitioned] },
    import_withheld: {
      from: [],
      to: "withheld",
      about: "A head's slip its Salary Withholding holds back (Frappe's Withheld), taken in withheld by payroll.head.sync, so it is never paid with the run.",
      emits: [event_salary_slip_transitioned],
    },
    record_collection: {
      from: [],
      to: "paid",
      about: "A landed agreement collection, by the agreement's process, with the write's payment id, transaction and block time.",
      emits: [event_salary_slip_transitioned],
    },
    submit: { from: ["draft"], to: "submitted", emits: [event_salary_slip_transitioned] },
    withhold: {
      from: ["submitted"],
      to: "withheld",
      guard: "It holds no lapsed Payment, which could still be retried.",
      emits: [event_salary_slip_transitioned],
    },
    release: { from: ["withheld"], to: "submitted", emits: [event_salary_slip_transitioned] },
    cancel: { from: ["draft", "submitted", "withheld"], to: "cancelled", about: "With its run.", emits: [event_salary_slip_transitioned] },
    pay: {
      from: ["submitted"],
      to: "paying",
      about: "Its net is one item of a run command: a new one under the next attempt, or its own lapsed command resumed with the same payment id.",
      emits: [event_salary_slip_transitioned],
    },
    escrow: { from: ["paying"], to: "escrowed", about: "Its Payment went into a claim escrow from the budget.", emits: [event_salary_slip_transitioned] },
    settle: { from: ["paying", "escrowed"], to: "paid", about: "Its Payment settled to the employee, at the block's time.", emits: [event_salary_slip_transitioned] },
    lapse: {
      from: ["paying"],
      to: "submitted",
      about: "Its command's approval lapsed unsent: it keeps its payment id and command, so only that command's resume pays it.",
      emits: [event_salary_slip_transitioned],
    },
    refund: {
      from: ["escrowed"],
      to: "submitted",
      about: "The budget's holder or the Board took the escrow back (payments cancels the Payment, outcome refunded); its payment fields clear and the net is owed again.",
      emits: [event_salary_slip_transitioned],
    },
    reverse: { from: ["paid"], to: "paying", about: "A reorg below finality reopened its Payment; it settles again as the next generation.", emits: [event_salary_slip_transitioned] },
  },
});

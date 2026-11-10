// Books' tables, the state machines that live on them, and each machine's one event (P7). The
// books are in the shape of ERPNext's accounting (aaron.books-first-principles): each table is one
// ERPNext doctype, with Frappe's own field names wherever the content is the same, so an
// Organization's books are complete without a head and sync one to one with an ERPNext head when
// one is connected (books.frappe-shape). The old tables these replace are in each record's `was`.
//
// Nine tables, all an Organization's except annotations (a person's or an Organization's) and
// prices (the system's):
// - book-companies     the accounting half of the Organization's ERPNext Company: chart template,
//                      currency, time zone, fiscal year, default cost centre, closed periods, and
//                      the counter of its gap-free feed (books.feed)
// - book-accounts      Account: the chart as Frappe's tree, archived, never deleted
// - book-cost-centers  Cost Center: the tree every profit-and-loss line names one of
// - book-annotations   the other side of a money row's voucher: account, party, cost centre,
//                      project, the documents it pays, a memo (books.annotations-one-table)
// - book-facts         the append-only facts, numbered without a gap per Organization; a money
//                      fact posts one Journal Entry or Payment Entry (books.vouchers)
// - book-document-vouchers the GL Entries of vouchers whose author gives their lines: a connected
//                      head's own (invoices, accruals, closings) and a payroll run's accrual
//                      (books.payroll-accrual); Capxul's money vouchers are derived from facts and
//                      never stored
// - book-head-syncs    where the books' sync with one connected head has got to (books.sync)
// - book-assets        the ERC-20s an Organization added, with the scan's next block
// - book-prices        USD rates by pair, from the Chainlink sync
//
// Births are transitions with no source state (`from: []`), so a born row sends its machine's
// event like any other change (books.births-are-transitions). Facts have no machine: they never
// change (books.machines; invariant books.facts-append-only at the end of this file).

import { Schema } from "effect";
import { defineEvent, defineInvariant, defineMachine, defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_books } from "../shared/foundation.ts";

const OLD = "packages/backend/src";
const BK = `${OLD}/books`;
const T = `${BK}/tables.ts`;
const MODEL = "packages/protocol/src/books/model.ts";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const NullOr = Schema.NullOr;

/** Capxul's six report sections (`BOOK_ACCOUNT_TYPES`): a code's first digit follows the type (1 asset … 6 expense). */
export const AccountType = Schema.Literals(["asset", "liability", "equity", "income", "cost_of_services", "expense"]);
/** Account.root_type: the five roots of Frappe's tree. cost_of_services and expense are both under Expenses. */
export const RootType = Schema.Literals(["Asset", "Liability", "Equity", "Income", "Expense"]);
/** Account.account_type, the values Capxul's chart uses (Frappe's list is longer; a head adds through Capxul). */
export const FrappeAccountType = Schema.Literals([
  "Bank",
  "Cash",
  "Receivable",
  "Payable",
  "Equity",
  "Tax",
  "Chargeable",
  "Round Off",
  "Fixed Asset",
  "Accumulated Depreciation",
  "Depreciation",
  "Current Asset",
  "Current Liability",
  "Income Account",
  "Direct Income",
  "Direct Expense",
  "Indirect Expense",
  "Expense Account",
]);
/** Why Capxul protects an account, and which Company default it fills (books.chart-tree). */
export const AccountRole = Schema.Literals([
  "type_group",
  "safe",
  "uncategorized_income",
  "uncategorized_expense",
  "opening",
  "receivable",
  "payable",
  "payroll_payable",
  "salaries",
  "bank_charges",
  "exchange_gain_loss",
]);
/** Frappe's Party Type: the role a Party of the directory plays on a receivable or payable line. */
export const PartyType = Schema.Literals(["Customer", "Supplier", "Employee", "Shareholder"]);
/**
 * One line of a payroll accrual as payroll gives it, in the run's token (books.payroll-lines): what Frappe HR's
 * `make_accrual_jv_entry` posts, before books fixes its account and its value in the Company's currency.
 */
export const PayrollLine = Schema.Struct({
  /**
   * The Salary Component Account's account, or the run's payable, by books' account id: an earning's or employer
   * contribution's `account` (its expense), a deduction's `account` or an employer contribution's `liability_account`
   * (its liability), the run's Payroll Payable; null for its role's (books.payroll-defaults).
   */
  account_id: NullOr(S),
  /**
   * What the line is, so a missing or unfit account falls back: `expense` to `salaries` (5000), or for an expense
   * claim's line to books' default expense account; `advance` to Employee Advances (Frappe's
   * default_employee_advance_account, a receivable); the others to Payroll Payable.
   */
  role: Schema.Literals(["expense", "liability", "payable", "advance"]),
  party_type: NullOr(PartyType),
  party_id: NullOr(S),
  cost_center_id: NullOr(S),
  project: NullOr(S),
  /**
   * A net's payable line names its Payroll Entry, as Frappe HR's does; an expense claim's payable line names the Expense
   * Claim, and an advance line (a claim's advance taken, a run's advance recovery) the Employee Advance; every other
   * line names none.
   */
  reference: NullOr(
    Schema.Struct({ reference_doctype: Schema.Literals(["Payroll Entry", "Expense Claim", "Employee Advance"]), reference_name: S }),
  ),
  /** In the run's token, at its display precision, as the slip's rows are. */
  debit: S,
  credit: S,
});
/** The documents a Capxul voucher may pay or be paid for: what Payment Entry Reference and Journal Entry Account allow. */
export const ReferenceDoctype = Schema.Literals([
  "Sales Invoice",
  "Purchase Invoice",
  "Journal Entry",
  "Expense Claim",
  "Employee Advance",
  "Payroll Entry",
  "Sales Order",
  "Purchase Order",
]);
/**
 * One allocation of a voucher to a document (Payment Entry Reference, or a Journal Entry Account's reference):
 * `allocated_amount` in the Company's currency, as Frappe's, or null for the whole of what is left (books.vouchers).
 */
export const DocumentRef = Schema.Struct({ reference_doctype: ReferenceDoctype, reference_name: S, allocated_amount: NullOr(S) });
/** One activity row: a Payment or a Movement (payments' ids, or a scanned Transfer's chain id). */
export const ReferenceKind = Schema.Literals(["payment", "movement"]);
export const Reference = Schema.Struct({ kind: ReferenceKind, id: S });
/** Every fact kind: the chart's changes, a cost centre, a row's account, a payroll run's accrual, and money (the last seven). */
export const FactKind = Schema.Literals([
  "account_created",
  "account_renamed",
  "account_archived",
  "cost_center_created",
  "account_assigned",
  "recategorized",
  "rows_reclassified",
  "accrual_posted",
  "accrual_cancelled",
  "payment_settled",
  "payment_received",
  "deposit_received",
  "payment_sent_outside",
  "payout_returned",
  "opening_balance",
  "reversed",
]);
/** What a money fact came from: the record `--source` lists by. */
export const SourceKind = Schema.Literals(["payment", "deposit", "payout", "movement", "agreement", "asset", "payroll_run"]);

/** One GL Entry line as ERPNext stores it, accounts and cost centres by Capxul's ids; `debit` and `credit` in the Company's currency, as decimal strings. */
export const GlLine = Schema.Struct({
  posting_date: S,
  account_id: S,
  party_type: NullOr(PartyType),
  party_id: NullOr(S),
  cost_center_id: NullOr(S),
  project: NullOr(S),
  debit: S,
  credit: S,
  account_currency: S,
  debit_in_account_currency: S,
  credit_in_account_currency: S,
  against_voucher_type: NullOr(S),
  against_voucher: NullOr(S),
  is_opening: Schema.Literals(["No", "Yes"]),
  is_cancelled: Schema.Boolean,
});

const KEPT = "Kept for the Organization's life: books keep their history.";

// ── book companies ──────────────────────────────────────────────────────────────────────────

export const table_book_companies = defineTable({
  id: "book-companies",
  title: "Book companies: the accounting half of the Organization's ERPNext Company",
  about:
    "One row per Organization whose books have begun, born by the first fact (its first money, a token added, or the " +
    "chart's import). It holds what ERPNext keeps on the Company for accounting, as the books were charted: " +
    "`chart_of_accounts` (the template, null until `org books accounts import`), and the Organization's " +
    "`default_currency`, `time_zone` and `fiscal_year_start` (organizations.company-shape), copied at the import and " +
    "fixed from then on, so no posted voucher's date, year or currency ever moves (books.company-settings). It holds the " +
    "default `cost_center_id` (Main) and `closed_through`, the latest `period_end_date` of the head's submitted Period " +
    "Closing Vouchers, as ERPNext's own check reads it: nothing changes on or before it, and cancelling the latest " +
    "closing moves it back to the one before (books.closed-periods). The Company's default accounts are the chart's accounts by role " +
    "(books.chart-tree). `last_seq` is the feed's counter: every fact writer takes this row's lock and the next number, " +
    "so facts commit in the order they are numbered (books.feed). `status` says whether the chart exists. Organizations " +
    "owns the Company's name, abbreviation and country.",
  was: [`${T}:20`, `${BK}/accounts/writes/chart.ts:32`, "docs/as-is/archive/books/data.ts"],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    status: Schema.Literals(["recording", "charted"]),
    chart_of_accounts: NullOr(Schema.Literal("us-services")),
    default_currency: NullOr(S),
    time_zone: NullOr(S),
    fiscal_year_start: NullOr(S),
    cost_center_id: NullOr(S),
    closed_through: NullOr(S),
    last_seq: Int,
    created_by: S,
    created_at: N,
    charted_at: NullOr(N),
    updated_at: N,
  }),
  key: ["org_id"],
  indexes: [],
  retention: KEPT,
});

export const event_book_company_transitioned = defineEvent({
  id: "book_company_transitioned",
  about: "An Organization's books began (`open`) or got their chart (`import`). Replaces books_chart_imported.",
  props: Schema.Struct({ from: NullOr(S), to: S, transition: S, org_id: S, template: NullOr(S), accounts: N }),
  was: [`${BK}/accounts/operations/emit-chart-imported.ts:1`],
});

export const machine_book_company = defineMachine({
  id: "book-company",
  title: "Book company: recording, then charted",
  about:
    "The books begin recording facts at the Organization's first money, with or without a chart; the import gives them " +
    "their chart once, and from then on every priced money fact posts a voucher. Nothing takes the chart away.",
  was: [`${T}:27`, "docs/as-is/archive/books/data.ts"],
  table: table_book_companies,
  field: "status",
  initial: "recording",
  states: [
    { id: "recording", about: "Facts are kept and numbered; with no chart there are no accounts, so no voucher posts yet." },
    { id: "charted", about: "The chart exists: accounts can be added, rows given accounts, vouchers posted and reports read." },
  ],
  transitions: {
    open: {
      from: [],
      to: "recording",
      about: "The first fact writer of an Organization with no row births it, in the same transaction as the fact.",
      emits: [event_book_company_transitioned],
    },
    import: {
      from: ["recording"],
      to: "charted",
      about: "`org books accounts import` makes the chart, the cost centres and the Company's defaults.",
      guard: "The books have no chart; the caller wears the Books hat.",
      emits: [event_book_company_transitioned],
    },
  },
});

// ── book accounts ───────────────────────────────────────────────────────────────────────────

export const table_book_accounts = defineTable({
  id: "book-accounts",
  title: "Book accounts: the chart as ERPNext's Account tree",
  about:
    "One Account of the chart, by a durable `acct_<ulid>` id every annotation, fact and voucher line points to (a head's " +
    "Account carries it as the Custom Field `capxul_id`, so a rename never breaks a link). Frappe's tree: five " +
    "roots by `root_type` and two groups under Expenses (cost of services, operating expenses) make Capxul's six types; " +
    "they are the `type_group` accounts and have no number. Every other account sits under its type's group or under a " +
    "group account. Only a ledger account (`is_group` false) takes postings; an account becomes a group when its first " +
    "sub-account is added, which needs it to hold no postings, no role and no Frappe account type, as ERPNext refuses " +
    "to make a group of any of those (books.chart-tree). `account_number` is the code: unique " +
    "among active accounts, its first digit follows `type`, and a sub-account takes its parent's type. `account_type` is " +
    "Frappe's (Bank for a Safe account, Receivable, Payable); `account_currency` is the Company's, or the asset's symbol for a " +
    "Safe account. `role` marks the accounts Capxul protects and finds by role, never by code, and fills the Company's " +
    "defaults: `safe` (one per company Safe and asset), `uncategorized_income` (4999) and `uncategorized_expense` (6999), " +
    "the review queue, `opening` (3990), `receivable`, `payable`, `payroll_payable` (2200), `salaries` (5000, where a " +
    "payroll expense with no account of its own posts: books.payroll-defaults), `bank_charges`, `exchange_gain_loss`. " +
    "An archive keeps the row and frees the code.",
  was: [`${T}:35`, `${BK}/writes.ts:91`, `${BK}/accounts/writes/chart.ts:99`, `${MODEL}:49`],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    account_id: S,
    account_number: NullOr(S),
    account_name: S,
    type: AccountType,
    root_type: RootType,
    account_type: NullOr(FrappeAccountType),
    is_group: Schema.Boolean,
    parent_account_id: NullOr(S),
    account_currency: S,
    quickbooks_detail_type: NullOr(S),
    status: Schema.Literals(["active", "archived"]),
    role: NullOr(AccountRole),
    safe_address: NullOr(S),
    asset_id: NullOr(S),
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "account_id"],
  indexes: [
    {
      name: "by_org_code",
      fields: ["org_id", "account_number"],
      unique: true,
      for: "The chart in code order (list, reports, export, next free code) and an account by its code; partial on status = active, so an archived code is free again.",
    },
    {
      name: "by_org_role",
      fields: ["org_id", "role", "asset_id"],
      for: "A protected account by its role: a type's group, the not-decided account of a direction, 3990, a Company default, the Safe account of an asset.",
    },
    {
      name: "by_org_parent",
      fields: ["org_id", "parent_account_id"],
      for: "A group's children: the tree, the next code in a parent's ten, an archive refused while active sub-accounts remain.",
    },
  ],
  retention: "Kept for the Organization's life: an account is archived, never deleted.",
});

export const event_book_account_transitioned = defineEvent({
  id: "book_account_transitioned",
  about:
    "An account was added (by an add, an import, an inline account, an accepted suggestion or the first money of a new " +
    "asset), renamed or archived. Replaces books_account_added, books_account_renamed, books_account_archived and " +
    "books_suggestion_accepted. It never carries an account's name.",
  props: Schema.Struct({ from: NullOr(S), to: S, transition: S, org_id: S, account_id: S, code: NullOr(S), type: S }),
  was: [`${BK}/accounts/events.ts:1`],
});

export const machine_book_account = defineMachine({
  id: "book-account",
  title: "Book account",
  about:
    "An account is born active, may be renamed while active, and is archived for good (Frappe's `disabled`); nothing " +
    "brings it back. Becoming a group when its first sub-account arrives is not a state: `is_group` changes in the add.",
  was: [`${T}:43`, `${BK}/accounts/writes/chart.ts:128`, "docs/as-is/archive/books/data.ts"],
  table: table_book_accounts,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "A ledger account takes new rows; its code is held against the chart's other active accounts." },
    { id: "archived", about: "Takes no new rows; history, reports and exports keep it; its code is free again.", terminal: true },
  ],
  transitions: {
    add: {
      from: [],
      to: "active",
      about: "Born by an import, an add, an inline account, an accepted suggestion, or the first money of an asset with no Safe account.",
      guard:
        "A free code that fits the type; a parent is active, gives its type, and is a group, or a ledger account with no " +
        "postings, no role and no Frappe account type (only those ERPNext lets become a group).",
      emits: [event_book_account_transitioned],
    },
    rename: {
      from: ["active"],
      to: "active",
      about: "A new name, a new code, or both; a call that changes neither is not a transition.",
      guard: "A new code is free among active accounts and fits the type.",
      emits: [event_book_account_transitioned],
    },
    archive: {
      from: ["active"],
      to: "archived",
      guard: "The account has no role and no active sub-account.",
      emits: [event_book_account_transitioned],
    },
  },
});

// ── book cost centres ───────────────────────────────────────────────────────────────────────

// ── book annotations ────────────────────────────────────────────────────────────────────────

export const table_book_annotations = defineTable({
  id: "book-annotations",
  title: "Book annotations: the other side of a money row's voucher",
  about:
    "The one annotation an owner (a person, or an Organization) keeps on one Payment or Movement row. For an " +
    "Organization it is the meaning ERPNext gives a payment: the account its voucher posts against (an `acct_` id of a " +
    "ledger account, or `personal_<code>` from the fixed personal chart for a person), the party (`party_type` and the " +
    "directory's `party_id`, required for a receivable or payable account), the cost centre and project of its " +
    "profit-and-loss line (`project`: one of the Organization's projects, by projects' id: books.annotation-project), " +
    "and the documents it pays (`references`: a head's invoice, expense claim or payroll entry, with the amount " +
    "allocated), beside a suggested account name and a memo. A save replaces it whole, last write wins. " +
    "`status` says whether the row waits in the review queue. A row nobody annotated has no row here and posts to its " +
    "direction's not-decided account at Main, unless a payroll collection's accrual names it; one naming a Payroll Entry " +
    "and no account (given before the chart) posts on Payroll Payable (books.payroll-postings). Money never comes from " +
    "here: a voucher reads it (books.account-at-posting).",
  was: [`${OLD}/activity/tables.ts:8`, `${T}:56`, `${BK}/writes.ts:155`],
  concept: concept_books,
  tenancy: "owner",
  tenantField: "owner_kind",
  fields: Schema.Struct({
    owner_kind: Schema.Literals(["person", "organization"]),
    owner_id: S,
    reference_kind: ReferenceKind,
    reference_id: S,
    account_id: NullOr(S),
    party_type: NullOr(PartyType),
    party_id: NullOr(S),
    cost_center_id: NullOr(S),
    project: NullOr(S),
    references: Schema.Array(DocumentRef),
    suggestion: NullOr(S),
    memo: NullOr(S),
    status: Schema.Literals(["waiting", "decided"]),
    last_editor_kind: Schema.Literals(["person", "agent", "system"]),
    last_editor_id: S,
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_kind", "owner_id", "reference_kind", "reference_id"],
  indexes: [
    {
      name: "by_owner_status_account",
      fields: ["owner_kind", "owner_id", "status", "account_id", "updated_at"],
      for: "The rows waiting in one not-decided account, oldest first: the review queue and a reclassify's candidates.",
    },
  ],
  retention: KEPT,
});

export const event_book_annotation_transitioned = defineEvent({
  id: "book_annotation_transitioned",
  about:
    "A row's annotation was saved, accepted from the queue or reclassified, for a person or an Organization. Replaces " +
    "activity_annotation_saved and books_rows_reclassified (one event per row moved). It never carries a memo or a name.",
  props: Schema.Struct({
    from: NullOr(S),
    to: S,
    transition: S,
    owner_kind: S,
    owner_id: S,
    reference_kind: S,
    reference_id: S,
    account_id: NullOr(S),
  }),
  was: [`${OLD}/activity/annotations/events.ts:36`, `${BK}/accounts/operations/emit-rows-reclassified.ts:1`],
});

export const machine_book_annotation = defineMachine({
  id: "book-annotation",
  title: "Book annotation: waiting in review or decided",
  about:
    "Whether a row waits in the review queue (`waiting`: no account, or a not-decided account, with or without a " +
    "suggestion) or has an account someone decided. Every committed save is one transition, so it is reported once.",
  was: [`${BK}/writes.ts:223`, `${BK}/accounts/writes/review.ts:24`, `${BK}/accounts/writes/review.ts:98`],
  table: table_book_annotations,
  field: "status",
  initial: "waiting",
  states: [
    { id: "waiting", about: "Posts to its direction's not-decided account; listed by `org books accounts review`." },
    { id: "decided", about: "Posts against the account, party and documents it names." },
  ],
  transitions: {
    queue: {
      from: [],
      to: "waiting",
      about: "The first save leaves the row waiting: a memo alone, or 4999 or 6999 with or without a suggestion.",
      emits: [event_book_annotation_transitioned],
    },
    assign: {
      from: [],
      to: "decided",
      about: "The first account the row gets (an `account_assigned` fact), by a save, a payment's choice, an accept or a reclassify.",
      emits: [event_book_annotation_transitioned],
    },
    requeue: {
      from: ["waiting", "decided"],
      to: "waiting",
      about: "A later save that leaves or puts the row waiting; a change of account is a `recategorized` fact.",
      emits: [event_book_annotation_transitioned],
    },
    recategorize: {
      from: ["waiting", "decided"],
      to: "decided",
      about: "A later save that gives the row an account, party or documents; a change of any is a `recategorized` fact.",
      emits: [event_book_annotation_transitioned],
    },
    accept: {
      from: ["waiting"],
      to: "decided",
      about: "`review --accept`: the suggestion becomes a new account and the row moves to it (`recategorized`).",
      guard: "The caller wears the Books hat; the row waits in a not-decided account in an open period.",
      emits: [event_book_annotation_transitioned],
    },
    reclassify: {
      from: ["waiting"],
      to: "decided",
      about: "`accounts reclassify` moves the row with every other in one change, under one `rows_reclassified` fact.",
      guard: "The caller wears the Books hat; the row waits in the from-account and its money falls inside the period, after closed_through.",
      emits: [event_book_annotation_transitioned],
    },
  },
});

// ── book facts ──────────────────────────────────────────────────────────────────────────────

export const table_book_facts = defineTable({
  id: "book-facts",
  title: "Book facts: the append-only, gap-free history of an Organization's books",
  about:
    "Every fact the books keep (ADR-0042): the chart's changes, a cost centre, a row's account, a payroll run's accrual " +
    "posted or cancelled (`source` the run: books.payroll-accrual), and money. Never edited or " +
    "deleted: a wrong account is a `recategorized` fact, money the chain took back a `reversed` fact naming the one it " +
    "cancels. `seq` numbers an Organization's facts from 1 with no gap, in the order they commit (books.feed), so a " +
    "ledger that follows the numbers reads every fact once. A money fact is keyed by the chain occurrence that moved the " +
    "money (`money_key`) and a generation (books.money-key). It records amount, asset, direction, the Safe it moved in or " +
    "out of, the counterparty (the chain's name for it, and its directory `party_id` when known: the voucher's party), the " +
    "part a rail kept as a fee (`fee_raw`), source, chain, block, transaction and log, and the USD value at the rate in force at its block, once, never revalued; it " +
    "names no account (books.account-at-posting). `posting_date` is set only when the block's day was already closed " +
    "when the fact was recorded: the voucher posts on the first open day instead (books.closed-periods). Each standing " +
    "priced money fact posts one voucher whose id is the fact's (books.vouchers). Chart facts carry the code and name " +
    "they set. Only Organizations keep facts; a person's rows keep none.",
  was: [`${T}:72`, `${BK}/writes.ts:47`, `${BK}/facts/writes/money.ts:66`, `${BK}/facts/writes/standing.ts:13`, `${MODEL}:189`],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    fact_id: S,
    seq: Int,
    kind: FactKind,
    occurred_at: N,
    recorded_at: N,
    posting_date: NullOr(S),
    // a chart fact, a cost centre, or a row's account
    account_id: NullOr(S),
    from_account_id: NullOr(S),
    cost_center_id: NullOr(S),
    code: NullOr(S),
    name: NullOr(S),
    reference_kind: NullOr(ReferenceKind),
    reference_id: NullOr(S),
    rows: Schema.Array(Reference),
    // money
    money_key: NullOr(S),
    generation: NullOr(N),
    direction: NullOr(Schema.Literals(["in", "out"])),
    asset_id: NullOr(S),
    symbol: NullOr(S),
    decimals: NullOr(N),
    amount_raw: NullOr(S),
    fee_raw: NullOr(S),
    usd_value: NullOr(S),
    usd_rate: NullOr(S),
    usd_source: NullOr(S),
    safe_address: NullOr(S),
    counterparty: NullOr(S),
    party_id: NullOr(S),
    source_kind: NullOr(SourceKind),
    source_id: NullOr(S),
    chain_id: NullOr(N),
    block_number: NullOr(N),
    tx_hash: NullOr(S),
    log_index: NullOr(N),
    reverses_fact_id: NullOr(S),
    // who caused it
    actor_kind: Schema.Literals(["person", "agent", "system"]),
    actor_id: NullOr(S),
  }),
  key: ["org_id", "fact_id"],
  indexes: [
    {
      name: "by_org_seq",
      fields: ["org_id", "seq"],
      unique: true,
      for: "The feed: an Organization's facts in the order they were recorded, read after a number with nothing skipped.",
    },
    {
      name: "by_org_occurred",
      fields: ["org_id", "occurred_at", "fact_id"],
      for: "Facts oldest first by when they happened: the facts list's pages and cursor, every report to its end, the export's window.",
    },
    {
      name: "by_org_kind_occurred",
      fields: ["org_id", "kind", "occurred_at", "fact_id"],
      for: "The facts list's `--kind`, from `--since`.",
    },
    {
      name: "by_org_source",
      fields: ["org_id", "source_kind", "source_id", "occurred_at"],
      for: "The facts list's `--source`: every fact one Payment, deposit, payout, agreement or Movement wrote.",
    },
    {
      name: "by_org_money_key",
      fields: ["org_id", "money_key", "generation", "kind"],
      unique: true,
      for: "The standing fact of one money occurrence: a replay is a no-op, a reversal finds what it cancels, a re-settle takes the next generation.",
    },
    {
      name: "by_org_reference",
      fields: ["org_id", "reference_kind", "reference_id"],
      for: "A row's facts: whether a row is the Organization's (annotate), its direction (review, reclassify), the vouchers an annotation reposts.",
    },
    {
      name: "by_org_asset",
      fields: ["org_id", "asset_id", "occurred_at"],
      for: "The assets an Organization's money moved (the Safe accounts an import makes) and each asset's units for the reconcile.",
    },
  ],
  retention: "Append-only: never edited or deleted (ADR-0042).",
});

// ── book document vouchers ──────────────────────────────────────────────────────────────────

// ── book head syncs ─────────────────────────────────────────────────────────────────────────

// ── book assets ─────────────────────────────────────────────────────────────────────────────

export const table_book_assets = defineTable({
  id: "book-assets",
  title: "Book assets: the ERC-20s an Organization added to its books",
  about:
    "A token an Organization added (`org books assets add`): held, scanned and booked, never paid in, never priced. " +
    "Capxul's own assets are the deployment's configuration, not rows (books.capxul-assets). The scan of added tokens reads " +
    "each `added` row's Transfers to and from `safe_address` from `next_block` and moves it forward (books.added-token-scan). " +
    "A removal keeps the row, so the money it booked still reads; adding it again re-arms the same row from the head.",
  was: [`${T}:149`, `${BK}/assets/writes.ts:31`, `${BK}/assets/writes.ts:64`, `${OLD}/indexing/movements/operations/scan-added.ts:32`],
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    asset_id: S,
    chain_id: N,
    token_address: S,
    symbol: S,
    decimals: N,
    safe_address: S,
    start_block: N,
    next_block: N,
    status: Schema.Literals(["added", "removed"]),
    first_added_at: N,
    added_by: S,
    added_at: N,
    removed_at: NullOr(N),
  }),
  key: ["org_id", "chain_id", "token_address"],
  indexes: [
    {
      name: "by_org_status_added",
      fields: ["org_id", "status", "first_added_at"],
      for: "The tokens one Organization records, in the order first saved: the assets list and the reconcile's tokens.",
    },
    {
      name: "by_status_chain",
      fields: ["status", "chain_id", "token_address"],
      crossTenant: true,
      for: "Every added token of every Organization, for the scan's work list each minute.",
    },
  ],
  retention: "Kept for the Organization's life: removal sets `removed`, so the money the token booked still reads.",
});

export const event_book_asset_transitioned = defineEvent({
  id: "book_asset_transitioned",
  about: "A token was added to an Organization's books, added again after a removal, or removed. Replaces books_asset_added and books_asset_removed.",
  props: Schema.Struct({ from: NullOr(S), to: S, transition: S, org_id: S, asset_id: S, chain_id: N, token_address: S }),
  was: [`${BK}/assets/events.ts:1`],
});

export const machine_book_asset = defineMachine({
  id: "book-asset",
  title: "Added token: recorded or removed",
  about: "A token is born added, may be removed, and may be added again; the old `removedAt` stamp becomes a status.",
  was: [`${T}:160`, `${BK}/assets/reads.ts:65`, "docs/as-is/archive/books/data.ts"],
  table: table_book_assets,
  field: "status",
  initial: "added",
  states: [
    { id: "added", about: "Scanned from `next_block`; its Transfers become money facts under its symbol, with no USD." },
    { id: "removed", about: "No longer scanned; the facts it booked stay." },
  ],
  transitions: {
    add: {
      from: [],
      to: "added",
      about: "`org books assets add`: the token's decimals, symbol and balance read at the head, its opening recorded.",
      guard: "An ERC-20 that answers decimals and symbol; not one of Capxul's assets; not already recorded by this Organization.",
      emits: [event_book_asset_transitioned],
    },
    readd: {
      from: ["removed"],
      to: "added",
      about: "Adding a removed token again re-arms its row from the head, with a new opening for what the Safe holds then.",
      emits: [event_book_asset_transitioned],
    },
    remove: {
      from: ["added"],
      to: "removed",
      about: "`org books assets remove` stops the scan.",
      emits: [event_book_asset_transitioned],
    },
  },
});

// ── book prices ─────────────────────────────────────────────────────────────────────────────

// ── invariants over the books ───────────────────────────────────────────────────────────────

export const invariant_books_one_live_money_fact = defineInvariant({
  id: "books.one-live-money-fact",
  title: "One live money fact per Organization and money occurrence",
  about:
    "What `books.record-money-fact` and `books.reverse-money-fact` keep (K10, P4): however many writers reach the same " +
    "money, and however often, the books count it once, so it posts one voucher. Checked by a property test over random " +
    "interleavings of settlements, replays, Movement attributions and reversals.",
  statement: "For each Organization and money key, at most one money fact stands that no `reversed` fact cancels.",
  over: [table_book_facts],
  check: "property",
});

export const invariant_books_feed_gap_free = defineInvariant({
  id: "books.feed-gap-free",
  title: "An Organization's facts are numbered 1, 2, 3 … in the order they commit",
  about:
    "What makes the feed followable (vision check C5): every fact writer takes the Organization's book-companies row lock " +
    "and the next number inside its own transaction, so a later number never commits before an earlier one and a rolled " +
    "back transaction leaves no hole. Checked by a property test of concurrent writers from payments, banking and books.",
  statement: "For each Organization, the facts' seq values are exactly 1 … last_seq, and every reader that saw n saw 1 … n−1.",
  over: [table_book_facts, table_book_companies],
  check: "property",
});

export const invariant_books_facts_append_only = defineInvariant({
  id: "books.facts-append-only",
  title: "Facts are never edited or deleted",
  about: "ADR-0042 decision 2: a wrong account is a new fact, money taken back a reversal. The generated access to book-facts has inserts only.",
  statement: "No statement updates or deletes a row of book-facts.",
  over: [table_book_facts],
  check: "static",
});

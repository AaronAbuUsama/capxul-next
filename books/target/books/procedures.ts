// Books' door: the three procedures other concepts invoke inside their own transaction (P4,
// rules.procedures, ADR-0042 decision 1). Payments invokes the first two when a Payment settles, is
// born from a chain fact, is reversed, or attributes a Movement of outside money; banking when a
// bank deposit arrives or a payout comes back. Payroll invokes the third when a run Capxul computed
// is submitted or cancelled (books.payroll-accrual). Nothing else crosses into books: reads of
// books' tables by the concepts above it are plain reads, and books' own rpcs and workflows write
// its tables directly.
//
// Neither procedure ever refuses: a settlement must never fail because of the books. A side whose
// voucher choice no longer fits the chart is booked and left waiting in review. Each fact takes the
// Organization's next feed number under its book-companies row lock (books.feed), so the fact, its
// number and the money commit together or not at all. A call with several Organizations' sides
// takes their locks in org id order, so two settlements between the same two never deadlock; the
// invoker invokes a books procedure after taking its own row locks and takes no other lock after
// it, so the books' lock is always the last one a money transaction waits on.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  DocumentRef,
  machine_book_account,
  machine_book_annotation,
  machine_book_company,
  machine_book_document_voucher,
  PartyType,
  Reference,
  SourceKind,
  table_book_accounts,
  table_book_annotations,
  table_book_companies,
  table_book_cost_centers,
  table_book_document_vouchers,
  table_book_facts,
  table_book_prices,
} from "./data.ts";

const OLD = "packages/backend/src";
const BK = `${OLD}/books`;
const PAY = `${OLD}/payments`;

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

/**
 * What the payer, the request or the head said the money is for, when it was instructed: the other side of its
 * voucher (books.vouchers). The command that moved the money carries it (`payment send --account`, a request's
 * invoice, a payout's account, a head's "pay this invoice with Capxul").
 */
export const Against = Schema.Struct({
  account_id: opt(S),
  suggestion: opt(S),
  same_as: opt(Reference),
  party: opt(Schema.Struct({ type: PartyType, id: S })),
  cost_center_id: opt(S),
  project: opt(S),
  references: opt(Schema.Array(DocumentRef)),
});

/** One Organization's side of one money occurrence, as the invoker knows it. */
const MoneySide = Schema.Struct({
  org_id: S,
  kind: Schema.Literals(["payment_settled", "payment_received", "deposit_received", "payment_sent_outside", "payout_returned"]),
  direction: Schema.Literals(["in", "out"]),
  /** The chain occurrence: `payment:<v4 payment id>`, or `transfer:<chain id>:<tx hash>:<log index>`. */
  money_key: S,
  reference: Reference,
  source: Schema.Struct({ kind: SourceKind, id: S }),
  asset_id: S,
  symbol: S,
  decimals: N,
  amount_raw: S,
  /** The part of the amount a rail kept (a bank payout's or deposit's fee), in the asset's units. */
  fee_raw: opt(S),
  /** Whether the asset is one of Capxul's priced assets; an added token never is. */
  priced: Schema.Boolean,
  counterparty: NullOr(S),
  /** The counterparty's Party in the directory, when it has one: the voucher's party. */
  party_id: NullOr(S),
  chain_id: N,
  block_number: N,
  block_time: N,
  tx_hash: S,
  log_index: NullOr(N),
  safe_address: S,
  actor: Schema.Struct({ kind: Schema.Literals(["person", "agent", "system"]), id: NullOr(S) }),
  against: opt(Against),
});

export const procedure_books_record_money_fact = defineProcedure({
  id: "books.record-money-fact",
  title: "Record a money occurrence's book facts",
  about:
    "Money fact: a settled Payment, a Payment born from a chain fact, a bank deposit, a payout's return and a Movement of " +
    "outside money always have their book fact, written in the same transaction (K10), and so their voucher. For each " +
    "Organization side the invoker passes, one fact under its `money_key` with the Organization's next feed number, " +
    "taken under its book-companies row lock (born `open` if the books have not begun), with the USD value at the rate in " +
    "force at the block for a priced asset (unpriced otherwise), chart or no chart (books.facts-without-chart). A block " +
    "whose day is on or before `closed_through` gets the first open day as its `posting_date`. A key with a standing fact " +
    "of the same kind and amount writes nothing (a replay, a second writer). A side from a Payment, deposit or payout " +
    "whose key holds a standing Movement fact reverses it and records itself as the next generation; a Movement side " +
    "never replaces one of theirs (books.money-key). With a chart, the asset's Safe account is made if missing " +
    "(`account_created`). The `against` choice becomes the row's annotation only if nobody annotated the row yet, and " +
    "only the parts that fit the chart: an archived or group account, a receivable or payable account with no party " +
    "given and no counterparty Party on the side, a document its party type cannot reference, or an unknown cost centre " +
    "is dropped and the row waits in review. It never refuses and makes no outside call.",
  was: [
    `${BK}/facts/writes/money.ts:98`,
    `${BK}/facts/writes/money.ts:130`,
    `${BK}/facts/writes/outside.ts:71`,
    `${BK}/facts/writes/standing.ts:13`,
    `${BK}/accounts/writes/chart.ts:163`,
    `${PAY}/writes/settlements.ts:145`,
    `${PAY}/writes/deposits.ts:117`,
    `${PAY}/writes/rails.ts:62`,
    "docs/as-is/archive/books/procedures.ts",
  ],
  concept: concept_books,
  input: Schema.Struct({ sides: Schema.Array(MoneySide) }),
  output: Schema.Struct({ recorded: Schema.Array(S), unchanged: Schema.Array(S), superseded: Schema.Array(S) }),
  errors: [],
  reads: [
    table_book_companies,
    table_book_facts,
    table_book_prices,
    table_book_accounts,
    table_book_annotations,
    table_book_cost_centers,
  ],
  writes: [table_book_companies, table_book_facts, table_book_accounts, table_book_annotations],
  drives: [
    machine_book_company.t.open,
    machine_book_account.t.add,
    machine_book_annotation.t.queue,
    machine_book_annotation.t.assign,
  ],
  invokes: [],
  emits: [],
});

export const procedure_books_reverse_money_fact = defineProcedure({
  id: "books.reverse-money-fact",
  title: "Reverse a money occurrence's book facts",
  about:
    "Money fact: money the chain took back is taken back in the books in the same transaction (K12). For each " +
    "Organization whose standing fact under `money_key` exists, a `reversed` fact `<fact id>_rev` with the next feed " +
    "number and the same amount, asset and USD value, naming the fact it cancels, dated when the reorganization was " +
    "seen: its voucher is cancelled on that day, the immutable ledger's way, and reports net the two. Settling again " +
    "later is the next generation, a new voucher amended from the cancelled one (`record-money-fact`). A key with no " +
    "standing fact writes nothing; a second call is a no-op. It never refuses and makes no outside call.",
  was: [
    `${BK}/facts/writes/money.ts:163`,
    `${BK}/facts/writes/money.ts:180`,
    `${BK}/facts/writes/movements.ts:16`,
    `${BK}/facts/writes/standing.ts:57`,
    `${PAY}/verifications/writes/history.ts:190`,
    `${PAY}/writes/rollbacks.ts:71`,
    "docs/as-is/archive/books/procedures.ts",
  ],
  concept: concept_books,
  input: Schema.Struct({
    money_key: S,
    org_ids: Schema.Array(S),
    seen_at: N,
    reason: Schema.Literals(["reorganized", "claimed_by_payment"]),
  }),
  output: Schema.Struct({ reversed: Schema.Array(S) }),
  errors: [],
  reads: [table_book_companies, table_book_facts],
  writes: [table_book_companies, table_book_facts],
  drives: [],
  invokes: [],
  emits: [],
});

/** One line of a payroll run's accrual, in the Company's currency, as Frappe HR's `make_accrual_jv_entry` makes it. */
const AccrualLine = Schema.Struct({
  /** The component's expense or liability account, or the run's payable, by books' account id; null for its role's. */
  account_id: NullOr(S),
  /** What the line is, so a missing or unfit account falls back: an earning or employer cost to 6999, a deduction or the net to Payroll Payable. */
  role: Schema.Literals(["expense", "liability", "payable"]),
  party_type: NullOr(PartyType),
  party_id: NullOr(S),
  cost_center_id: NullOr(S),
  project: NullOr(S),
  debit: S,
  credit: S,
});

export const procedure_books_record_payroll_accrual = defineProcedure({
  id: "books.record-payroll-accrual",
  title: "Record or cancel a payroll run's accrual",
  about:
    "Money fact: a submitted payroll run owes each employee's net pay and each withheld deduction until its Payments " +
    "settle them; the books credit that liability in the run's own transaction, so no slip's Payment is ever booked " +
    "against a payable nothing credited, and cancelling the run takes the liability back with it (books.payroll-accrual). " +
    "`submit` records an `accrual_posted` fact with the Organization's next feed number (source the run) and its " +
    "Journal Entry as a `payroll` document voucher whose id is that fact's, dated `posting_date`: each earning's and " +
    "employer cost's expense debited, each deduction's liability and each employee's net on Payroll Payable credited " +
    "(party the Employee), every line naming the Payroll Entry, the lines payroll computed in the Company's currency. " +
    "A line whose account is missing, archived, a group or of the wrong root posts to its role's account (6999, or " +
    "Payroll Payable), and without a chart the voucher is kept and posts once the chart exists, as money facts do. A run " +
    "with a standing accrual writes nothing. `cancel` records `accrual_cancelled` naming it and cancels the voucher on " +
    "that day, its reversing lines appended; a run with no standing accrual writes nothing. A head-computed run never " +
    "reaches this door: its accrual is the head's own voucher. It never refuses and makes no outside call.",
  concept: concept_books,
  input: Schema.Struct({
    org_id: S,
    run_id: S,
    action: Schema.Literals(["submit", "cancel"]),
    posting_date: S,
    lines: Schema.Array(AccrualLine),
    at: N,
    actor: Schema.Struct({ kind: Schema.Literals(["person", "agent", "system"]), id: NullOr(S) }),
  }),
  output: Schema.Struct({ factId: NullOr(S), voucher: NullOr(S) }),
  errors: [],
  reads: [table_book_companies, table_book_facts, table_book_accounts, table_book_cost_centers, table_book_document_vouchers],
  writes: [table_book_companies, table_book_facts, table_book_document_vouchers],
  drives: [machine_book_company.t.open, machine_book_document_voucher.t.post, machine_book_document_voucher.t.cancel],
  invokes: [],
  emits: [],
});

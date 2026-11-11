// Moved out of the built book by the cut, 10 November 2026, from books/target/books/procedures.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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
  PayrollLine,
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

export const procedure_books_record_payroll_accrual = defineProcedure({
  id: "books.record-payroll-accrual",
  title: "Record or cancel an accrual: a run's, a collection slip's, an expense claim's",
  about:
    "Money fact: a submitted payroll run owes each net and withheld deduction until its Payments settle them, a landed " +
    "agreement collection's paid slip is pay to expense, and an approved expense claim is owed to its Employee; the " +
    "books post it in payroll's own transaction, so no payroll Payment is booked against a payable nothing credited, " +
    "and a cancel takes it back (books.payroll-accrual). `submit` records an `accrual_posted` fact with the next feed " +
    "number (source the run) and a `payroll` Journal Entry whose id is the fact's: each earning's and employer " +
    "contribution's expense debited, each deduction's and contribution's liability credited, each net on Payroll " +
    "Payable credited, party the Employee and reference the Payroll Entry; a run's advance-recovery deduction credits " +
    "Employee Advances. `collection` does the same for one collection slip (source the agreement), naming the Payment " +
    "that paid it (books.payroll-postings); a Payment's row in a closed period writes nothing. `expense_claim` " +
    "(payroll.hr-money) debits each line's sanctioned amount to its type's account (null: the default expense " +
    "account), credits each advance taken to Employee Advances (reference the Employee Advance) and the grand total to " +
    "the payable (reference the Expense Claim), party the Employee, on the approval's day. Books fixes each account (a " +
    "missing, archived, group or wrong-root one to its role's: books.payroll-defaults) and each value in the Company's " +
    "currency once charted, and dates the voucher on the Company's day: the run's `posting_date`, or the block's day, " +
    "moved to the first open day when closed (books.payroll-lines). One with a standing accrual writes nothing. " +
    "`cancel` and `expense_claim_cancel` record `accrual_cancelled` and cancel the voucher on the day of `at`. A " +
    "head-computed run never reaches this door. It never refuses and makes no outside call.",
  concept: concept_books,
  input: Schema.Struct({
    org_id: S,
    action: Schema.Literals(["submit", "cancel", "collection", "expense_claim", "expense_claim_cancel"]),
    /** `submit` and `cancel`: the run (its Payroll Entry id); null for `collection` and an expense claim's. */
    run_id: NullOr(S),
    /** `expense_claim` and `expense_claim_cancel`: the claim (its Expense Claim id); absent otherwise. */
    expense_claim_id: Schema.optionalKey(S),
    /** `collection` only: the paid slip, its agreement, the Payment (`payment_<id>`) the collection is, and its block's time. */
    collection: NullOr(Schema.Struct({ salary_slip_id: S, agreement_id: S, payment_id: S, block_time: N })),
    /** The run's token, as a money side names its asset. */
    asset_id: S,
    symbol: S,
    /** `submit`: the run's posting date (Frappe's `YYYY-MM-DD`); null for `cancel` and `collection`, which books dates. */
    posting_date: NullOr(S),
    lines: Schema.Array(AccrualLine),
    at: N,
    actor: Schema.Struct({ kind: Schema.Literals(["person", "agent", "system"]), id: NullOr(S) }),
  }),
  output: Schema.Struct({ factId: NullOr(S), voucher: NullOr(S) }),
  errors: [],
  reads: [
    table_book_companies,
    table_book_facts,
    table_book_accounts,
    table_book_cost_centers,
    table_book_annotations,
    table_book_document_vouchers,
    table_book_prices,
  ],
  writes: [table_book_companies, table_book_facts, table_book_document_vouchers],
  drives: [machine_book_company.t.open, machine_book_document_voucher.t.post, machine_book_document_voucher.t.cancel],
  invokes: [],
  emits: [],
});

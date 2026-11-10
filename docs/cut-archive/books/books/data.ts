// Moved out of the built book by the cut, 10 November 2026, from books/target/books/data.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { defineEvent, defineInvariant, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";

export const event_book_document_voucher_transitioned = defineEvent({
  id: "book_document_voucher_transitioned",
  about:
    "A document voucher reached Capxul's ledger (a head's, pulled; a payroll run's accrual, recorded), or its " +
    "cancellation did. It never carries an amount or a party.",
  props: Schema.Struct({ from: NullOr(S), to: S, transition: S, org_id: S, author: S, voucher_type: S, voucher_no: S }),
});

export const machine_book_document_voucher = defineMachine({
  id: "book-document-voucher",
  title: "Document voucher: submitted or cancelled",
  about: "Frappe's docstatus for a voucher whose author gave its lines: submitted when its GL Entries arrive, cancelled when its author cancels it.",
  table: table_book_document_vouchers,
  field: "status",
  initial: "submitted",
  states: [
    { id: "submitted", about: "Its lines count in every report from its posting date." },
    { id: "cancelled", about: "Its lines and their reversal both count, so it nets to nothing from the cancellation on.", terminal: true },
  ],
  transitions: {
    post: {
      from: [],
      to: "submitted",
      about:
        "The head sync's first sight of a submitted head voucher (a later version replaces its lines without a " +
        "transition), or a payroll accrual recorded when its run is submitted or its collection slip is paid.",
      guard:
        "It balances (a head's in the Company's currency, payroll's in its token) and no line is on a Safe account; a " +
        "head's lines name only accounts and cost centres of Capxul's chart; an unfit payroll account posts to its " +
        "role's once charted (books.payroll-lines).",
      emits: [event_book_document_voucher_transitioned],
    },
    cancel: {
      from: ["submitted"],
      to: "cancelled",
      about: "Its author cancelled it (the head, or payroll cancelling the run): its reversing lines are appended, a payroll voucher's once charted.",
      emits: [event_book_document_voucher_transitioned],
    },
  },
});

export const table_book_head_syncs = defineTable({
  id: "book-head-syncs",
  title: "Book head syncs: the books' sync with one connected head",
  about:
    "One row per head connection the books sync with: how far it has pushed the feed (`pushed_seq`, a fact number), how " +
    "far it has read the head's own changes (`pulled_change`), when each last ran, and what it settled: `conflicts` (a " +
    "head edit based on an older version, which Capxul's version overwrote) and `refused` (a head change Capxul's checks " +
    "refused, pushed back or left unadopted). Its process (`books.head.sync`) is the only writer (books.sync).",
  concept: concept_books,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    head_id: S,
    pushed_seq: Int,
    pulled_change: NullOr(S),
    pushed_at: NullOr(N),
    pulled_at: NullOr(N),
    conflicts: Int,
    refused: Int,
    created_at: N,
    updated_at: N,
  }),
  key: ["org_id", "head_id"],
  indexes: [],
  retention: KEPT,
});

export const table_book_prices = defineTable({
  id: "book-prices",
  title: "Book prices: USD rates by pair, from a time on",
  about:
    "A USD rate per pair (`USDC/USD`, `EUR/USD`, `ETH/USD`, `BTC/USD`) from the time Chainlink last updated it, with its " +
    "source (`chainlink:<feed>`) and round. Written only by the price sync (books.prices-sync). A money fact of one of " +
    "Capxul's assets copies the latest rate at or before its block's time, once. A voucher in a Company currency other " +
    "than USD divides by that currency's own USD rate at the same time (EUR/USD), read from the same kept history. On a devnet the Chainlink fake answers the devnet's scripted rates, so the same " +
    "writer stores them; the old stand-in series and the devnet set-price row go.",
  was: [`${T}:140`, `${BK}/facts/operations/prices.ts:35`, `${BK}/facts/reads/facts.ts:14`, `${BK}/facts/rules.ts:108`],
  concept: concept_books,
  tenancy: "global",
  fields: Schema.Struct({ pair: S, from_at: N, rate: S, source: S, round_id: S }),
  key: ["pair", "from_at"],
  indexes: [],
  retention: "Kept: a fact's rate stays explainable from the history it was taken from.",
});

export const invariant_books_postings_balance = defineInvariant({
  id: "books.postings-balance",
  title: "Every voucher balances",
  about:
    "The posting rules (`frappe-v1`) turn each standing priced money fact into one voucher whose debits equal its " +
    "credits in the Company's currency, and every document voucher (a head's, or a payroll run's accrual) arrives " +
    "balanced, so every trial balance balances at any time and in any window.",
  statement: "For every voucher, Capxul's or a document's, its GL lines' debits equal their credits in the Company's currency; a chart or row fact posts nothing.",
  over: [table_book_facts, table_book_annotations, table_book_accounts, table_book_document_vouchers],
  check: "property",
});

export const invariant_books_one_author_per_voucher = defineInvariant({
  id: "books.one-author-per-voucher",
  title: "Money in a Safe posts only from its fact; every other voucher only by its author",
  about:
    "The rule that keeps the sync from double-posting (books.sync): a money voucher is one standing priced money fact and " +
    "has one line on a Safe account; a document voucher (a head's, or a payroll run's accrual) has none, its number is " +
    "never a money voucher's id, and a run's accrual has one author, the side that computed the run " +
    "(books.payroll-accrual). So no movement of money is posted twice and no voucher has two writers.",
  statement: "No book-document-vouchers line names a `safe` account, and every voucher with a Safe line is a money fact's.",
  over: [table_book_document_vouchers, table_book_facts, table_book_accounts],
  check: "property",
});

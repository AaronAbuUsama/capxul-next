// The books' feed and their sync with a connected ERPNext head (aaron.frappe-head), with one author
// per voucher (books.sync; invariant books.one-author-per-voucher). The sync follows the system's
// head pattern (organizations.head-connection, organizations.head-ownership, organizations.head-doorbell):
// Capxul always calls, through the `frappe-head` integration, and the head holds no Capxul key; it
// only rings a doorbell after a change.
//
// - `books.sync.feed` (here): the Organization's facts in the order they were recorded, gap-free
//   (books.feed), each with the Frappe documents it makes or changes. Any Seat's ledger may follow it
//   through the Core SDK (flows.ts); it is how a ledger that is not a head follows the books.
// - `books.head.sync` (processes.ts): one process per head connection. Push: the same documents, in
//   feed order, by `capxul_id` (`upsertDocs`). Pull: the head's own vouchers and cost centres, and
//   the head users' changes to the chart and to the meaning of Capxul's money (`listChanges`),
//   applied through books' own checks with that user's rights.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
} from "../shared/vocabulary.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_org_members } from "../organizations/data.ts";
import {
  table_book_accounts,
  table_book_annotations,
  table_book_companies,
  table_book_cost_centers,
  table_book_document_vouchers,
  table_book_facts,
} from "./data.ts";
import { BookFact } from "./facts.ts";
import { FrappeDoc } from "./frappe.ts";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const opt = Schema.optionalKey;

const GUARD_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE] as const;

export const FeedEntry = Schema.Struct({ seq: Int, fact: BookFact, documents: Schema.Array(FrappeDoc) });

export const rpc_books_sync_feed = defineRpc({
  id: "books.sync.feed",
  title: "Read the books' facts after a number, with their Frappe documents",
  about:
    "The facts numbered after `after` (0 for the first), in number order, at most `limit` (1 to 500, default 100), and " +
    "`through`, the books' last number now: a reader that keeps the last number it applied and asks again reads every " +
    "fact exactly once, whatever order money happened in (vision check C5). Each fact comes as the facts list shows it " +
    "(block time, Safe, transaction, log, party: check C6) with the documents it makes or changes, as they stand now: " +
    "`account_*` an Account (an `account_created` under a ledger parent hands that parent, now a group, first); " +
    "`cost_center_created` a Cost Center; a priced money fact its voucher (books.vouchers); `account_assigned`, " +
    "`recategorized` and `rows_reclassified` each voucher they repost, at `capxul_version` this number; `reversed` the " +
    "voucher cancelled, dated when the money was taken back; `accrual_posted` a payroll accrual's Journal Entry (a run's, or a collection " +
    "slip's with a new version of its Payment's voucher when that Payment's fact came first: books.payroll-postings) " +
    "and `accrual_cancelled` it cancelled (books.payroll-accrual). Before the chart a money fact has no document, so a reader " +
    "that began before the import reads again from 0 once it sees the import's facts (the head sync pushes nothing " +
    "until the books are charted). A voucher a reader first sees already cancelled is inserted, submitted and cancelled " +
    "on its `cancelled_on`. An unpriced fact (an added token) posts no voucher. It writes nothing: the reader keeps its " +
    "own place.",
  concept: concept_books,
  kind: "query",
  who:
    "A current Seat of the Organization (org-members), while the `books` gate is on: an outside ledger reads as a " +
    "Seat's agent. Anyone else is refused ROLE_PERMISSION_DENIED.",
  input: Schema.Struct({ orgId: S, after: Int, limit: opt(Int) }),
  output: Schema.Struct({ entries: Schema.Array(FeedEntry), last: Int, through: Int, asOf: N }),
  errors: [...GUARD_ERRORS, error_INVALID_INPUT],
  reads: [
    table_org_members,
    table_feature_flags,
    table_book_companies,
    table_book_facts,
    table_book_accounts,
    table_book_cost_centers,
    table_book_annotations,
    table_book_document_vouchers,
  ],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

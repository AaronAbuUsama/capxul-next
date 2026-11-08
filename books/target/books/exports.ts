// The export for QuickBooks Online: the chart file and the window's journal, derived when asked
// from the same ledger the reports and a head read: the money vouchers (`frappe-v1`,
// books.vouchers) and the document vouchers (a head's own, a payroll run's accrual). The SDK method
// returns both files' text; the CLI writes them into `--out` (books.export-files-by-cli).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_org_members } from "../organizations/data.ts";
import {
  table_book_accounts,
  table_book_annotations,
  table_book_companies,
  table_book_document_vouchers,
  table_book_facts,
} from "./data.ts";

const OLD = "packages/backend/src/books/exports";

const S = Schema.String;
const N = Schema.Number;

export const rpc_books_exports_quickbooks = defineRpc({
  id: "books.exports.quickbooks",
  title: "Export the books for QuickBooks Online",
  about:
    "Two CSV texts: `chart-of-accounts.csv`, every numbered account with its number, its QuickBooks type and detail " +
    "type, parents before their sub-accounts, named as QuickBooks names them (the roots and type groups are QuickBooks' " +
    "own types); and `journal-entries.csv`, one balanced journal entry in the Company's currency per voucher posted from " +
    "the start of `from`'s day to the end of `to`'s in the books' time zone: one per standing priced money fact, and one " +
    "per document voucher (a head's, a payroll run's accrual, a cancellation's reversal on its own day), its lines the " +
    "voucher's GL lines, numbered by its day and a hash of its id so a voucher keeps its number in any window. A money " +
    "fact with no USD price yet stays out and is counted, with its asset.",
  was: [`${OLD}/operations/quickbooks.ts:10`, `${OLD}/rules.ts:131`, `${OLD}/rules.ts:199`, `${OLD}/rules.ts:189`],
  concept: concept_books,
  kind: "query",
  who:
    "Any current Seat of the Organization (org-members), while the `books` gate is on; anyone else is refused " +
    "ROLE_PERMISSION_DENIED.",
  input: Schema.Struct({ orgId: S, from: N, to: N }),
  output: Schema.Struct({
    from: N,
    to: N,
    accountsCsv: S,
    journalCsv: S,
    entries: N,
    unpriced: Schema.Struct({ facts: Schema.Int, assets: Schema.Array(S) }),
  }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE, error_WRONG_STATE, error_INVALID_INPUT],
  reads: [
    table_org_members,
    table_feature_flags,
    table_book_companies,
    table_book_accounts,
    table_book_annotations,
    table_book_facts,
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

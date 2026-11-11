// The reports, derived from the ledger when read and never stored: the trial balance, the profit
// and loss and the balance sheet, and the reconcile of the books against what the chain says the
// Safe holds now. The ledger is ERPNext's GL Entry lines: those of Capxul's own vouchers, derived
// from the facts by the pure, versioned posting rules (`frappe-v1`, books.vouchers), and those of
// the document vouchers whose author gave their lines (book-document-vouchers: a connected head's
// own, and a payroll run's accrual), so with a head these reports equal the head's
// (books.head-vouchers, books.payroll-accrual).
//
// Posting: a voucher's Safe line moves its Safe account; its other side is the row's annotation now
// (account, party, cost centre), else its direction's not-decided account at Main, so a
// recategorization reposts the voucher and moves every report at once (books.account-at-posting). A
// money fact with no USD value posts no voucher: it is counted under `unpriced` and left out of
// every total. A chart fact posts nothing. Amounts are in the Company's currency and a day is the
// books' time zone's (book-companies, books.company-settings); a line counts by its posting date. The profit and loss leaves out a Period Closing Voucher's lines;
// the balance sheet keeps them, so current earnings are what no closing has moved into equity yet.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_books } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { contract_erc20, integration_chain_rpc } from "../shared/external.ts";
import { table_feature_flags } from "../access/data.ts";
import { table_org_members, table_organizations } from "../organizations/data.ts";
import { table_escrows } from "../indexing/data.ts";
import {
  AccountType,
  table_book_accounts,
  table_book_annotations,
  table_book_assets,
  table_book_companies,
  table_book_facts,
  table_book_document_vouchers,
} from "./data.ts";

const OLD = "packages/backend/src/books";
const REP = `${OLD}/reports`;
const ROWS = "packages/protocol/src/books";

const S = Schema.String;
const N = Schema.Number;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;

const SEAT_WHO =
  "Any current Seat of the Organization (org-members), while the `books` gate is on; anyone else is refused " +
  "ROLE_PERMISSION_DENIED.";
const SEAT_READS = [table_org_members, table_feature_flags] as const;
const GUARD_ERRORS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE] as const;
const POSTED_READS = [
  table_book_companies,
  table_book_accounts,
  table_book_annotations,
  table_book_facts,
  table_book_document_vouchers,
] as const;

const AccountRef = Schema.Struct({ accountId: S, code: S, name: S });
/** `cash` while every voucher is a money voucher; `accrual` once a document voucher exists (a head's invoice or accrual, a payroll run's accrual). */
export const Rules = Schema.Struct({ basis: Schema.Literals(["cash", "accrual"]), version: S });
const Unpriced = Schema.Struct({ facts: Schema.Int, assets: Schema.Array(S) });
const Section = Schema.Struct({
  type: AccountType,
  rows: Schema.Array(Schema.Struct({ account: AccountRef, parent: NullOr(S), amount: S, total: S })),
  total: S,
});

export const rpc_books_reports_trial_balance = defineRpc({
  id: "books.reports.trial-balance",
  title: "Read the trial balance",
  about:
    "Every ledger account's debits and credits from the GL lines up to the end of `asOf`'s day in the books' time zone, " +
    "or up to now, with what each Safe account holds in its asset's units; total debits equal total credits. WRONG_STATE " +
    "`no_chart` before the import.",
  was: [`${REP}/operations/trial-balance.ts:7`, `${REP}/rules.ts:64`, `${OLD}/postings/rules.ts:96`],
  concept: concept_books,
  kind: "query",
  who: SEAT_WHO,
  input: Schema.Struct({ orgId: S, asOf: opt(N) }),
  output: Schema.Struct({
    rules: Rules,
    currency: S,
    asOf: N,
    lines: Schema.Array(
      Schema.Struct({ account: AccountRef, type: AccountType, debit: S, credit: S, holds: NullOr(Schema.Struct({ asset: S, units: S })) }),
    ),
    totals: Schema.Struct({ debit: S, credit: S }),
    unpriced: Unpriced,
  }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE],
  reads: [...SEAT_READS, ...POSTED_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_books_reports_profit_and_loss = defineRpc({
  id: "books.reports.profit-and-loss",
  title: "Read the profit and loss",
  about:
    "Income, cost of services and expense from the start of `from`'s day to the end of `to`'s in the books' time zone, " +
    "each group's sub-accounts rolled into it and counted once, with gross profit (income less cost of services) and " +
    "net income; a Period Closing Voucher's lines are left out. `to` before `from` is INVALID_INPUT.",
  was: [`${REP}/operations/profit-and-loss.ts:10`, `${REP}/rules.ts:92`, `${OLD}/postings/rules.ts:96`],
  concept: concept_books,
  kind: "query",
  who: SEAT_WHO,
  input: Schema.Struct({ orgId: S, from: N, to: N }),
  output: Schema.Struct({
    rules: Rules,
    currency: S,
    from: N,
    to: N,
    sections: Schema.Array(Section),
    grossProfit: S,
    netIncome: S,
    unpriced: Unpriced,
  }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE, error_INVALID_INPUT],
  reads: [...SEAT_READS, ...POSTED_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_books_reports_balance_sheet = defineRpc({
  id: "books.reports.balance-sheet",
  title: "Read the balance sheet",
  about:
    "Assets, liabilities and equity from the GL lines up to the end of `asOf`'s day in the books' time zone, or up to " +
    "now, with current earnings (what no Period Closing Voucher has moved into equity yet); assets equal liabilities, " +
    "equity and current earnings.",
  was: [`${REP}/operations/balance-sheet.ts:7`, `${REP}/rules.ts:131`, `${OLD}/postings/rules.ts:96`],
  concept: concept_books,
  kind: "query",
  who: SEAT_WHO,
  input: Schema.Struct({ orgId: S, asOf: opt(N) }),
  output: Schema.Struct({
    rules: Rules,
    currency: S,
    asOf: N,
    sections: Schema.Array(Section),
    currentEarnings: S,
    liabilitiesAndEquity: S,
    unpriced: Unpriced,
  }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE],
  reads: [...SEAT_READS, ...POSTED_READS],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});

export const rpc_books_reports_reconcile = defineRpc({
  id: "books.reports.reconcile",
  title: "Check the books against the Safe",
  about:
    "For every asset the books record (Capxul's own and this Organization's added tokens), in name order: the units the " +
    "books say the company Safe holds (every money fact, priced or not), the Safe's `balanceOf` read live at the head " +
    "block, and what the Organization's open escrows hold (money that left the Safe and is not booked out until the " +
    "escrow pays: indexing's escrows by `sender`, the company Safe). On v4 an agreement reserves its money inside the Safe, so it holds nothing " +
    "outside it (books.reconcile-held). `difference` is books less chain less held; `matches` when every asset's is 0. A " +
    "chain that does not answer is PROVIDER_ERROR.",
  was: [`${REP}/operations/reconcile.ts:7`, `${REP}/rules.ts:184`, `${OLD}/postings/rules.ts:120`, `${ROWS}/report-schema.ts:1`],
  concept: concept_books,
  kind: "action",
  who: SEAT_WHO,
  input: Schema.Struct({ orgId: S }),
  output: Schema.Struct({
    asOf: N,
    assets: Schema.Array(
      Schema.Struct({ asset: S, symbol: S, books: S, chain: S, held: S, difference: S }),
    ),
    matches: Schema.Boolean,
  }),
  errors: [...GUARD_ERRORS, error_WRONG_STATE, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID],
  reads: [...SEAT_READS, ...POSTED_READS, table_book_assets, table_organizations, table_escrows],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_chain_rpc.c.getBlock, integration_chain_rpc.c.readContract],
  chain: [contract_erc20.f.balanceOf],
  spans: [],
  budget: budget("chain-read"),
});

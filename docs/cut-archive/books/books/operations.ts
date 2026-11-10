// Moved out of the built book by the cut, 10 November 2026, from books/target/books/operations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineOperation, type Ref } from "../../../packages/book/src/index.ts";
import { frozen, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CANCELLED,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  BookAccount,
  rpc_books_accounts_add,
  rpc_books_accounts_archive,
  rpc_books_accounts_import,
  rpc_books_accounts_list,
  rpc_books_accounts_reclassify,
  rpc_books_accounts_rename,
} from "./accounts.ts";
import { Annotation, rpc_books_annotations_save } from "./annotations.ts";
import { BookAsset, rpc_books_assets_add, rpc_books_assets_list, rpc_books_assets_remove } from "./assets.ts";
import { BookFact, rpc_books_facts_list } from "./facts.ts";
import {
  rpc_books_reports_balance_sheet,
  rpc_books_reports_profit_and_loss,
  rpc_books_reports_reconcile,
  rpc_books_reports_trial_balance,
} from "./reports.ts";
import { rpc_books_exports_quickbooks } from "./exports.ts";
import { flow_client_org_books_accounts_review } from "./flows.ts";
import { AccountType, Reference } from "./data.ts";

export const operation_org_books_accounts_import = defineOperation({
  ...frozenText("org.books.accounts.import"),
  was: [page("org.books.accounts.import"), `${CLI}/accounts/subcommands/import/execute.ts:13`, `${SDK}/accounts.ts:188`],
  priority: "normal",
  implementedBy: rpc_books_accounts_import,
  acceptance: [
    keep("org.books.accounts.import", 1, "cli: `added`, `protected` and `safeAccounts` with 1010 linked to the Safe; read: `accounts list` shows the chart."),
    rewrite(
      "org.books.accounts.import",
      2,
      "The import is reported once, after it commits.",
      "trace: one book_company_transitioned with transition import for the import.",
    ),
    rewrite(
      "org.books.accounts.import",
      3,
      "A second import is refused and reports nothing more.",
      "cli: WRONG_STATE `already_set_up`; trace: no second book_company_transitioned with transition import; world: no change.",
    ),
    rewrite(
      "org.books.accounts.import",
      4,
      "A Seat without Manage books, an outsider, the books gate off and a call with no session are each refused and report nothing.",
      "cli: ROLE_PERMISSION_DENIED, ROLE_PERMISSION_DENIED, FEATURE_NOT_AVAILABLE and NOT_AUTHENTICATED; trace: no book_company_transitioned; world: no change.",
    ),
  ],
  returns: rpc_books_accounts_import.output,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.import", {
    WRONG_STATE: [error_WRONG_STATE, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, NO_CHART],
    INVALID_INPUT: [error_INVALID_INPUT, NO_CHART],
    NOT_AUTHENTICATED: [error_NOT_AUTHENTICATED, SIGNED_OUT],
  }),
  budget: budget("write"),
});

export const operation_org_books_accounts_list = defineOperation({
  ...frozenText("org.books.accounts.list"),
  was: [page("org.books.accounts.list"), `${CLI}/accounts/subcommands/list/execute.ts:13`, `${SDK}/accounts.ts:182`],
  priority: "normal",
  implementedBy: rpc_books_accounts_list,
  acceptance: [keep("org.books.accounts.list", 1, "cli: WRONG_STATE `no_chart` before the import, then the accounts in code order.")],
  returns: rpc_books_accounts_list.output,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.list", {
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

export const operation_org_books_accounts_add = defineOperation({
  ...frozenText("org.books.accounts.add"),
  was: [page("org.books.accounts.add"), `${CLI}/accounts/subcommands/add/execute.ts:13`, `${SDK}/accounts.ts:190`],
  priority: "normal",
  implementedBy: rpc_books_accounts_add,
  acceptance: [
    keep("org.books.accounts.add", 1, "cli: `--under 6100` returns code 6101 with the parent's type."),
    keep("org.books.accounts.add", 2, "cli: a top-level expense returns the next free hundred in 6000-6999."),
    rewrite(
      "org.books.accounts.add",
      3,
      "Each committed account is reported once as added, and a refused add reports nothing.",
      "trace: one book_account_transitioned (transition add) per committed account, none for a refused add.",
    ),
    keep("org.books.accounts.add", 4, "cli: WRONG_STATE (no chart, archived parent), INVALID_INPUT (full range) and ROLE_PERMISSION_DENIED (no Books hat, outsider)."),
  ],
  returns: Schema.Struct({
    accountId: S,
    code: S,
    name: S,
    type: AccountType,
    parent: NullOr(AccountRef),
    status: Schema.Literal("active"),
  }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.add", {
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("write"),
});

export const operation_org_books_accounts_rename = defineOperation({
  ...frozenText("org.books.accounts.rename"),
  was: [page("org.books.accounts.rename"), `${CLI}/accounts/subcommands/rename/execute.ts:18`, `${SDK}/accounts.ts:202`],
  priority: "normal",
  implementedBy: rpc_books_accounts_rename,
  acceptance: [
    keep("org.books.accounts.rename", 1, "cli: the account by code and by `acct_` id renamed and renumbered; read: an account_renamed fact."),
    keep("org.books.accounts.rename", 2, "cli: the sub-account keeps its parent and type; its name comes back trimmed."),
    keep("org.books.accounts.rename", 3, "cli: the account's own code succeeds, and a code freed by an archive is taken."),
    rewrite(
      "org.books.accounts.rename",
      4,
      "A call that changes nothing reports no change.",
      "trace: no book_account_transitioned for it; read: no account_renamed fact.",
    ),
    rewrite(
      "org.books.accounts.rename",
      5,
      "An archived account is refused and nothing is reported.",
      "cli: WRONG_STATE; trace: no book_account_transitioned.",
    ),
  ],
  returns: Schema.Struct({ accountId: S, code: S, name: S, type: AccountType }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.rename", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("write"),
});

export const operation_org_books_accounts_archive = defineOperation({
  ...frozenText("org.books.accounts.archive"),
  was: [page("org.books.accounts.archive"), `${CLI}/accounts/subcommands/archive/execute.ts:10`, `${SDK}/accounts.ts:213`],
  priority: "normal",
  implementedBy: rpc_books_accounts_archive,
  acceptance: [
    keep("org.books.accounts.archive", 1, "cli: status `archived`; read: an account_archived fact and `accounts list` leaves it out."),
    rewrite(
      "org.books.accounts.archive",
      2,
      "A sub-account and then its parent are each reported once as archived.",
      "trace: two book_account_transitioned (transition archive), one per account.",
    ),
    rewrite(
      "org.books.accounts.archive",
      3,
      "Another Organization's account is refused and nothing is reported.",
      "cli: ROLE_PERMISSION_DENIED; trace: no book_account_transitioned; world: no change.",
    ),
  ],
  returns: Schema.Struct({ accountId: S, code: S, status: Schema.Literal("archived") }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.archive", {
    WRONG_STATE: [error_WRONG_STATE, CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("write"),
});

export const operation_org_books_accounts_review = defineOperation({
  ...frozenText("org.books.accounts.review"),
  was: [page("org.books.accounts.review"), `${CLI}/accounts/subcommands/review/execute.ts:19`, `${SDK}/accounts.ts:214`],
  priority: "normal",
  implementedBy: flow_client_org_books_accounts_review,
  acceptance: [
    keep("org.books.accounts.review", 1, "cli: each waiting row with its account and suggested name, oldest first."),
    keep("org.books.accounts.review", 2, "cli: an outside deposit is listed with no suggestion until `--accept --name` gives it an account, then it is gone."),
  ],
  returns: Schema.Struct({
    rows: Schema.Array(Schema.Struct({ reference: Reference, account: AccountRef, suggestion: NullOr(S), waitingSince: N })),
  }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.review", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("write"),
});

export const operation_org_books_accounts_reclassify = defineOperation({
  ...frozenText("org.books.accounts.reclassify"),
  was: [page("org.books.accounts.reclassify"), `${CLI}/accounts/subcommands/reclassify/execute.ts:43`, `${SDK}/reclassify.ts:31`],
  priority: "normal",
  implementedBy: rpc_books_accounts_reclassify,
  acceptance: [
    keep("org.books.accounts.reclassify", 1, "cli: `moved` lists every waiting row of the period and one `factId`; read: one rows_reclassified fact."),
    keep("org.books.accounts.reclassify", 2, "cli: `moved` and `refused` with each reason."),
    keep("org.books.accounts.reclassify", 3, "cli: from org-with-straddling-payout, the payout's row is in `refused` with `straddles_period`, with or without `--row`."),
    rewrite(
      "org.books.accounts.reclassify",
      4,
      "When nothing moves it records no fact and reports no change.",
      "cli: `factId` null; read: no rows_reclassified fact; trace: no book_annotation_transitioned.",
    ),
    keep("org.books.accounts.reclassify", 5, "cli: the second call's `moved` is empty and its `factId` null."),
  ],
  returns: rpc_books_accounts_reclassify.output,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.accounts.reclassify", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("write"),
});

export const operation_org_books_export_quickbooks = defineOperation({
  ...frozenText("org.books.export.quickbooks"),
  was: [page("org.books.export.quickbooks"), `${CLI}/export/subcommands/quickbooks/execute.ts:1`, `${SDK}/exports.ts:1`],
  priority: "normal",
  implementedBy: rpc_books_exports_quickbooks,
  acceptance: [
    keep(
      "org.books.export.quickbooks",
      1,
      "cli: the two files in `--out`; their rows are the chart and one balanced entry per priced money fact in the window (and per document voucher, when the world has one).",
    ),
    keep("org.books.export.quickbooks", 2, "cli: WRONG_STATE `no_chart` before the import, then the files."),
  ],
  returns: Schema.Struct({
    from: N,
    to: N,
    accounts: S,
    journal: S,
    entries: N,
    unpriced: Unpriced,
  }),
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusalsOf("org.books.export.quickbooks", {
    CLI_STORAGE: [error_CLI_STORAGE, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

export const operation_org_books_reports_balance_sheet = defineOperation({
  ...frozenText("org.books.reports.balance-sheet"),
  was: [page("org.books.reports.balance-sheet"), `${CLI}/reports/subcommands/balance-sheet/execute.ts:1`, `${SDK}/reports.ts:59`],
  priority: "normal",
  implementedBy: rpc_books_reports_balance_sheet,
  acceptance: [
    keep("org.books.reports.balance-sheet", 1, "cli: assets equal `liabilitiesAndEquity`."),
    keep("org.books.reports.balance-sheet", 2, "cli: money settled before the import shows under a Safe account per asset once the chart is made."),
    keep("org.books.reports.balance-sheet", 3, "cli: `asOf` is now without the flag, and the end of the given day with it."),
  ],
  returns: Schema.Struct({
    rules: Rules,
    currency: S,
    asOf: N,
    sections: Schema.Array(Section),
    currentEarnings: S,
    liabilitiesAndEquity: S,
    unpriced: Unpriced,
  }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.reports.balance-sheet", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

export const operation_org_books_reports_profit_and_loss = defineOperation({
  ...frozenText("org.books.reports.profit-and-loss"),
  was: [page("org.books.reports.profit-and-loss"), `${CLI}/reports/subcommands/profit-and-loss/execute.ts:1`, `${SDK}/reports.ts:48`],
  priority: "normal",
  implementedBy: rpc_books_reports_profit_and_loss,
  acceptance: [
    keep("org.books.reports.profit-and-loss", 1, "cli: money just before `--from` and just after `--to` is not in the totals."),
    keep("org.books.reports.profit-and-loss", 2, "cli: the parent's total includes its sub-account's once, and the section total counts it once."),
    keep("org.books.reports.profit-and-loss", 3, "cli: after 6999 is renumbered, unannotated money out still shows under it."),
  ],
  returns: Schema.Struct({
    rules: Rules,
    currency: S,
    from: N,
    to: N,
    sections: Schema.Array(Section),
    grossProfit: S,
    netIncome: S,
    unpriced: Unpriced,
  }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.reports.profit-and-loss", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    INVALID_INPUT: [error_INVALID_INPUT, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

export const operation_org_books_reports_reconcile = defineOperation({
  ...frozenText("org.books.reports.reconcile"),
  was: [page("org.books.reports.reconcile"), `${CLI}/reports/subcommands/reconcile/execute.ts:1`, `${SDK}/reports.ts:1`],
  priority: "normal",
  implementedBy: rpc_books_reports_reconcile,
  acceptance: [
    keep("org.books.reports.reconcile", 1, "cli: `matches` true with every `difference` 0, including while a claim escrow the Organization funded is open."),
    keep("org.books.reports.reconcile", 2, "cli: one line per Capxul asset and per added token; chain: each line's `chain` equals the Safe's balanceOf."),
    keep("org.books.reports.reconcile", 3, "cli: after a Transfer the books never saw (a devnet mint to the Safe), that asset's `difference` is the amount; lines in name order."),
  ],
  returns: rpc_books_reports_reconcile.output,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.reports.reconcile", {
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    PROVIDER_ERROR: [error_PROVIDER_ERROR, NODE_DOWN],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("chain-read"),
});

export const operation_org_books_reports_trial_balance = defineOperation({
  ...frozenText("org.books.reports.trial-balance"),
  was: [page("org.books.reports.trial-balance"), `${CLI}/reports/subcommands/trial-balance/execute.ts:1`, `${SDK}/reports.ts:59`],
  priority: "normal",
  implementedBy: rpc_books_reports_trial_balance,
  acceptance: [
    keep("org.books.reports.trial-balance", 1, "cli: WRONG_STATE `no_chart` before the import, then the report."),
    keep("org.books.reports.trial-balance", 2, "cli: total debits equal total credits; the Safe account's `holds` equals the Safe's balance."),
    keep("org.books.reports.trial-balance", 3, "cli: a payment out debits its row's account and credits the Safe account; a deposit the reverse."),
    keep("org.books.reports.trial-balance", 4, "cli: `unpriced` counts the fact with no USD; an account_created fact moves no total."),
  ],
  returns: rpc_books_reports_trial_balance.output,
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.books.reports.trial-balance", {
    CLI_USAGE: [error_CLI_USAGE, CHART],
    WRONG_STATE: [error_WRONG_STATE, NO_CHART],
    ROLE_PERMISSION_DENIED: [error_ROLE_PERMISSION_DENIED, CHART],
  }),
  budget: budget("read"),
});

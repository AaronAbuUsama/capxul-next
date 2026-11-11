// Moved out of the built book by the cut, 10 November 2026, from books/target/books/decisions.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { component_frappe_app, concept_books } from "../shared/foundation.ts";
import {
  event_book_account_transitioned,
  event_book_annotation_transitioned,
  event_book_asset_transitioned,
  event_book_company_transitioned,
  event_book_document_voucher_transitioned,
  machine_book_account,
  machine_book_annotation,
  machine_book_asset,
  machine_book_company,
  machine_book_document_voucher,
  table_book_accounts,
  table_book_annotations,
  table_book_assets,
  table_book_companies,
  table_book_cost_centers,
  table_book_facts,
  table_book_document_vouchers,
  table_book_head_syncs,
  table_book_prices,
  invariant_books_facts_append_only,
  invariant_books_feed_gap_free,
  invariant_books_one_author_per_voucher,
  invariant_books_one_live_money_fact,
  invariant_books_postings_balance,
} from "./data.ts";
import {
  procedure_books_record_money_fact,
  procedure_books_record_payroll_accrual,
  procedure_books_reverse_money_fact,
} from "./procedures.ts";
import {
  rpc_books_accounts_accept,
  rpc_books_accounts_add,
  rpc_books_accounts_archive,
  rpc_books_accounts_import,
  rpc_books_accounts_list,
  rpc_books_accounts_reclassify,
  rpc_books_accounts_rename,
  rpc_books_accounts_review,
} from "./accounts.ts";
import { rpc_books_annotations_save } from "./annotations.ts";
import { rpc_books_assets_add, rpc_books_assets_list, rpc_books_assets_remove } from "./assets.ts";
import { rpc_books_facts_list } from "./facts.ts";
import { rpc_books_sync_feed } from "./sync.ts";
import {
  rpc_books_reports_balance_sheet,
  rpc_books_reports_profit_and_loss,
  rpc_books_reports_reconcile,
  rpc_books_reports_trial_balance,
} from "./reports.ts";
import { rpc_books_exports_quickbooks } from "./exports.ts";
import { workflow_books_assets_scan_added, workflow_books_head_sync, workflow_books_prices_sync } from "./processes.ts";
import { flow_client_org_books_accounts_review, flow_client_org_books_sync_follow } from "./flows.ts";
import * as ops from "./operations.ts";

export const decision_books_rows_by_id = defineDecision({
  id: "books.rows-by-id",
  title: "Accept and reclassify take a row's id; books finds its kind",
  question: "The old CLI read the review queue to find each `--row` and `--accept` id's kind before calling. Who resolves it now?",
  options: [
    { label: "books", text: "The rpcs take ids only and find each row's kind from books' own facts and annotations." },
    { label: "client", text: "The SDK reads the queue first, then calls with kinds." },
  ],
  chosen: "books",
  why: "Books holds every row it can move, so resolving there removes a client round trip and keeps reclassify a single rpc behind its SDK method (A4).",
  source: by("apps/cli/src/commands/org/subcommands/books/subcommands/accounts/subcommands/reclassify/execute.ts:34; review/execute.ts:26"),
  affects: [rpc_books_accounts_reclassify, rpc_books_accounts_accept],
});

export const decision_books_review_flow = defineDecision({
  id: "books.review-flow",
  title: "`org books accounts review` is one SDK flow: the queue, then an accept",
  question: "The old command called `books.accounts.review`, and with `--accept` also `books.accounts.accept`. A4 allows the CLI one SDK method. Which?",
  options: [
    { label: "flow", text: "One flow: read the queue; with `accept`, accept a row only if the queue lists it, else return `notInQueue` for the CLI's CLI_USAGE." },
    { label: "rpc", text: "One rpc that reads or accepts depending on its input." },
  ],
  chosen: "flow",
  why:
    "An rpc is one kind (a query or a mutation); a read that sometimes writes would blur both. The frozen surface keeps " +
    "CLI_USAGE for an `--accept` id not in the queue (P10 rung 1), so the flow reads the queue first and the CLI, not the " +
    "SDK, turns `notInQueue` into its own code (the SDK never returns CLI codes). The frozen note naming two SDK methods " +
    "stays as frozen text.",
  source: by("apps/cli/src/commands/org/subcommands/books/subcommands/accounts/subcommands/review/execute.ts:21; A4; org.books.accounts.review.yaml notes"),
  affects: [flow_client_org_books_accounts_review, rpc_books_accounts_review, rpc_books_accounts_accept, ops.operation_org_books_accounts_review],
});

export const decision_books_prices_sync = defineDecision({
  id: "books.prices-sync",
  title: "One price writer: the Chainlink sync; devnet prices come through its fake",
  question: "The old prices had two writers (the devnet-only set-price and the five-minute Chainlink sync) and a stand-in series. What stays?",
  options: [
    { label: "one-writer", text: "Only the five-minute sync writes `book-prices`; on a devnet the Chainlink fake answers the devnet's scripted rates." },
    { label: "as-is", text: "Keep a devnet set-price rpc in books and the stand-in series." },
  ],
  chosen: "one-writer",
  why:
    "Scripted prices are devnet's (concepts.devnet), read by the integration's fake, so books keeps no devnet rpc and one " +
    "code path writes rates everywhere. The stand-in series hid a missing price on a devnet that staging would show as " +
    "unpriced. P3 keeps this cron.",
  source: by(`${B}/facts/operations/price.ts:23; ${B}/facts/operations/prices.ts:35; ${B}/facts/rules.ts:108; P3`),
  affects: [workflow_books_prices_sync, table_book_prices],
});

export const decision_books_reconcile_held = defineDecision({
  id: "books.reconcile-held",
  title: "On v4, 'money in agreements' is money held outside the Safe: open escrows",
  question:
    "The reconcile shows 'what open agreements hold' and its line 1 says the chain's balance and the money in " +
    "agreements explain the books. On v4 an agreement reserves its money in Budgets, inside the Safe. What fills the column?",
  options: [
    {
      label: "escrows",
      text:
        "`held` is what the Organization's open escrows hold (money that left the Safe and is booked out only when the " +
        "escrow pays); agreements hold nothing outside the Safe. Line 1 stays word for word.",
    },
    { label: "reserved", text: "Show what Budgets reserves for open agreements, and subtract it." },
  ],
  chosen: "escrows",
  why:
    "Subtracting a reservation would count money twice: it is still in the Safe's balance and in the books. A claim " +
    "escrow is the v4 case the old column covered: money funded out of the Safe before its Payment settles. The frozen " +
    "claim still holds, since agreements now explain a zero difference. The balance is read live with chain-rpc for " +
    "every asset, added tokens included, which Ponder does not index.",
  source: by(`${B}/reports/operations/reconcile.ts:7; ${B}/README.md:330 (readAgreementHoldingsInTx); packages/contracts/v4/src/interfaces/IEscrow.sol:8`),
  affects: [rpc_books_reports_reconcile, ops.operation_org_books_reports_reconcile],
});

export const decision_books_export_files_by_cli = defineDecision({
  id: "books.export-files-by-cli",
  title: "The SDK returns the two export files; the CLI writes them",
  question: "Who writes `chart-of-accounts.csv` and `journal-entries.csv`, and so who refuses CLI_STORAGE?",
  options: [
    { label: "cli", text: "The SDK method returns both files' text and counts; the CLI writes them, never over a file, and removes the chart if the journal fails." },
    { label: "sdk", text: "An SDK flow with a local step writes the files (the shared landing note's reading)." },
  ],
  chosen: "cli",
  why:
    "The shared vocabulary says the SDK never returns the CLI's own codes, and the frozen refusal is CLI_STORAGE; MCP and " +
    "browser hosts want the text, not a file on the host. Writing output is the CLI's printing, not orchestration (A4). " +
    "The shared landing for books/exports says 'written by the SDK': this decision reads it as 'produced by the SDK'.",
  source: by("books/target/shared/vocabulary.ts (the CLI's own codes); books/target/shared/landings.ts (books/exports); quickbooks.yaml notes"),
  affects: [rpc_books_exports_quickbooks, ops.operation_org_books_export_quickbooks],
});

export const decision_books_no_fork = defineDecision({
  id: "books.no-fork",
  title: "ERPNext accounting is not forked",
  question:
    "Fork ERPNext's accounting only if Capxul-native cannot feel integrated. Does anything in the books' design need a " +
    "fork of ERPNext Accounts, or an overridden doctype class?",
  options: [
    {
      label: "no-fork",
      text:
        "No. The Capxul app for Frappe (component frappe-app) with configuration, Custom Fields and hooks only: " +
        "`capxul_id` and `capxul_version` (indexed, not unique, since an amendment carries its predecessor's id; the app " +
        "keeps one live document per id); Safe accounts frozen, the Company's `role_allowed_for_frozen_entries` a role " +
        "only the app's user holds; the immutable ledger on; invoices' unlink-on-cancel off; a `Capxul` Mode of Payment; " +
        "a Currency per token; currency precision at least the assets' (up to 9); hooks on Journal and Payment Entry " +
        "(`before_submit`, `before_cancel`, `before_update_after_submit`) refusing every change to a Capxul voucher the " +
        "sync did not make, and any other voucher with a line on a Safe account; and a 'Pay with Capxul' action on " +
        "invoices that opens Capxul's own payment command, prefilled with the payee, the amount and the voucher's other " +
        "side, for a person or the Organization's agent to sign in Capxul: the head holds no key and moves no money.",
    },
    { label: "override-classes", text: "Override Payment Entry and Journal Entry in the app to post from facts." },
    { label: "fork-accounts", text: "Fork ERPNext Accounts so the bank is a Safe throughout." },
  ],
  chosen: "no-fork",
  why:
    "Every Capxul voucher is a standard Journal or Payment Entry that passes ERPNext's own validations: a party where " +
    "the account needs one, a reference number and date on a bank entry (the transaction and the block's day), exchange " +
    "rates given, cost centres on profit and loss. Four details the app must get right, all within its rights: it " +
    "inserts with `flags.ignore_exchange_rate`, since a Journal Entry refetches a rate of exactly 1, which a stablecoin's " +
    "often is; it cancels with the request's `posting_date` set, which the immutable ledger dates the reversal by (else " +
    "today); it refuses Payment Reconciliation and allow-on-submit edits (cost centre, project) on a Capxul voucher, " +
    "since both change it after submit, and offers its own classify action instead, which reaches the books through the " +
    "head sync; and it keeps unlink-on-cancel off, so an invoice a Capxul payment settles cannot be cancelled until " +
    "Capxul drops the allocation. Freezing alone does not stop the site's Administrator, who holds every role, hence " +
    "the hook. The Bank Reconciliation workspace is hidden, not removed. What would force a fork: an asset with more " +
    "decimals than Frappe's 9 (WETH's 18) rounds in the head while Capxul's raw units stay exact; showing the chain's " +
    "live status in the form is a client script.",
  source: byFrappe("build-on-frappe skill; erpnext gl_entry.py:430, journal_entry.py:764, general_ledger.py:760, accounts_controller.py:1358; frappe mariadb/database.py:188"),
  affects: [concept_books, rpc_books_sync_feed, workflow_books_head_sync, invariant_books_one_author_per_voucher],
});

export const decision_books_hr_money = defineDecision({
  id: "books.hr-money",
  title: "An expense claim accrues at approval; claims and advances post as Frappe HR's do",
  question:
    "Payroll now pays expense claims and employee advances from a department's budget (payroll.hr-money). How do they " +
    "reach the books, which read neither payroll nor payments?",
  options: [
    {
      label: "door-and-against",
      text:
        "Approving a claim invokes `books.record-payroll-accrual` (action `expense_claim`): each line's sanctioned " +
        "amount debited to its Expense Claim Type's account (null: the default expense account), each advance it takes " +
        "credited to Employee Advances (a receivable, Frappe's default_employee_advance_account, line role `advance`, " +
        "reference the Employee Advance), and the grand total credited to the payable, party the Employee, reference the " +
        "Expense Claim, on the approval's day, with its `accrual_posted` fact; cancelling it (`expense_claim_cancel`) " +
        "records `accrual_cancelled`. A settled Payment posts by the `against` payroll gives its item: a claim's, Dr the " +
        "payable (reference the Expense Claim) and Cr the paying Safe's account; an advance's, Dr Employee Advances " +
        "(reference the Employee Advance) and Cr the Safe's account. A run's advance-recovery deduction credits Employee " +
        "Advances (reference the Employee Advance).",
    },
    { label: "review", text: "Every HR payment waits in review for a Books-hat wearer, as unclassified money does." },
  ],
  chosen: "door-and-against",
  why:
    "It is how Frappe HR posts them: an Expense Claim's make_gl_entries debits each expense and credits the payable, " +
    "less the advances it allocates, and an Employee Advance's payment debits the advance account; so a head that " +
    "connects later rebuilds the same ledger. The accrual and its claim are one money fact in payroll's transaction, " +
    "as a run's are (books.payroll-accrual), and the settlement already names its source through `against` " +
    "(books.payroll-postings), so books learns no HR table. Review would leave every claim unbooked until someone " +
    "classified it, which Frappe never asks.",
  source: "Claude, world pass build, 9 November 2026; evidence: payroll.hr-money; hrms expense_claim.py (make_gl_entries); employee_advance.py; payroll_entry.py:481 (add_advance_deduction_entry)",
  affects: [procedure_books_record_payroll_accrual, concept_books],
});

export const decision_books_head_vouchers = defineDecision({
  id: "books.head-vouchers",
  title: "Capxul keeps a head's own vouchers as their GL Entries",
  question:
    "A head posts vouchers Capxul does not (Sales and Purchase Invoices, accruals, depreciation, a payroll run's " +
    "accrual, a year's closing). Does Capxul keep them, and how much of them?",
  options: [
    {
      label: "gl-lines",
      text:
        "Keep each as its header (type, number, posting date, docstatus, party, a closing's period end) and its GL Entry " +
        "lines, accounts and cost centres by Capxul's ids; not the invoice's items or taxes. Reports sum them with " +
        "Capxul's vouchers, so they equal the head's; `basis` reads `accrual` once one exists.",
    },
    { label: "documents", text: "Keep the head's invoices, orders and payroll documents themselves." },
    { label: "none", text: "Keep nothing of the head's: Capxul's books are its money only." },
  ],
  chosen: "gl-lines",
  why:
    "The GL is what every ERPNext financial statement reads, so its lines are the least that makes Capxul's books the " +
    "Organization's whole books and keeps them complete if the head is gone; the documents behind them stay the head's, " +
    "as the documents of selling and buying are not accounting. With `none`, a payment allocated to an invoice would " +
    "debit payables that Capxul never credited. Aaron should confirm this reading of 'accounting synced': that Capxul " +
    "holds a copy of the head's ledger, authored by the head, rather than only its own money's vouchers.",
  source: byFrappe(`${ERP}/gl_entry/gl_entry.json; ${ERP}/period_closing_voucher/period_closing_voucher.json; rulings.ts (aaron.frappe-head)`),
  affects: [
    table_book_document_vouchers,
  ],
});

export const decision_books_payroll_lines = defineDecision({
  id: "books.payroll-lines",
  title: "A payroll accrual's lines come in the run's token; books fixes them once charted",
  question:
    "The accrual door took lines 'in the Company's currency' with accounts resolved by role. Payroll computes in the " +
    "run's token and cannot know the Company's currency, which the import fixes (books.company-settings), nor the " +
    "chart's role accounts before there is a chart; a voucher kept before the chart has neither. Who values and " +
    "accounts a payroll line, when, and on which day does it post?",
  options: [
    {
      label: "token-lines-fixed-once",
      text:
        "Payroll gives its lines in the run's token, with Frappe HR's accounts or null, and books keeps them as given. " +
        "When the books are charted (at the record, or by the import for one recorded before), books fixes the GL lines " +
        "once: each null or unfit account to its role's; each amount in the Company's currency at par when that currency " +
        "is the token's peg (USD for USDC, EUR for EURC), else through the two USD rates in force at the record, any " +
        "rounding left on exchange gain or loss (6510). A run's voucher posts on its `posting_date`, a collection's on " +
        "its block's day, a cancellation on the day of `at`, each a day in the Company's time zone and moved to the first " +
        "open day when on or before `closed_through`. The lines are Frappe HR's: an earning's `account` and an employer " +
        "contribution's are expense, a deduction's `account` and an employer contribution's `liability_account` are " +
        "liability, and only a net's Payroll Payable line names the Payroll Entry.",
    },
    { label: "payroll-converts", text: "Payroll converts its lines into the Company's currency and resolves the accounts before it invokes the door." },
    { label: "derive-on-read", text: "Derive a payroll voucher's GL lines from payroll's lines every time it is read, as a money fact's voucher is." },
  ],
  chosen: "token-lines-fixed-once",
  why:
    "Books owns the Company's currency, the prices and the chart; payroll reads none of them before the chart and would " +
    "copy books' rules if it converted. Deriving on every read would move a posted accrual when an account is archived " +
    "or a price row arrives late, and ERPNext never moves a submitted entry. At par for the peg is what the slip says " +
    "and what Frappe HR posts with the exchange rate 1 the Capxul app sets on a head, and it matches the at-par " +
    "allocation of each slip's Bank Entry (books.vouchers), so an Employee's Payroll Payable closes exactly; another " +
    "currency is valued at the record's rates, the Bank Entry's difference going to 6510 as ERPNext's does. Moving a " +
    "closed day forward is what books.closed-periods does for late money, since a head refuses a posting on or before " +
    "its closing. Frappe HR posts employer contributions as a second Journal Entry; Capxul keeps them in the run's one " +
    "voucher, which still balances and is keyed by the run. A deduction's liability is its component's `account` in " +
    "Frappe HR (`make_accrual_jv_entry` credits it); `liability_account` is an employer contribution's.",
  source: byAssembly("hrms payroll_entry.py:619, :784, :891, :1011; books.company-settings, books.vouchers, books.closed-periods"),
  affects: [
    table_book_document_vouchers,
  ],
});

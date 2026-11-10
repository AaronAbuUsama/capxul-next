# Research: accounting, as a user sees it, re-skinned as Capxul's Books

Step: Research (accounting) of the Capxul mock-up (`demo/PROGRESS.md`). Written 9 November 2026.

This page describes every accounting screen of ERPNext as a user sees it today. For each screen it gives the
purpose, the layout, every field or column with an example value, the actions and their states, and how Capxul's
re-skin should show it: the same structure, under Capxul's names and identity, with the matching `capxul` command.
The data, shell and module steps build from it.

Everything on this page about Frappe is for the builders only. Nothing in the mock-up may say Frappe, ERPNext,
"head" or "DocType" (`aaron.one-product`, `books/target/shared/rulings.ts:696-714`). Section 2 lists the words to
replace.

## Contents

1. [Sources](#1-sources)
2. [The rules of the re-skin](#2-the-rules-of-the-re-skin)
3. [The frame every accounting screen shares](#3-the-frame-every-accounting-screen-shares)
4. [Status indicators and their colours](#4-status-indicators-and-their-colours)
5. [Screens](#5-screens)
   - 5.1 [Books home (the Accounting workspace)](#51-books-home-the-accounting-workspace)
   - 5.2 [Chart of accounts (tree)](#52-chart-of-accounts-tree)
   - 5.3 [Account (form)](#53-account-form)
   - 5.4 [Sales invoices (list)](#54-sales-invoices-list)
   - 5.5 [Sales invoice (form)](#55-sales-invoice-form)
   - 5.6 [Purchase invoices (list)](#56-purchase-invoices-list)
   - 5.7 [Purchase invoice (form)](#57-purchase-invoice-form)
   - 5.8 [Payment entries (list)](#58-payment-entries-list)
   - 5.9 [Payment entry (form), with its proof](#59-payment-entry-form-with-its-proof)
   - 5.10 [Journal entries (list and form)](#510-journal-entries-list-and-form)
   - 5.11 [General ledger (report)](#511-general-ledger-report)
   - 5.12 [Trial balance (report)](#512-trial-balance-report)
   - 5.13 [Profit and loss (report)](#513-profit-and-loss-report)
   - 5.14 [Balance sheet (report)](#514-balance-sheet-report)
   - 5.15 [Cash flow (report)](#515-cash-flow-report)
   - 5.16 [Accounts receivable and payable, with ageing](#516-accounts-receivable-and-payable-with-ageing)
   - 5.17 [Banking: reconciliation of Safes and the bank account](#517-banking-reconciliation-of-safes-and-the-bank-account)
   - 5.18 [Bank account (form)](#518-bank-account-form)
   - 5.19 [Chart of cost centres (tree)](#519-chart-of-cost-centres-tree)
   - 5.20 [Fiscal years and closing a year](#520-fiscal-years-and-closing-a-year)
   - 5.21 [Review queue (Capxul's own, inside Books)](#521-review-queue-capxuls-own-inside-books)
   - 5.22 [Money facts (Capxul's own, inside Books)](#522-money-facts-capxuls-own-inside-books)
6. [A chart of accounts for Harbourline](#6-a-chart-of-accounts-for-harbourline)
7. [Every screen and action and its command](#7-every-screen-and-action-and-its-command)
8. [Points for the later steps](#8-points-for-the-later-steps)

---

## 1. Sources

| Source | Version | Used for |
|---|---|---|
| ERPNext, `/tmp/erpnext` (from `github.com/frappe/erpnext`, the `develop` branch) | commit `6b946b0f`, 8 November 2026 | every doctype's fields, tabs, sections and list settings; workspaces, sidebar, number cards and charts; report filters and columns; form buttons |
| ERPNext's new Banking screen, `/tmp/erpnext/banking/src` (a React app served at `/banking`) | the same commit | the bank reconciliation screen's layout, tabs, balance panel and actions |
| Frappe, `/tmp/frappe` (a sparse clone) and `frappe/public/js/frappe/model/indicator.js` fetched from `github.com/frappe/frappe` `develop` | commit `1a7ea57`, 8 November 2026 | default status colours (Draft, Submitted, Cancelled) |
| ERPNext's documentation, `https://docs.frappe.io/erpnext/…` (`docs.erpnext.com` redirects there) | fetched 9 November 2026 | the v16 layout in its screenshots, and the field and status explanations |
| `docs/design/frappe/accounting.md` | working tree | Capxul's books in ERPNext's shape: the chart, the role accounts, the vouchers money facts post |
| `docs/design/frappe/bridge-work/design-bank.md` | working tree (the payments bridge study, in progress) | Safes as bank accounts, the chain as their statement, the payment advice the document hash commits to, Bridge's two hops |
| `docs/design/command-surface.md`, `docs/design/new-commands.md` (G7), `books/frozen/flags.ts` | working tree | command spellings, SDK method names and flags |
| `books/target/shared/rulings.ts` | working tree | `aaron.frappe-native` (:667), `aaron.one-product` (:696), `aaron.other-accounts` (:716), `aaron.departments` (:406) |

The ERPNext screenshots that were read, all from `https://novacompanies.m.frappe.cloud/files/` (linked from the docs
pages named):

- `01-sales-invoice-list.png`, `02-customer-and-dates.png`, `06-taxes-and-totals.png`, `08-create-payment.png`
  (https://docs.frappe.io/erpnext/sales-invoice)
- `payments-04-payment-entry-party-amount.png` (https://docs.frappe.io/erpnext/payment-entry)
- `docs-20260814-nova-industries-general-ledger-voucher-postings.png` (https://docs.frappe.io/erpnext/general-ledger)
- `docs-accounting-reports-20260814-accounts-receivable.png` (https://docs.frappe.io/erpnext/accounts-receivable-and-payable)
- `docs-20260814-nova-industries-balance-sheet-loaded.png` (https://docs.frappe.io/erpnext/balance-sheet)
- `https://docs.frappe.io/files/chart-of-accounts-tree773763.webp` (https://docs.frappe.io/erpnext/chart-of-accounts)
- `https://docs.frappe.io/files/bank-reconciliation-tool.png` (https://docs.frappe.io/erpnext/bank-reconciliation)

Paths below are short: `erpnext:` is `/tmp/erpnext/erpnext/`, `acc:` is `/tmp/erpnext/erpnext/accounts/`, `banking:` is
`/tmp/erpnext/banking/src/`.

---

## 2. The rules of the re-skin

### 2.1 What stays

- **The structure.** Every screen keeps ERPNext's regions, tabs, sections, field order, list columns, filters, report
  columns, status values and actions. A person who knows ERPNext should recognise every screen. A person who does not
  should never learn that it exists.
- **Accounting's own words.** Sales Invoice, Purchase Invoice, Payment Entry, Journal Entry, General Ledger, Trial
  Balance, Profit and Loss, Balance Sheet, Cash Flow, Accounts Receivable, Accounts Payable, Cost Center, Fiscal Year,
  Debit, Credit, Party, Voucher, Posting Date. These are bookkeeping terms, not Frappe's brand. They stay.

### 2.2 What changes

- **Capxul's identity.** Capxul's palette, fonts, icons and layout (the shell step decides them). Labels in sentence
  case ("Posting date", not "Posting Date"), as Capxul's own pages are written. British spelling for a UK company:
  "Cost centre". Tabular numbers everywhere.
- **The workspace is "Books".** The module is called Books, as `org books` is (`command-surface.md` group 7). Its home
  is "Books" in the sidebar, not "Accounting workspace".
- **One company per Organization.** ERPNext appends the company's abbreviation to every account and cost centre
  ("Debtors - NID"). Capxul's Organization is one company, so drop the suffix: "1200 · Accounts receivable", not
  "1200 - Debtors - HL". Drop the Company field from forms and filters, or show it read-only once, because it never
  changes.
- **Naming series.** ERPNext's default `ACC-SINV-.YYYY.-` gives `ACC-SINV-2026-00087`. A company may set its own
  series, so use `SINV-2026-00087`, `PINV-2026-00142`, `PAY-2026-00318`, `JV-2026-00051`, `PCV-2026-00001`.
- **Hidden machinery.** Leave out what a 25-person services firm on Capxul never sees: Finance Book, POS, Loyalty,
  Shipping Rule, Incoterm, Scan Barcode, Warehouse and Update Stock (it sells no stock), UTM Analytics, Inter Company,
  Subscription, Auto Repeat, Letter Head and Print Heading, Tax Withholding (a UK firm does not withhold on invoices),
  "Is System Generated", "Include Default FB Entries", Plaid Settings, Share Management (Capxul's equity module owns
  shares), and every regional tax report.

### 2.3 Words that never appear, and what replaces them

| ERPNext shows | Capxul shows |
|---|---|
| ERPNext, Frappe, Desk, "Frappe HR", "head", "site" | Capxul, Books (nothing else) |
| DocType (in Party Type, Reference Type, Voucher Type pickers) | the values only: Customer, Supplier, Employee; Sales Invoice, Purchase Invoice |
| "Closing Balance as per ERP" (`erpnext:public/js/bank_reconciliation_tool/number_card.js:24`) | "Closing balance as per books" |
| "Frozen" badge on an account (`acc:doctype/account/account_tree.js:79-85`) | a lock badge "Chain": only Capxul's chain postings reach a Safe's account |
| "Accounting Ledger" preview (`erpnext:public/js/utils/ledger_preview.js:8`) | "Ledger preview" |
| "Bank Reconciliation (old)", "Banking" app | "Banking" |
| "COA Importer", "Chart of Accounts Importer" | "Set up the chart" (`org books accounts import`) |
| "Finance Book", "Default FB Entries" | (removed) |
| "Mode of Payment: Wire Transfer / Cash" | "Capxul" (on chain), "Bridge" (fiat through a Safe), "Bank transfer" (the ordinary account) |
| "Amended From" `ACC-SINV-2026-00011-1` | "Amends SINV-2026-00011" |
| "Submit this document to confirm" banner | "Post this invoice to make it final" |

### 2.4 Commands: the rule this page applies

Every screen and action shows its `capxul` command, spelled as `docs/design/command-surface.md` books it, and its SDK
method as `docs/design/new-commands.md` G7 derives it (`org` is `client.org(orgId)`, a group is a namespace, nouns are
plural camelCase, the verb comes last; payments are `client.payments`).

1. **Native commands first.** Where a native command does the thing, show it: `org books accounts list|add|rename|
   archive|import|review|reclassify`, `org books reports trial-balance|profit-and-loss|balance-sheet|reconcile`,
   `org books facts list`, `org books export quickbooks`, `activity annotate`, `request issue|list|get|cancel`,
   `inbox list|get|pay|decline`, `payment send|get|list|cancel|wait|claim`, `org department pay`, `bank pay|accounts|
   deposits|details|match|settle`, `document verify|get|render`.
2. **Invoices, payment entries, journal entries and the rest of the accounting records** have no native command. The
   book reaches them through the document family, booked as `org head doc list|get|create|change|submit|cancel|amend|
   apply|remove` (`command-surface.md` section 6, "The Frappe site"). That spelling carries the word "head", which
   `aaron.one-product` forbids anyone to see. **The mock-up drops the word**: `org doc …`. That is the spelling
   `command-surface.md` lists in its "Before the tree" column for the same 9 operations, so it is still a spelling from
   that page. The record is the plain, kebab-case noun, as G2 spells records: `sales-invoice`, `purchase-invoice`,
   `payment-entry`, `journal-entry`, `account`, `cost-center`, `fiscal-year`, `period-closing-voucher`,
   `bank-account`, `bank-transaction`. SDK: `client.org(orgId).docs.get`, `.create`, `.submit` and so on.
3. **Reports with no native command** (General Ledger, Cash Flow, Accounts Receivable, Accounts Payable, their
   summaries) take the reports command `command-surface.md` 7.4 proposes, `org head report run <Report>`, with the same
   word dropped: `org report run general-ledger --filter …`. Mark it "proposed" in the mock-up's command strip.

Section 7 lists every screen and action with its command. Section 8 records the departure in rule 2 for the critique
step and Aaron.

---

## 3. The frame every accounting screen shares

ERPNext v16's desk, from the screenshots (section 1). The shell step builds Capxul's version of each pattern once.

### 3.1 The app frame

- **Left rail:** an icon per app (Home, Accounting, Buying, Selling, Stock, HR, CRM, Projects…), search, notifications
  and the user's initials at the bottom. In v16 each app also has its own **sidebar**, defined in
  `acc:sidebar/accounts/accounts.json` (section 5.1).
- **Page head:** the title, or a breadcrumb "Sales Invoice / Northstar Retail" with the status pill, then the page's
  buttons on the right, the primary one filled.

Capxul: the shell's sidebar holds the Books section (5.1); the top bar holds search, the company "Harbourline",
"today" (9 November 2026) and the person signed in; the command strip shows the screen's `capxul` command.

### 3.2 List view

From `01-sales-invoice-list.png`:

- **Head:** title ("Sales Invoice"); "List View" switcher (List, Report, Kanban, Calendar, Dashboard); "Default
  Layout"; refresh; "…" menu; primary "+ Add Sales Invoice".
- **Saved filter tabs** (v16's "List Filter" records, `acc:doctype/<doctype>/list_filter/*.json`): pills such as
  "Drafts", "Unpaid", "Overdue", "Credit Notes", "This Month", each with its own columns and sort (5.4).
- **Standard filter row:** one input per `in_standard_filter` field, then "Filter" (add any condition), a clear "x",
  and sort ("Created On", ascending or descending).
- **Rows:** a checkbox; the title field (bold if unread); the status pill; the `in_list_view` columns; the right column
  (`right_column`, Grand Total, right-aligned); the ID; the time since modified ("7 m", "1 w"); the comment count; a
  like heart.
- **Count:** "11 of 11" at the top right of the table.
- **Paging:** "20 · 100 · 500 · 2500" at the bottom left.
- **Bulk actions** appear when rows are ticked: "Actions" menu with Edit, Export, Assign To, Apply Assignment Rule, Add
  Tags, Print, Delete, and the doctype's own, such as "Payment" on invoices
  (`acc:doctype/sales_invoice/sales_invoice_list.js:37-49`).

Capxul: the same, minus Kanban and Calendar for vouchers. Drop the like heart. Keep the comment count. Wide tables
scroll inside their own container at 400px.

### 3.3 Form view

From `02-customer-and-dates.png` and `08-create-payment.png`:

- **Head:** breadcrumb "Sales Invoice / {title}" and the status pill. Buttons by state:
  - Draft: "Create ▾", "Preview ▾" (Ledger preview), "Get Items From ▾", previous and next arrows, "…", primary
    "Submit".
  - Submitted: "View ▾" (Ledger), "Create ▾" (primary), arrows, "…", "Cancel".
  - Cancelled: "Amend" primary.
  - Unsaved: the pill reads "Not Saved" (amber, `indicator.js:28`) and the primary button is "Save".
- **Banner** on a saved draft: "Submit this document to confirm" (light blue).
- **Tabs:** for an invoice, "Details · Payments · Address & Contact · Terms · More Info · Connections". The first tab is
  named "Details" because the doctype starts with fields, not a Tab Break.
- **Sections:** a heading, fields in up to three columns (Column Breaks), collapsible sections shown as a heading with
  a chevron ("Currency and Price List ›").
- **Fields:** label above a grey input; a red asterisk on required fields; read-only fields as grey text.
- **Child tables (grids):** a header row (checkbox, "No.", the `in_list_view` columns, a settings cog), rows with a
  pencil to open the full row form, then "Add row", "Add multiple", and "Download" / "Upload" on the right.
- **Right side panel:** the title and the ID (`ACC-SINV-2026-00011`), print and like icons, then "Assign +",
  "Attachments +", "Tags +", "Share +", then "Last Edited By You · 7 minutes ago" and "Created By You · 7 minutes
  ago".
- **Timeline** under the form (Activity): an "Add a comment" box, then entries such as "Ada Okafor submitted this
  document · 2 weeks ago", "changed value of Status from Unpaid to Paid", "linked Payment Entry PAY-2026-00318", and
  each comment and email.
- **Connections tab:** the doctype's dashboard groups (`*_dashboard.py`), each linked document type with a count and a
  "+" to make one.

Capxul: the same layout. "Submit" reads "Post", and "Cancel" reads "Cancel" with a confirmation built into the page
(no browser confirm). The side panel adds the command for the document (`capxul org doc get sales-invoice
SINV-2026-00087`) under the ID.

### 3.4 Report view (query report)

From the General Ledger, Accounts Receivable and Balance Sheet screenshots:

- **Head:** the report's name; buttons such as "Accounts Receivable Summary" (a related report), "Financial
  Statements ▾", "Actions ▾" (Export, Print, Pick Columns, Add Column, Save As, Set User Settings), refresh, "…".
- **Filter bar:** one control per filter in rows, the first row always visible, "▾" to show the rest.
- **Summary cards** on financial statements: "Total Asset", "Total Liability", "Total Equity", "Provisional Profit /
  Loss (Credit)" (green when positive).
- **Chart** (bar, line or percentage), with a legend.
- **Table:** a row-number column, then the columns; a filter input under each header; tree rows with chevrons on tree
  reports; group and total rows in bold; currency columns right-aligned.
- **Footer:** "For comparison, use >5, <10 or =324. For ranges, use 5:10" and "Execution Time: 0.018306 sec".

Capxul: the same, without the execution time. "Actions" keeps Export (CSV, shown only as a command, since the mock-up
makes no downloads) and Pick Columns.

### 3.5 Tree view

From the Chart of Accounts screenshot: a full-width tree; the head has the company picker, "Expand ▾" (Expand All,
Collapse All), "View ▾" (related reports), "…", primary "New". Each node shows a chevron, the name, badges (account
number, a currency badge when not the company's, "Frozen"), and the balance at the right ("£ 293,745.00 Dr"). Clicking
a node opens its toolbar: "Add Child", "View Ledger", "Update Account Name / Number", "Convert to Group" or
"Convert to Non-Group" (`acc:doctype/account/account_tree.js:286-395`), and Frappe's default "Edit" and "Delete" (`extend_toolbar: true`, `:409`).

---

## 4. Status indicators and their colours

Frappe draws a coloured pill from `get_indicator` (`frappe/public/js/frappe/model/indicator.js:26-125`): unsaved is
"Not Saved" amber; a submittable draft is "Draft" red; a cancelled document is "Cancelled" red; a doctype's own
`get_indicator` comes next; a submitted document with none is "Submitted" blue.

| Record | Status | Colour | Source |
|---|---|---|---|
| Sales Invoice | Draft | red | `acc:doctype/sales_invoice/sales_invoice_list.js:16-28` |
| | Unpaid | orange | |
| | Partly Paid | yellow | |
| | Paid | green | |
| | Overdue | red | |
| | Return (it is a credit note) | gray | |
| | Credit Note Issued | gray | |
| | Unpaid and Discounted · Partly Paid and Discounted · Overdue and Discounted | orange · yellow · red | (invoice discounting: not used) |
| | Internal Transfer | dark grey | (not used) |
| | Cancelled | red | Frappe default |
| Purchase Invoice | Draft | red | Frappe default |
| | Unpaid · Partly Paid · Paid · Overdue | orange · yellow · green · red | `acc:doctype/purchase_invoice/purchase_invoice_list.js:21-51` |
| | Return · Debit Note Issued | gray | |
| | On Hold (no release date) · Temporarily on Hold (release date ahead) | dark grey | |
| | Cancelled | red | Frappe default |
| Payment Entry | Draft · Submitted · Cancelled | red · blue · red | Frappe default; `status` options `acc:doctype/payment_entry/payment_entry.json` |
| Journal Entry | Draft | red | Frappe default |
| | its Entry Type ("Journal Entry", "Bank Entry", "Opening Entry"…) when submitted | blue | `acc:doctype/journal_entry/journal_entry_list.js:4-11` |
| | Cancelled | red | |
| Bank Transaction | Pending · Settled · Unreconciled · Reconciled · Cancelled | (by guess_colour: orange · green · orange · green · red) | `acc:doctype/bank_transaction/bank_transaction.json` |
| Account, Cost Center | Enabled · Disabled | blue · gray | Frappe default on `disabled` |
| Period Closing Voucher | Draft · Submitted · Cancelled | red · blue · red | Frappe default |

The Sales Invoice status options in full (`acc:doctype/sales_invoice/sales_invoice.json`): Draft, Return, Credit Note
Issued, Submitted, Paid, Partly Paid, Unpaid, Unpaid and Discounted, Partly Paid and Discounted, Overdue and Discounted,
Overdue, Cancelled, Internal Transfer. The Purchase Invoice's: Draft, Return, Debit Note Issued, Submitted, Paid, Partly
Paid, Unpaid, Overdue, Cancelled, Internal Transfer.

**Capxul adds the on-chain payment's state** where a payment is in flight. It is the Payment's own status from the
bridge study (`design-bank.md` 1.3): Prepared, Scheduled, Needs retry, Escrowed, In transit, Settled, Cancelled,
Mismatched. It shows as a second, smaller pill beside the invoice's status, such as "Unpaid · Payment in transit", and
never changes the invoice's own status until the chain (and Bridge, for a fiat payout) has spoken
(`aaron.frappe-native`: "Frappe never marks money moved until the chain says so").

Colours in Capxul's palette: keep the semantic mapping (red for Draft, Overdue and Cancelled; orange for Unpaid; yellow
for Partly Paid; green for Paid; gray for returns; blue for Submitted), each a token with a dark-mode value.

---

## 5. Screens

Example values are for the mock-up's company, **Harbourline Studio Ltd**: a UK design and engineering studio, company
currency **GBP**, time zone Europe/London, fiscal year 1 April to 31 March, books closed through 31 March 2026, today 9
November 2026. Its money is in two Safes holding USDC on Base, plus one ordinary bank account at Barclays. The rate in
the examples is 1 USDC = £0.7893. The data step may change any value; the shapes are what matter.

### 5.1 Books home (the Accounting workspace)

**Purpose.** The landing page for the books: headline numbers, the profit-and-loss chart, and links to every report
and record.

**ERPNext's layout** (`acc:workspace/accounting/accounting.json`, label "Accounting", icon `landmark`), top to bottom:

1. Onboarding panel "Accounting Onboarding" (full width; dismissed once set up).
2. Chart "Profit and Loss" (full width, bar): the Profit and Loss Statement report, yearly, fiscal-year based
   (`acc:dashboard_chart/profit_and_loss/profit_and_loss.json`).
3. Three number cards, a third of the width each:
   - **Total Outgoing Bills**: sum of `base_net_total` of submitted Sales Invoices in the current fiscal year
     (`acc:number_card/total_outgoing_bills/total_outgoing_bills.json`), with a monthly percentage change.
   - **Total Incoming Bills**: the same over Purchase Invoices.
   - **Total Incoming Payment**: sum of `base_received_amount` of submitted Payment Entries of type Receive.
   (A fourth card exists, **Total Outgoing Payment**, `base_paid_amount` of type Pay; the Invoicing and Payments
   workspaces show it.)
4. Eleven link cards, a third of the width each:

| Card | Links |
|---|---|
| Financial Statements | Profit and Loss, Balance Sheet, Cash Flow, Trial Balance, General Ledger, Consolidated Report, Custom Financial Statement, Consolidated Trial Balance, Financial Ratios |
| Receivables & Payables | Accounts Receivable, Accounts Receivable Summary, Accounts Payable, Accounts Payable Summary, Customer Ledger Summary, Supplier Ledger Summary, Trial Balance for Party, Customer Credit Balance, Payment Period Based On Invoice Date |
| Registers & Profitability | Sales Register, Purchase Register, Item-wise Sales Register, Item-wise Purchase Register, Gross Profit, Profitability Analysis, Gross and Net Profit Report, Deferred Revenue and Expense, Sales Invoice Trends, Purchase Invoice Trends, Sales Payment Summary |
| Tax & Compliance | TDS Computation Summary, Tax Withholding Details, UAE VAT 201, VAT Audit Report, South Africa VAT Settings, IRS 1099, Electronic Invoice Register |
| Invoicing & Payments | Payment Request, Payment Order, Dunning, Invoice Discounting, Subscription, Subscription Plan |
| Banking | Bank Reconciliation (old), Bank Transaction, Bank Statement Import, Bank, Bank Account Type, Bank Account Subtype, Bank Guarantee, Plaid Settings, Bank Reconciliation Statement, Bank Clearance Summary |
| Reconciliation | Payment Reconciliation, Process Payment Reconciliation, Unreconcile Payment |
| Opening & Closing | COA Importer, Opening Invoice Tool, Accounting Period, FX Revaluation, Period Closing Voucher, Process Deferred Accounting |
| Ledger Tools | Repost Accounting Ledger, Repost Payment Ledger, Ledger Merge, Ledger Health Monitor, Process Statement Of Accounts |
| Share Management | Shareholder, Share Transfer, Share Type, Share Ledger, Share Balance |
| Setup | Currency, Finance Book, Journal Entry Template, Tax Category, Tax Withholding Group, Deduction Certificate, Dunning Type, Cheque Print Template, Currency Exchange Settings, Subscription Settings |

Three smaller workspaces sit beside it: **Invoicing** (chart "Outgoing Bills (Sales Invoice)", monthly bars over the
last year; cards Total Outgoing Bills, Total Incoming Bills, Total Outgoing Payment), **Payments** (chart "Bank
Balance", a monthly line over the last year; cards Total Incoming Payment, Total Outgoing Payment, Total Outgoing
Bills) and **Financial Reports** (chart "Budget Variance"). The **Accounts dashboard**
(`acc:accounts_dashboard/accounts/accounts.json`) puts the four number cards over seven charts: Profit and Loss (full),
Incoming Bills and Outgoing Bills (half each), Accounts Receivable Ageing and Accounts Payable Ageing (half each,
donuts with ranges 30, 60, 90, 120 by due date), Budget Variance (full) and Bank Balance (full).

**The v16 sidebar** (`acc:sidebar/accounts/accounts.json`, title "Accounts", icon `calculator-duotone`), in order:

- Home · Dashboard · Chart of Accounts · Sales Invoice · Purchase Invoice · Payment Entry · Journal Entry
- **Reports** (collapsible): General Ledger, Trial Balance, Trial Balance for Party, Profit and Loss, Balance Sheet,
  Cash Flow, Consolidated Report, Profitability Analysis, Accounts Receivable, Accounts Payable
- **Banking**: Banking (the `/banking` page), Bank Account, Bank Clearance
- **Taxes**: Sales Tax Template, Purchase Tax Template, Item Tax Template, Tax Rule, Tax Withholding Category
- **Budgeting**: Budget, Cost Center Allocation, Monthly Distribution, Budget Variance
- **Setup**: Company, Fiscal Year, Chart of Cost Centers, Accounting Dimension, Account Category, Financial Report
  Template, Mode of Payment, Payment Terms Template, Currency Exchange, Settings

**Capxul's re-skin: "Books".**

- **Sidebar section "Books":** Home · Chart of accounts · Sales invoices · Purchase invoices · Payment entries ·
  Journal entries · then "Reports" (General ledger, Trial balance, Profit and loss, Balance sheet, Cash flow, Accounts
  receivable, Accounts payable) · "Banking" (Banking, Bank accounts) · "Setup" (Chart of cost centres, Fiscal years,
  Tax templates, Payment terms). Budgeting is not here: budgets belong to departments, Capxul's own module
  (`aaron.departments`), so the sidebar links "Department budgets" to it.
- **Home, top to bottom:**
  1. The chart "Profit and loss": monthly bars of Income and Expense with a Net Profit line, for the fiscal year to
     date (April to October 2026), drawn to scale.
  2. Four number cards: **Sales invoiced** (Total Outgoing Bills: £318,450.00, +6.2% on last month), **Bills
     received** (Total Incoming Bills: £96,210.40), **Received** (Total Incoming Payment: £301,880.00), **Paid** (Total
     Outgoing Payment: £274,115.62). Then Capxul's own: **In Safes** (229,404.21 USDC in two Safes, £181,068.75),
     **Money waiting** (2,400.00 USDC in 1 escrow), **To review** (3 rows in 4999 and 6999), **Reconciled** ("Safes match the
     chain", from `org books reports reconcile`).
  3. Link cards, keeping only what applies: Financial statements (Profit and loss, Balance sheet, Cash flow, Trial
     balance, General ledger); Receivables and payables (Accounts receivable, its summary, Accounts payable, its
     summary, Customer ledger summary, Supplier ledger summary); Registers (Sales register, Purchase register,
     Profitability analysis); Tax (VAT summary); Banking (Banking, Bank accounts, Bank reconciliation statement);
     Opening and closing (Set up the chart, Period closing voucher); Setup (Fiscal years, Tax templates, Payment
     terms, Currency exchange).
- **Command strip:** `capxul org books reports profit-and-loss --from 2026-04-01 --to 2026-10-31`.

### 5.2 Chart of accounts (tree)

**Purpose.** The account tree with each account's balance; where accounts are added, renamed and archived.

**ERPNext's layout** (`acc:doctype/account/account_tree.js`): title "Chart of Accounts"; the company picker on the
toolbar; root "Accounts" shown as the company's name; five roots by root type (in ERPNext's standard chart:
"Application of Funds (Assets)", "Source of Funds (Liabilities)", "Equity", "Income", "Expenses"). Each node:

- chevron, the account name, then badges: the **account number** (`account_tree.js:64-66`); the **currency** in blue
  when it is not the company's (`:68-76`); **"Frozen"** with a lock, orange, titled "Frozen - entries restricted"
  (`:78-86`);
- at the right, the balance, when Accounts Settings `show_balance_in_coa` is on: for a foreign-currency account
  "{balance in account currency} / {balance in company currency} Dr|Cr", else "{balance} Dr|Cr" (`:92-118`). Positive
  (debit minus credit) shows Dr, else Cr.

Toolbar on a node: Add Child (on a group), View Ledger (opens the General Ledger filtered to the account), Edit,
Update Account Name / Number, Convert to Group, Convert to Non-Group (`:286-395`), Delete (the default toolbar, `:409`). Head: "Expand ▾", "View ▾"
(Chart of Cost Centers, Opening Invoice Creation Tool, then Trial Balance, General Ledger, Balance Sheet, Profit and
Loss Statement, Cash Flow, Accounts Payable, Accounts Receivable: `:225-266`), primary "New" ("Add Account"). The
"New Account" dialog asks: New Account Name, Account Number, Is Group, Root Type (at the root), Account Type,
Account Category, Tax Rate, Currency (`:152-216`).

**Capxul's re-skin.**

- Capxul's chart is ERPNext's tree with five roots and seven type groups (`docs/design/frappe/accounting.md:89-101`):
  Assets, Liabilities, Equity, Income, Expenses › Cost of services and Expenses › Operating expenses. Type groups have
  no number. Section 6 has Harbourline's chart.
- Node: "1010 · Treasury · USDC" with badges "USDC" (currency), "Safe" and a lock "Chain" (frozen: only Capxul's own
  postings reach it), balance "189,404.21 USDC / £149,496.74 Dr". "1200 · Accounts receivable · £52,936.80 Dr".
  "2101 · VAT on sales · £18,644.00 Cr".
- Role accounts (receivable, payable, payroll payable, bank charges, exchange, opening, 4999, 6999, Safes) carry a
  small "role" badge, and their toolbar has no Convert or Delete, because Capxul refuses them as parents
  (`parent_protected`, `accounting.md:103-112`).
- Toolbar on a node: "Add sub-account" (`org books accounts add "<name>" --under <code>`), "View ledger" (5.11),
  "Rename" (`org books accounts rename`), "Archive" (`org books accounts archive`). Head: "Expand ▾", "Reports ▾",
  primary "Add account".
- Empty state, before a chart exists: "No chart yet. Set it up with the standard chart." and a button that runs `org
  books accounts import` (the FDE does it in the first sitting, `accounting.md:554-557`).
- **Command strip:** `capxul org books accounts list` (SDK `client.org(orgId).books.accounts.list()`).

### 5.3 Account (form)

**ERPNext's fields, in order** (`acc:doctype/account/account.json`; it is a tree doctype, `is_tree: 1`): Disable;
Account Name\*; Account Number; Is Group; Company\*; Root Type (read-only: Asset, Liability, Income, Expense, Equity);
Report Type (read-only: Balance Sheet, Profit and Loss); Currency; | Parent Account\*; Account Category; Account Type
(Accumulated Depreciation, Bank, Cash, Chargeable, Cost of Goods Sold, Current Asset, Current Liability, Depreciation,
Direct Expense, Direct Income, Equity, Expense Account, Fixed Asset, Income Account, Indirect Expense, Indirect Income,
Liability, Payable, Receivable, Round Off, Stock, Tax, Temporary, and stock-only types); Tax Rate; Frozen (No/Yes);
Balance must be (Debit/Credit); Include in gross. List view columns: Account Name, Account Number; filters: Account
Number, Company, Root Type, Report Type, Account Type.

**Capxul's re-skin.** Show: Account name "Software and subscriptions"; Number "6300"; Parent "Operating expenses";
Root type "Expense" and Report type "Profit and loss" (read-only); Currency "GBP"; Account type "—"; Is group (read
only, derived); Archived. Capxul's own read-only fields: Role (for a role account, such as "bank_charges"), Safe (for a
Safe account: "Treasury, 0x4A1f…9c2E on Base"). Actions: Rename, Archive, View ledger. Command: `capxul org books
accounts list` (the account's row); `org books accounts rename 6300 --name "Software"`.

### 5.4 Sales invoices (list)

**Purpose.** Every invoice Harbourline sends, with what is still owed.

**ERPNext's list** (`acc:doctype/sales_invoice/sales_invoice.json`, `sales_invoice_list.js`, `list_filter/*.json`):

- Title column: Customer Name (`title_field: customer_name`).
- `in_list_view` columns: Posting Date, Payment Due Date, Grand Total, Status; right column Grand Total.
- Standard filters: Company, Customer, Posting Date, Status (and ID and Customer Name in the v16 filter row).
- Default sort: Created On, descending.
- Saved filter tabs, in order:

| Tab | Filter | Columns | Sort |
|---|---|---|---|
| Drafts | docstatus 0 | Customer Name, Posting Date, Grand Total, Created By, ID | creation desc |
| Unpaid | submitted, outstanding > 0 | Customer Name, Status, Posting Date, Payment Due Date, Grand Total, Outstanding Amount, ID | due date asc |
| Overdue | status Overdue (or Overdue and Discounted) | Customer Name, Payment Due Date, Outstanding Amount, Grand Total, Territory, ID | due date asc |
| Credit Notes | is_return, submitted | Customer Name, Status, Posting Date, Return Against, Grand Total, ID | posting date desc |
| This Month | submitted, posting date this month | Customer Name, Status, Posting Date, Grand Total, Outstanding Amount, ID | posting date desc |

- Bulk actions: "Delivery Note" and "Payment" (one Payment Entry per selected invoice,
  `sales_invoice_list.js:37-49`).

**Example rows** (Capxul re-skin):

| Customer | Status | Posting date | Due date | Grand total | Outstanding | ID |
|---|---|---|---|---|---|---|
| Aldermoor Housing Trust | Unpaid (orange) | 31 Oct 2026 | 30 Nov 2026 | £9,540.00 | £9,540.00 | SINV-2026-00087 |
| Bellwether Labs Inc. | Paid (green) | 30 Oct 2026 | 29 Nov 2026 | $12,000.00 | $0.00 | SINV-2026-00086 |
| Meridian Tidal Energy | Partly Paid (yellow) | 15 Sep 2026 | 15 Nov 2026 | £21,600.00 | £10,800.00 | SINV-2026-00079 |
| Calder & Finch Architects | Overdue (red) | 29 Aug 2026 | 28 Sep 2026 | £14,400.00 | £8,400.00 | SINV-2026-00071 |
| Osprey Health Partnership | Draft (red) | 7 Nov 2026 | 7 Dec 2026 | £3,240.00 | — | SINV-2026-00088 |

**Capxul's re-skin.**

- Title "Sales invoices"; primary "New invoice"; tabs Drafts · Unpaid · Overdue · Credit notes · This month · All.
- Filter row: Customer, Posting date, Status, Project, Cost centre.
- A column Capxul adds: **Paid by** — a small mark for how the money came (Capxul for a Safe-to-Safe payment, Bridge for
  a bank transfer converted into the Safe, Bank for the Barclays account), and the in-flight payment pill (section 4).
- Bulk action "Request payment" (`request issue`, one request per invoice) beside "Record payment".
- **Command strip:** `capxul org doc list sales-invoice --filter status=Unpaid` (SDK
  `client.org(orgId).docs.list({ record: "sales-invoice", filters: { status: "Unpaid" } })`).

### 5.5 Sales invoice (form)

**Purpose.** One bill to a customer: what was sold, the tax, when it is due, and what is paid.

**ERPNext's form**, tabs and sections in order (`acc:doctype/sales_invoice/sales_invoice.json`), with the fields a
services company sees (hidden machinery left out, section 2.2). `*` is required.

**Tab "Details"**

1. *(top section, three columns)*
   - Column 1: Company\*; Series\* (`ACC-SINV-.YYYY.-`, `ACC-SINV-RET-.YYYY.-`); Customer\*; Customer Name
     (read-only); Tax Id (read-only).
   - Column 2: Posting Date\* (default today); Posting Time; Edit Posting Date and Time (draft only); Payment Due
     Date\*.
   - Column 3: Include Payment (POS); Is Return (Credit Note); Return Against (when a return); Is Rate Adjustment
     Entry (Debit Note) with its help text; Consider for Tax Withholding; Amended From.
2. **Accounting Dimensions** (collapsible): Cost Center | Project (both editable after submit).
3. **Currency and Price List** (collapsible): Currency\*, Exchange Rate\* | Price List\*, Price List Currency, Price
   List Exchange Rate, Ignore Pricing Rule.
4. **Items**: (Scan Barcode, Update Stock, Source Warehouse: stock only) then the **Items** grid\*.
   - Grid columns (`sales_invoice_item.json`, `in_list_view`): Item (4), Quantity (2), Rate\* (2), Amount\* (2),
     Warehouse.
   - The row form (pencil): Item, Item Name\*; Description; Quantity, UOM\*; Price List Rate; Discount and Margin;
     Rate, Amount, Item Tax Template; Net Amount; **Accounting Details**: Income Account\*; **Deferred Revenue**:
     Enable, Service Start Date, Service End Date; **Accounting Dimensions**: Cost Center\*, Project.
5. *(totals under the grid)*: Total Quantity | Total (Company Currency), Net Total (Company Currency) | Total, Net
   Total.
6. **Taxes and Charges**: Tax Category, Sales Taxes and Charges Template | Shipping Rule | Incoterm. Then the **Sales
   Taxes and Charges** grid:
   - columns (`sales_taxes_and_charges.json`): Type\* (Actual, On Net Total, On Previous Row Amount, On Previous Row
     Total, On Item Quantity), Account Head\*, Tax Rate, Net Amount, Amount, Total;
   - row form: Description\*, "Is this Tax included in Basic Rate?", Cost Center, Project, Account Currency, the
     amounts in both currencies.
   - Then Total Taxes and Charges (Company Currency) | Total Taxes and Charges.
7. **Totals**: Use Company default Cost Center for Round off; **Grand Total**\* (bold); In Words ("USD One Thousand,
   Nine Hundred And Forty Four and Seventeen Cent only.") | Disable Rounded Total; Rounding Adjustment; Rounded Total.
8. **Totals (Company Currency)**: Grand Total, In Words | Rounding Adjustment, Rounded Total.
9. *(advance and outstanding)*: Total Advance | **Outstanding Amount**.
10. **Additional Discount** (collapsible): Apply Additional Discount On (Grand Total / Net Total), Additional Discount
    Amount (Company Currency), Coupon Code | Additional Discount Percentage, Additional Discount Amount, Is Cash or Non
    Trade Discount.
11. **Tax Breakup** (collapsible): the item-wise tax table.
12. **Time Sheet List** (collapsible): the **Time Sheets** grid (Activity Type, Description, Billing Hours, Billing
    Amount, Time Sheet), then Total Billing Hours | Total Billing Amount.

**Tab "Payments"**

1. Payments (POS only).
2. Paid Amount (Company Currency) | Paid Amount (POS only).
3. **Advance Payments**: Allocate Advances Automatically (FIFO); Only Include Allocated Payments; button "Get Advances
   Received"; the **Advances** grid (Reference Name, Remarks, Advance amount, Allocated amount, Difference Posting
   Date).
4. Write Off (POS only).

**Tab "Address & Contact"**: **Billing Address**: Customer Address, Address | Contact Person, Contact, Territory.
**Shipping Address**: (left out for services). **Company Address**: Company Address Name, Company Address | Company
Contact Person.

**Tab "Terms"**: **Payment Terms**: Payment Terms Template; the **Payment Schedule** grid (Payment Term, Description,
Due Date\*, Invoice Portion, Payment Amount\*; the row form adds Mode of Payment, Discount, Outstanding, Paid Amount).
**Terms and Conditions**: Terms (template), Terms and Conditions Details.

**Tab "More Info"**: **Customer PO Details**: Customer's Purchase Order, Customer's Purchase Order Date. **Accounting
Details**: Debit To\* (the receivable account). **Commission**, **Sales Team** (left out). **Print Settings** (left out).
**Additional Info**: Status (read-only), Remarks, Title | Is Internal Customer, Represents Company, Is Discounted.

**Tab "Connections"** (`sales_invoice_dashboard.py`): Payment (Payment Entry, Payment Request, Journal Entry, Invoice
Discounting, Dunning); Reference (Timesheet, Delivery Note, Sales Order); Returns (Sales Invoice); Subscription (Auto
Repeat); Internal Transfers (Purchase Invoice).

**Actions by state** (`sales_invoice.js:80-215`, the docs page):

| State | Buttons |
|---|---|
| New, not saved | "Not Saved" pill; Save |
| Draft | Get Items From ▾ (Sales Order, Quotation, Delivery Note, **Timesheet**: a "Fetch Timesheet" dialog with From, To, Item Code, Project, then "Get Timesheets"); Preview ▾ (Accounting Ledger); Submit |
| Submitted, outstanding ≠ 0 | Create ▾ (primary): **Payment**, Return / Credit Note, Delivery Note, Payment Request, Invoice Discounting, Dunning, Maintenance Schedule; View ▾ (Accounting Ledger); Cancel |
| Paid | View ▾; Create ▾ (Return / Credit Note); Cancel |
| Cancelled | Amend |

On submit the invoice posts: Debit the receivable (Grand Total), Credit each income account (net item amounts), Credit
each tax account (tax) (https://docs.frappe.io/erpnext/sales-invoice, "Submit and next steps").

**Example: SINV-2026-00087, Aldermoor Housing Trust, Unpaid.**

- Customer "Aldermoor Housing Trust"; Tax id "GB 318 4471 20"; Posting date 31 Oct 2026; Due date 30 Nov 2026; Cost
  centre "Engineering"; Project "Aldermoor retrofit, phase 2"; Currency GBP.
- Items:

| No. | Item | Quantity | Rate | Amount |
|---|---|---|---|---|
| 1 | Engineering services: Aldermoor retrofit, October | 64 h | £95.00 | £6,080.00 |
| 2 | Design services: Aldermoor retrofit, October | 22 h | £85.00 | £1,870.00 |

- Total £7,950.00. Taxes: On Net Total · 2101 · VAT on sales · 20 · £7,950.00 · £1,590.00 · £9,540.00. Grand total
  **£9,540.00**, "Nine Thousand, Five Hundred And Forty Pounds only". Outstanding £9,540.00.
- Time sheets: TS-2026-00412 (Engineering, 64 h, £6,080.00), TS-2026-00413 (Design, 22 h, £1,870.00).
- Payment terms "Net 30": one row, due 30 Nov 2026, 100%, £9,540.00.
- Debit to "1200 · Accounts receivable".
- Timeline: "Tomás Reyes created this · 1 Nov 2026"; "Tomás Reyes submitted this document · 1 Nov 2026"; "Payment
  request sent to accounts@aldermoor.org.uk · 1 Nov 2026".

**Capxul's re-skin.**

- Same tabs: Details · Payments · Address and contact · Terms · More info · Connections. The same sections in the
  same order, minus section 2.2's machinery.
- **How to pay** (a section Capxul adds at the end of Details, and on the printed invoice): the invoice's **Capxul
  payment reference**, an ISO 11649 RF reference such as `RF71 HL87 2026` (`design-bank.md` P10); "Pay in USDC to
  Harbourline's Safe" (the pay link of the request); "Pay by bank transfer" to Harbourline's Bridge account details
  for GBP (sort code and account number from `bank details`), quoting the reference. A transfer converts to USDC at
  the edge and lands in the Treasury Safe.
- **The payment in flight**, when one exists, under the outstanding amount: "Payment 0x7c41…e2a9 · In transit · 9,540.00
  USDC from Aldermoor's Safe" with a link to the Payment (Capxul's money module).
- **Actions:**
  - Draft: "Get items from ▾" (Timesheet), "Ledger preview", "Post".
  - Unpaid: "Create ▾" with **Request payment** (`capxul request issue accounts@aldermoor.org.uk 9540 --currency GBP
    …`, sends the customer the pay link and the bank details; it is also what Payment Request becomes),
    **Record payment** (a payment received outside Capxul, into the Barclays account: makes a Payment Entry, 5.9),
    Credit note, Dunning; "View ▾" (Ledger); Cancel.
  - Paid: "View ▾" (Ledger, **Proof**: the payment's document hash, 5.9); Credit note.
- **Connections:** Payment (Payment entries, Requests, Journal entries); Reference (Timesheets); Returns (Sales
  invoices).
- **Command strip:** `capxul org doc get sales-invoice SINV-2026-00087`; on Post, `capxul org doc submit
  sales-invoice SINV-2026-00087`; on Request payment, `capxul request issue accounts@aldermoor.org.uk 9540`.

### 5.6 Purchase invoices (list)

**Purpose.** Every bill Harbourline has received and what it still owes.

**ERPNext's list** (`acc:doctype/purchase_invoice/*`): title Supplier Name; `in_list_view` Posting Date, Due Date,
Supplier Invoice No, Grand Total; standard filters Supplier, Company, Posting Date, Supplier Invoice No, Status.
Indicators in section 4, including On Hold. Saved tabs:

| Tab | Filter | Columns | Sort |
|---|---|---|---|
| Drafts | docstatus 0 | Supplier Name, Supplier Invoice No, Supplier Invoice Date, Grand Total, Created By, ID | creation desc |
| To Pay | submitted, outstanding > 0 | Supplier Name, Status, Supplier Invoice No, Due Date, Grand Total, Outstanding Amount, ID | due date asc |
| Overdue | status Overdue | Supplier Name, Supplier Invoice No, Due Date, Outstanding Amount, Grand Total, ID | due date asc |
| On Hold | submitted, on hold | Supplier Name, Supplier Invoice No, Due Date, Release Date, Outstanding Amount, ID | due date asc |
| Debit Notes | is_return, submitted | Supplier Name, Status, Posting Date, Return Against Purchase Invoice, Grand Total, ID | posting date desc |

Bulk actions: "Purchase Receipt", "Payment".

**Example rows:**

| Supplier | Status | Supplier invoice no | Due date | Grand total | Outstanding | ID |
|---|---|---|---|---|---|---|
| Brightfield Workspace Ltd | Unpaid | BW-2026-1107 | 15 Nov 2026 | £5,040.00 | £5,040.00 | PINV-2026-00142 |
| Kestrel Cloud Ltd | Paid | KC-88213 | 5 Nov 2026 | £1,618.80 | £0.00 | PINV-2026-00141 |
| Marta Kowalczyk (contractor) | Paid | MK-2026-10 | 4 Nov 2026 | $4,800.00 | $0.00 | PINV-2026-00139 |
| Tallis Insurance Brokers | Overdue | TIB-55120 | 22 Oct 2026 | £1,344.00 | £1,344.00 | PINV-2026-00128 |
| Penrose Legal LLP | Paid | PL/26/0912 | 2 Nov 2026 | £2,160.00 | £0.00 | PINV-2026-00127 |
| Capxul | Paid | CX-2026-0007 | 1 Nov 2026 | $100.00 | $0.00 | PINV-2026-00137 |

(The last is Capxul's own bill for ten more seats at 10 USDC each, paid from the Safe: `design-bank.md` P16, "Capxul's
own charges".)

**Capxul's re-skin.** Title "Purchase invoices"; tabs Drafts · To pay · Overdue · On hold · Debit notes · All; a
"Paid by" column and the in-flight pill as on sales invoices; a **Department** column (the cost centre is the
department whose budget pays it). Bulk action "Pay selected" prepares one payment for several invoices of one
supplier (`design-bank.md` P2). **Command strip:** `capxul org doc list purchase-invoice --filter
outstanding_amount>0`.

### 5.7 Purchase invoice (form)

**ERPNext's form** (`acc:doctype/purchase_invoice/purchase_invoice.json`), differences from the sales invoice:

**Tab "Details"**

1. *(top)* Series\*; Supplier\*; Supplier Name; Tax Id; Company | Posting Date\*, Posting Time, Edit Posting Date and
   Time, Due Date | **Is Paid**; Is Return (Debit Note); Return Against Purchase Invoice; Consider for Tax Withholding;
   Amended From.
2. **Supplier Invoice** (collapsible): **Supplier Invoice No** | Supplier Invoice Date.
3. Accounting Dimensions: Cost Center | Project.
4. Currency and Price List: Currency, Exchange Rate, Use Transaction Date Exchange Rate | Price List…
5. Items: Update Stock, Is Subcontracted; the **Items** grid: Item (3), Accepted Qty (2), Rate (3), Amount (2); the row
   form has Expense Account (instead of Income Account) and the dimensions.
6. Totals under the grid; **Taxes and Charges** with the **Purchase Taxes and Charges** grid (the same columns; a row
   adds Consider Tax or Charge for (Total, Valuation) and Add or Deduct); then Taxes and Charges Added, Deducted and
   Total, in both currencies.
7. Totals; Totals (Company Currency); Total Advance | Outstanding Amount; Additional Discount; Tax Breakup.

**Tab "Payments"**: **Payments** (when Is Paid or advances): Mode of Payment, Paid Amount (Company Currency), Clearance
Date | Cash/Bank Account, Paid Amount. **Advance Payments**: "Set Advances and Allocate (FIFO)", "Get Advances Paid",
Advances grid. **Write Off**.

**Tab "Address & Contact"**: Supplier Address (Select Supplier Address, Address | Contact Person, Contact, Mobile No,
Contact Email); Company Billing Address.

**Tab "Terms"**: Payment Terms Template; Payment Schedule; Terms and Conditions.

**Tab "More Info"**: Status; **Accounting Details**: Credit To\* (the payable account), Is Opening Entry; **Hold
Invoice**: Hold Invoice, Release Date | Reason For Putting On Hold; Additional Info: Title, Supplier Group, Sender,
Remarks.

**Connections** (`purchase_invoice_dashboard.py`): Payment (Payment Entry, Payment Request, Journal Entry); Reference
(Purchase Order, Purchase Receipt, Asset, Landed Cost Voucher); Returns; Subscription.

**Actions** (`purchase_invoice.js:90-240`): Draft: Get Items From ▾ (Purchase Order, Purchase Receipt), Submit.
Submitted with outstanding: Create ▾ (primary): **Payment**, Return / Debit Note, Payment Request; **Hold Invoice**
(dialog: Release Date, Reason) or Unblock Invoice / Block Invoice; View ▾ (Accounting Ledger); Cancel.

**Example: PINV-2026-00142, Brightfield Workspace Ltd.** Supplier invoice no BW-2026-1107, dated 1 Nov 2026; posting 2
Nov 2026; due 15 Nov 2026; cost centre "Operations". Item "Studio rent, November 2026", 1 × £4,200.00, expense account
"6100 · Rent and premises". Tax: On Net Total · 2102 · VAT on purchases · 20 · £840.00. Grand total £5,040.00.
Outstanding £5,040.00. Credit to "2000 · Accounts payable".

**Capxul's re-skin.**

- The same tabs and sections. **Department** (the cost centre) is prominent in the top section: it names whose
  budget pays the bill.
- **Pay** replaces Create › Payment, and is the primary action on an unpaid bill. It opens Capxul's own pay step,
  prefilled from the invoice (`accounting.md:395-398`, "Pay with Capxul"; `design-bank.md` P1):
  - **Pay from:** the department's budget ("Operations · £3,880.00 left this quarter"), as its current hat wearer;
    or the Board (from the Safe, by proposal).
  - **To:** the supplier's Safe if they use Capxul ("Kestrel Cloud Ltd · 0x91c2…44Be"), else their bank account
    through Bridge with Bridge's quote (bank receives £5,040.00; the Safe sends 6,390.40 USDC; fee 4.10 USDC), else an
    escrow they claim if they have no account yet.
  - **When:** now, or on the due date (a scheduled payment).
  - **What it pays:** this invoice, its two lines and their VAT: the payment advice whose hash goes on chain.
  - The step ends with "Approve in your browser", or for an agent or the FDE, "Drafted for you to run".
  - While the money is in flight the invoice reads "Unpaid · Payment in transit"; it turns Paid only when the chain
    (and, for a bank payout, Bridge's delivery) says so (`design-bank.md` P11).
- **Command strip:** for Brightfield, which has no Safe, a fiat payout through Bridge: `capxul bank pay brightfield
  5040 GBP`. For a supplier on Capxul, from the department's budget: `capxul org department pay operations --to
  accounts@kestrelcloud.co.uk --amount 2050.93`; from a person's allowance: `capxul payment send
  accounts@kestrelcloud.co.uk 2050.93 --asset USDC --from operations --account 5200`. Reading the bill: `capxul org
  doc get purchase-invoice PINV-2026-00142`.

### 5.8 Payment entries (list)

**Purpose.** Every money movement the books recorded: received, paid, transferred.

**ERPNext's list** (`acc:doctype/payment_entry/*`): title field `title` (the party name, or "{paid from}-{paid to}" for
a transfer); `in_list_view` Payment Type, Posting Date, Account Paid From, Account Paid To; standard filters Payment
Type, Posting Date, Party Type, Party, Cheque/Reference No; status Draft (red), Submitted (blue), Cancelled (red).
Saved tabs:

| Tab | Filter | Columns | Sort |
|---|---|---|---|
| Drafts | docstatus 0 | Title, Payment Type, Posting Date, Party, Paid Amount, Mode of Payment, ID | creation desc |
| Received | submitted, Receive | Title, Posting Date, Party, Paid Amount, Mode of Payment, Cheque/Reference No, ID | posting date desc |
| Paid | submitted, Pay | the same | posting date desc |
| Transfers | submitted, Internal Transfer | Title, Posting Date, Account Paid From, Account Paid To, Paid Amount, Cheque/Reference No, ID | posting date desc |
| Unallocated | submitted, unallocated > 0 | Title, Payment Type, Posting Date, Party, Paid Amount, Unallocated Amount, ID | posting date asc |
| Unreconciled | submitted, no clearance date | Title, Payment Type, Posting Date, Party, Paid Amount, Cheque/Reference No, Cheque/Reference Date, ID | posting date asc |

**Example rows:**

| Title | Type | Posting date | Party | Paid amount | Paid by | Reference | ID |
|---|---|---|---|---|---|---|---|
| Aldermoor Housing Trust | Receive | 6 Nov 2026 | Aldermoor Housing Trust | £6,000.00 | Bank | BACS AHT 0611 | PAY-2026-00321 |
| Kestrel Cloud Ltd | Pay | 5 Nov 2026 | Kestrel Cloud Ltd | 2,050.93 USDC | Capxul | 0x3e9a…10fd | PAY-2026-00319 |
| Marta Kowalczyk | Pay | 4 Nov 2026 | Marta Kowalczyk | 4,800.00 USDC | Capxul | 0x7c41…e2a9 | PAY-2026-00318 |
| Treasury · USDC to Payouts in transit · GBP | Internal Transfer | 3 Nov 2026 | — | 6,390.40 USDC | Bridge | 0xa20b…77c1 | PAY-2026-00317 |
| Bellwether Labs Inc. | Receive | 2 Nov 2026 | Bellwether Labs Inc. | 12,000.00 USDC | Capxul | 0x51d0…9b38 | PAY-2026-00316 |

**Capxul's re-skin.** Title "Payment entries"; tabs Received · Paid · Transfers · Unallocated · Unreconciled · All
(Drafts only for the ordinary bank account: a Capxul payment entry is never a draft, it is made from the chain). A
"Paid by" column (Capxul, Bridge, Bank), and the **Reference** is the payment id, shortened, linking to its proof.
**Command strip:** `capxul org doc list payment-entry --filter payment_type=Pay`; for Capxul's own side of the same
money, `capxul payment list`.

### 5.9 Payment entry (form), with its proof

**Purpose.** One movement of money: who paid whom, from and to which accounts, and which invoices it settles.

**Types** (`payment_type`): **Receive** (Debit bank, Credit the customer's receivable), **Pay** (Debit the supplier's
payable, Credit bank), **Internal Transfer** (Debit the destination account, Credit the source)
(https://docs.frappe.io/erpnext/payment-entry, "How a Payment Entry affects the ledger").

**ERPNext's form** (`acc:doctype/payment_entry/payment_entry.json`), one tab, sections in order:

1. **Type of Payment**: Series\*; **Payment Type**\* (Receive, Pay, Internal Transfer) | Posting Date\*; Company\*; Mode
   of Payment; Company Bank Account.
2. **Payment From / To** (Receive or Pay): Party Type (Customer, Supplier, Employee, Shareholder); **Party**; Party Name;
   Book Advance Payments in Separate Party Account; Consider for Tax Withholding | Party Bank Account; Contact; Email.
3. **Accounts and Transaction Details** (collapsed as "Accounts ›" on a submitted entry): **Account Paid From**\*,
   Account Currency (From), Bank Account (From), **Cheque/Reference No** | **Account Paid To**\*, Account Currency
   (To), Bank Account (To), **Cheque/Reference Date**, Clearance Date.
4. **Amount**: **Paid Amount**\* (in the paid-from account's currency, labelled "Paid Amount (USD)"), Source Exchange
   Rate, Paid Amount (Company Currency) | **Received Amount**\*, Target Exchange Rate, Received Amount (Company
   Currency).
5. **Reference**: buttons "Get Outstanding Invoices" and "Get Outstanding Orders" (draft); the **Payment References**
   grid (`payment_entry_reference.json`):
   - columns: **Type**\* (Sales Invoice, Purchase Invoice, Journal Entry, Sales Order, Purchase Order, Expense Claim…),
     **Name**\* (4), Due Date, **Grand Total**, **Outstanding**, **Allocated**;
   - row form: Supplier Invoice No, Payment Term, Payment Term Outstanding, Account, Exchange Rate, **Exchange
     Gain/Loss**.
6. **Writeoff**: **Total Allocated Amount** | **Unallocated Amount**; Difference Amount (Company Currency); button "Write
   Off Difference Amount".
7. **Taxes and Charges** (advance taxes; left out).
8. **Deductions or Loss** (collapsible): the **Payment Deductions or Loss** grid: Account, Cost Center, Amount (Company
   Currency). Deductions are debits (`accounting.md:201-202`).
9. **Accounting Dimensions**: Project | Cost Center.
10. **More Information**: Status; Custom Remarks; **Remarks**; In Words (Company Currency); Is Opening | Bank, Bank
    Account No, Payment Order, In Words, Amended From.

Above the sections, on a submitted entry, the Connections links show (for example "Bank Transaction") (screenshot
`payments-04-payment-entry-party-amount.png`).

**Actions:** Draft: Save, Submit; "Get Outstanding Invoices". Submitted: **Ledger** (opens the General Ledger for this
voucher, `payment_entry.js:423-437`), Actions ▾ (View Exchange Gain/Loss Journals, Unreconcile), Cancel. Cancelled:
Amend.

**Example: PAY-2026-00318, Marta Kowalczyk, Pay.**

- Payment type Pay; Posting date 4 Nov 2026; Mode of payment "Capxul".
- Party type Supplier; Party "Marta Kowalczyk"; Party name "Marta Kowalczyk".
- Account paid from "1010 · Treasury · USDC" (USDC); Account paid to "2000 · Accounts payable" (GBP). Reference no
  `0x7c41…e2a9` (the payment id); Reference date 4 Nov 2026; Clearance date 4 Nov 2026.
- Paid amount 4,800.000000 USDC; Source exchange rate 0.7893 (the block's rate); Paid amount (company currency)
  £3,788.64; Received amount £3,788.64. The invoice was booked at 0.7901, so it carries £3,792.48 outstanding; the
  payment settles it in full at par and the £3.84 difference posts to exchange gain (`accounting.md:195-200`).
- References: Purchase Invoice · PINV-2026-00139 · due 4 Nov 2026 · grand total $4,800.00 · outstanding $4,800.00 ·
  allocated $4,800.00 · exchange gain £3.84.
- Total allocated £3,792.48; Unallocated £0.00.
- Deductions: 6510 · Exchange gain or loss · Main · −£3.84.
- Cost centre "Engineering"; Project "Tidewater sensor housing".

**Capxul's re-skin: the payment entry is the books' side of a Capxul payment.**

- The same sections in the same order, with "Cheque/Reference No" relabelled **Payment reference** and showing the
  payment id.
- **Read-only when the chain made it.** A Capxul or Bridge payment entry is created by Capxul when the chain's line
  arrives (`design-bank.md` 1.4, and P1's "Frappe after"). No one can edit, cancel or amend it in Books; its only edit
  is **Classify** (account, party, cost centre, project, documents), which is `activity annotate`
  (`accounting.md:393-394`). The button bar shows: Ledger, Classify, **Proof**. A payment entry for the Barclays
  account is an ordinary, editable document with Save, Submit, Cancel and Amend.
- **Proof** (a section Capxul adds after Amount, open by default on a Capxul payment):

| Field | Example |
|---|---|
| Payment | `0x7c41a9…e2a9` (the payment id) · Settled |
| Document hash | `0x5f0e3b…9a14` · "Commits to PINV-2026-00139, 1 line, no VAT" |
| Transaction | `0xd2c8…7f03` on Base · block 28,114,902 · 4 Nov 2026 14:32:07 GMT |
| From | Harbourline's company Safe `0x4A1f…9c2E`, by the Engineering budget, approved by Priya Natarajan (wearing the Head of Engineering hat) |
| To | Marta Kowalczyk's Safe `0xB7e0…31aD` |
| Amount | 4,800.000000 USDC |
| Advice | the allocation table: document, number, date, content hash, allocated, lines and their tax |
| Verify | "Verified: the advice re-hashes to the document hash, and the invoice's content re-hashes to its line" |

  Its commands: `capxul payment get 0x7c41…e2a9` and `capxul document verify --document-hash 0x5f0e…9a14`.
- **Bridge payouts are two entries** (`design-bank.md` P11): an Internal Transfer from "Treasury · USDC" to "Payouts
  in transit · GBP" when the USDC leaves, then a Pay from "Payouts in transit · GBP" to the supplier, with Bridge's fee
  as a deduction on "6500 · Bank charges", when Bridge delivers. A Bridge deposit is one Receive into "Treasury ·
  USDC" with the deposit fees as deductions on 6500 (P10).
- **Command strip:** `capxul org doc get payment-entry PAY-2026-00318`; Classify: `capxul activity annotate --id
  <row> --account 5200 --confirm`; Proof: `capxul payment get 0x7c41…e2a9`.

### 5.10 Journal entries (list and form)

**Purpose.** Adjustments posted by hand or by the system: accruals, reclassifications, depreciation, the payroll
accrual, bank entries that are not payments to a party.

**ERPNext's list** (`acc:doctype/journal_entry/*`): title field `title`; `in_list_view` Company, Total Debit; standard
filters Company, Entry Type; indicator: submitted shows the Entry Type in blue ("Bank Entry"), else Draft or Cancelled
(red). Saved tabs: **Drafts** (Title, Entry Type, Posting Date, Total Debit, Created By, ID); **Bank and Cash**
(submitted Bank, Cash and Contra Entries: Title, Entry Type, Posting Date, Total Debit, Reference Number, Clearance
Date, ID); **Opening Entries**; **Depreciation**.

**ERPNext's form** (`journal_entry.json`):

**Tab "Details"** (unnamed first tab)

1. Company\*; **Entry Type**\* (Journal Entry, Inter Company Journal Entry, Bank Entry, Cash Entry, Credit Card Entry,
   Debit Note, Credit Note, Contra Entry, Excise Entry, Write Off Entry, Opening Entry, Depreciation Entry, Asset
   Disposal, Periodic Accounting Entry, Exchange Rate Revaluation, Exchange Gain Or Loss, Deferred Revenue, Deferred
   Expense) | Series\*; **Posting Date**\*; Multi Currency; Is System Generated; Amended From.
2. The **Accounting Entries** grid\* (`journal_entry_account.json`): columns **Account**\* (4), Party Type, Party (2),
   **Debit** (2), **Credit** (2). The row form: Account, Bank Account, Party Type, Party; Accounting Dimensions (Cost
   Center, Project); Currency (Account Currency, Exchange Rate); Amount (Debit, Debit in Company Currency, Credit,
   Credit in Company Currency); Reference (Reference Type, Reference Name, Reference Due Date, Is Advance, User Remark).
3. **Total Debit** | **Total Credit**, **Difference (Dr - Cr)** and the button "Make Difference Entry" (only when it
   does not balance).
4. **Reference Number** (`cheque_no`), **Reference Date** (`cheque_date`), Clearance Date.

**Tab "Tax Withholding"** (left out). **Tab "More Info"**: Reference (Bill No, Bill Date, Due Date | Reversal Of,
Payment Order…); Printing Settings (Pay To / Recd From); Write Off (for Write Off Entry); Additional Info (Is Opening,
From Template | Custom Remark, **Remark**, Mode of Payment).

**Actions** (`journal_entry.js:243-290`): Draft: **Quick Entry** (a dialog for a two-line entry), Save, Submit.
Submitted: View ▾ **Ledger**; Actions ▾ **Reverse Journal Entry**; Cancel. Cancelled: Amend.

**Example: JV-2026-00051, "Payroll accrual, October 2026", Journal Entry.**

| Account | Party | Debit | Credit |
|---|---|---|---|
| 5000 · Salaries and wages | | £118,416.67 | |
| 5010 · Employer's National Insurance | | £14,302.11 | |
| 5020 · Employer's pension contributions | | £3,552.50 | |
| 2300 · PAYE and NI payable | | | £39,871.36 |
| 2400 · Pensions payable | | | £9,473.34 |
| 2200 · Payroll payable | Employee: Ada Okafor | | £4,512.38 |
| 2200 · Payroll payable | (one line per employee, 21 more) | | … |
| **Total** | | **£136,271.28** | **£136,271.28** |

Remark "Payroll run PR-2026-10, October 2026"; reference type Payroll Entry. It is posted by Capxul's payroll through
the books' accrual door (`accounting.md:242-269`). Each employee's net is then paid by a Bank Entry on 2200 against the
run (`accounting.md:216`).

**Capxul's re-skin.**

- Title "Journal entries"; tabs Drafts · Bank and cash · Opening entries · All.
- Entries Capxul made (the payroll accrual, a Safe's Bank Entry for money with no party) are read-only and marked
  "Posted by Capxul" with their source (the payroll run, or the payment and its proof). People make their own
  adjustments with Quick entry or the full form; the entry types offered are Journal Entry, Bank Entry (the Barclays
  account only), Opening Entry, Write Off Entry, Credit Note, Debit Note, Depreciation Entry. A line on a Safe's
  account is refused: "Only the chain posts to a Safe's account" (`accounting.md:390-391`).
- **Command strip:** `capxul org doc get journal-entry JV-2026-00051`; a new one: `capxul org doc create
  journal-entry --input entry.json`, then `capxul org doc submit journal-entry JV-2026-00052`; Reverse makes a new
  entry with the lines swapped and "Reversal of" set: `capxul org doc create journal-entry --input reversal.json`.

### 5.11 General ledger (report)

**Purpose.** Every posting line, account by account, with a running balance.

**ERPNext's filters** (`acc:report/general_ledger/general_ledger.js`), in order: Company\*; Finance Book; **From Date**
(default a month ago); **To Date** (today); **Account** (multi-select); **Voucher No**; Against Voucher No; — then the
second row: **Party Type**; **Party** (multi-select); Party Name; **Categorize by** (Categorize by Voucher, Categorize
by Voucher (Consolidated) [default], Categorize by Account, Categorize by Party); Tax Id; Currency (presentation);
**Cost Center** (multi); **Project** (multi); and checks: Consider Accounting Dimensions, Disable Opening Balance
Calculation, Show Opening Entries, Include Default FB Entries, Show Cancelled Entries, Show Net Values in Party
Account, Show Credit / Debit in Company Currency, Add Columns in Transaction Currency, Show Remarks, Ignore Exchange
Rate Revaluation and Gain / Loss Journals, Ignore System Generated Credit / Debit Notes.

**Columns** (`general_ledger.py:690-850`): Posting Date; Account; **Debit ({currency})**; **Credit ({currency})**;
**Balance ({currency})**; (Debit, Credit and Currency in transaction currency, optional); Voucher Type; Voucher Subtype
(the Entry Type or Payment Type); Voucher No; Against Account; Party Type; Party; (Party Name); Project; Cost Center;
Against Voucher Type; Against Voucher; Supplier Invoice No; (Remarks).

**Rows:** "Opening", then the lines, then "Total", then "Closing (Opening + Total)" (`general_ledger.py:412-416`).
Categorized by account or party, each group has its own Opening, lines, Total and Closing.

**Example** (Account 1200 · Accounts receivable, 1 to 9 Nov 2026, by voucher):

| Posting date | Account | Debit (GBP) | Credit (GBP) | Balance (GBP) | Voucher type | Voucher subtype | Voucher no | Party | Against voucher |
|---|---|---|---|---|---|---|---|---|---|
| | Opening | £60,936.80 | £0.00 | £60,936.80 | | | | | |
| 1 Nov 2026 | 1200 · Accounts receivable | £9,540.00 | | £70,476.80 | Sales Invoice | Sales Invoice | SINV-2026-00087 | Aldermoor Housing Trust | |
| 2 Nov 2026 | 1200 · Accounts receivable | | £9,484.40 | £60,992.40 | Payment Entry | Receive | PAY-2026-00316 | Bellwether Labs Inc. | SINV-2026-00086 |
| 6 Nov 2026 | 1200 · Accounts receivable | | £6,000.00 | £54,992.40 | Payment Entry | Receive | PAY-2026-00321 | Aldermoor Housing Trust | SINV-2026-00082 |
| | Total | £9,540.00 | £15,484.40 | | | | | | |
| | Closing (Opening + Total) | £70,476.80 | £15,484.40 | £54,992.40 | | | | | |

**Capxul's re-skin.**

- Filters: From, To, Account, Party type, Party, Voucher no, Cost centre (department), Project, Group by (Voucher,
  Account, Party), Show cancelled entries. No Finance Book, no transaction-currency toggles unless a USD line is in view
  (then "Show amounts in the account's currency" shows USDC beside GBP).
- A **Proof** column Capxul adds: for a line posted from the chain, the payment id or transaction (`0x7c41…e2a9`),
  linking to the payment entry's proof.
- Drill-through: a Voucher no opens its document; an Account opens the ledger filtered to it.
- **Command strip:** `capxul org report run general-ledger --filter account=1200 --filter from_date=2026-11-01
  --filter to_date=2026-11-09` (proposed: `command-surface.md` 7.4, with "head" dropped). The money facts behind the
  chain lines: `capxul org books facts list` (5.22).

### 5.12 Trial balance (report)

**Purpose.** Every account's opening, movement and closing, proving debits equal credits.

**ERPNext's filters** (`acc:report/trial_balance/trial_balance.js`): Company\*; **Fiscal Year**; **From Date**; **To
Date**; Cost Center; Project; Finance Book; Currency; checks: With Period Closing Entry For Opening Balances (on), Period
Closing Entry For Current Period (on), Show zero values, Show unclosed fiscal year's P&L balances, Include Default FB
Entries (on), Show net values in opening and closing columns (on), Show Group Accounts (on).

**Columns** (`trial_balance.py:515-590`): **Account** (300 wide; Account Name, Account Number and Currency hidden);
**Opening (Dr)**; **Opening (Cr)**; **Debit**; **Credit**; **Closing (Dr)**; **Closing (Cr)**. A tree report (`tree:
true`, `initial_depth: 3`, parent field `parent_account`): group rows in bold with chevrons, then a bold **Total** row
whose debit and credit columns are equal.

**Example rows** (fiscal year 2026-2027, 1 Apr to 31 Oct 2026):

| Account | Opening (Dr) | Opening (Cr) | Debit | Credit | Closing (Dr) | Closing (Cr) |
|---|---|---|---|---|---|---|
| Assets | | | | | | |
| › 1010 · Treasury · USDC | £131,204.17 | | £512,880.40 | £498,512.62 | £145,571.95 | |
| › 1050 · Barclays Business · GBP | £22,418.09 | | £41,600.00 | £37,980.55 | £26,037.54 | |
| › 1200 · Accounts receivable | £48,260.00 | | £382,140.00 | £369,463.20 | £60,936.80 | |
| Liabilities | | | | | | |
| › 2101 · VAT on sales | | £14,880.00 | £58,400.00 | £62,164.00 | | £18,644.00 |
| Income | | | | | | |
| › 4000 · Engineering services | | | | £201,330.00 | | £201,330.00 |
| … | | | | | | |
| **Total** | **£412,118.40** | **£412,118.40** | **£1,906,402.75** | **£1,906,402.75** | **£431,876.10** | **£431,876.10** |

**Capxul's re-skin.** The same tree with the same seven columns. Filters: Fiscal year, From, To, Cost centre, Project,
Show zero values, Show group accounts. A Safe's row shows its USDC holding beneath the GBP ("holds 189,404.21 USDC",
which equals the Safe's balance on chain: the frozen claim of `org.books.reports.trial-balance` 2). **Command strip:**
`capxul org books reports trial-balance --as-of 2026-10-31` (SDK `client.org(orgId).books.reports.trialBalance({
asOf: "2026-10-31" })`).

### 5.13 Profit and loss (report)

**Purpose.** Income less expenses over periods.

**ERPNext's filters** (`erpnext:public/js/financial_statements.js:420-540` and
`acc:report/profit_and_loss_statement/profit_and_loss_statement.js`): Company\*; Finance Book; **Filter Based On**
(Fiscal Year or Date Range); Start Date and End Date, or **Start Year** and **End Year**; **Periodicity** (Monthly,
Quarterly, Half-Yearly, Yearly; default Yearly); Currency; Cost Center; Project; the accounting dimensions (such as
Department); Group by Dimension; Report Template; Account Detail Level (Summary, Account Breakdown); **Select View**
(Report View, Growth View, Margin View); Accumulated Values; Include Default FB Entries; Show zero values.

**Layout** (balance-sheet screenshot, the same frame): filters; **summary cards**: "Total Income", "Total Expense",
"Net Profit" (or "… This Year" with accumulated values, `profit_and_loss_statement.py:130-140`); a **chart** (bar for
several periods, with datasets "Income", "Expense", "Net Profit/Loss", `:200-222`); the **table**: Account, one column
per period ("Apr 2026", "May 2026"… labelled "MMM YYYY"), and "Total" (`financial_statements.py:885-960`). Rows: the
Income tree with "Total Income (Credit)", the Expense tree with "Total Expense (Debit)"
(`financial_statements.py:535`), and "Profit for the year" (`profit_and_loss_statement.py:163`).

**Example** (monthly, April to October 2026):

| Account | Apr 2026 | … | Oct 2026 | Total |
|---|---|---|---|---|
| Income | | | | |
| › 4000 · Engineering services | £27,360.00 | | £31,920.00 | £201,330.00 |
| › 4100 · Design services | £16,150.00 | | £19,040.00 | £117,120.00 |
| **Total Income (Credit)** | £43,510.00 | | £50,960.00 | **£318,450.00** |
| Expenses | | | | |
| › Cost of services › 5000 · Salaries and wages | £96,250.00 | | £118,416.67 | … |
| › Operating expenses › 6100 · Rent and premises | £4,200.00 | | £4,200.00 | £29,400.00 |
| **Total Expense (Debit)** | | | | |
| **Profit for the year** | | | | |

(The data step must make a 25-person studio's income cover its payroll over the year; the shape is what this page
fixes.)

**Capxul's re-skin.** The same filters, minus Finance Book and Report Template; "Department" is the cost centre. The
summary cards, the chart (drawn to scale in SVG) and the tree table. **Command strip:** `capxul org books reports
profit-and-loss --from 2026-04-01 --to 2026-10-31` (SDK `client.org(orgId).books.reports.profitAndLoss({ from, to
})`).

### 5.14 Balance sheet (report)

**Purpose.** What the company owns and owes at a date.

**ERPNext's layout** (`acc:report/balance_sheet/*`, screenshot `…balance-sheet-loaded.png`): the same filters as profit
and loss (the screenshot shows Company, Finance Book, Fiscal Year, 2026, 2026, Yearly; Currency, Cost Center,
Department, Project, Group by Dimension, Report Template; Report View, Accumulated Values on, Include Default FB
Entries on, Show zero values). Then four summary cards: **Total Asset**, **Total Liability**, **Total Equity**,
**Provisional Profit / Loss (Credit)** (green) (`balance_sheet.py:250-270`). A chart with datasets Assets,
Liabilities, Equity. The tree table: Account and one column per period. Rows: "Application of Funds (Assets)" with
its tree and "Total Asset (Debit)"; "Source of Funds (Liabilities)" with "Total Liability (Credit)"; "Equity" with
"Total Equity (Credit)"; then "Provisional Profit / Loss (Credit)" and "Total (Credit)"
(`balance_sheet.py:135-190`).

**Example** (as at 31 Oct 2026): Total asset £271,384.20; Total liability £74,397.10; Total equity £132,522.99;
Provisional profit / loss (credit) £64,464.11. Assets: 1010 · Treasury · USDC £145,571.95; 1020 · Reserve Safe · USDC
£31,572.00; 1030 · Money waiting · USDC £1,894.32; 1050 · Barclays Business · GBP £26,037.54; 1200 · Accounts
receivable £60,936.80; 1500 · Equipment £7,820.00; 1510 · Accumulated depreciation −£2,448.41. Liabilities: 2000 ·
Accounts payable £9,618.80; 2101 · VAT on sales £18,644.00; 2102 · VAT on purchases −£3,210.40; 2300 · PAYE and NI
payable £39,871.36; 2400 · Pensions payable £9,473.34; 2200 · Payroll payable £0.00 (paid on 28 Oct). Equity: 3000 ·
Share capital £120,000.00; 3100 · Retained earnings £12,522.99 (the 2025-2026 profit, closed). The check: £271,384.20
= £74,397.10 + £132,522.99 + £64,464.11.

**Capxul's re-skin.** Root labels "Assets", "Liabilities", "Equity" (Capxul's chart's roots, not "Application of
Funds"). The same four cards; "Provisional Profit / Loss (Credit)" reads "Profit this year, not yet closed". **Command
strip:** `capxul org books reports balance-sheet --as-of 2026-10-31` (SDK
`client.org(orgId).books.reports.balanceSheet({ asOf })`). The frozen claim: assets equal liabilities and equity.

### 5.15 Cash flow (report)

**Purpose.** Where the cash came from and went, by operations, investing and financing.

**ERPNext's layout** (`acc:report/cash_flow/*`): the financial statement filters, plus Group by Dimension, Report
Template, Account Detail Level, Include Default FB Entries, **Show Opening and Closing Balance**. Columns: **Section**
and one column per period, then Total. Rows (`cash_flow.py:175-210`):

- **Cash Flow from Operations**: Profit for the year; Depreciation; Net Change in Accounts Receivable; Net Change in
  Accounts Payable; Net Change in Inventory; Net Change in Other Balance Sheet Accounts; footer **Net Cash from
  Operations**.
- **Cash Flow from Investing**: Net Change in Fixed Asset; footer **Net Cash from Investing**.
- **Cash Flow from Financing**: Net Change in Equity; footer **Net Cash from Financing**.
- **Net Change in Cash**; with the option, Opening Balance and Closing Balance.

Cash here is every account of type Bank or Cash.

**Capxul's re-skin.** The same sections and rows (Inventory left out). Cash is the two Safes, Money waiting, Payouts in
transit and the Barclays account, each a Bank account in the books (`design-bank.md` 1.1). **Command strip:** `capxul
org report run cash-flow --filter period_start_date=2026-04-01 --filter period_end_date=2026-10-31 --filter
periodicity=Monthly` (proposed).

### 5.16 Accounts receivable and payable, with ageing

**Purpose.** Who owes the company money (receivable), whom it owes (payable), and how long overdue.

**ERPNext's filters** (`acc:report/accounts_receivable/accounts_receivable.js`): Company\*; **Report Date** (today);
Finance Book; Cost Center; Project; Party Type; **Party**; Receivable Account; **Ageing Based On** (Due Date default,
Posting Date, Supplier Invoice Date); **Age as on** (Report Date); **Ageing Range** ("30, 60, 90, 120"); Customer
Group; Payment Terms Template; Sales Partner; Sales Person; Territory; checks: Group By Customer, Based On Payment
Terms, Show Future Payments, Show Linked Delivery Notes, Show Sales Person, Show Remarks, In Party Currency, Include
Revaluation Journals, Group by Voucher. Accounts Payable has the same with Supplier and Payable Account.

**Head buttons:** "Accounts Receivable Summary", Actions ▾, refresh (screenshot).

**Chart:** a horizontal **percentage** bar of the ageing buckets (`accounts_receivable.py:1349-1365`), legend "<0",
"0-30", "31-60", "61-90", "91-120", "121-Above", with each bucket's amount under its label.

**Columns** (`accounts_receivable.py:1180-1345`): Posting Date; Party Type; Party; Receivable Account (Payable Account);
(Customer Name or Supplier Name); Customer Contact; Cost Center; Project; Voucher Type; Voucher No; **Due Date**; (Bill
No, Bill Date for payables); (Payment Term, Invoice Grand Total, with Based On Payment Terms); **Invoiced Amount**;
**Paid Amount**; **Credit Note** (Debit Note); **Outstanding Amount**; **Age (Days)**; then the ageing columns **<0**,
**0-30**, **31-60**, **61-90**, **91-120**, **121-Above**; Currency; (Future Payment Ref, Future Payment Amount,
Remaining Balance; Customer LPO; Territory, Customer Group; Remarks). A **Total** row at the bottom.

**The summary** (`accounts_receivable_summary.py:136-210`): one row per party: Party Type, Party, (Name), **Advance
Amount**, **Invoiced Amount**, **Paid Amount**, **Credit Note**, **Outstanding Amount**, (GL Balance, Difference),
the ageing buckets, **Total Amount Due**, Territory, Customer Group, Currency.

**Example** (receivable, as at 9 Nov 2026, by due date; an excerpt):

| Posting date | Party | Voucher no | Due date | Invoiced | Paid | Outstanding | Age | 0-30 | 31-60 | 61-90 |
|---|---|---|---|---|---|---|---|---|---|---|
| 31 Oct 2026 | Aldermoor Housing Trust | SINV-2026-00087 | 30 Nov 2026 | £9,540.00 | £0.00 | £9,540.00 | -21 | | | |
| 15 Sep 2026 | Meridian Tidal Energy | SINV-2026-00079 | 15 Nov 2026 | £21,600.00 | £10,800.00 | £10,800.00 | -6 | | | |
| 29 Aug 2026 | Calder & Finch Architects | SINV-2026-00071 | 28 Sep 2026 | £14,400.00 | £6,000.00 | £8,400.00 | 42 | | £8,400.00 | |
| 30 Jul 2026 | Osprey Health Partnership | SINV-2026-00064 | 29 Aug 2026 | £3,600.00 | £0.00 | £3,600.00 | 72 | | | £3,600.00 |

Not-yet-due amounts sit in the "<0" bucket (negative age).

**Capxul's re-skin.** The same filters (party, as-at date, ageing based on, ranges, group by party), the percentage
bar, the columns and the summary report behind its button. A receivable row offers "Request payment" (`request
issue`) or "Send a reminder" (Dunning); a payable row offers "Pay" (5.7). **Command strip:** `capxul org report run
accounts-receivable --filter report_date=2026-11-09 --filter ageing_based_on="Due Date"` (proposed); Capxul's own
view of what it is owed: `capxul request list`; of what it has been asked to pay by other Capxul organizations:
`capxul inbox list`.

### 5.17 Banking: reconciliation of Safes and the bank account

**Purpose.** Prove each bank account's books against its statement, and book the lines nothing has booked yet.

**ERPNext has two screens.**

**The new Banking page** (`/banking`, `banking:pages/BankReconciliation.tsx`), linked from the sidebar as "Banking"
(`acc:sidebar/accounts/accounts.json`):

- **Head:** breadcrumb Home / Banking; the **Company** selector; on the right Settings (matching rules, preferences,
  keyboard shortcuts), the **Action log**, and the **date range** filter (`BankRecDateFilter.tsx`).
- **Bank picker** (`BankPicker.tsx`): a horizontal strip of account cards (bank logo, account name, account number),
  one selected.
- **Balance panel** beside it (`BankBalance.tsx`), "laid out like the totals block of an invoice": the account name;
  **Opening Balance**; **Closing (system)** with an info card ("This is what the system expects the closing balance to
  be in your bank statement…"); **Closing (statement)** "As of {date}", click to set; a separator; **Difference**
  (emphasised, red when not zero); **Reconciled** (a progress bar, "x of y").
- **Tabs:** **Match and Reconcile** · **Reconciliation Statement** · **Transactions** · **Clearance Summary** ·
  **Incorrectly Cleared** (`BankReconciliation.tsx:104-115`).
- **Match and Reconcile** (`MatchAndReconcile.tsx`), two panes:
  - left, **"Unreconciled Transactions"**: a search box, an amount filter, a type filter (All, Debits, Credits); each
    transaction shows date, description, "Ref: {reference}", the amount (red withdrawal, green deposit), "{amount}
    Unallocated", and a "Matched by rule" mark. A banner when older ones exist: "There are {n} unreconciled
    transactions before {date}… View older transactions". Empty: "No unreconciled transactions found. Import your bank
    statement to get started."
  - right, **"Match or Create"**: for the selected transaction, the rule's recommended action (Account, Party,
    "Create {type}"), then the suggested vouchers, each with **Amount**, **Posted On**, **Reference Date** and
    reference, and match badges ("Suggested", "Complete Match", "Partial Match", "No Match"), each with a
    **Reconcile** button; and three ways to create: **Bank Entry** ("Record a bank journal entry for expenses, income
    or split transactions"), **Record Payment** ("Record a payment entry against a customer or supplier"), **Transfer**
    ("Record an internal transfer to another bank/credit card/cash account"). Several transactions can be selected at
    once ("3 transactions selected").
- The other tabs: the Bank Reconciliation Statement report, the account's Bank Transactions list, the Bank Clearance
  Summary report, and cheques and deposits incorrectly cleared.
- The page is desktop-only: on a phone it says "This screen is not supported on mobile devices."

**The classic Bank Reconciliation Tool** (`acc:doctype/bank_reconciliation_tool/*`, screenshot), now labelled "Bank
Reconciliation (old)": head buttons Upload Bank Statement, Auto Reconcile, primary **Get Unreconciled Entries**; a banner
"Try the new Banking module for a better experience"; fields Company, Bank Account | From Date, To Date, Filter by
Reference Date | Account Opening Balance, Closing Balance; section **Reconcile** with three number cards **Closing
Balance as per Bank Statement**, **Closing Balance as per ERP**, **Difference** (red); then a table: Date, Party Type,
Party, Description, Deposit (green), Withdrawal (red), Unallocated Amount, Reference Number, Actions
(`erpnext:public/js/bank_reconciliation_tool/data_table_manager.js:36-95`). Actions open "Reconcile the Bank
Transaction" (Action: Match Against Voucher, Create Voucher, Update Bank Transaction; Document Type; Filters; "Select
Vouchers to Match" with Document Type, Document Name, Reference Date, Remaining, Reference Number, Party).

**A bank transaction** (`acc:doctype/bank_transaction/bank_transaction.json`): Date; Status (Pending, Settled,
Unreconciled, Reconciled, Cancelled); Bank Account; Deposit; Withdrawal; Currency; Description; Reference Number;
Transaction ID; Transaction Type; Payment Entries (the vouchers it is reconciled to); Allocated Amount; Unallocated
Amount; Party Type, Party; Party Name/Account Holder (Bank Statement), Party Account No., Party IBAN; Included Fee,
Excluded Fee.

**Capxul's re-skin: one Banking screen for Safes and the bank account alike.**

Capxul's own books design left ERPNext's bank screens out, because a Safe is cleared when it is posted
(`accounting.md:76-77`, `:401`). Two later decisions bring them back: `aaron.other-accounts` (a company may keep
ordinary bank accounts, reconciled the usual way) and the bridge study's `bank.safe-is-a-bank` (each Safe per token is a
bank account, and the chain is its statement, `design-bank.md` 1.1-1.4). The mock-up follows both.

- **Account strip**, five cards: **Treasury · USDC** (Safe `0x4A1f…9c2E`, Base); **Reserve Safe · USDC**; **Money
  waiting · USDC** (the open escrows Harbourline funded); **Payouts in transit · GBP** (Bridge); **Barclays Business ·
  GBP** (sort code 20-45-77, account ending 4417). Each card shows a "Safe", "Escrow", "Bridge" or "Bank" mark.
- **Balance panel:** for a Safe, "Opening", "Closing (books)", "Closing (chain)" with the block it was read at, and
  "Difference £0.00" with "Reconciled 214 of 214" (every line was booked from the chain as it arrived). This is `org
  books reports reconcile` (each Safe's books against `balanceOf`). For Barclays, the ERPNext panel as it is, for 1 to
  9 November: Opening £26,037.54; Closing (system) £32,037.54 (the books' £29,877.54 plus the £2,160.00 payment not
  yet cleared); Closing (statement) "As of 6 Nov 2026" £29,877.54; Difference −£2,160.00; Reconciled 38 of 41.
- **Match and reconcile** for Barclays: three unreconciled lines, e.g. "3 Nov 2026 · BACS PENROSE LEGAL LLP PL/26/0912 ·
  −£2,160.00 · Ref PL260912" with a suggested match "Payment entry PAY-2026-00320 · Penrose Legal LLP · £2,160.00 ·
  Complete match · Reconcile" (reconciling it brings the difference to £0.00), and the create buttons Bank entry ·
  Record payment · Transfer. The other two: a card fee "−£18.00 · BARCLAYS COMMERCIAL CARD FEE" (Bank entry to 6500)
  and "+£6,000.00 · BACS ALDERMOOR HSG TRUST" (matches PAY-2026-00321). For a Safe the left
  pane is empty with "Every line is booked from the chain as it arrives" and the list of the latest lines, each with
  its payment id and a link to its proof.
- Statement lines of a Safe show: Date (the block's day); Description ("Payment to Marta Kowalczyk"); Reference (the
  payment id); Transaction ID (`8453:0xd2c8…7f03:41`, chain id, transaction, log index); Withdrawal 4,800.000000 USDC;
  Party; Status Reconciled; Payment entries PAY-2026-00318.
- A Bridge deposit line: "2 Oct 2026 · Bridge deposit · CALDER & FINCH ARCHITECTS · RF57 HL71 2026 · +7,595.67 USDC ·
  included fee 6.00 USDC" (the customer wired £6,000.00), matched by its RF reference to SINV-2026-00071, which leaves
  £8,400.00 outstanding (`design-bank.md` P10).
- **At 400px wide** the strip scrolls sideways inside its container, and the two panes stack (Capxul does not refuse
  the phone).
- **Commands:** the Safes' check, `capxul org books reports reconcile`; Bridge deposits, `capxul bank deposits
  --unmatched` and `capxul bank match <deposit> <request>`; the Barclays lines, `capxul org doc list bank-transaction
  --filter bank_account="Barclays Business · GBP" --filter status=Unreconciled`; reconcile one (set the line's payment
  entries): `capxul org doc change bank-transaction <id> --input match.json`.

### 5.18 Bank account (form)

**ERPNext's form** (`acc:doctype/bank_account/bank_account.json`): Account Name\*; Company Account (the ledger
account); Bank\*; Account Type; Account Subtype | Disabled; Is Default Account; Is Company Account; Company; Is Credit
Card. **Party Details** (for a customer's or supplier's account): Party Type | Party. **Account Details**: IBAN |
Branch Code, Bank Account No, Statement PDF Password. **Address and Contact**. **Integration Details**: Last
Integration Date | Mask. List columns: Account Name, Company Account, Company, IBAN, Bank Account No. Connections:
Transactions (Payment Request, Payment Order, Bank Guarantee, Bank Transaction), Accounting (Payment Entry, Journal
Entry), Party (Customer, Supplier).

**Capxul's re-skin.** For Barclays: Account name "Barclays Business · GBP"; Ledger account "1050 · Barclays Business ·
GBP"; Bank "Barclays"; Account number "****4417"; Sort code "20-45-77"; IBAN "GB29 BARC 2045 7783 1244 17". For a
Safe: Account name "Treasury · USDC"; Ledger account 1010; Bank "Capxul"; Account number = the Safe's address
(`accounting.md:126-128`); a note "Statement: the chain". A supplier's saved bank account (for Bridge payouts) is the
same form with Party Type Supplier. **Commands:** `capxul bank accounts --org` (list) and `capxul bank accounts add
--org --currency GBP --input account.json`.

### 5.19 Chart of cost centres (tree)

**Purpose.** The dimension every profit-and-loss line carries. At Harbourline, one cost centre per department.

**ERPNext's tree** (`acc:doctype/cost_center/cost_center_tree.js`): root "Cost Centers" as the company; each node with
its number badge; toolbar Convert to Group, Convert to Non-Group; head "View ▾" (Chart of Accounts), "Budget ▾"
(Budget List, Monthly Distribution). The form (`cost_center.json`): Cost Center Name\*, Cost Center Number, Parent
Cost Center\*, Company\* | Is Group, Disabled. ERPNext creates the root and "Main" with a company
(`accounting.md:565-566`).

**Capxul's re-skin.** Harbourline › Main, Design, Engineering, Delivery, Growth, Operations: each department's cost
centre, linked to its budget (`design-bank.md` 1.1, "a department is a Department plus a Cost Center, linked to its
budget id"). A node shows the department's hat and its current wearer ("Engineering · Head of Engineering: Priya
Natarajan") and this quarter's spend against its budget, linking to the department (Capxul's own screen). Budgets are
not set here. **Commands:** `capxul org doc list cost-center`; the department behind it, `capxul org department show
engineering`.

### 5.20 Fiscal years and closing a year

**Fiscal Year** (`acc:doctype/fiscal_year/fiscal_year.json`): Year Name\* (named as ERPNext names it, "2025-2026" for
a year across two calendar years); Disabled; Is Short/Long Year; Year Start Date\*; Year End Date\*; Companies. List
columns: Year Name, Year Start Date, Year End Date; sorted newest first.

**Period Closing Voucher** (`acc:doctype/period_closing_voucher/period_closing_voucher.json`, series `ACC-PCV-.YYYY.-`):
Transaction Date; Company\*; **Fiscal Year**\*; **Period Start Date**\*; **Period End Date**\* | **Closing Account
Head**\* (the equity account that takes the year's profit); GL Entry Processing Status (In Progress, Completed,
Failed); **Remarks**\*. Submitting it closes the year: nothing can post on or before its end date
(`accounting.md:403-418`).

**Capxul's re-skin.** Fiscal years: "2026-2027" (1 Apr 2026 to 31 Mar 2027, current), "2025-2026" (1 Apr 2025 to 31
Mar 2026, closed). The closing: PCV-2026-00001, fiscal year 2025-2026, period 1 Apr 2025 to 31 Mar 2026, closing
account "3100 · Retained earnings", remarks "Year-end close 2025-26, signed off by Harbourline's accountants",
Submitted. The books home shows "Closed through 31 Mar 2026". A fiscal year is derived from the Organization's fiscal
year start (`accounting.md:428-429`), so the list is read-only. **Commands:** `capxul org doc list fiscal-year`;
`capxul org doc get period-closing-voucher PCV-2026-00001`.

### 5.21 Review queue (Capxul's own, inside Books)

ERPNext has no such screen. Capxul's books post money with no meaning to the not-decided accounts 4999 and 6999, and
the review queue lists those rows until someone gives them an account (`accounting.md:123-124`, `:206-214`).

- **Layout:** a list: Date, Direction (in or out), Amount, Counterparty, Suggested account (a name the payer
  suggested), Source (payment, deposit, outside movement), and actions **Accept** (make the suggestion an account),
  **Classify** (`activity annotate`), and, for several rows, **Move all to…** (`org books accounts reclassify`).
- **Example:** "28 Oct 2026 · out · 186.40 USDC · 0x2F11…aa09 (no contact) · suggested 'Conference tickets' · from
  Growth's budget".
- **Commands:** `capxul org books accounts review`; accept, `capxul org books accounts review --accept <row> --under
  6400 --name "Events and conferences"`; move, `capxul org books accounts reclassify --from-account 6999 --to-account
  6400 --from 2026-10-01 --to 2026-10-31`.

### 5.22 Money facts (Capxul's own, inside Books)

ERPNext has no such screen either. Every money movement is a numbered fact, the books' proof that a voucher came from
the chain (`accounting.md:137-167`).

- **Layout:** a list: Seq (gap-free number), Kind (payment_settled, payment_received, deposit_received,
  payout_returned, accrual_posted, reversed…), Occurred (block time), Safe, Amount and asset, USD value with its rate,
  Party, Fee, Voucher (linking to the payment entry or journal entry), Transaction.
- **Example:** "#1,284 · payment_settled · 4 Nov 2026 14:32 · Treasury · −4,800.000000 USDC · $4,800.00 at 1.0000 ·
  Marta Kowalczyk · fee 0 · PAY-2026-00318 · 0xd2c8…7f03".
- **Command:** `capxul org books facts list --since 2026-11-01` (SDK `client.org(orgId).books.facts.list`).

---

## 6. A chart of accounts for Harbourline

Codes follow Capxul's rules: the first digit follows the type, a top-level account takes the next free hundred, a
sub-account the next number in its parent's ten, and role accounts sit at their fixed codes (`accounting.md:87-135`).
Type groups have no number. `(role)` marks an account Capxul protects; `(Bank)`, `(Receivable)` and so on are its
account type.

```
Assets
  1010  Treasury · USDC                 (Bank, USDC, Safe, frozen)   the company Safe
  1020  Reserve Safe · USDC             (Bank, USDC, Safe, frozen)   the second Safe
  1030  Money waiting · USDC            (Bank, USDC)                 open escrows Harbourline funded
  1040  Payouts in transit · GBP        (Bank, GBP)                  Bridge payouts on their way
  1050  Barclays Business · GBP         (Bank, GBP)                  the ordinary bank account
  1200  Accounts receivable             (Receivable, role)
  1300  Prepayments
  1500  Equipment                       (Fixed Asset)
  1510  Accumulated depreciation        (Accumulated Depreciation)
Liabilities
  2000  Accounts payable                (Payable, role)
  2100  VAT                             (group)
    2101  VAT on sales
    2102  VAT on purchases
  2200  Payroll payable                 (Payable, role)
  2300  PAYE and NI payable
  2400  Pensions payable
  2500  Accruals
Equity
  3000  Share capital
  3100  Retained earnings
  3990  Opening balances                (role)
Income
  4000  Engineering services
  4100  Design services
  4200  Retainers
  4999  Income, not decided             (role)
Expenses
  Cost of services
    5000  Salaries and wages            (role: salaries)
    5010  Employer's National Insurance
    5020  Employer's pension contributions
    5100  Contractors
    5200  Cloud and computing
  Operating expenses
    6100  Rent and premises
    6200  Software and subscriptions
    6300  Travel
    6400  Events and conferences
    6500  Bank charges                  (Chargeable, role)
    6510  Exchange gain or loss         (role)
    6600  Professional fees
    6700  Insurance
    6800  Depreciation
    6999  Expense, not decided          (role)
```

Notes for the data step:

- 1030 and 1040 come from the bridge study (`design-bank.md` 1.1, `bank.money-waiting`). Under the books design alone,
  an escrow's funding posts nothing (`books.escrow-held`, `accounting.md:218`). The mock-up follows the bridge study,
  because the Safe's statement shows the money leaving at funding.
- 2100 is a group and its children are 2101 and 2102, as Capxul's sub-account rule numbers them.
- 2200 has a role, so it takes no sub-accounts; PAYE and pensions are siblings (2300, 2400).

---

## 7. Every screen and action and its command

`(native)` is booked in `command-surface.md`. `(family)` is the document family with "head" dropped (section 2.4,
rule 2). `(proposed)` is `command-surface.md` 7.4's report command with "head" dropped.

| Screen or action | Command | SDK | Kind |
|---|---|---|---|
| Books home: profit and loss chart | `capxul org books reports profit-and-loss --from 2026-04-01 --to 2026-10-31` | `client.org(orgId).books.reports.profitAndLoss` | native |
| Chart of accounts | `capxul org books accounts list` | `client.org(orgId).books.accounts.list` | native |
| Set up the chart (first sitting) | `capxul org books accounts import` | `client.org(orgId).books.accounts.import` | native |
| Add an account | `capxul org books accounts add "Events and conferences" --under 6400` | `client.org(orgId).books.accounts.add` | native |
| Rename an account | `capxul org books accounts rename 6200 --name "Software"` | `client.org(orgId).books.accounts.rename` | native |
| Archive an account | `capxul org books accounts archive 6300` | `client.org(orgId).books.accounts.archive` | native |
| Review queue | `capxul org books accounts review` | `client.org(orgId).books.accounts.review` | native |
| Move waiting rows | `capxul org books accounts reclassify --from-account 6999 --to-account 6400 --from … --to …` | `client.org(orgId).books.accounts.reclassify` | native |
| Classify a payment | `capxul activity annotate --id <row> --account 5100 --confirm` | `client.activity.annotate` | native |
| Money facts | `capxul org books facts list` | `client.org(orgId).books.facts.list` | native |
| Trial balance | `capxul org books reports trial-balance --as-of 2026-10-31` | `client.org(orgId).books.reports.trialBalance` | native |
| Profit and loss | `capxul org books reports profit-and-loss --from … --to …` | `client.org(orgId).books.reports.profitAndLoss` | native |
| Balance sheet | `capxul org books reports balance-sheet --as-of 2026-10-31` | `client.org(orgId).books.reports.balanceSheet` | native |
| Safes against the chain | `capxul org books reports reconcile` | `client.org(orgId).books.reports.reconcile` | native |
| Export for an accountant | `capxul org books export quickbooks --from 2026-04-01 --to 2026-10-31 --out ./export` (shown, never run: no downloads) | `client.org(orgId).books.export.quickbooks` | native |
| Sales invoices (list) | `capxul org doc list sales-invoice --filter status=Unpaid` | `client.org(orgId).docs.list` | family |
| Sales invoice (read) | `capxul org doc get sales-invoice SINV-2026-00087` | `client.org(orgId).docs.get` | family |
| New sales invoice | `capxul org doc create sales-invoice --input invoice.json` | `client.org(orgId).docs.create` | family |
| Post (submit) | `capxul org doc submit sales-invoice SINV-2026-00088` | `client.org(orgId).docs.submit` | family |
| Cancel | `capxul org doc cancel sales-invoice SINV-2026-00088` | `client.org(orgId).docs.cancel` | family |
| Amend | `capxul org doc amend sales-invoice SINV-2026-00088` | `client.org(orgId).docs.amend` | family |
| Request payment | `capxul request issue accounts@aldermoor.org.uk 9540` | `client.requests.issue` | native |
| Requests sent | `capxul request list` | `client.requests.list` | native |
| Purchase invoices (list, read, create, post) | `capxul org doc list\|get\|create\|submit purchase-invoice …` | `client.org(orgId).docs.*` | family |
| Pay a bill from a department's budget | `capxul org department pay operations --to accounts@kestrelcloud.co.uk --amount 2050.93` | `client.org(orgId).departments.pay` | native |
| Pay a bill (USDC, from an allowance) | `capxul payment send <to> <amount> --asset USDC --from <allowance> --account 6200` | `client.payments.send` | native |
| Pay a bill (bank, through Bridge) | `capxul bank pay <contact> 5040 GBP` | `client.bank.pay` | native |
| Pay a request another Capxul company sent | `capxul inbox pay <id>` | `client.inbox.pay` | native |
| Bills from Capxul companies | `capxul inbox list` | `client.inbox.list` | native |
| Payment entries (list, read) | `capxul org doc list\|get payment-entry …` | `client.org(orgId).docs.*` | family |
| A payment's proof | `capxul payment get 0x7c41…e2a9` | `client.payments.get` | native |
| Verify the document hash | `capxul document verify --document-hash 0x5f0e…9a14` | `client.documents.verify` | native |
| Record a payment into Barclays | `capxul org doc create payment-entry --input payment.json` | `client.org(orgId).docs.create` | family |
| Journal entries (list, read, create, post) | `capxul org doc list\|get\|create\|submit journal-entry …` | `client.org(orgId).docs.*` | family |
| General ledger | `capxul org report run general-ledger --filter account=1200 …` | `client.org(orgId).reports.run` | proposed |
| Cash flow | `capxul org report run cash-flow --filter periodicity=Monthly …` | `client.org(orgId).reports.run` | proposed |
| Accounts receivable / payable (and summaries) | `capxul org report run accounts-receivable --filter report_date=2026-11-09` | `client.org(orgId).reports.run` | proposed |
| Banking: Bridge deposits | `capxul bank deposits --unmatched` | `client.bank.deposits` | native |
| Banking: match a deposit to a request | `capxul bank match <deposit> <request>` | `client.bank.match` | native |
| Banking: Barclays statement lines | `capxul org doc list bank-transaction --filter status=Unreconciled` | `client.org(orgId).docs.list` | family |
| Bank accounts | `capxul bank accounts --org` | `client.bank.accounts` | native |
| Bank details to quote on an invoice | `capxul bank details` | `client.bank.details` | native |
| Cost centres | `capxul org doc list cost-center` | `client.org(orgId).docs.list` | family |
| The department behind a cost centre | `capxul org department show engineering` | `client.org(orgId).departments.show` | native |
| Fiscal years | `capxul org doc list fiscal-year` | `client.org(orgId).docs.list` | family |
| Closing the year | `capxul org doc create period-closing-voucher --input close.json` | `client.org(orgId).docs.create` | family |

---

## 8. Points for the later steps

1. **The document family's spelling (for the critique step and Aaron).** `command-surface.md` books `org head doc …` and
   proposes `org head report run …`; `aaron.one-product` forbids anyone to see "head". This page spells them `org doc …`
   and `org report run …` (rule 2.4), the first being the page's own "Before the tree" spelling. A critic checking
   "a command spelled differently from command-surface.md" should read this as the one deliberate departure, made to
   keep the ruling. The book should settle it (a decision to respell `org head` now that the head is invisible).
2. **The bridge study is not yet a decision.** Safes as bank accounts, Money waiting, Payouts in transit, the payment
   advice and the RF reference come from `docs/design/frappe/bridge-work/design-bank.md`, which is research in
   progress. The mock-up uses them because they show Aaron's rulings (other accounts reconciled, Bridge at the edge,
   the document hash as proof) better than the earlier books design, which hid the Banking screen. Where they conflict
   with `accounting.md` (the escrow posting, the Banking screen), this page follows the bridge study.
3. **What is drafted, not done.** The FDE and every agent act only with the asker's permissions and draft risky
   actions for the person to run: in Books that is Pay, Post on an invoice above a threshold, Cancel, the year-end
   close and reclassifying a period. The mock-up shows such an action as "Drafted by the FDE for Ada Okafor to run",
   with the command, and a Run button that goes through the approval step.
4. **Authority by department hat.** Whoever wears a department's hat pays from its budget, and the Books hat manages
   the chart (`docs/design/authority.md:111-115`). The mock-up names the hat and its current wearer on every Pay and
   every chart change, never a person's standing permission.
5. **Precision.** USDC has 6 decimals and shows all six in a Safe's statement (`4,800.000000 USDC`); GBP shows two.
   Mixed rows show both ("4,800.000000 USDC / £3,788.64").
6. **No downloads, no print.** Print, PDF, Export and QuickBooks export show their command on the strip and a toast
   ("This is what Capxul would run"), and do nothing else.

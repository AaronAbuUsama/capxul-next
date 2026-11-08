# Accounting: the books in ERPNext accounting's shape, synced

Lane: **accounting**. Owns `books/target/books`. Written 8 November 2026, main-line design, book
first. The records are the design; this page explains them and lists what other lanes must change.
Every judgment is a decision record in `books/target/books/decisions.ts`, named in brackets.

The rulings this lane carries out:

- `aaron.books-first-principles`: redesign the books from first principles in the shape of
  ERPNext's accounting, so an Organization's books sync with an ERPNext head when one is connected.
  Money proven on chain posts the entries. Keep every frozen books operation's behaviour. Fork
  Frappe's accounting only if Capxul-native cannot feel integrated.
- `aaron.erp-on-capxul` and `aaron.frappe-shape`: Frappe is Capxul's UI (the head), an
  Organization's data lives in Frappe's shapes from the start, and accounting is synced at the bare
  minimum. Fork as little as possible, ideally nothing.
- `aaron.frappe-head`: the books are complete without a head; once one is connected they sync, and
  Capxul stays the system of record for money.
- Its `SUPERSEDED` list: `books.facts-without-chart` is rewritten to `aaron.books-first-principles`.
- `system.frozen-behaviour`: the 17 books operations keep what their acceptance claims require.
  Every claim keeps its words; only three observations change (the chart's event is now the
  Company's).

The starting point was [`docs/vision/erp.md`](../../vision/erp.md): section 3's mapping, its
fact-to-voucher table and core checks C1 to C6, C18, C19, C21, C25 and C26, now read as main-line
design.

## In one paragraph

An Organization's books are the accounting half of an ERPNext Company, held by Capxul in ERPNext's
own doctypes. The chart is ERPNext's Account tree, with a Cost Center tree beside it. Every money
fact is kept from the first money, chart or no chart. Each fact is numbered without a gap per
Organization, so a ledger can follow the facts one by one and never skip one. Once the chart exists,
each standing priced money fact posts exactly one voucher, a Journal Entry or a Payment Entry, whose
id is the fact's. The voucher's Safe line is the money the chain proved. Its other side is what the
payer, the request or the head said the money was for. A connected head follows the facts and
inserts the vouchers it is handed. It posts its own vouchers (invoices, accruals, closings) back as
GL Entries. Money in a Safe is posted only by Capxul, and every other voucher only by its head, so
nothing is posted twice. ERPNext is not forked.

## What was read

| Source | Commit | Used for |
|---|---|---|
| `frappe/erpnext` `erpnext/accounts/doctype`: Account, GL Entry, Journal Entry, Journal Entry Account, Payment Entry, Payment Entry Reference, Payment Entry Deduction, Cost Center, Fiscal Year, Accounting Period, Period Closing Voucher, Bank Account, Mode of Payment, Payment Ledger Entry, Accounts Settings, Repost Accounting Ledger | `6b946b0f` | every field below; the validations in `account.py` (`validate_root_details`, `validate_group_or_ledger`, `validate_account_number`), `journal_entry.py` (`validate_party`, `validate_cheque_info`), `payment_entry.py` (party mandatory, `validate_transaction_reference`), `gl_entry.py` (cost centre required on profit and loss), `general_ledger.py` (the immutable ledger's reversal), `repost_accounting_ledger.py` (`_repost_pe_je`, closed fiscal years) |
| `frappe/erpnext` `erpnext/setup/doctype/company/company.json` | `6b946b0f` | the Company's accounting defaults: `default_currency`, the default receivable, payable, bank-charges, exchange and round-off accounts, `cost_center` |
| `frappe/erpnext` `account/chart_of_accounts` | `6b946b0f` | how ERPNext builds a tree from a template; that templates are read only from ERPNext's own folders (so a head takes Capxul's chart through the Chart of Accounts Importer) |
| `frappe/hrms` `payroll_entry.py:1093`, `:1196` | `88161025` | a payroll run is paid by a Bank Entry Journal Entry against its Payroll Entry |
| The skills `fde-frappe:frappe-stack` and `fde-frappe:build-on-frappe` | | the ladder (configuration, Custom Field, hooks, an app, a fork), and Habitat's sync as prior art ("Capxul Treasury", "Capxul" Mode of Payment) |

## The shape: one table per doctype

| Capxul table | ERPNext doctype | What it holds |
|---|---|---|
| `book-companies` | Company (its accounting fields) | the chart template, the currency, time zone and fiscal year start copied from the Organization when the chart is made, the default cost centre, `closed_through`, the feed's counter `last_seq` |
| `book-accounts` | Account | the tree: `account_name`, `account_number` (the code), `is_group`, `parent_account_id`, `root_type`, `account_type`, `account_currency`, Capxul's six-way `type`, the protecting `role` |
| `book-cost-centers` | Cost Center | the tree: the root and Main from the import, the rest from a head |
| `book-annotations` | the other side of a Journal Entry Account or Payment Entry | account, `party_type` and the directory's `party_id`, cost centre, project, `references` (Payment Entry Reference: the documents it pays), memo, suggestion |
| `book-facts` | (no doctype: Capxul's proof) | the append-only facts, numbered by `seq`; each standing priced money fact is a voucher |
| (derived) | Journal Entry, Payment Entry, GL Entry | Capxul's own vouchers, made from a fact and its annotation by the rules `frappe-v1`; never stored |
| `book-head-vouchers` | GL Entry (with its voucher's header) | the GL lines of the vouchers a head posted |
| `book-assets`, `book-prices` | (none) | added tokens and USD rates, as before |

Field names are Frappe's wherever the content is the same, so the sync copies and never translates
[`books.frappe-shape`]. Capxul keeps its own durable ids, and a head carries them as unique Custom
Fields: `capxul_account`, `capxul_cost_center`, `capxul_voucher` and, from the CRM lane,
`capxul_party`. The books leave some doctypes out on purpose:

- Bank Transaction, Bank Clearance and the Bank Reconciliation Tool. A Capxul voucher is cleared
  on its posting date, because the bank is the chain and there is no statement to match.
- Payment Ledger Entry. ERPNext derives it from the GL.
- Fiscal Year documents. They are derived from the Company's fiscal year start.
- Accounting Period and Budget. Budgets is Capxul's own concept, on chain.

The ERPNext document shapes the feed hands a head are in `books/target/books/frappe.ts`.

## The chart: ERPNext's Account tree

ERPNext's tree has five root groups by `root_type`. Only a ledger account takes GL Entries, and an
account that has entries can never become a group. Capxul's six types sit on that tree as seven
type groups [`books.chart-tree`]. They have no number, and `accounts list` does not show them:

```
Assets (root, Asset)                 type asset
Liabilities (root, Liability)        type liability
Equity (root, Equity)                type equity
Income (root, Income)                type income
Expenses (root, Expense)
  Cost of services (group)           type cost_of_services
  Operating expenses (group)         type expense
```

- A **top-level account** (in the frozen wording) sits directly under its type's group and takes the
  next free hundred in its range.
- A **sub-account** sits under a parent and takes the next code in the parent's ten (6100 gives
  6101) and the parent's type. The parent becomes a group, which needs it to hold no postings.
  Otherwise the add is refused with WRONG_STATE `parent_has_postings`. This is the one behaviour
  that narrows, and no claim covers it. The remedy is to add a sibling and reclassify.
- **Codes** keep Capxul's rule: the first digit follows the type, and a code is unique among active
  accounts. An archive frees the code. In a head, where numbers are unique among all accounts, the
  archived account's copy is disabled and loses its number.
- **Roles fill the Company's defaults:**
  - `receivable` (1200) is `default_receivable_account`;
  - `payable` (2000) is `default_payable_account`;
  - `payroll_payable` (2200) is Payroll Settings' payable account;
  - `bank_charges` (6500) is `bank_charges_account`;
  - `exchange_gain_loss` (6510) is `exchange_gain_loss_account` and `round_off_account`;
  - `opening` (3990);
  - the two not-decided accounts, 4999 and 6999, which make the review queue;
  - one `safe` account per Safe and asset: type Bank, in the token's own currency (USDC, EURC),
    frozen in the head (`freeze_account` Yes), so only Capxul's app user can post to it. A head
    gives it a Bank Account document (bank "Capxul", the Safe's address) and the Mode of Payment
    "Capxul".
- **Account types** follow the template: 1000 and every Safe account are Bank, 1200 is Receivable,
  2000 and 2200 are Payable, 3xxx is Equity, 1500 is Fixed Asset, 1510 is Accumulated
  Depreciation, and 6500 is Chargeable.

Every frozen claim keeps its words on this tree. Add's world (`org-with-chart`) must leave 6100 with
no postings [`books.worlds`].

## Money facts and the feed (checks C5 and C6)

**The feed** [`books.feed`]. Every fact takes its Organization's next `seq` from its
`book-companies` row. The writer locks that row inside its own transaction, so numbers commit in
order and a rollback leaves no hole (invariant `books.feed-gap-free`). The writers are:

- payments' settlement and Movements;
- banking's deposits and returns;
- books' own rpcs and its scan of added tokens.

A call with several Organizations' sides takes their locks in org id order. `books.sync.feed` reads
the facts after a number. The reader keeps its own place, so the read writes nothing. The facts list
keeps its order by when money happened (frozen line 2); the feed is the order in which facts were
recorded.

**The fact's read** [`books.fact-read`]. A money fact now carries everything a ledger needs to post
it:

- the Safe it moved in or out of;
- the chain, block, transaction and log index;
- the block time;
- the counterparty's directory `party_id` beside the chain's own name for it;
- the fee a rail kept;
- its posting date, when a closing moved it;
- the voucher it posts.

The invoker passes these when it records the fact. That is a change for payments and banking (see
"For other lanes").

## How each kind of money fact becomes ledger entries

The rules are versioned `frappe-v1` [`books.vouchers`]. A voucher's id is its fact's id. The parts
of every voucher:

- **The Safe line.** It credits the Safe account for money out and debits it for money in. The
  account currency is the token, at the token's units; the Company's amount uses the block's rate.
- **The other side.** It is the row's annotation (account, party, cost centre, project, documents),
  else the direction's not-decided account (4999 or 6999) at Main.
- **The cost centre.** Every profit-and-loss line names one: the annotation's, else Main.
- **The amounts.** They are in the Company's currency. Each fact keeps its own USD value; for a
  Company in another currency the books divide by that currency's USD rate at the same block (EUR/USD,
  from `book-prices`' kept history).
- **The voucher type.** An account that is Receivable or Payable, with its party, makes a **Payment
  Entry** (Pay or Receive) allocated to the documents named. The exception is a reference to a
  Payroll Entry or Journal Entry, which only a Journal Entry line can carry. Any other account makes
  a **Journal Entry**, voucher type Bank Entry, cheque number the transaction, cheque date the
  block's day.
- **Allocations** add up to at most the row's value. The rest stays unallocated, as an advance.
- **The posting date** is the block's day in the books' time zone. If that day is on or before
  `closed_through` when the fact is recorded, the voucher posts on the first open day.

| Money fact | Voucher with no meaning given | With the meaning a payer, request or head gave it |
|---|---|---|
| A payment out (`payment_settled`, out), from the company Safe or a budget | Bank Entry: Dr 6999 at Main, Cr Safe | Bank Entry Dr the chosen expense account (`payment send --account`); or Payment Entry Pay, party Supplier or Employee, paid to Creditors, references the Purchase Invoice or Expense Claim it settles ("Pay with Capxul" from the invoice) |
| A payment in (`payment_received`, or a settled Payment to the Organization) | Bank Entry: Dr Safe, Cr 4999 | Bank Entry Cr the income account; or Payment Entry Receive, party Customer, references the Sales Invoice |
| A request paid (the Organization's request settled by its payer) | as a payment in | the request's own meaning: Payment Entry Receive against the Sales Invoice the request is, or Bank Entry against its income account |
| A bank payout (a Payment to Bridge's deposit address) | Bank Entry: Dr 6999 (amount less fee), Dr 6500 (fee), Cr Safe (amount) | Payment Entry Pay to the payee's Supplier, with the fee as a deduction on 6500; or Bank Entry against the chosen account and 6500 |
| A payout returned (`payout_returned`) | Bank Entry: Dr Safe, Cr the payout's own account | the same account and party as the payout, so the return nets it |
| A bank deposit (`deposit_received`) | Bank Entry: Dr Safe (net), Dr 6500 (fee), Cr 4999 (gross) | Payment Entry Receive from the Customer, or Bank Entry against the matched request's income |
| Outside money in or out (`deposit_received` or `payment_sent_outside` from a Movement) | Bank Entry against 4999 or 6999: it waits in review | whatever `activity annotate` or the head gives it |
| An agreement collection (kind 4 from a budget) | as a payment out | a contractor's Purchase Invoice (the head makes it from the agreement's terms) and its Payment Entry; or, for an Employee, payroll's own posting |
| A payslip's net, paid against a run | as a payment out | Bank Entry Dr Payroll Payable (2200), party Employee, reference the Payroll Entry; Cr Safe. A Payment Entry cannot reference a Payroll Entry (`payroll_entry.py:1093`) |
| A fee: Capxul's seats bought from the Safe, or a rail's fee | a seat purchase is a payment out to Capxul; a rail's fee is the 6500 line above | Payment Entry Pay to the Supplier "Capxul" against its Purchase Invoice |
| Money waiting in a claim escrow | nothing: the escrow's funding is not money out of the books until the escrow pays, and the reconcile shows it as held | |
| `reversed` (the chain took it back) | the voucher is cancelled, its reversal dated the day the reorganization was seen (the immutable ledger's way); a re-settle is the next generation's voucher, `amended_from` the cancelled one | |
| An unpriced fact (an added token, its opening included) | no voucher: held, scanned and reconciled, never valued | |

A recategorization (an annotation that changes account, party or documents) reposts the same voucher
in place, the way ERPNext's Repost Accounting Ledger does. The feed hands the voucher again with a
newer `capxul_version` [`books.account-at-posting`]. Every voucher balances exactly
(`books.postings-balance`). The other side and the fee are a split of the Safe line's amount, and
one money occurrence stands once (`books.one-live-money-fact`).

## The sync, both ways, without double-posting

[`books.sync`; invariant `books.one-author-per-voucher`]

```mermaid
sequenceDiagram
  participant CH as Chain
  participant CX as Capxul (books)
  participant APP as Head's Capxul app
  participant H as ERPNext head
  CH->>CX: PaymentSent / Transfer at finality
  CX->>CX: payments settles; the fact gets seq n; its voucher is derived
  APP->>CX: books.sync.feed(after = last applied)
  CX-->>APP: seq n: the fact and its Journal or Payment Entry
  APP->>H: insert and submit by capxul_voucher (unique), store last applied = n, one transaction
  H->>H: a person submits a Purchase Invoice
  H->>APP: on_submit queues it
  APP->>CX: books.sync.post(the invoice's GL Entries)
  CX->>CX: checked: chart accounts, no Safe line, balanced, open period; stored
  H->>APP: a person allocates a Capxul payment to that invoice
  APP->>CX: books.annotations.save(party, Creditors, reference)
  CX-->>APP: seq m: recategorized, with the voucher reposted as a Payment Entry
```

**Out: from Capxul to the head.** The head's app follows `books.sync.feed` from the last number it
applied. It applies each document by its Capxul id and stores that number in the same Frappe
transaction. So a crash replays nothing twice, the unique `capxul_voucher` refuses a second insert,
and a newer `capxul_version` reposts the voucher. The feed hands:

- an Account for each chart fact;
- a Cost Center for `cost_center_created`;
- a voucher for each priced money fact;
- the reposted vouchers for `account_assigned`, `recategorized` and `rows_reclassified`;
- the cancelled voucher for `reversed`.

A head is connected only to charted books. A follower that began earlier reads again from 0 once it
sees the import's facts.

**In: from the head to Capxul.** The head sends only what it authors: its own vouchers (as GL
Entries) and its cost centres, through `books.sync.post`. It sends them in order, and a newer
`modified` replaces an older one. A voucher is refused, with its reason, if any of these is true:

- it names an account or cost centre that Capxul's chart does not have;
- a line is on a group account or on a Safe account;
- it carries a `capxul_voucher` (an echo of Capxul's own);
- it does not balance;
- it posts into a closed period.

The head never posts money in a Safe. The meaning a head gives Capxul's money, and every chart
change made in the head, go through the rpcs the CLI uses: `books.annotations.save` and
`books.accounts.add`, `rename` and `archive`. Capxul assigns every code, id and repost, so the
chart and the meaning of money have one writer. The head's own reports and Capxul's agree, because
Capxul keeps the head's GL [`books.head-vouchers`]: with a head that posts invoices, `basis` reads
`accrual`.

**Why nothing is posted twice.**

- Every movement of money has exactly one voucher, keyed by its fact.
- No head voucher has a Safe line.
- Every head voucher has one author, and no Capxul voucher is ever edited in the head.

Capxul is the system of record for money, and the head for its documents.

**What the head's Capxul app needs, with no fork** [`books.no-fork`]:

- **Custom Fields**, unique: `capxul_account`, `capxul_cost_center`, `capxul_voucher`,
  `capxul_party`, plus `capxul_version`, `capxul_tx_hash`, `capxul_chain_id`, `capxul_log_index`
  and `capxul_block_time` on Journal Entry and Payment Entry.
- **Accounts Settings**: `enable_immutable_ledger` on, so a cancellation posts on its own day as a
  `reversed` fact does. Journal Entry and Payment Entry listed in Repost Allowed Types.
- **Safe accounts** frozen. Only the app's user holds the role that may post to frozen accounts.
- A **Currency** per token (USDC, EURC, …) and currency precision of at least the assets' decimals,
  up to Frappe's 9. WETH's 18 decimals round in the head, and Capxul's raw units stay exact.
- **The Company's chart** applied from Capxul through the Chart of Accounts Importer before any
  transaction, and its Fiscal Year documents made from the Organization's fiscal year start.
- **Hooks**:
  - `before_cancel` and `before_submit` refuse a person's change to a Capxul voucher;
  - Account's `before_insert` and `on_update` call Capxul's account rpcs;
  - `on_submit` and `on_cancel` of the head's own vouchers queue them for `books.sync.post`;
  - Payment Reconciliation on a Capxul payment becomes `books.annotations.save` with the
    references.
- **A "Pay with Capxul" action** on Purchase Invoice, Expense Claim and Payroll Entry. It sends the
  payment with its voucher's other side.
- **The Bank Reconciliation workspace** hidden: a Capxul voucher is cleared when it is posted.

## Closed periods

A head's submitted Period Closing Voucher moves `closed_through` [`books.closed-periods`]. From then
on, nothing on or before that day changes:

- A late money fact (an added token's scan, a deposit credited days after its block) posts on the
  first open day, and its block time stays on the voucher.
- A recategorization, accept or reclassify of a row posted in a closed period is refused with
  WRONG_STATE `period_closed`. Reclassify lists the row with that reason. The correction is an
  adjusting entry the head posts in the open period.
- A head voucher into a closed period is refused.

Without a head nothing closes, so every frozen claim reads exactly as before.

## The Company's settings (checks C18 and C19)

The Organization carries the Company's `default_currency`, `time_zone` and `fiscal_year_start`
(`organizations.company-shape`, the organizations lane). The import copies them into
`book-companies`, and the books keep that copy for good [`books.company-settings`]. So a later edit
on the Organization can never re-date, re-year or re-value a posted voucher. ERPNext forbids that
too, since a Company's currency is fixed once it has entries.

- Every posting date, and every report's "end of the day", is in that time zone. That answers C18.
- A fiscal year is derived from the start, named as ERPNext names it.
- Vouchers are in the Company's currency. Each fact still records its USD value once, at the
  block's rate (C19). EURC in a euro Company is exact.
- A currency with no USD price pair refuses the import with INVALID_INPUT `currency_not_priced`.
  The deployment lists each Company currency's Chainlink pair beside the assets' pairs, and the
  price sync reads them.

## Settling the vision's core checks on accounting

| # | Check | Now | Records |
|---|---|---|---|
| C1 | A money fact is independent of any chart | **Fits.** A fact names no account; the import posts every earlier priced fact at once | `book-facts`, `books.facts-without-chart`, `books.account-at-posting` |
| C2 | One key per money occurrence | **Fits.** `money_key` and generation are unique; the voucher's id is the fact's, and a head's `capxul_voucher` is unique | `books.money-key`, `books.vouchers` |
| C3 | Corrections are new facts | **Fits.** `reversed` cancels the voucher on the day it was seen (immutable ledger), and a re-settle is a voucher `amended_from` it; a recategorization is a fact and a repost | `books.vouchers`, `books.facts-append-only` |
| C4 | Capxul never waits on the books | **Fits.** Both procedures never refuse; a choice that no longer fits leaves the row in review; the head's lag never touches a settlement | `books.record-money-fact` |
| C5 | A ledger can follow every fact exactly once | **Settled.** A gap-free `seq` per Organization under the books' row lock, and `books.sync.feed` | `books.feed`, `books.feed-gap-free` |
| C6 | A fact's read is enough to post it | **Settled.** Safe, chain, block, transaction, log, block time, Party, fee and voucher are on the fact and in its read | `books.fact-read` |
| C18 | Posting dates, periods and currency | **Settled.** The Organization's time zone, fiscal year start and currency, fixed at the import; a head's closing freezes the past | `books.company-settings`, `books.closed-periods` |
| C19 | Stablecoins valued so a ledger can use them | **Fits.** USD at the block, once; the Company's currency through its own Chainlink pair | `books.company-settings` |
| C21 | An outside system learns what changed | **Fits.** The head pulls the feed; no webhook | `books.sync` |
| C25 | The ERP's businesses keep books | **Fits.** Only Organizations keep facts | `book-facts` |
| C26 | A payment's kind tells the ledger what it is | **Fits with the annotation.** The ledger classifies by the voucher's other side (account, party, documents), never by the on-chain kind | `books.vouchers` |

## The frozen operations

All 17 are kept, booked once, with every acceptance claim word for word. They are `activity
annotate` and the 16 `org books` commands. Three observations of `org books accounts import` now
watch `book_company_transitioned` (transition `import`), because the chart's machine became the
Company's books [`books.acceptance-rewrites`, `books.machines`].

What changed is spelling or new design, never a dropped behaviour:

- `accounts import` copies the Organization's settings and answers them with the cost centre. A
  currency Capxul cannot value is refused, under the existing INVALID_INPUT.
- `accounts list` and `BookAccount` add the Frappe root, the account type, the group flag and the
  currency.
- `accounts add` refuses a parent that holds postings, under the existing WRONG_STATE.
- `activity annotate` takes a party, a cost centre, a project and documents. A receivable or
  payable account without a party is refused, under the existing INVALID_INPUT. A closed period is
  refused with WRONG_STATE on the rpc.
- `reclassify` adds the reason `period_closed`.
- The reports name their currency, and `rules.basis` can read `accrual`.
- `facts list` shows the fact's number, Safe, chain, Party, fee and voucher.

`tools/check-frozen.ts` reports 0 breaches.

## Decisions

- `books.facts-without-chart`: rewritten to its ruling.
- Updated: `books.account-at-posting`, `books.machines`, `books.births-are-transitions`,
  `books.guards`, `books.acceptance-rewrites`, `books.worlds` and `books.budgets`.
- New: `books.frappe-shape`, `books.chart-tree`, `books.feed`, `books.fact-read`, `books.vouchers`,
  `books.sync`, `books.head-vouchers` (for Aaron), `books.closed-periods`,
  `books.company-settings`, `books.cost-centers` and `books.no-fork`.

## For other lanes

- **payments.** Pass with each money side the Safe address, the log index, the counterparty's
  `party_id` when the directory has one, and the `against` the command carried:
  - `payment send --account`, `--suggest` and a party;
  - a request's meaning;
  - a payout's account and fee;
  - a head's "Pay with Capxul" with its references.

  The payment command must store that choice from its birth, so it reaches
  `books.record-money-fact` at settlement. Today nothing carries `--account` to books.
- **banking.** Pass `fee_raw` for a payout (the quote's `fee_amount`) and for a deposit (gross less
  net, in the token's units). Pass the payout's account and party into the command it prepares, and
  `log_index` and `party_id` on the deposit's and the return's sides.
- **requests.** A paid request's side carries its meaning. That is the income account, and, when a
  head made a Sales Invoice for the request, party Customer and that invoice as the reference. Its
  invoice document maps to the head's Sales Invoice; that mapping is the requests or head design.
- **payroll.** A collection reaches books as a payment out with no meaning: payroll cannot invoke
  books, and payments does not know agreements. If collections should be pre-classified, the
  account must come through payments' birth of the collection, or from the head, which makes the
  contractor's Purchase Invoice or the Employee's posting and annotates the row. Frappe HR's net pay
  against a Payroll Entry posts as a Bank Entry on Payroll Payable, with reference Payroll Entry
  and party Employee. Withheld deductions are paid later against their components' liability
  accounts.
- **organizations, start-up and the head connection.**
  - The start-up step should run `org books accounts import` for a new Organization: books does not
    make a chart by itself, because the frozen behaviour "no chart until one is made" must stay
    reachable. The FDE agent does it in its first sitting.
  - `default_currency` must be one Capxul can value: USD, or a currency whose USD pair the
    deployment lists. Otherwise the import refuses it.
  - A time zone or fiscal year start changed after the import does not move the books.
  - The head connection connects only charted books, gives the head's agent a Seat wearing the
    Books hat, applies Capxul's chart through the Chart of Accounts Importer, and sets the head's
    Company and System Settings to the books' copy.
  - ERPNext makes a root cost centre and "Main" when it creates a Company. The connection maps
    Capxul's root and Main onto those (by setting `capxul_cost_center`) instead of making a second
    pair.
  - It sets the Company's default accounts to the chart's role accounts, and makes the Fiscal Years
    the books' start implies. ERPNext refuses a posting date with no Fiscal Year.
- **parties and contacts (CRM).** A voucher's party is a directory `party_id`. The head's app finds
  or creates the Customer, Supplier or Employee by `capxul_party`. A head line whose party has no
  Party is accepted with a null `party_id`.
- **projects.** An annotation's `project` is an opaque text today. Books cannot read projects'
  table until `concept_projects` is added to books' `dependsOn` (shared `foundation.ts`,
  `dependencies.of-books`). Projects sits below books, so the edge is allowed.
- **shared.**
  - `concept_books.about` in `foundation.ts` should name the Company, the Account and Cost Center
    trees, the feed and the head's vouchers.
  - The deployment's asset configuration (`books.capxul-assets`) gains the Company currencies'
    Chainlink pairs.
  - Journeys may add the feed: `close-the-books` could end with a head following it.

## Questions for Aaron

1. **Does Capxul keep a copy of the head's ledger?** This design keeps the GL Entries of every voucher
   a head posts (invoices, accruals, closings), so that Capxul's books are the Organization's whole
   books and match the head's. The other reading of "accounting synced" is that Capxul keeps only
   its own money's vouchers and the head keeps the rest. Under that reading, a payment allocated to
   an invoice debits payables that Capxul never credited. [`books.head-vouchers`]
2. **Is a Company currency without a price feed refused?** A company in a currency with no Chainlink
   USD pair cannot be charted until the deployment lists one. The alternative is to keep its books
   in USD and convert in its head, which ERPNext would not allow once the head's Company is in the
   local currency.

## Not decided here

- Syncing a head's invoices, orders and payroll documents themselves. Only their GL is synced.
- A typed payslip or invoice document on chain (vision C8, C20).
- Tax and withholding payees beyond what a bank payout carries.
- Accounting dimensions beyond the cost centre and the project.
- A Capxul month-end lock without a head. `closed_through` is ready for it.

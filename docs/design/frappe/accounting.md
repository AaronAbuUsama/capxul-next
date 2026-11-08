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
  Capxul stays the system of record for money. "The connection is an integration": the books sync
  through the shared `frappe-head` integration, by organizations' head pattern, like every other
  app concept.
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
payer, the request or the head said the money was for. A run Capxul's payroll computed posts its
accrual through a books door. When a head is connected, books' own process pushes every fact's
documents to it and pulls back the head's own vouchers (invoices, accruals, closings) as GL Entries.
The head holds no Capxul key. Money in a Safe is posted only from its fact, and every other voucher
only by its author, so nothing is posted twice. ERPNext is not forked.

## What was read

| Source | Commit | Used for |
|---|---|---|
| `frappe/erpnext` `erpnext/accounts/doctype`: Account, GL Entry, Journal Entry, Journal Entry Account, Payment Entry, Payment Entry Reference, Payment Entry Deduction, Cost Center, Fiscal Year, Accounting Period, Period Closing Voucher, Bank Account, Mode of Payment, Payment Ledger Entry, Accounts Settings, Repost Accounting Ledger | `6b946b0f` | every field below, and which are allow-on-submit; the validations in `account.py` (`validate_root_details`, `validate_group_or_ledger`, which also refuses a group with an account type or a Company default, `validate_account_number`), `journal_entry.py` (`validate_party`, `validate_cheque_info`, `_set_row_exchange_rate`, which refetches a rate of exactly 1), `payment_entry.py` (party mandatory, `get_valid_reference_doctypes`, `validate_transaction_reference`), `payment_entry/services/gl_composer.py` (deductions are debits), `gl_entry.py` (frozen accounts, cost centre on profit and loss), `general_ledger.py` (the immutable ledger dates a reversal from the request's `posting_date`, else today), `services/gl_validator.py` (`validate_against_pcv`), `repost_accounting_ledger.py` (`_repost_pe_je` reverses the rebuilt lines) |
| `frappe/erpnext` `erpnext/setup/doctype/company/company.json` | `6b946b0f` | the Company's accounting defaults: `default_currency`, the default receivable, payable, bank-charges, exchange and round-off accounts, `cost_center` |
| `frappe/erpnext` `account/chart_of_accounts` | `6b946b0f` | how ERPNext builds a tree from a template; that templates are read only from ERPNext's own folders (so a head takes Capxul's chart through the Chart of Accounts Importer) |
| `frappe/hrms` `payroll_entry.py:619`, `:1093`, `:1196`; `setup.py:171`; `overrides/employee_payment_entry.py` | `88161025` | a run's accrual Journal Entry and its Bank Entry against the Payroll Entry; Payroll Payable is the Company's `default_payroll_payable_account`; which documents an Employee's Payment Entry may reference |
| `frappe/frappe` `database/mariadb/database.py` | `1a7ea577` | a Currency column is decimal(21,9) |
| The shared head records: `frappe-head` (`shared/external.ts`), `frappe-app` (`shared/foundation.ts`), `organizations.head-connection`, `head-ownership`, `head-doorbell`; `projects.head.sync`, `contacts.head.sync`, payroll's head sync | | the one head pattern the books follow |
| The skills `fde-frappe:frappe-stack` and `fde-frappe:build-on-frappe` | | the ladder (configuration, Custom Field, hooks, an app, a fork), and Habitat's sync as prior art ("Capxul Treasury", "Capxul" Mode of Payment) |

## The shape: one table per doctype

| Capxul table | ERPNext doctype | What it holds |
|---|---|---|
| `book-companies` | Company (its accounting fields) | the chart template, the currency, time zone and fiscal year start copied from the Organization when the chart is made, the default cost centre, `closed_through`, the feed's counter `last_seq` |
| `book-accounts` | Account | the tree: `account_name`, `account_number` (the code), `is_group`, `parent_account_id`, `root_type`, `account_type`, `account_currency`, Capxul's six-way `type`, the protecting `role` |
| `book-cost-centers` | Cost Center | the tree: the root and Main from the import, the rest from a head |
| `book-annotations` | the other side of a Journal Entry Account or Payment Entry | account, `party_type` and the directory's `party_id`, cost centre, project, `references` (Payment Entry Reference: the documents it pays, `allocated_amount` in the Company's currency), memo, suggestion |
| `book-facts` | (no doctype: Capxul's proof) | the append-only facts, numbered by `seq`; each standing priced money fact is a voucher |
| (derived) | Journal Entry, Payment Entry, GL Entry | Capxul's money vouchers, made from a fact and its annotation by the rules `frappe-v1`; never stored |
| `book-document-vouchers` | GL Entry (with its voucher's header) | the GL lines of vouchers whose author gives them: a head's own (`author` head) and a payroll run's accrual (`author` payroll) |
| `book-head-syncs` | (no doctype: the sync's place) | per head connection, how far the push and the pull have got |
| `book-assets`, `book-prices` | (none) | added tokens and USD rates, as before |

Field names are Frappe's wherever the content is the same, so the sync copies and never translates
[`books.frappe-shape`]. Capxul keeps its own durable ids. A head carries each in the Custom Fields
`capxul_id` and `capxul_version`, as every synced doctype does (component `frappe-app`), and a party
in `capxul_party`, the CRM lane's field. `capxul_id` is indexed but not unique, because an amendment
carries its predecessor's id; the app keeps one live document per id. The books leave some doctypes
out on purpose:

- Bank Transaction, Bank Clearance and the Bank Reconciliation Tool. A Capxul voucher is cleared
  on its posting date, because the bank is the chain and there is no statement to match.
- Payment Ledger Entry. ERPNext derives it from the GL.
- Fiscal Year documents. They are derived from the Company's fiscal year start.
- Accounting Period. Only a Period Closing Voucher closes the books, and the Capxul app refuses an
  Accounting Period that closes Journal or Payment Entries [`books.closed-periods`].
- Budget. Budgets is Capxul's own concept, on chain.

The ERPNext document shapes the feed and the head sync hand a head are in
`books/target/books/frappe.ts`.

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
  6101) and the parent's type. The parent becomes a group. ERPNext lets an account become a group
  only when it holds no postings, has no account type and fills no Company default. So the add is
  refused with WRONG_STATE `parent_has_postings` when the parent holds postings (a money voucher, an
  annotation or a document voucher line), and with WRONG_STATE `parent_protected` when it has a
  role or a Frappe account type. Capxul refuses these itself, so a head never receives a tree it
  would refuse and its sync never stalls on one. This is the one behaviour that narrows, and no
  claim covers it. The remedy is to add a sibling and reclassify.
- **Codes** keep Capxul's rule: the first digit follows the type, and a code is unique among active
  accounts. An archive frees the code. In a head, where numbers are unique among all accounts, the
  archived account's copy is disabled and loses its number.
- **Roles fill the Company's defaults:**
  - `receivable` (1200) is `default_receivable_account`;
  - `payable` (2000) is `default_payable_account`;
  - `payroll_payable` (2200) is `default_payroll_payable_account`, the field Frappe HR adds to
    Company;
  - `bank_charges` (6500) is `bank_charges_account`;
  - `exchange_gain_loss` (6510) is `exchange_gain_loss_account` and `round_off_account`;
  - `opening` (3990);
  - the two not-decided accounts, 4999 and 6999, which make the review queue;
  - one `safe` account per Safe and asset: type Bank, in the token's own currency (USDC, EURC),
    frozen in the head (`freeze_account` Yes), so only Capxul's app user can post to it. A head
    gives it a Bank Account document (bank "Capxul", the Safe's address as `bank_account_no`) and
    the Mode of Payment "Capxul".
- **Account types** are set only where ERPNext needs one: 1000 and every Safe account are Bank,
  1200 is Receivable, 2000 and 2200 are Payable, 1500 is Fixed Asset, 1510 is Accumulated
  Depreciation, and 6500 is Chargeable. Every other account has none, so it can still take
  sub-accounts.

Every frozen claim keeps its words on this tree. Add's world (`org-with-chart`) must leave 6100 with
no postings [`books.worlds`].

## Money facts and the feed (checks C5 and C6)

**The feed** [`books.feed`]. Every fact takes its Organization's next `seq` from its
`book-companies` row. The writer locks that row inside its own transaction, so numbers commit in
order and a rollback leaves no hole (invariant `books.feed-gap-free`). The writers are:

- payments' settlement and Movements;
- banking's deposits and returns;
- payroll's run submit and cancel, through the accrual door;
- books' own rpcs, its scan of added tokens and its head sync's pull.

A call with several Organizations' sides takes their locks in org id order. The invoker invokes a
books procedure after taking its own row locks and takes no other lock after it, so the books' lock
is always the last one a money transaction waits on. `books.sync.feed` reads the facts after a
number. The reader keeps its own place, so the read writes nothing. The facts list
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
- **The party.** A Receivable or Payable account needs one. It is the annotation's directory Party,
  else the counterparty Party the money fact proves. So a head that knows the payer only as a
  private Customer can still allocate the payment.
- **The voucher type.** An account that is Receivable or Payable, with its party, makes a **Payment
  Entry** (Pay or Receive) allocated to the documents named. Each party type references what
  ERPNext lets it reference (`get_valid_reference_doctypes`, and Frappe HR's override for Employee):
  - Customer: Sales Order, Sales Invoice, Journal Entry;
  - Supplier: Purchase Order, Purchase Invoice, Journal Entry;
  - Employee: Expense Claim, Employee Advance, Journal Entry.

  A Payroll Entry, which no Payment Entry may reference, takes a Journal Entry line instead. Any
  other account makes a **Journal Entry**, voucher type Bank Entry, cheque number the transaction,
  cheque date the block's day.
- **Allocations** are in the Company's currency (`allocated_amount`, as Payment Entry Reference has
  it) and add up to at most the row's value. When the Company's currency is the token's peg (USD
  for USDC, EUR for EURC), they may add up to the token amount at par. The difference from the
  block's value posts to exchange gain or loss (6510) as a deduction. So 1,000 USDC worth 999.80 USD
  at the block pays a 1,000 USD invoice in full, instead of leaving 20 cents outstanding. The rest of
  a row stays unallocated, as an advance.
- **Deductions** are debits in ERPNext (`add_deductions_gl_entries`). A rail's fee is a positive
  amount on 6500. An exchange gain is a negative amount on 6510 and a loss a positive one.
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

A recategorization (an annotation that changes account, party or documents) changes Capxul's
voucher in place: its lines on its posting date become the annotation's. The feed hands the voucher
again with a newer `capxul_version` [`books.account-at-posting`]. Every voucher balances exactly
(`books.postings-balance`), and one money occurrence stands once (`books.one-live-money-fact`).

**How a head follows a new version** [`books.vouchers`]. A head cannot change a submitted voucher in
place:

- Journal Entry Account's `account`, `party` and reference are not allow-on-submit (only
  `cost_center` and `project` are).
- Repost Accounting Ledger only remakes the GL from the document as it stands. Under the immutable
  ledger it also reverses the *rebuilt* lines, dated today, not the old ones (`_repost_pe_je`).

So the head's app does it the Frappe way. It cancels the live document, with the reversal dated on
the voucher's own `posting_date`. Under the immutable ledger, ERPNext reads that date from the
request's `posting_date`, else it uses today. Then it submits the amendment on the same date,
carrying the same `capxul_id`. When the type changes between Journal Entry and Payment Entry, it
submits a new document instead. Each day's GL in the head then nets to Capxul's in-place voucher.
A `reversed` fact is cancelled the same way, dated `cancelled_on`.

## A payroll run's accrual

[`books.payroll-accrual`; procedure `books.record-payroll-accrual`]

Payroll keeps Frappe HR's runs and slips from the first day, head or no head. It asks books to post
a run's accrual, because each slip's net is paid by a Bank Entry on Payroll Payable
(`payroll.accrual`). Without an accrual, an Organization with no head would pay every net against a
payable nothing credited. Its profit and loss would show no payroll at all.

- **The door.** Payroll's run submit and cancel invoke `books.record-payroll-accrual` in their own
  transaction. Books cannot follow payroll's events, because payroll will sit above payments and
  payments above books, so a door is the only way down. It passes P4's test: if the run and its
  accrual disagreed at a commit, money would leave the Safe against a liability the books never
  recorded.
- **What it posts.** The Journal Entry that `make_accrual_jv_entry` makes, as a `payroll` document
  voucher:
  - each earning's and employer cost's expense is debited;
  - each deduction's liability is credited;
  - each employee's net is credited to Payroll Payable, with party the Employee;
  - every line names the Payroll Entry.

  An `accrual_posted` fact puts it on the feed, so a head receives it like money. Cancelling the run
  records `accrual_cancelled` and cancels the voucher on that day.
- **It never refuses.** A line whose account is missing or unfit posts to its role's account (6999,
  or Payroll Payable). Without a chart the voucher waits and posts once the chart exists, as money
  facts do.
- **One author.** The side that computed the run posts its accrual. A run a head computed accrues
  in the head and comes back as the head's own voucher. Payroll never invokes the door for it.

## The sync, both ways, without double-posting

[`books.sync`; invariant `books.one-author-per-voucher`; process `books.head.sync`]

The books follow the system's one head pattern, as projects, the CRM and payroll do
(`organizations.head-connection`, `head-ownership`, `head-doorbell`):

- Capxul always calls the head, through the shared `frappe-head` integration.
- The head holds no Capxul key. The Capxul app for Frappe only rings a doorbell, with no data, after
  a change.
- Each app concept syncs its own records with its own process. For the books that is
  `books.head.sync`, one per head connection, which keeps its place in `book-head-syncs`.

```mermaid
sequenceDiagram
  participant CH as Chain
  participant CX as Capxul (books)
  participant H as ERPNext head (with the Capxul app)
  CH->>CX: PaymentSent / Transfer at finality
  CX->>CX: payments settles; the fact gets seq n; its voucher is derived
  CX->>H: books.head.sync push: upsertDocs(seq n's Payment Entry, capxul_id, capxul_version)
  H-->>CX: written (or unchanged); pushed_seq = n
  H->>H: a person submits a Purchase Invoice
  H->>CX: ring (no data)
  CX->>H: pull: listChanges(after pulled_change)
  H-->>CX: the invoice's GL Entries
  CX->>CX: checked (chart accounts, no Safe line, balanced, open period); kept as a head document voucher
  H->>H: a person classifies a Capxul payment against that invoice (the app's one action for it)
  H->>CX: ring
  CX->>H: pull: listChanges
  H-->>CX: the classification, by a head user matched to a member by mailbox
  CX->>CX: applied as books.annotations.save would be: recategorized, seq m
  CX->>H: push seq m: cancel and amend the voucher on its posting date, now allocated to the invoice
```

**Push: Capxul to the head.** The process pushes nothing until the books are charted. Then it pages
the feed from `pushed_seq`, from 1 the first time, so a head connected late gets the whole ledger in
order. It writes each fact's documents as they stand, by `capxul_id`, with their `capxul_version`
(`upsertDocs`):

- an Account for each chart fact (an `account_created` under a ledger parent sends that parent,
  now a group, first);
- a Cost Center for `cost_center_created`;
- a voucher for each priced money fact;
- the new version of each voucher for `account_assigned`, `recategorized` and `rows_reclassified`;
- the cancelled voucher for `reversed`;
- a payroll run's accrual for `accrual_posted`, and its cancellation for `accrual_cancelled`.

Money vouchers and payroll accruals are Capxul's alone under `organizations.head-ownership`. They
are read-only on the head and overwritten there if they drift. A push is idempotent by version: the
head answers "unchanged".

**Pull: the head to Capxul.** The process reads the head's own changes after `pulled_change`,
oldest first, each applied in its own transaction:

- **The chart.** A head-born or renamed Account is applied as `books.accounts.add` or `rename`
  would be. Capxul assigns its code and id. The head user must be a member wearing the Books hat,
  matched by mailbox.
- **The meaning of Capxul's money.** A head user classifies a Capxul voucher through the app's one
  action for it: account, party, cost centre, project and the documents it pays. This is applied as
  `books.annotations.save` would be for that member (any Seat gives an account; the Books hat a new
  account or a memo). It is a `recategorized` fact, and the next push carries the new version.
- **The head's own vouchers.** Its submitted or cancelled invoices, accruals, depreciation and
  closings are kept as `head` document vouchers with their GL Entries [`books.head-vouchers`].
  A closing moves `closed_through`.

A change based on an older version loses, and Capxul's version is pushed back over it (a conflict).
A change Capxul's checks refuse is pushed back. A head voucher is refused, left out and counted when
any of these is true:

- a line names an account or cost centre that Capxul's chart does not have;
- a line is on a group account or on a Safe account;
- it carries a `capxul_id` (an echo of Capxul's own);
- it does not balance;
- it posts on or before `closed_through` and is not itself a closing.

The process wakes on a fact here, on the head's ring, and once a day to catch a lost ring. While
the head is failing it waits. It ends when the head is disconnected.

**`books.sync.feed` stays.** It is an rpc any Seat may read, with the follow flow in the Core SDK,
for any other ledger that follows the books (an accountant's own system). It hands the same
documents the push writes.

**Why nothing is posted twice.**

- Every movement of money has exactly one voucher, keyed by its fact.
- No document voucher has a Safe line, on either side: the app refuses one in the head, and the
  pull refuses it in Capxul.
- A payroll run's accrual has one author, the side that computed the run.
- No Capxul voucher is edited in the head except by the push.

Capxul is the system of record for money, and the head for its own documents.

**What the head's Capxul app needs, with no fork** [`books.no-fork`]:

- **Custom Fields:** `capxul_id` and `capxul_version` (indexed, not unique, as above), `capxul_party`
  (the CRM lane's), and `capxul_tx_hash`, `capxul_chain_id`, `capxul_log_index` and
  `capxul_block_time` on Journal Entry and Payment Entry.
- **Accounts Settings:** `enable_immutable_ledger` on, so a cancellation posts on its own day, as a
  `reversed` fact does. `unlink_payment_on_cancellation_of_invoice` off, so an invoice a Capxul
  payment settles cannot be cancelled until Capxul drops the allocation. Repost Accounting Ledger is
  not used for Capxul's vouchers.
- **Safe accounts** frozen. The Company's `role_allowed_for_frozen_entries` is a role only the app's
  user holds.
- **A Currency** per token (USDC, EURC, and each added token), and currency precision of at least
  the assets' decimals, up to Frappe's 9 (a Currency column is decimal(21,9)). WETH's 18 decimals
  round in the head, and Capxul's raw units stay exact.
- **The Company's chart** applied from Capxul through the Chart of Accounts Importer before any
  transaction, and its Fiscal Year documents made from the Organization's fiscal year start.
- **Writing Capxul's vouchers** (`upsertDocs`):
  - insert with `flags.ignore_exchange_rate`, because a Journal Entry refetches a rate of exactly 1
    (`journal_entry.py:764`), which a stablecoin's often is;
  - cancel with the request's `posting_date` set to the reversal's date, which the immutable ledger
    reads (`general_ledger.py:760`);
  - keep one live document per `capxul_id` across Journal Entry and Payment Entry.
- **Hooks** on Journal Entry and Payment Entry:
  - `before_submit`, `before_cancel` and `before_update_after_submit` refuse every change to a
    Capxul voucher that the push did not make. That covers a person's cancel or amend, an
    allow-on-submit edit (cost centre, project) and Payment Reconciliation or unreconcile;
  - `before_submit` also refuses any other voucher with a line on a Safe account. Freezing alone
    does not stop the site's Administrator, who holds every role;
  - each change to a synced doctype goes into the app's change list, for `listChanges`.
- **A classify action** on a Capxul voucher, the only edit the app allows on one. It records the
  head user's account, party, cost centre, project and documents as a change for the pull.
- **A "Pay with Capxul" action** on Purchase Invoice, Expense Claim and Payroll Entry. It opens
  Capxul's own payment command, prefilled with the payee, the amount and the voucher's other side,
  for a person or the Organization's agent to sign in Capxul. The head holds no key and moves no
  money.
- **An Accounting Period guard:** the app refuses an Accounting Period that closes Journal or
  Payment Entries. Only a Period Closing Voucher closes the books.
- **The Bank Reconciliation workspace** hidden: a Capxul voucher is cleared when it is posted.

## Closed periods

`closed_through` is the latest `period_end_date` among the head's submitted Period Closing Vouchers,
as ERPNext's own `validate_against_pcv` reads it [`books.closed-periods`]. Cancelling the latest
closing moves it back to the one before. Nothing on or before that day changes:

- A late money fact (an added token's scan, a deposit credited days after its block) posts on the
  first open day, and its block time stays on the voucher.
- A recategorization, accept or reclassify of a row posted in a closed period is refused with
  WRONG_STATE `period_closed`. Reclassify lists the row with that reason. The correction is an
  adjusting entry the head posts in the open period.
- A head voucher into a closed period is refused.
- Only a closing closes. An Accounting Period that closed Journal or Payment Entries would make the
  head refuse Capxul's late vouchers and stall the sync, so the Capxul app forbids one.

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
| C2 | One key per money occurrence | **Fits.** `money_key` and generation are unique; the voucher's id is the fact's, and a head holds one live document per `capxul_id` | `books.money-key`, `books.vouchers` |
| C3 | Corrections are new facts | **Fits.** `reversed` cancels the voucher on the day it was seen (immutable ledger), and a re-settle is a voucher `amended_from` it; a recategorization is a fact and a new version, which a head applies by cancelling and amending on the voucher's posting date | `books.vouchers`, `books.facts-append-only` |
| C4 | Capxul never waits on the books | **Fits.** Both procedures never refuse; a choice that no longer fits leaves the row in review; the head's lag never touches a settlement | `books.record-money-fact` |
| C5 | A ledger can follow every fact exactly once | **Settled.** A gap-free `seq` per Organization under the books' row lock, and `books.sync.feed` | `books.feed`, `books.feed-gap-free` |
| C6 | A fact's read is enough to post it | **Settled.** Safe, chain, block, transaction, log, block time, Party, fee and voucher are on the fact and in its read | `books.fact-read` |
| C18 | Posting dates, periods and currency | **Settled.** The Organization's time zone, fiscal year start and currency, fixed at the import; a head's closing freezes the past | `books.company-settings`, `books.closed-periods` |
| C19 | Stablecoins valued so a ledger can use them | **Fits.** USD at the block, once; the Company's currency through its own Chainlink pair | `books.company-settings` |
| C21 | An outside system learns what changed | **Fits.** Books' head sync pushes the feed to a head, which only rings a data-free doorbell; any other ledger follows `books.sync.feed` | `books.sync` |
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
- `accounts add` refuses a parent that holds postings, or that has a role or a Frappe account type,
  under the existing WRONG_STATE (`parent_has_postings`, `parent_protected`).
- `activity annotate` takes a party, a cost centre, a project and documents. A receivable or
  payable account with no party given and no counterparty Party on the row's fact is refused, and so
  is a document its party type cannot reference, both under the existing INVALID_INPUT. A closed
  period is refused with WRONG_STATE on the rpc.
- `reclassify` adds the reason `period_closed`.
- The reports name their currency, and `rules.basis` can read `accrual` (a head's voucher or a
  payroll run's accrual exists).
- `export quickbooks` also writes one entry per document voucher in the window, so the export is
  the same ledger the reports read. Its claim keeps its words; its observation names the extra
  rows.
- `facts list` shows the fact's number, Safe, chain, Party, fee and voucher.

`tools/check-frozen.ts` reports 0 breaches.

## Decisions

- `books.facts-without-chart`: rewritten to its ruling.
- Updated: `books.account-at-posting`, `books.machines`, `books.births-are-transitions`,
  `books.guards`, `books.acceptance-rewrites`, `books.worlds` and `books.budgets`.
- New: `books.frappe-shape`, `books.chart-tree`, `books.feed`, `books.fact-read`, `books.vouchers`,
  `books.sync`, `books.head-vouchers` (for Aaron), `books.closed-periods`,
  `books.company-settings`, `books.cost-centers`, `books.no-fork` and `books.payroll-accrual`.

## What the review changed

An adversarial review read the design against Frappe's sources and the other lanes' records, and
changed the records where they were wrong:

- **The sync.** The first draft had the head's Capxul app follow the feed and post its vouchers back
  as the Organization's agent, on a Seat wearing the Books hat. That contradicted the shared head
  records: `frappe-head` says Capxul always calls, the Capxul app "holds no Capxul key", and
  projects, the CRM and payroll each sync through their own process. Books now does the same
  (`books.head.sync`). `books.sync.post` and its SDK flow are gone.
- **Reposting.** A recategorization was said to repost "the way Repost Accounting Ledger does".
  ERPNext cannot change a submitted entry's account, and under the immutable ledger that tool
  reverses the rebuilt lines, dated today. A head now cancels and amends on the voucher's own date.
  `capxul_id` is not unique, because an amendment carries its predecessor's.
- **The chart.** ERPNext refuses to make a group of an account with an account type or a Company
  default. Capxul now refuses those parents itself (`parent_protected`), and Equity carries no
  account type, so 3000 and 3900 can still take sub-accounts. Payroll Payable is the Company's
  `default_payroll_payable_account`, not a Payroll Settings field.
- **Allocations.** The field is Frappe's `allocated_amount`, in the Company's currency. A par
  allocation settles a peg-currency invoice in full, the difference to 6510.
- **References.** A Payment Entry may reference a Journal Entry. Only a Payroll Entry needs a Journal
  Entry line.
- **The payroll accrual.** Payroll asked books for a door (`payroll.accrual`), and the first draft
  had left the accrual to a head. The books now have `books.record-payroll-accrual`.
- **Closings.** `closed_through` is the latest submitted closing, so cancelling one reopens. An
  Accounting Period that closes Journal or Payment Entries is refused in the head.
- **The head app's details:** `flags.ignore_exchange_rate`, the cancellation date, the
  `before_update_after_submit` hook, unlink-on-cancel off, and the guard against a non-Capxul voucher
  on a Safe account.

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
- **payroll.**
  - Add books to payroll's dependencies (shared `foundation.ts`, `dependencies.of-payroll`). Books
    sits below payroll, so the edge is allowed.
  - Invoke `books.record-payroll-accrual` from `payroll.runs.submit` (action `submit`) and
    `payroll.runs.cancel` (action `cancel`), in the same transaction, only for a run Capxul
    computed. Pass the lines `make_accrual_jv_entry` would make, in the Company's currency, with
    books' account ids (or null, for the role's account).
  - Never invoke it for a run imported from a head (`payroll.runs.import`): that run's accrual is
    the head's own voucher. The Capxul app must not submit the slips of a run Capxul pushed to the
    head through Frappe HR's own path, which would make a second accrual there.
  - Frappe HR's net pay against a Payroll Entry posts as a Bank Entry on Payroll Payable, with
    reference Payroll Entry and party Employee. Withheld deductions are paid later against their
    components' liability accounts.
  - A collection reaches books as a payment out with no meaning, because payments, which writes its
    fact, does not know agreements. To pre-classify collections, the account must come through
    payments' birth of the collection, or from the head, which makes the contractor's Purchase
    Invoice or the Employee's posting and classifies the row.
- **organizations, start-up and the head connection.**
  - The start-up step should run `org books accounts import` for a new Organization: books does not
    make a chart by itself, because the frozen behaviour "no chart until one is made" must stay
    reachable. The FDE agent does it in its first sitting.
  - `default_currency` must be one Capxul can value: USD, or a currency whose USD pair the
    deployment lists. Otherwise the import refuses it.
  - A time zone or fiscal year start changed after the import does not move the books.
  - The head connection needs no Seat or key for the books: books' own process syncs them from the
    connection's `confirm`, as projects and the CRM do. It applies Capxul's chart through the Chart
    of Accounts Importer, and sets the head's Company and System Settings to the books' copy. Books
    pushes nothing until the books are charted.
  - ERPNext makes a root cost centre and "Main" when it creates a Company. The connection maps
    Capxul's root and Main onto those (by setting `capxul_id`) instead of making a second pair.
  - It sets the Company's default accounts to the chart's role accounts, and makes the Fiscal Years
    the books' start implies. ERPNext refuses a posting date with no Fiscal Year.
- **parties and contacts (CRM).** A voucher's party is a directory `party_id`: the one the
  classification gives, else the counterparty the money fact proves. The head's app finds or
  creates the Customer, Supplier or Employee by `capxul_party`. When a head user classifies a
  payment against a private Customer, linking that Customer to the fact's Party is the CRM's
  (`contacts.book.record`), never the head's. A head line whose party has no Party is accepted
  with a null `party_id`.
- **projects.** An annotation's `project` is an opaque text today. Books cannot read projects'
  table until `concept_projects` is added to books' `dependsOn` (shared `foundation.ts`,
  `dependencies.of-books`). Projects sits below books, so the edge is allowed.
- **shared.**
  - `concept_books.about` in `foundation.ts` should name the Company, the Account and Cost Center
    trees, the feed, the document vouchers and the head sync.
  - `frappe-head` (`external.ts`) must carry what the books sync needs:
    - `upsertDocs` cancels and amends a submitted Journal or Payment Entry on a given posting date,
      with `flags.ignore_exchange_rate`;
    - `listChanges` returns the head's submitted and cancelled vouchers with their GL Entries, its
      Account and Cost Center changes, and the app's classify changes.
  - `frappe-app` (`foundation.ts`) must carry the books' settings and hooks listed under "What the
    head's Capxul app needs". It must also not mark `capxul_id` unique.
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

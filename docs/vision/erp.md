# The ERP on Capxul

> **Speculative. Thinking only, not the build.** This note is the long-term vision, written down on
> the main line so that what we build now does not block it. Nothing in it is a record, nothing in it
> changes the baseline, and nothing in it is scheduled. The main line now is the baseline of the new
> product (the rebuilt Capxul, `books/target`) and the starter kit. Where the vision would need the
> baseline to change, this note asks Aaron a question instead of changing anything
> (`aaron.erp-on-capxul`, `aaron.frappe-shape`, `aaron.crm-frappe-shape`,
> `aaron.books-first-principles` in `books/target/shared/rulings.ts`).

Status: written 8 November 2026. The core checks in section 7 are the part that matters for the
main line. Everything before them explains the picture they are checked against.

> "The goal is we're going to build an agentic ERP that runs on stablecoins... an opinionated front
> end to Capxul, but tailored to real business. Right now all of this is very speculative. I want
> the thinking on this to be on the main line, making sure that whatever we build supports that
> longer-term vision, but I don't want that to be the thing that we're building right now."
> (Aaron, 8 November 2026)

## What this note used

- **Skills:** `fde-frappe:frappe-stack` (which Frappe app and DocType owns each need) and
  `fde-frappe:implement-erpnext` (the partner procedure, the settings to decide first, and
  `references/limits.md`, what ERPNext and Frappe HR do not do). The `build-on-frappe` skill names
  Habitat's existing sync, which already adds Capxul fields to ERPNext with Custom Fields and books
  Capxul payments against a "Capxul Treasury" bank account with "Capxul Clearing" and "Capxul
  Suspense" accounts. That is prior art for section 3. Its code was not read.
- **Real doctypes**, cloned shallow into `/tmp` on 8 November 2026 and read as data:
  `frappe/erpnext` at `6b946b0f`, `frappe/hrms` at `88161025`, `frappe/crm` at `2cecd300`, and the
  `frappe/frappe` framework (sparse: `frappe/utils`, `scheduled_job_type`, `tests/classes`) at
  `1a7ea577`. Field lists below are from their DocType JSON; behaviour is from their Python.
- **The baseline:** the records named in each check, in `books/target`.
- **The old system**, read only: the v4 contracts in `/home/user/factory/packages/contracts/v4`
  (`IPayments.sol`, `Budgets.sol`).

## The picture

The ERP is an opinionated front end to Capxul for a real business. Running on stablecoins is just
how it runs: every payment it makes or receives is a Capxul payment on chain. Frappe and ERPNext
supply the business documents (quotes, orders, invoices, stock, projects, payslips) and the ledger.
Capxul supplies the money and everything that must be true about it.

```mermaid
flowchart TD
  subgraph ERP["The ERP (Frappe site per business)"]
    CRM["Frappe CRM: leads, deals, contacts"]
    SELL["ERPNext: selling, buying, stock, projects"]
    HR["Frappe HR: employees, salary slips, payroll runs"]
    GL["Accounts (the likely fork): ledger, AR/AP, tax, periods"]
    APP["Capxul app for Frappe: the one seam"]
  end
  subgraph CAPXUL["Capxul (the baseline)"]
    DIR["parties: the global directory"]
    PAY["payments, requests, banking: money that moves"]
    BUD["budgets, board, approvals: who may move it"]
    BOOKS["books: money facts"]
    DOCS["documents: the content behind every hash"]
    CLOCK["one clock"]
  end
  AGENTS["agents with Seats and keys"]
  CHAIN["Protocol v4 on chain"]
  CRM --> APP
  SELL --> APP
  HR --> APP
  GL --> APP
  APP -->|"instructs: pay, request, resolve"| PAY
  APP -->|"resolves people and companies"| DIR
  BOOKS -->|"settled facts flow back"| APP
  AGENTS --> APP
  AGENTS --> PAY
  PAY --> CHAIN
  BUD --> CHAIN
  CLOCK -.->|"drives both"| ERP
```

The line between the two is one rule: **Capxul owns what the chain makes true; the ERP owns what
the business means by it.**

| Capxul owns (the truth of money) | The ERP owns (the meaning of money) |
|---|---|
| That money moved: the Payment, its payment id, the transaction, the block and its time | Which account it posts to, which invoice it pays, which cost centre and project it belongs to |
| Who may move it: hats, budgets, Board, approvals, all on chain | Who may raise a document and approve it as a business step (Frappe roles and Workflows) |
| The exact content behind each hash on chain (documents) | The document itself as the business works on it: the invoice, the payslip, the order |
| One money fact per money occurrence, never edited, reversed forward | The ledger: accrual, receivables and payables, tax, periods, closing, revaluation, reports |
| Who someone is and where they get paid: the global directory | The relationship: lead, deal, customer, supplier, employee, notes, owner |
| Now, on one clock | When a document is due, posted and reported, on the same clock |

Money never moves because the ERP says so in its own database. The ERP asks Capxul; Capxul asks the
chain; the chain decides; the settled fact comes back and the ERP books it.

## 1. Which Frappe apps, as they are or forked

The order of preference is the `build-on-frappe` skill's: configuration first, then Custom Fields
and Property Setters, then hooks and overridden classes in a custom app, and a fork only where the
product must feel like one thing and the lighter tools cannot get there. "Ideally nothing" is
forked.

| App | As it is, or forked | Why |
|---|---|---|
| Frappe Framework | As it is | DocTypes, REST, permissions, Workflow, Notification, the scheduler. Nothing in it touches money. |
| ERPNext Selling, Buying, Stock, Manufacturing, Projects, Assets, Quality, POS | As it is | They make documents (Quotation, Sales Order, Purchase Order, Delivery Note, Timesheet, Work Order). None of them moves money; they hand an invoice to Accounts. |
| ERPNext Accounts | Most likely forked, after a stretch as a custom app | It is where the bank lives, and on Capxul the bank is a Safe. See below. |
| Frappe HR (HRMS) | As it is, with one step replaced by the Capxul app | It computes gross, deductions and net well and in many shapes. Only its payment step (a "Bank Entry" Journal Entry) becomes a Capxul payment run (section 4). |
| Frappe CRM | As it is, with a Party link | It holds the relationship. The global directory is linked to it, not merged into it (section 2). |
| Helpdesk | As it is | No money. |
| A Capxul app for Frappe | New | The one seam: Custom Fields (a Party on every party DocType, a payment id and transaction on every money document), the instruction calls, the follower of settled facts, the posting job and, on a devnet, the clock follower. Habitat's sync is the first version of this. |

**Why Accounts is the likely fork.** ERPNext's accounting assumes a bank that the business does not
control and reads after the fact: a Payment Entry is drafted and submitted by a person, and later a
Bank Transaction from a statement is reconciled to it (Payment Entry has `clearance_date`,
`reference_no`, `reference_date`; Bank Transaction has `status`
`Pending|Settled|Unreconciled|Reconciled`). On Capxul the order is the other way round and the
bank is exact:

- **A payment is the settlement.** A Payment Entry should exist, submitted, only once the chain has
  settled the payment; it should never be submitted by a person beforehand, and it should be
  cancelled only by a reversal Capxul recorded. The instruction before it is a Payment Request
  (whose `status` already runs `Requested|Initiated|Payment Ordered|Paid|Failed`) or a Payment
  Order, both standard in ERPNext, not a draft Payment Entry.
- **Reconciliation goes away.** There is no statement to match: the settled fact carries the
  payment id, the transaction and the block. The Bank Reconciliation Tool, Bank Clearance and Bank
  Transaction import are replaced by posting from facts (and `limits.md` already warns that
  semi-automatic bank reconciliation errored in Frappe's own demo).
- **The bank account is a Safe and a token.** Each Safe and stablecoin is a Bank Account linked one
  to one to a ledger account in the token's currency (USDC as an account currency, with the block's
  USD rate), which is how Habitat's "Capxul Treasury" already works.
- **Who may pay is on chain.** Submitting a payment in Frappe must not imply authority. The approval
  is Capxul's (the payer's own Safe, a budget's hat, the Board).
- **Posting is automatic and exactly once.** Every money fact posts one voucher, keyed by the
  fact's id, and a reversal posts a reversing entry (Journal Entry has `reversal_of`).

All of this can begin as the Capxul app (Custom Fields, `doc_events`, an overridden Payment Entry
class, a hidden Bank Reconciliation workspace). It becomes a fork only where the forms and the flow
must read as Capxul's own: paying a Purchase Invoice from its own page, seeing the chain's status on
the voucher, never seeing "reconcile".

**Projects** need nothing from Capxul. A Timesheet becomes a Sales Invoice in ERPNext; the invoice
becomes a Capxul request; the payment's fact posts with the project as an accounting dimension that
the ERP's document carries. Capxul's money fact has no dimension and needs none.

## 2. People and companies: the global directory meets Frappe CRM

Frappe is one site per business (or several companies in one site). Every Contact, CRM Lead, CRM
Deal and CRM Organization lives in one site and is that business's private record. Capxul's
directory is global: one Party for each identity Capxul can name and pay, across every tenant, and
it holds nothing private (`parties.directory-tenancy`, `parties.mailbox-digest`).

So the two are two layers, not one table:

- **Identity (global, Capxul).** Who someone is, where they get paid, and the name and photo they
  show everyone: `parties` (`kind`, `handle`, `display_name`, `photo_file_id`, `safe_address`,
  `mailbox_digest`, `owner_kind`, `owner_id`).
- **Relationship (per business, the ERP).** What this business knows and does with them: the CRM
  Organization's `website`, `industry`, `territory`, `annual_revenue`; the Lead's `status`,
  `lead_owner`, `source`, `email`, `mobile_no`; the Deal's `probability`, `deal_value`,
  `expected_closure_date`; notes, tasks and calls. Capxul's own per-tenant layer is `contacts` (an
  owner's book: `label`, `visibility`), which the CRM's records extend.

| Capxul | Frappe |
|---|---|
| Party, kind `person` (found by mailbox digest; provisional until they sign in) | Contact; and Employee, Customer or Supplier through Frappe's links |
| Party, kind `organization` (a Capxul Organization, with its company Safe) | CRM Organization; Customer or Supplier |
| Party, kind `agent` | A Frappe User for the agent, and the Party on whatever it acts for |
| Party, kind `address` (an outside wallet) | A Supplier or Customer paid at a wallet |
| `contacts` entry (an owner's label and visibility) | The CRM's Contact or Organization in that business's site |

The Capxul app adds one Custom Field, the Party id, to CRM Organization, Contact, Customer,
Supplier and Employee. Resolving a handle, a mailbox or an address to a Party
(`parties.resolve-recipient`) is how the ERP dedupes a counterparty across tenants and learns where
to pay them; it never copies the directory into the site. A won deal makes a Customer as Frappe CRM
already does (ERPNext CRM Settings `create_customer_on_status_change`), and the Customer keeps the
deal's Party.

The fit has one hole, and it is in the core: the directory today holds only identities Capxul can
pay. A company that is not on Capxul (a prospect, a supplier paid by bank) has no Party, because an
`organization` Party is a Capxul workspace born with its company Safe and every Party has a
`safe_address`. A global CRM of companies needs them. That is check C13 and question 1.

## 3. Accounting on a Frappe fork, from first principles

A ledger posts an entry when it can answer six questions about money: what happened, exactly once;
when; how much of what; between whom; for what; and whether it still stands. Capxul must record the
answers. Everything else is the ledger's.

**What Capxul must record so a ledger can post it** (and where the baseline records it today):

| The ledger needs | The baseline records it in |
|---|---|
| One record per money occurrence, with a key that is the same whoever reaches it | `book-facts.money_key` (`payment:<v4 payment id>` or `transfer:<chain>:<tx>:<log>`) with `generation`, unique per Organization (`books.money-key`); `fact_id` |
| Every such record delivered once and in an order it can follow | Not yet: the facts list is ordered by when money happened, not when it was recorded (check C5) |
| When it happened: the block's time | `book-facts.occurred_at`; the facts list's `blockTime` (`books.facts.list`) |
| How much of what | `amount_raw`, `asset_id`, `symbol`, `decimals`; `usd_value` at the rate in force at the block, once (`usd_rate`, `usd_source`) |
| Which bank it moved in and out of | The Safe is the procedure's `MoneySide.safe_address`; the fact's read does not show it (check C6) |
| Between whom | `counterparty`, a string the record does not pin to a Party id (check C6) |
| For what | `source_kind` and `source_id` (a Payment, a deposit, a payout, a Movement, an agreement, an asset) and, on the Payment, `document_hash`, whose content is in `documents` |
| Whether it still stands | A `reversed` fact naming the one it cancels (`reverses_fact_id`); a re-settle is the next generation |
| Proof | `tx_hash`, `block_number`, `chain_id` on the fact; the Payment's `settled_tx_hash`, `settled_log_index`, `settled_block_hash` |

**What the ledger owns:** the chart of accounts and which account each fact posts to; accrual
(receivables and payables, invoices and bills, advances); tax and withholding; cost centres,
projects and other dimensions; the posting date in the company's time zone, fiscal years, periods
and their closing; the functional currency, exchange rates and revaluation; the reports; and the
matching of payments to invoices (Payment Entry `references`, allocation).

The baseline already draws the line in the right place. A money fact names no account: the account
is chosen when the books are read (`books.account-at-posting`), and facts are kept from the first
money whether or not a chart exists (`books.facts-without-chart`). Recording never refuses
(`books.record-money-fact`, `errors: []`), so a settlement never waits on any ledger, Capxul's or
the ERP's.

**How the facts would post.** The Capxul app reads each new fact and posts one voucher, with the
fact's id as a Custom Field (unique), the transaction as `reference_no` or `cheque_no`, and the
block's date as the posting date:

| Fact kind (`book-facts.kind`) | Voucher in the ERP |
|---|---|
| `payment_settled`, out | Payment Entry (Pay) against the Purchase Invoice, Expense Claim or Payroll Entry it paid; credit the Capxul Treasury account of the Safe and token |
| `payment_settled` or `payment_received`, in | Payment Entry (Receive) against the Sales Invoice the request was issued for |
| `deposit_received` (a bank deposit, or outside money in) | Journal Entry to the receivable it matched, else to a suspense account until someone decides |
| `payment_sent_outside` (outside money out) | Journal Entry from a suspense account until classified |
| `payout_returned` | Journal Entry reversing the payout's posting |
| `opening_balance` (a token added with a balance) | Opening Journal Entry |
| `reversed` | A reversing Journal Entry (`reversal_of`), or cancellation of the voucher it posted |

Three things follow for the ledger, none of which the baseline must change for:

- **Posting date.** ERPNext posts by date in the site's time zone; a fact is an instant. The ledger
  converts. A fact for a closed period (a late scan, a reversal) posts on the first open date with
  the original instant kept on the voucher.
- **Currency.** Facts carry USD at the block's rate, never revalued. A company whose functional
  currency is not USD converts with its own rates and revalues in the ERP (ERPNext's Exchange Rate
  Revaluation), as it does for any foreign-currency bank account.
- **Two sets of books.** Capxul's books concept (chart, annotations, reports, QuickBooks export)
  stays on the main line for businesses that use Capxul alone. A business on the ERP posts from
  the same facts into ERPNext's ledger, so its Capxul chart would go unused. Whether the ERP fills
  Capxul's annotations or ignores them is a later question, not this one.

## 4. Payroll, and how a payslip comes from on-chain pay in both directions

**Frappe HR today.** A Salary Structure Assignment gives an employee a structure; a Payroll Entry
(`start_date`, `end_date`, `payroll_frequency`, `payment_account`, `payroll_payable_account`)
makes one Salary Slip per employee with `earnings` and `deductions` (rows of Salary Detail:
`salary_component`, `amount`), `gross_pay`, `total_deduction` and `net_pay`. Submitting the run
posts an accrual Journal Entry (`make_accrual_jv_entry`: expenses up, payroll payable and each
deduction's account up). Paying it is a separate "Bank Entry" Journal Entry (`make_bank_entry`:
debit Payroll Payable for each employee, credit the bank), linked by `reference_type` Payroll Entry
(`hrms/payroll/doctype/payroll_entry/payroll_entry.py:1093`, `:1196`). A Salary Slip's `status` is
`Draft|Submitted|Cancelled|Withheld`: Frappe HR has no "paid" on the slip itself; a run is paid when
its bank entries exist (`has_bank_entries`).

**The vision replaces only the bank entry.** Frappe HR keeps computing; Capxul pays; the settled
facts come back.

```mermaid
sequenceDiagram
  participant HR as Frappe HR
  participant APP as Capxul app (as the company's agent)
  participant CX as Capxul
  participant CH as Chain
  HR->>HR: Payroll Entry makes slips with gross, deductions and net, and posts the accrual
  APP->>CX: one payment per slip (net to the employee) and per deduction payee, each with its slip as the document and its own request key
  CX->>CX: read the payroll budget's limit, prepare, then the agent's key signs (or a person, or the Board)
  CX->>CH: Budgets.spend for each item
  CH-->>CX: PaymentSent(paymentId, sender, recipient, token, amount, kind, documentHash)
  CX->>CX: settle at the finality depth, the Payment and its book fact in one transaction
  CX-->>APP: settled with payment id, transaction and block time (later a reversal, if a reorg took it back)
  APP->>HR: mark the slip paid, then post the payment entry dated at the block
```

Step by step:

1. **Compute (the ERP).** Frappe HR makes the slips exactly as it does today, including tax,
   pension and every other deduction, and posts the accrual.
2. **Instruct (ERP to Capxul).** For each slip the Capxul app asks Capxul to pay the net to the
   employee's Party, and each deduction to whoever is owed it: a tax office through a bank payout
   (banking, from the payroll budget with `--from`), a pension fund at its Party. Each payment
   carries the payslip as its document (a PDF or JSON file of at most 128 KB, whose hash goes on
   chain) and a request key made from the site, the slip and the component, so asking twice can
   never pay twice (`payment-commands.request_key`, K1).
3. **Authorize (Capxul and the chain).** The payments come from the payroll department's budget.
   The company's agent holds a Seat with that budget's spending allowance and signs with its own
   key, so a run needs no person, and it can never pay more than the Board put in the budget for the
   period (`PAYROLL_BUDGET_EXCEEDED`). A business that wants a person to approve each run has them
   sign; one that wants the Board pays as a Board batch.
4. **Pay (Capxul on chain).** Each item is one `Budgets.spend`; the chain emits one `PaymentSent`
   with the payment id and the payslip's hash.
5. **Settle (Capxul).** Payments settles each Payment from its indexed `PaymentSent` at the
   finality depth, every term checked, and writes its book fact (`payment_settled`, keyed
   `payment:<payment id>`, with the block's time and the transaction) in the same transaction.
6. **Come back (Capxul to ERP).** The Capxul app reads the settled facts: the payment id, the
   transaction, the block's time. On the slip it fills Custom Fields (payment id, transaction,
   block time, Capxul status "paid") and it posts the payment entry the bank entry used to make:
   debit Payroll Payable for the employee, credit the Capxul Treasury account, posting date the
   block's date, `cheque_no` the transaction. A run is paid when every slip is.
7. **If the chain takes it back.** A reorg below finality reopens the Payment and reverses its book
   fact (`payments.reorg`); the app reverses the entry and the slip reads unpaid until the
   payment settles again, as the next generation.
8. **If it never lands.** A lapsed approval leaves the Payment `needs_retry`; a retry pays the same
   payment id, so it still cannot pay twice.

**The other direction: pay that starts on chain.** Capxul's own payroll today is pay agreements
(v4 Agreements: a salary, stream or retainer from a budget, released over time, collected by the
payee; `payroll.scope`). There the chain is the source and the ERP follows it. Each collection is a
`PaymentSent` (kind 4, `Budgets.sol` `KIND_COLLECTION`) that payments births as a Payment, and
payroll's write keeps its payment id, its window and the block's time
(`agreement-writes.payment_id`, `landed_at`, `args.period_start`, `args.period_end`). The ERP makes
the slip from it: the period it covers, the rate from the agreement's terms document, gross equal
to what was collected, already paid, dated at the block. This is the payslip the baseline already
previews (`payroll/shapes.ts` `Payslip`: `periodStart`, `periodEnd`, `rate`, `gross`, `token`,
`terms`). An agreement pays the whole released amount to the payee, so there is no withholding on
chain: this direction suits contractors, retainers and anyone paid gross. Employees whose tax is
withheld are paid the first way.

## 5. One clock for the larger system

The baseline has one clock (`time.one-clock`): every product decision reads one now, and on a
devnet that same instant is the chain's block time. The ERP would run on it too, by three rules:

- **Money's times are Capxul's.** When money moved is the block's time, never the ERP's. A payment
  due on a day is a Capxul dated payment (a `Budgets.schedule` for a budget), whose timer fires on
  the one clock; the ERP never schedules money with its own scheduler.
- **Documents' times are the ERP's, on the same clock.** Due dates, posting dates, payroll periods,
  Auto Repeat and reminders are Frappe's, read through `frappe.utils`.
- **The ERP takes now from Capxul when it acts on Capxul.** Every Capxul answer carries the
  backend's now (`time.clients-take-server-now`), so the Capxul app never decides a Capxul expiry
  or window from Frappe's clock.

On staging and production both sides read their host's clock, as Capxul already does.

On a devnet (and in a simulation like vending-bench's year of a business) the Frappe site joins
the clock as a follower. The protocol is already public and language-free: `capxul.devnet/1` over
HTTP JSON (`devnet.time-protocol`), and "an outside program joins the same way, so a simulation's
own happenings become stops" (`devnet.followers`). The Frappe side is small because Frappe already
has the seams:

- **Now.** ERPNext and Frappe HR read time almost only through Frappe's helpers (418 calls of
  `now_datetime()`, `nowdate()`, `getdate()` or `today()` outside tests, against 7 direct
  `datetime.now()` or `time.time()` reads). `now_datetime()` reads the host clock in the site's
  time zone (`frappe/utils/data.py:373`), and Frappe's tests already freeze it
  (`frappe/tests/classes/context_managers.py:29`, `freeze_time`). The follower sets that one place
  to the devnet's now.
- **Due work.** Frappe's scheduler wakes every 4 minutes of real time
  (`frappe/utils/scheduler.py:26`) and runs each Scheduled Job Type whose next run is due:
  `is_event_due(current_time)` compares `get_next_execution()` with now
  (`scheduled_job_type.py:103`, `:120`). The follower runs that check at each stop instead, reports
  the earliest `get_next_execution()` as its next due instant, and acknowledges idle when its job
  queues are empty.

A warp then stops at every instant something is due on either side (`devnet.warp-barrier`): a
Capxul timer, a Frappe daily job, a payroll run's date. A simulated year produces an ERP ledger dated
in the story's time, because every voucher is dated at its fact's block and every block is mined
at now.

## 6. The agentic part

An agent is a first-class Capxul user: its own account and Safe, owned by a person or an
Organization, signing with its own key (`concept agents`). It can hold a Seat
(`org-members.kind` `human|agent`) and be offered allowances (`org-invitations.grantee_kind`,
`offers`), so it can pay from a budget within the limit the chain enforces.
A machine signs in with its key in one step, and a warp never signs it out (`aaron.machine-login`).
Every company has ten Seats, each may hold one agent, and the company may hold one agent of its own
(`aaron.seats`).

That is enough for the ERP's agents: the company's agent runs the Capxul app (payroll, paying
approved bills, issuing requests for invoices), and a Seat's agent works for its holder. The ERP's
Frappe roles decide who may raise and approve a document; the chain decides whether money may move.
People who use the ERP but never move money need no Seat, and payees (employees, suppliers) are not
Seats at all.

## 7. Core checks

Each check is a place where today's baseline would fit or block the vision, with the record and
field that show it. **Fits** needs nothing. **Fits with a mapping** needs only the ERP side to map
it. **Blocks** would need the baseline to change, so it is a question for Aaron below; nothing has
been changed.

| # | Check | Verdict | Evidence | What it means |
|---|---|---|---|---|
| C1 | A money fact is independent of any chart | Fits | `book-facts` names no account (`books.account-at-posting`); facts kept with or without a chart (`books.facts-without-chart`) | Any ledger can post Capxul's facts to its own accounts. |
| C2 | One key per money occurrence | Fits | `book-facts.money_key` and `generation`, unique index `by_org_money_key`; `books.money-key` | The ledger's posting is idempotent by the fact's id; a replay or a second writer never posts twice. |
| C3 | Corrections are new facts | Fits | `book-facts.kind` `reversed`, `reverses_fact_id`; invariant `books.facts-append-only` | Maps to a reversing Journal Entry (`reversal_of`); nothing is edited after the ledger read it. |
| C4 | Capxul never waits on the books | Fits | `books.record-money-fact` and `books.reverse-money-fact`: `errors: []`, "It never refuses and makes no outside call" | A ledger that is down or behind never stops a settlement. |
| C5 | A ledger can follow every fact exactly once | **Blocks** | `books.facts.list` pages "oldest first by when they happened" on index `by_org_occurred` (`org_id`, `occurred_at`, `fact_id`); facts have no machine and so no event (`books.machines`, P7); facts come from several writers in their own transactions (payments' settlement, banking's deposits, books' minute scan of added tokens, `books.added-token-scan`); `activity.change-log` itself rules that "a time column cannot promise exactly once" and gives activity a gap-free `seq` instead | A ledger tailing the facts by their time can skip one that commits after it has read past that time. Question 2. |
| C6 | A settled payment's read is enough to post it | Fits with a mapping | `payments.settled_at` is not said to be the block's time; `PaymentView.receipt` has `chain_id` and `tx_hash` only (`payments/ledger.ts`); `BookFact` has `blockTime` and `txHash` but not the Safe or log index (`books/facts.ts`); `book-facts.counterparty` is a string, not pinned to a Party id | The ERP reads the fact (`--source` the Payment) for the block's time; which Safe and which Party should be explicit. Folded into question 2. |
| C7 | An instruction can be repeated safely | Fits | `payment-commands.request_key`, unique `by-request-key`, compared by `request_digest` (K1) | The slip's name is the request key: a crashed or repeated run never pays twice. |
| C8 | Each payment carries the business document | Fits with a mapping | `payments.document_hash` per Payment; `DOCUMENT_KINDS` is `memo|invoice|terms|receipt` (`documents.kinds` dropped the Payslip); `ReceiptContent` takes a PDF, PNG, JPEG or JSON file of at most 128 KB (`SendInput.document`) | The payslip goes on chain as a receipt file's hash. A typed payslip kind would let Capxul render and check it; later, not now. |
| C9 | A payroll run is one approval with a payslip per item | **Blocks** (one approval per run) | `SendInput` has one `to`, one `amount` and one `document` (`payments/commands.ts`); several items appear only in prose, for a personal payment (`payments.commands.prepare`: "`sendBatch` for several items of `--input`"); a budget payment is one `Budgets.spend` per item | Today a run is one payment per slip, each its own approval: fine for an agent signing with its key, heavy for a person. Question 3. |
| C10 | A budget can pay someone who has no account yet | **Blocks** (payroll to new hires) | `payments.claim-escrow-routes` (chosen `own-safe-or-board`: a budget spend to a mailbox with no Safe is `INVALID_RECIPIENT`); `operation payment.send` refusal `INVALID_RECIPIENT` | A new employee must claim their Capxul account before the first run, or be paid by the Board. That decision already asks Aaron the same question; question 4 adds payroll's weight. |
| C11 | Agents can move money within on-chain limits | Fits | `org-members.kind` `human|agent`; `org-invitations.grantee_kind` `human|agent` with allowances in `offers`; `aaron.seats`; `aaron.machine-login` | The company's agent runs payroll and bills without a person, bounded by its budget. |
| C12 | Seats are enough for an ERP | Fits | `aaron.seats` (ten Seats, one agent each, plus the company's agent); payees are paid by mailbox or Party, never by Seat (`agreements.payee_email`, `payments.payee_id`) | Only people and agents who move money need Seats; employees and suppliers do not. Several ERP agents each use a Seat. |
| C13 | The global directory can hold companies and people not on Capxul | **Blocks** (a global CRM) | `parties.kind` is `person|agent|organization|address`; every Party has `safe_address` (not null); an `organization` Party is born only with a Capxul Organization (`machine_party.t.register`); a `person` is known only by mailbox (`mailbox_digest`) | A prospect company, or a supplier paid only by bank, cannot be in the directory. Question 1. |
| C14 | The directory leaks nothing a CRM keeps private | Fits | `parties.directory-tenancy` (global, "it holds nothing private"); `parties.mailbox-digest` (a digest, never the mailbox) | Emails, phones, notes and deals stay in each business's Frappe CRM. |
| C15 | The address book extends to a CRM | Fits with a mapping | `contacts` is per owner (`owner_kind`, `owner_id`, `party_id`, `label`, `visibility`) | Frappe CRM's Contact and Organization carry the Party id; the CRM holds the rest. |
| C16 | Capxul's pay agreements and Frappe HR's payroll can both exist | Fits with a mapping | `agreements` (`rate`, `period`, `release`, `terms_hash`); `payroll.scope` (runs and slips dropped from the baseline); `Payslip` shows `gross` only (`payroll/shapes.ts`) | Agreements pay gross on chain; withheld payroll is Frappe HR's run paid by budget spends. The ERP makes slips from both (section 4). |
| C17 | A collection can become a paid slip | Fits | `agreement-writes.payment_id`, `landed_at` (the block's time), `args.period_start`, `args.period_end`; `agreement_transitioned.occurred_at`; `payroll.collection-payment-id` | Each collection is one slip, keyed by its payment id. |
| C18 | Posting dates, periods and currency are the ledger's | Fits | `organizations` has `country` but no time zone, functional currency or fiscal year; `book-charts.template` `us-services`, `basis` `cash`; books' reports cut at "the end of `asOf`'s day" with no time zone named (`books/reports.ts`) | ERPNext owns them. Capxul's own reports should say whose day they cut at; a clarification for the books owner, not a blocker. |
| C19 | Facts value stablecoins the way a ledger can use | Fits | `book-facts.usd_value`, `usd_rate`, `usd_source` at the block's rate; `book-prices` pairs `USDC/USD`, `EUR/USD`, `ETH/USD`, `BTC/USD` | USD at the block, once; other functional currencies are converted and revalued in the ERP. |
| C20 | An ERP invoice can be a Capxul request | Fits with a mapping | `InvoiceContent.lines` are `description`, `quantity` (an integer), `unit_amount_raw`, adding up exactly (`documents/procedures.ts`); `requests.invoice.lines` | ERPNext's fractional quantities, taxes and discounts map to lines that are totals. The ERP's own invoice file cannot be the request's document (a request carries a Memo or an Invoice envelope); later, not now. |
| C21 | An outside system can learn what changed | Fits | `rules.outbox` (events go to the relay, not to outside apps); `activity.changes.read` (a sealed `seq` cursor over Payments and Movements); `payments.ledger.watch` (live) | The Capxul app pulls; Capxul needs no outbound webhooks for the ERP. |
| C22 | A Python ERP can reach Capxul | Fits with a mapping | The Core SDK is TypeScript (`component core-sdk`); the CLI prints `--json` for every operation; the devnet clock is HTTP JSON (`devnet.time-protocol`) | The Capxul app calls the CLI as the company's agent, or runs a small TypeScript sidecar. |
| C23 | The ERP can run on the one clock | Fits | `time.one-clock`; `devnet.followers`; `devnet.warp-barrier`; `time.clients-take-server-now`; `time.chain-judged-deadlines` (a fact's time is its block's; periods are half-open) | Frappe joins as a follower (section 5). |
| C24 | Money authority stays on chain | Fits | `concept budgets` ("It answers, from the chain, who may spend"); `concept approvals` ("It never decides authority: the chain does") | No Frappe role can move money; a Frappe Workflow is a business step before Capxul's approval. |
| C25 | The ERP's businesses keep books | Fits | `book-facts`: "Only Organizations keep facts; a person's rows keep none" | A business is an Organization; a sole trader on a personal Safe is out of scope for the ERP. |
| C26 | A payment's kind tells the ledger what it is | Fits with a mapping | `PaymentKind` `bill|one-off|reimbursement|transfer` (kinds 0 to 3) and 4 for a collection (`Budgets.sol` `KIND_COLLECTION`, `MAX_PREPARED_KIND`) | There is no salary kind; the ledger classifies by its own document, not by the kind. |
| C27 | An employee keeps their pay after they leave | Fits with a condition | A person's Safe is a pure function of their mailbox (`concept accounts`; `parties.safe_address`); sign-in is an emailed code (`concept access`); no record moves a person to a new mailbox | Pay an employee at a mailbox they keep, never at a work address that ends with the job. Question 5. |

### Questions this raises for Aaron

1. **The directory (C13).** You ruled the directory global, a global CRM of people and companies.
   Today it holds only identities Capxul can pay: every Party has a Safe, a company is a Party only
   once it is a Capxul Organization, and a person only by mailbox. Should the global directory also
   hold companies and people who are not on Capxul (a prospect, a supplier paid by bank), or do
   those stay private in each business's CRM until they join?
2. **A feed of facts a ledger can follow (C5, C6).** An outside ledger would post Capxul's money
   facts. Today they can be read only in the order money happened, which can skip a fact recorded
   late. Should the books keep each Organization's facts in the order they were recorded (a gap-free
   sequence, as activity's change log has), with each fact's read naming its block time, Safe and
   counterparty Party?
3. **One approval for a payroll run (C9).** Should paying several people from one budget in one
   approval, each payment with its own document (a payslip each), be part of the baseline's payment
   send? Without it a run is one approval per person.
4. **Paying a new hire (C10).** Must every employee claim their Capxul account before their first
   pay from a budget, or should a budget be able to pay someone who has no account yet? This is the
   question `payments.claim-escrow-routes` already asks, with payroll as the case that needs it.
5. **A person's mailbox for life (C27).** A person's Safe and sign-in hang on one mailbox, and
   nothing moves them to another. Is that the rule for good (so the ERP must pay at a mailbox the
   employee keeps), or will a person be able to move their account to a new mailbox?

## 8. Not decided here, and not now

- Whether Accounts is ever forked, or stays the Capxul app's overrides.
- How ERP sites are hosted: one Frappe site per Organization, or several companies in one site.
- Whether a business on the ERP keeps Capxul's own chart and annotations, or the ERP fills them.
- A typed payslip document and an ERP invoice document on chain (C8, C20).
- Tax and withholding payees beyond what a bank payout already carries.

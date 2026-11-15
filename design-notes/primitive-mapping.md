# On-chain primitives and Frappe records: the mapping, and the decisions it needs

Research of 14 November 2026, read-only. It answers `docs/roadmap.md:34`: "Where a Frappe record and an on-chain
primitive do not match one to one ... the mapping is designed and agreed per primitive before its slice is built."

**How paths are cited.**
- `C:` is `packages/contracts/src/` on `master`.
- `F:` is `packages/frappe-app/capxul/`. `Core:` is `packages/core/src/`.
- `E:` and `H:` are ERPNext v16.54.0 and Frappe HR v16.53.2, the versions `packages/bench-image/apps.lock.json` pins. I
  read them from the bench image's layers under `/var/lib/docker/.../snapshots/{1170,1171}/fs/home/frappe/frappe-bench/apps/`.
- `infra:` is the old stack at `/home/user/infrastructure`. `main:` is `origin/main` of capxul-next.
- **[K]** marks a claim from my knowledge of ERPNext/HRMS that I did not read in source. **[A]** marks an assumption.

## 0. The answer in five lines

1. Payments, Budgets.spend and Escrow pay **one document once**. Each maps 1:1 onto a Payment Entry that Frappe drafts and
   the chain posts. That is today's thin line (`F:payments.py:171`), and it extends to Expense Claims and payroll runs.
2. **An Agreement is not a document.** It is a standing promise that accrues continuously and is collected by the
   payee, in amounts the payee chooses. No ERPNext or HRMS record has that shape. It needs a Capxul record of its own,
   and its books are an accrual plus N collections, not invoices or slips.
3. **The reconciliation key must become `paymentId`, not `documentHash`.** Every collection of an agreement carries the
   same hash (`C:money/Agreements.sol:221-222`). An escrow sends two `PaymentSent` events under one hash, one to fund it
   and one to pay it out. Today the site matches on the hash alone (`F:payments.py:165-168`).
4. **The chain's Budget is a cash gate per calendar period.** ERPNext's Budget is an expense check per fiscal year.
   Map departments to Cost Centers and HR Departments 1:1. Do not use ERPNext Budget as a gate.
5. **Salary Slips belong to pay that Frappe HR computes**: deductions, tax, a run. That pay goes to the chain as an
   ordinary spend (kind 2). Agreement collections are never slips. This is main's 11 November review
   (`main:blueprint/payments/agreements/decisions.ts:649-692`).

## 1. The on-chain primitives

### 1.1 Payments: the one way money moves (`C:money/Payments.sol`)
- **State.** It holds only `paid[paymentId]` (`:20`). It holds no funds and has no owner.
- **Function.** `send(item)` (`:37`, `_send` `:51-78`) moves exactly `amount` of `token` from the caller to `recipient`.
  It requires a non-zero `documentHash` and `jobNonce`, and only `executor` may call it when one is set. It consumes the
  id once (`:64-67`).
- **The id.** `paymentId = keccak(typehash, chainId, this, jobNonce, executor, recipient, token, amount, kind, documentHash)`
  (`:80-95`). It is known before the payment lands.
- **Event.** `PaymentSent(paymentId, sender, recipient, token, amount, kind, documentHash)` (`C:interfaces/IPayments.sol:23`).
- **Kinds.** The kind is a `uint16` stamp. Budgets accepts 0 to 3 from people and 4 for collections
  (`C:money/Budgets.sol:25-27`). The old codes were 0 quick pay, 1 invoice, 2 payroll, 3 reimbursement and 4 collection
  (`infra:packages/protocol/src/payments/value-schema.ts:21-29`). The rebuild uses 1 for a supplier
  (`Core:approvals/payments.ts:35`).

### 1.2 Budgets: a company's money as a tree (`C:money/Budgets.sol`, `C:interfaces/IBudgets.sol`)
- **State.** A budget holds `{safe, parent, hat, token, period ∈ month|quarter|year, depth ≤ 8, closed, amount per period,
  childrenAmount, ownSpent, ownCommitted, spent, committed, periodIndex}` (`IBudgets.sol:18-33`).
- **Spent and left.** Spent resets when the calendar period turns. What is left is
  `amount − childrenAmount − ownSpent − ownCommitted` (`IBudgets.sol:314-318`).
- **Authority.** The company Safe may act, and so may any wearer, in good standing, of the hat of this budget or one above
  it (`:373`).
- **Lifecycle.** `createTopBudget` (`:126`), `createChildBudget` (`:146`, which needs room in the parent), `setAmount`
  (`:159`), `setHat` (`:179`), `close` and `reopen` (`:188`, `:197`).
- **Money.**
  - `spend` (`:206`) pays now. It emits `Spent` and `PaymentSent`, and pays from the company Safe through Roles and
    Payments (`_pay` `:497`).
  - `schedule` (`:235`) reserves now and pays later. `execute` (`:283`, which anyone may call after `payAt`) pays it, and
    `cancel` (`:268`) frees it. Its states are None → Pending → Paid | Cancelled (`IBudgets.sol:36-41`).
  - Agreements alone call `commit`, `release` and `payReserved` (`:305`, `:316`, `:325`). `payReserved` pays kind 4 and
    does **not** add to `ownSpent`.
- **Events.** BudgetCreated, BudgetAmountSet, BudgetHatSet, BudgetClosed and BudgetReopened; Spent, PaymentScheduled,
  ScheduleCancelled and ScheduledPaid; Committed, Released and ReservedPaid (`IBudgets.sol:56-97`).
- **In the rebuild today.** There is one top budget per company, for the Books hat: 1,000,000 USDC a month
  (`Core:organizations/found.ts:52,170`).

### 1.3 Agreements: recurring pay against a budget (`C:money/Agreements.sol`, `C:interfaces/IAgreements.sol`)
- **State.** An agreement holds `{safe, budgetId, token, payee, rate, period ∈ week|month|year, collected, reserved,
  earnedScaled, releasedScaled, startsAt, step (seconds or MONTHLY), offerExpiresAt, accruedAt, endsAt, pendingAt,
  pendingRate, collections, accepted, paused, closed, documentHash}` (`IAgreements.sol:12-35`).
- **Limit.** A budget may have at most 64 open agreements (`:31`).
- **Lifecycle.**
  - `offer` (`:59`): a hat wearer offers, and the call commits the reservation in the budget (`:92`).
  - `withdrawOffer` (`:114`).
  - `accept(id, termsHash)` (`:193`): the payee's Safe accepts, and `termsHash` must equal `documentHash`.
  - `changeRate` (`:124`): a raise commits the difference now. A lowering waits for its effective date.
  - `cancelChange` (`:149`), `pause` and `resume` (`:160`, `:170`, which stop and restart accrual), and `end` (`:180`).
  - The offer lapses at `offerExpiresAt`. The agreement closes after `endsAt` (`_accrue` `:321`, `_close` `:362`,
    which frees the reservation and releases all earned pay).
  - `settle(budgetId)` (`:229`) is anyone's and moves no money.
- **Money.** Pay accrues by the Calendar (`C:libraries/Calendar.sol:37`), to the second. It is released in whole steps.
  The **payee** calls `collect(id, amount)` (`:209-224`) for any amount up to `availableOf`. Each collection is a
  `payReserved` with job nonce `keccak(agreements, id, index)` and the **same** `documentHash`.
- **Events.** AgreementOffered, AgreementAccepted, OfferWithdrawn, RateChanged, RateChangeCancelled, AgreementPaused,
  AgreementResumed, AgreementEnded, ReservationReleased and `Collected(…, amount, paymentId)` (`IAgreements.sol:37-65`).
- **What it pays.** It pays **gross**. Nothing on chain withholds tax or deductions.

### 1.4 Escrow and EscrowFactory (`C:money/Escrow.sol`, `C:money/EscrowFactory.sol`)
- **Terms.** The terms `{ownerSafe, payeeSafe, token, amount, jobNonce, kind, documentHash, condition}` are fixed at
  deploy (`IEscrow.sol:19-28`).
- **Address.** The factory deploys at a predictable CREATE2 address (`EscrowFactory.sol:28`, `predictAddress :37`,
  `predictPaymentId :46`), so the payer funds it **before** it exists.
- **Conditions.**
  - Condition 0: the escrow holds the invoice amount, and anyone may `payout` (`Escrow.sol:110`).
  - Condition 1: the payee has claimed. The payee Safe no longer has Companies House as an owner, and only the payee may
    `collect` (`:98-107`, `:116`).
- **States.** Open → Paid | Refunded (`IEscrow.sol:12-16`). The owner may `refund` (`:176`).
- **Money.** It moves twice:
  - funding is an ordinary spend to the escrow's address, so one `PaymentSent` goes to the escrow;
  - the payout is `Payments.send` from the escrow to the payee, so a second `PaymentSent` carries the same `documentHash`
    (`:135-147`).
- **Events.** EscrowCreated, EscrowPaid, EscrowRefunded and InvoicePaymentCompleted.
- **Pending change.** Ruling `aaron.escrow-general` (main) says the escrow contract changes, so that its owner is the
  recipient's future account and the sender may reclaim it, while Budgets stays as it is. That change is not made on
  `master` yet.

### 1.5 Approvals, hats and departments (not separate contracts)
- **What an approval is.** A Safe signature, or a threshold of them, over a UserOperation or a Safe transaction. Core
  collects them and sends the transaction when they complete (`Core:approvals/sign.ts:37-139`, `payments.ts:38`).
- **Where authority is checked.** Only in `Budgets.authorised` against Hats (`packages/contracts/README.md`, "How an
  agent's authority to spend flows").
- **What a department is.** A **budget plus its hat** (ruling `aaron.departments`, `main:blueprint/shared/rulings.ts:421-443`).
  The chain names neither the department nor the people in it. Only budget ids and hat ids exist there.

## 2. Frappe records that touch money or HR (all are submittable unless noted: docstatus 0 → 1 → 2)

| Record | Lifecycle (status field) | Accounting effect on submit | Source |
|---|---|---|---|
| Purchase Invoice | Draft → Unpaid / Partly Paid / Paid / Overdue / Cancelled. `on_hold` and `release_date` block payment | Dr expense (cost center), Cr Creditors (party Supplier) | `E:accounts/doctype/purchase_invoice/purchase_invoice.json`; `.py:853,920`; hold `:263-267` |
| Sales Invoice | The same, from the receiving side | Dr Debtors, Cr income | `E:…/sales_invoice/sales_invoice.py:499,1841` |
| Payment Entry | Draft / Submitted / Cancelled. Pay, Receive or Internal Transfer | Pay: Dr party account, Cr `paid_from`. Allocated to the invoices it references | `E:…/payment_entry/payment_entry.py:265,1507` |
| Payment Request (ERPNext) | Outward: Initiated → Payment Ordered → Paid. Inward: Requested (sends the email and the payment URL) → Paid | None | `E:…/payment_request/payment_request.py:329-347`; statuses in `.json` |
| Journal Entry | Types include Journal, Bank and Cash Entry | Whatever its rows say | `E:…/journal_entry/journal_entry.json` |
| Contract (CRM) | Unsigned → Active ↔ Inactive (by dates) / Cancelled. `party_type` is Customer, Supplier or Employee. The terms are text | None | `E:crm/doctype/contract/contract.py:150-154,240` |
| Subscription | Trialing / Active / Grace Period / Unpaid / Cancelled / Completed. **Not** submittable | It makes a Sales Invoice for a Customer, or a Purchase Invoice for a Supplier, each period | `E:…/subscription/subscription.py:328,604` |
| Budget | Submitted. Against a Cost Center or a Project, with account and amount; fiscal years; distribution Monthly to Yearly; action Stop, Warn or Ignore | None. It checks GL debits (`E:accounts/general_ledger.py:230`) and Material Requests and Purchase Orders (`E:controllers/buying_controller.py:1248`) | `E:…/budget/budget.py:375` |
| Cost Center | A tree (not submittable) | Dimension of every GL row | `E:…/cost_center/cost_center.json` |
| Department | A tree, per company (not submittable). HRMS adds `payroll_cost_center` | None | `E:setup/doctype/department/department.json`; `H:setup.py:115` |
| Employee | Active, Inactive, Suspended or Left (not submittable) | It is a party. Capxul adds `capxul_wallet_address` (`F:canon.py:31`) | `E:setup/doctype/employee/employee.json` |
| Salary Structure | Submitted. Components and formulas; `payroll_frequency` Monthly, Fortnightly, Bimonthly, Weekly or Daily; `payment_account` | None | `H:payroll/doctype/salary_structure/*.json` |
| Salary Structure Assignment | Submitted. `{employee, salary_structure, from_date, base, variable, payroll_payable_account, cost centers}` | None. A slip takes the **latest assignment whose `from_date` is on or before its start**, so there is no proration inside a slip | `H:…/salary_slip/salary_slip.py:878-890` |
| Additional Salary | Submitted. One component for one employee on a date, or recurring | None. It feeds the next slip | `H:…/additional_salary/additional_salary.py` |
| Salary Slip | Draft / Submitted / Withheld / Cancelled. Gross − deductions = net, for start to end dates | **None by itself** | `H:…/salary_slip/salary_slip.py:193,272`; `.json:180` |
| Payroll Entry | Draft → Submitted (makes the slips, `:80`) → slips submitted (Queued or Failed if more than 30) → bank entry. It cancels its slips and Journal Entries | Submitting the slips posts a **submitted accrual JE**: Dr salary expense, Cr Payroll Payable (`:580`, `:657`, `:1798-1830`). `make_bank_entry` makes a **draft** Bank Entry JE: Dr Payroll Payable, Cr `payment_account` (`:1054`, `:1238`) | `H:payroll/doctype/payroll_entry/payroll_entry.py` |
| Expense Claim | Draft → Unpaid / Paid / Partially Paid / Rejected (`approval_status`) | Dr expense, Cr employee payable. Paid by a Payment Entry with party Employee | `H:hr/doctype/expense_claim/expense_claim.py:186,249` |
| Employee Advance | Draft → Unpaid → Paid → Claimed / Returned | Paid by a Payment Entry: Dr advance account. Settled through an Expense Claim, a return, or salary | `H:hr/doctype/employee_advance/employee_advance.py:104` |

**Capxul's own records today.** The Capxul app adds three doctypes: Capxul Payment Request (status Requesting, Waiting
for signature, Sent, Failed or Mismatch, keyed by `document_hash`), Capxul Chain Event (the event log) and Capxul Hat
Grant (`F:capxul/doctype/*`). Its hooks forbid submitting a Safe-backed Payment Entry, or crediting the Safe's ledger
account, unless a chain event posts it (`F:hooks.py:21-29`, `F:payments.py:39-57`).

## 3. Mapping matrix

Key: **Ch** = the chain owns the fact; **Fr** = the Frappe site owns it; **Co** = Core owns it (approvals, the directory).
"Drives" names the side whose action causes the other.

| Primitive ↔ Frappe record | Rel. | Amount | Schedule | Payee | Approval | Status | History | Reconciliation key | Drives |
|---|---|---|---|---|---|---|---|---|---|
| Budgets.spend ↔ Payment Entry (Pay, Safe-backed) referencing a PI, EC or Payroll Entry | 1:1 | Fr drafts it; Ch is final (mismatch → Bank Transaction, `F:payments.py:193-196`) | — | Fr (the party's `capxul_wallet_address`) | Co / Ch (hat + signature) | Ch posts | Ch (tx), Fr (GL) | `paymentId` (today `documentHash`) | **Frappe → chain** (doc.submit holds; approval.sign sends; `PaymentSent` posts) |
| Budgets.spend ↔ Purchase Invoice | N:1 or 1:N through the PE's references | Fr | due date (Fr) | Fr | — | Fr (outstanding is updated by the PE) | Fr | PE references | Frappe → chain |
| Budgets.schedule / execute / cancel ↔ PE with a future posting date, or PI `release_date` | 1:1 | Fr → Ch frozen at schedule | `payAt` Ch | Fr → Ch | Co / Ch | Ch: Pending / Paid / Cancelled ↔ PE: draft held / submitted / deleted | Ch | `scheduledId` + `paymentId` (known at schedule, `IBudgets.sol:245-247`) | Frappe → chain at schedule; chain → Frappe at execute |
| Budgets.spend batch ↔ Payroll Entry (slips Frappe HR computed) | 1 run : N payments, or one batch | Fr (net per slip) | Fr (period) | Fr (Employee wallet) | Co / Ch | Ch posts one Bank Entry JE that clears Payroll Payable | Fr | one `paymentId` per slip, `documentHash` = the slip's hash | Frappe → chain |
| Budgets.spend ↔ Expense Claim / Employee Advance | 1:1 through the PE | Fr | — | Fr | Fr (`approval_status`) + Ch | Ch posts the PE | Fr | `paymentId` | Frappe → chain |
| Budget (node) ↔ Cost Center, Department and (optionally) ERPNext Budget | 1:1:1 | Ch (amount per period) | Ch (calendar period) | — | Ch (hat) | Ch (closed) | Ch | `budgetId` stored on the Cost Center and the Department | Frappe/Core op → chain (create); chain event → Frappe (mirror) |
| Agreement ↔ Contract + Employee or Supplier + (a Capxul Agreement) | 1:1 | **Ch** (rate, earned, available) | **Ch** (start, end, step, rate changes) | Ch (`payee` Safe); Fr names the party | Ch (offer by a hat wearer, accept by the payee) | Ch | Ch | `agreementId` (+ `documentHash` = the Contract terms' hash) | Op → Frappe draft → chain offer; **chain → Frappe** for accept, pause, end and lapse |
| Agreement.collect ↔ Payment Entry (or JE) clearing Agreement Payable | 1:1 per collection | Ch | **the payee chooses when** | Ch | the payee alone | Ch | Ch | `paymentId` from `Collected` | **chain → Frappe** only (the employer site never asks) |
| Agreement accrual ↔ Salary Slip | none (see P2) | | | | | | | | |
| Escrow ↔ two Payment Entries (fund, pay out) + an escrow clearing account | 1:2 | Fr → Ch | — | Fr names the party; Ch predicts the Safe | Co / Ch | Ch: Open / Paid / Refunded | Ch | escrow address + two `paymentId`s | Frappe → chain (fund); chain → Frappe (claim, refund) |
| Hat (Books, People, …) ↔ Frappe Roles + User Permission on Department | 1:N | — | — | — | Ch | Ch | Ch | (user, hat, department) | chain → Frappe (`F:hats.py`) |

### 3.1 Lifecycles side by side

| Agreement (chain, `AGREEMENT_STATUSES`, `main:…/agreements/data.ts:42`) | Contract (ERPNext) | Employee / SSA (HRMS) | Books |
|---|---|---|---|
| prepared (Capxul only, nothing on chain) | Draft, Unsigned | — | — |
| offered (`AgreementOffered`) | Submitted, Unsigned | Employee exists (provisional party). No SSA yet | nothing. The budget reservation is not a GL fact |
| withdrawn or lapsed (`OfferWithdrawn` / expiry) | Cancelled | — | — |
| active (`AgreementAccepted`) | `is_signed` set, so Active between its dates | SSA submitted with `from_date = startsAt` (option A only) | accruals begin |
| paused / resumed | no state. A comment [A] | no HRMS equivalent. Leave Without Pay is the nearest [K] | the accrual stops |
| rate changed (effective at) | amended terms? See Q4 | a new SSA from `effectiveAt`. **A mid-period change is not prorated** (`H:salary_slip.py:878`) | the accrual changes from that second |
| ending → ended (`AgreementEnded`, close) | `end_date` set, then Inactive | Employee `relieving_date`, status Left [A] | the final accrual. Earned stays payable |
| collected ×N (`Collected`) | (fulfilment N/A) | — | Dr Agreement Payable, Cr Safe, per `paymentId` |

## 4. The mismatches, as decision packs

Grades run H (good), M or L. The columns are: Fid = fidelity to the chain; Frp = use of Frappe's real functionality;
Rec = reconciliation simplicity; Par = parallel-buildable without changing the Capxul app on the shared bench (the app
is copied into the image, `packages/bench-image/README.md`); Agt = agent ergonomics (one operation, one record, obvious
state).

### P1. A payment agreement versus invoices
The agreement accrues by the second and releases by step. The payee collects any amount, whenever they like. An invoice
is a fixed amount that one or more payments settle.

| Option | Fid | Frp | Rec | Par | Agt |
|---|---|---|---|---|---|
| **A. Invoice per period.** A Purchase Invoice (Supplier payee), made by an ERPNext Subscription (`E:subscription.py:328`) or by Core each period; collections are Payment Entries allocated first in, first out | L: periods and steps differ, a collection can span invoices, and pause and mid-period rate changes need credit notes | H: AP ageing and Subscription | M: allocation is many to many | M: Core can create PIs through the door, but allocation needs a hook | M |
| **B. Accrual, not invoices.** No invoice. Core posts a period-end accrual Journal Entry (Dr expense, Cr Agreement Payable, party Employee or Supplier) computed with the Calendar maths, and each `Collected` posts a Payment Entry against that party's payable | H | M: GL and party ledger, AP/AR reports by party | H: one `paymentId` per collection; the payable balance equals the chain's `earnedOf` at the period end | M: needs a new chain-event kind in `F:api.py:13-20` | H |
| **C. Cash basis.** Each `Collected` is posted straight to expense (Dr expense, Cr Safe); there is no accrual | M: the books miss earned-but-uncollected pay | L | H | M: the same event kind | H |

**Recommendation: B.** The chain holds the true liability. The books should show it. An invoice would invent a schedule
the chain does not have. Keep option A only for an Organization payee that wants an invoice as its record (s8.20 in the
old saga); there, the payee issues the Sales Invoice and the employer receives it as a Purchase Invoice for reference.

### P2. Agreement collections versus Salary Slip and Payroll Entry

| Option | Fid | Frp | Rec | Par | Agt |
|---|---|---|---|---|---|
| **A. A slip as the statement.** A monthly Payroll Entry computes a zero-deduction slip from an SSA (`base` = monthly rate); the accrual JE posts; collections clear Payroll Payable; the run's bank entry is never made | L: weekly rates, steps, pause and mid-month rate changes do not prorate as the chain does; a slip with deductions would contradict gross pay on chain | H: payslips, the HR payroll register, emails | M: the slip net must equal the chain's earned for the month, so a check is needed | M | M |
| **B. Two pay paths.** (i) Pay Frappe HR computes (tax, statutory deductions, leave): a Payroll Entry, whose submitted slips are paid by one budget spend per slip (kind 2, Frappe → chain), clearing Payroll Payable. (ii) Agreements (salaries paid gross, streams, retainers, contractors): P1-B, never slips. **An employee is on one path or the other** | H | H for runs, M for agreements | H: path (i) is the thin line; path (ii) is P1-B | M: (i) needs a hold on the Payroll Entry like `F:core_api.py:146`; (ii) needs an event kind | H |
| **C. A born-paid slip per collection.** The old `payroll.collection-slips`, archived on main | M | M | L: a slip per collection floods payroll and duplicates the accrual | L | L |

**Recommendation: B.** This is main's 11 November current scope (`payroll.agreements-in-frappe-shape`,
`payroll.accrual`). Old payslips (`infra:docs/adr/0022…:100-112`, ADR-0037 amendment) do not carry over:
- on path (i), the payslip is Frappe's Salary Slip;
- on path (ii), the "period statement" is a report over the chain (earned, released, collected), not a document.

**Guard.** Refuse an SSA, or a Payroll Entry row, for an Employee who has an active agreement on the same component, so
that nobody is paid twice (main's archived `IMPORT_RUN` rule, `main:…/agreements/runs.ts`).

### P3. Budgets versus ERPNext Budget and Cost Center
The chain's budget is the cash paid out in a calendar period, plus standing commitments, in a tree whose children fit
inside their parent. It refills each period.

ERPNext's Budget checks GL expense debits by account and cost center, per fiscal year, with distribution, and its action
is Stop, Warn or Ignore. Collections paid by `payReserved` do not count as chain spend (`Budgets.sol:325`), but they do
count as ERPNext expense.

| Option | Fid | Frp | Rec | Par | Agt |
|---|---|---|---|---|---|
| **A. Mirror, do not gate.** Each budget node becomes a Cost Center (same tree, `budgetId` on it). Optionally an ERPNext Budget with action **Warn**, monthly distribution and amount = the chain's per-period amount × 12, for the Budget Variance report only. The chain's `leftOf` is the gate, shown by a Capxul read operation | H | M | H | H: Core creates Cost Centers through the generic door | H |
| **B. Double gate.** ERPNext Budget **Stop** as a pre-check before the chain | L: two gates on different bases disagree (accrual against cash; fiscal against calendar) | H | L | H | L: refusals come from two places |
| **C. Cost Centers only.** No ERPNext Budget; the budget-against-actual view is a Capxul report from chain events | H | L | H | M: needs a Capxul report | M |

**Recommendation: A.** Basis and period differ, so the two figures will diverge, and the label must say which one is
the money gate.

### P4. Escrow (paying someone with no account) versus Payment Entry
The money leaves the Safe at funding but still belongs to the company until it is claimed or refunded.

| Option | Fid | Frp | Rec | Par | Agt |
|---|---|---|---|---|---|
| **A. One Payment Entry, posted at the claim.** Keep the PE held until `EscrowPaid` | L: the books show the money in the Safe while the chain shows it gone | M | L: the Safe balance differs for days | H | M |
| **B. Two entries through a clearing account.** At funding, an Internal Transfer PE from the Safe to "Money in escrow" (an asset account); at the claim, a Pay PE from "Money in escrow" to the party; at refund, an Internal Transfer back. Each is keyed by its `paymentId` (the escrow's id comes from `predictPaymentId`) | H | H | H: the Safe and escrow balances equal the chain's | M: the hold and post logic in `F:payments.py` must handle three event kinds | H |
| **C. Journal Entries only** | H | L | M | M | L |

**Recommendation: B.** It fits main's rule that "escrow-held money is not settled payroll and cannot close the payable
until claimed" (`payroll.accrual`). The party is a Supplier or Employee whose `capxul_wallet_address` is the predicted
payee Safe. The escrow contract is still to change (`aaron.escrow-general`), so pin the events before building this.

### P5. Departments versus HR Department

| Option | Fid | Frp | Rec | Par | Agt |
|---|---|---|---|---|---|
| **A. One department, three faces.** A department is a budget + hat (chain) = HR Department = Cost Center (the Department's `payroll_cost_center`, `H:setup.py:115`). The name, parent and members' Employee rows live in Frappe; `budgetId` and `hatId` live on the Department. Hat grants keep giving roles and a User Permission on the Department (`F:hats.py:62-132`) | H | H: HR Department drives approvers, leave and payroll cost | H | M: custom fields | H |
| **B. HR Department independent.** HR Departments are HR's own; budgets are mapped only to Cost Centers | M | H | M: a person's department and their spending authority can disagree | H | L |
| **C. A Capxul Department doctype** | H | L | H | L | M |

**Recommendation: A.** A child department is created by an operation that drafts the Department, and then the chain
creates the child budget and hat. The chain event fills in `budgetId` and `hatId`.

**Membership.**
- **Spending** follows the hat.
- **The HR department** follows the Employee row.

These two are different facts; see Q6.

### P6. Requests and the inbox versus Payment Request and Sales Invoice
The old stack had an issuer's request or invoice, frozen at issue, and a payer's inbox to approve or decline
(`infra:packages/backend/src/requests/README.md`). Each Capxul company has its own site.

| Option | Fid | Frp | Rec | Par | Agt |
|---|---|---|---|---|---|
| **A. Native on both sites.** The issuer's site has a Sales Invoice and an ERPNext Payment Request (Inward: payment URL and email, `E:payment_request.py:333-344`). The payer's inbox is a Core read of requests addressed to the payer's company. "Pay" drafts a Purchase Invoice and a held PE on the payer's site. The chain payment carries **the Sales Invoice's hash**, and both sites post on the same `PaymentSent` | H | H | H: one `paymentId` and one hash across two books | M: the canonical hash must be able to name an external document | H |
| **B. Core-only requests.** The old shape; the Sales Invoice is optional | M | L | M | H | M |
| **C. ERPNext inter-company invoicing** | — | — | — | — | — |

Option C works only between companies on one site [K]. Ours are on separate sites, so it is not applicable.

**Recommendation: A.** The hash the payment carries must be the issuer's. Today a PE's canonical hash is its own
(`F:canon.py`).

**Name clash.** "Capxul Payment Request" (`F:payments.py:89`) collides with ERPNext's Payment Request. Rename it
"Capxul Payment Hold", or replace it with an **Outward** ERPNext Payment Request whose status Initiated → Payment
Ordered → Paid is our held → signed → sent (see Q8).

### P7 (an additional one). Scheduled payments versus a Purchase Invoice's due date
`Budgets.schedule` reserves the money and freezes the recipient, amount and hash at once. ERPNext's due date and
`release_date` are only hints.

**Map** a schedule to a held PE with the posting date set to `payAt`. At schedule time the PE's `capxul_status` is
"Scheduled". `ScheduledPaid` posts it, and `ScheduleCancelled` returns it to draft. The key is `scheduledId` +
`paymentId`. Frappe drives the schedule; the chain drives payment. No ERPNext feature is lost.

## 5. Parameterisation: where an agreement's terms live

**Recommendation.** A thin Capxul doctype, **Capxul Agreement**, holds the chain's terms and links the native records.
The alternative was Salary Structure plus Assignment as the terms, but an SSA has one `from_date` and one `base`, no
step, no expiry, no pause and no end. It cannot hold the terms, and an SSA alone would make HRMS compute pay that the
chain already computes.

| Parameter | Chain field | Frappe home | Owner | Written by |
|---|---|---|---|---|
| Payee | `payee` | Employee or Supplier (`capxul_wallet_address`); the Agreement's `party_type` and `party` | Ch (address), Fr (party) | operation → Frappe draft; `AgreementOffered` confirms |
| Rate and period | `rate`, `period` (week, month or year), raw units | Agreement `rate`, `period` (read-only) | Ch | chain events only (`RateChanged`) |
| Start, end, offer expiry | `startsAt`, `endsAt`, `offerExpiresAt` | Agreement, and Contract `start_date` and `end_date` | Ch | chain events |
| Release step | `step` (seconds or MONTHLY) | Agreement `release_step` | Ch | chain event |
| Budget (department) | `budgetId` | Agreement → Department → Cost Center | Ch / Fr | operation |
| Token | `token` (the budget's) | the Safe account's currency | Ch | — |
| Terms document | `documentHash` | **Contract** (`contract_terms`). Hash = keccak of the stored Contract (`F:canon.py` `stored_hash`) | Fr (text), Ch (hash) | operation drafts the Contract; its hash goes into `offer` |
| Accepted, paused, closed and the nine statuses | `accepted`, `paused`, `closed` | Agreement `status`; Contract `is_signed` | Ch | chain events |
| Accounting | — | the payable account (Agreement Payable, per party type), the expense account (an Agreement Pay component or account), the cost center | Fr | company setup |
| Payment kind | 4 (collection), set by Budgets | an Agreement link on each collection's PE | Ch | — |
| Statutory deductions, tax, leave | none | Salary Structure, Income Tax Slab, Leave (path B-i only) | Fr | HR |

**Other parameters.**
- **Payment kind selects the record that posts.** 1 = Purchase Invoice PE, 2 = Payroll Entry slip, 3 = Expense Claim or
  Employee Advance, 4 = Capxul Agreement collection.
- **Escrow condition.** Condition 1, the claim, is the only one Capxul uses for people with no account.
- **Set once per company.** The clearing accounts "Money in escrow" and "Agreement Payable" are set in Capxul Settings.

## 6. Questions only Aaron can answer

1. **Gross or net.** May an employee with statutory deductions be paid by an Agreement, which pays gross on chain? If
   so, who pays the withholding, and from which budget? Or are such employees always on the Frappe HR payroll path (P2-B)?
2. **Agreement accrual in the books.** Should the books accrue agreement pay each period, as recommended (P1-B)? Or is
   cash basis enough (P1-C)?
3. **A Capxul Agreement doctype.** May the shared bench's Capxul app gain a Capxul Agreement doctype and two chain-event
   kinds? Every agreement slice depends on that app change.
4. **Rate changes and the terms hash.** A rate change keeps the same `documentHash` on chain (`changeRate` takes no new
   hash). Should a raise also amend the Contract? If it does, the hash and the text diverge.
5. **Direction.** Collections, acceptance and lapse start on chain, outside any operation of the employer's. Is that an
   accepted exception to "operations drive Frappe, which drives the chain" (`docs/roadmap.md:34`)?
6. **Two memberships.** A person's spending authority (their hat) and their HR Department (their Employee row) may
   differ. May they? For example, an Engineering employee who also holds the Operations budget's hat.
7. **ERPNext Budget.** Mirror budgets as ERPNext Budgets with action Warn for the variance report (P3-A)? Or not at all?
8. **The held state.** Replace "Capxul Payment Request" with ERPNext's Outward Payment Request as the record of a held,
   signed and sent payment?
9. **The escrow contract change** (`aaron.escrow-general`). Is it in scope before payroll to new hires? P4 depends on
   its events.
10. **Organization payees.** When the payee is an Organization (old s8), should its own site record the incoming
    collections as receipts against a Sales Invoice, or against a Customer advance?

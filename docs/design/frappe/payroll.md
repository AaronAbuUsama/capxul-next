# Payroll: Frappe HR's payroll, synced, with payslips from on-chain pay

Lane: **payroll**. Owns `books/target/payroll` and the payslip documents in `books/target/documents`.
Written 8 November 2026, main-line design, book first. The records are the design; this page explains
them and lists what other lanes must change.

The rulings this lane carries out:

- `aaron.erp-on-capxul`: Frappe is Capxul's UI, the head. An Organization's data lives in Frappe's
  shapes from its first day, whether or not a head is connected. Fork as little as possible, ideally
  nothing.
- `aaron.frappe-shape`: accounting and payroll sync with Frappe at the bare minimum. It supersedes
  `payroll.scope`, which is rewritten to it.
- `aaron.frappe-head`: the head is optional. Once it is connected, payroll syncs, and Capxul stays
  the system of record for money and identity.
- `aaron.books-first-principles`: money facts proven on chain post the ledger's entries. Books posts
  them, not payroll.
- `aaron.budget-pay-unclaimed` (fifth batch): a budget may pay someone with no account through a
  claim escrow, "payroll to new hires needs it". This settles C10.
- `aaron.fde-agent` and `aaron.seats`: the Organization's own agent is its Forward Deployed
  Engineer. It may run and pay payroll with its key.
- `system.frozen-behaviour`: the eleven frozen agreement operations keep their behaviour. None of
  their acceptance lines changes. `document render` #1 ("A payslip names its employer and
  employee") is kept word for word again, because payslips are stored again.

The starting point was [`docs/vision/erp.md`](../../vision/erp.md), section 4 and core checks C8 to
C11, C16, C17, C26 and C27, now read as main-line design.

## In one paragraph

Payroll keeps Frappe HR's six payroll doctypes as its own tables, with Frappe's field names:

- **Employee** in `employees`;
- **Salary Component** in `salary-components`;
- **Salary Structure** in `salary-structures`;
- **Salary Structure Assignment** in `salary-structure-assignments`;
- **Payroll Entry** in `payroll-entries`;
- **Salary Slip** in `salary-slips`.

So an Organization with no head has complete payroll. Capxul works every slip out (gross, deductions,
net) with the part of Frappe's formula language that it evaluates exactly as a head does.

Capxul pays a run's nets on chain:

- **One run is one payment command.** It goes through payments' door, with one approval for every
  slip (C9). A lapsed approval resumes the same command; it never makes a second one.
- **A new hire with no account is paid into a claim escrow** from the budget (C10).
- **The settled facts come back to the slip.** These are the payment id, the transaction, the block
  number and the block's time. The slip is then paid, and books posts the Bank Entry that Frappe HR
  would have made.

Pay that starts on chain is reflected in the same shapes:

- An accepted v4 agreement to a person is an Employee and an assignment of the Organization's
  agreement structure.
- Each landed collection is a slip that is born paid.

A head connected later is synced by payroll's own process, as contacts and projects sync theirs:
Capxul pushes its changes in order and pulls the head's when the head rings. On the head the Capxul
app adds Custom Fields, three Property Setters, settings and a Client Script, and forks nothing.

## What was read

- **Frappe HR**, `frappe/hrms` at `8816102`, cloned to `/tmp/hrms`. The DocType JSON of
  `salary_component`, `salary_structure`, `salary_detail`, `salary_structure_assignment`,
  `payroll_entry`, `payroll_employee_detail`, `salary_slip`, `additional_salary`,
  `salary_withholding`, `salary_component_account` and `payroll_settings`. The Python of
  `payroll_entry.py`:
  - `before_submit` :113 and `validate_existing_salary_slips` :123, which refuse slips that already
    exist for the run's dates;
  - `on_submit` :119 and `create_salary_slips` :309, which make the head's own draft slips;
  - `cancel_linked_journal_entries` :209, which cancels every Journal Entry referencing the run;
  - `make_accrual_jv_entry` :619, called from `submit_salary_slips_for_employees` :1837;
  - `has_bank_entries` :1069;
  - `make_bank_entry` :1093;
  - `get_salary_slip_details` :1138.

  The Python of `salary_slip.py`:
  - `validate` :218, which works earnings out again from the structure on every save;
  - `on_submit` :276, which refuses a net below zero;
  - `get_status` :355, whose statuses are Draft, Submitted, Cancelled and Withheld, with no paid;
  - `check_salary_withholding` :257, by which Withheld is a Salary Withholding over the period;
  - `check_existing` :383, which compares the same dates only;
  - `calculate_net_pay` :985, `add_structure_component` :1359 and `get_amount_based_on_payment_days`
    :2250, the order of proration;
  - `eval_condition_and_formula` :1471, which is `_safe_eval` with `COMPONENT_EVAL_GLOBALS` from
    `payroll/utils.py:57`, over Python floats.

  And `additional_salary.py:331` `get_additional_salaries`, which adds every submitted Additional
  Salary in a slip's period to it, used or not.
- **ERPNext**, `frappe/erpnext` at `6b946b0`: the Employee doctype, whose `gender` and
  `date_of_birth` are mandatory and whose `salary_mode` is Bank, Cash or Cheque;
  `employee.py:406`, whose duplicate check counts only Active Employees; and Journal Entry's
  `validate_cheque_info`. A Bank Entry needs
  `cheque_no` and `cheque_date`. `reference_type` may be Payroll Entry.
- **Frappe**, `frappe/frappe` at `1a7ea57`: `frappe/utils/data.py:1255` `rounded`. Its methods are
  Banker's Rounding (legacy, the default, `:1276`, which rounds half up above zero places), Banker's
  Rounding (`:1329`, half to even within an epsilon), and Commercial Rounding.
- **The book**:
  - payroll's records;
  - payments' `payments.prepare-command` (with `resume`), the Payment machine (lapse, retry, cancel,
    unsettle), `payment_transitioned` and the `payments` table;
  - documents' store;
  - organizations' `people_hat`, `organizations.head-ownership`, `organizations.head-doorbell` and
    the `frappe-head` integration;
  - contacts' and projects' head syncs;
  - books' `books.record-payroll-accrual` and `books.sync`.

## Mapping, field for field

Capxul's columns use Frappe's fieldnames, which are already snake_case. The SDK speaks the camelCase
of the same names (`dateOfJoining` is `date_of_joining`). Each Capxul id is the sync key: `emp_`,
`sc_`, `sst_`, `ssa_`, `pe_` or `slip_` and a ULID. A head keeps it in a Custom Field `capxul_id`,
and Capxul keeps the head's `name` in `head_name`.

| Frappe doctype | Capxul table | Frappe fields kept | Capxul's own (a Custom Field on a head) |
|---|---|---|---|
| Employee | `employees` | `employee_name`, `first_name`, `last_name`, `status` (Active, Inactive, Suspended, Left), `date_of_joining`, `relieving_date`, `department`, `designation`, `employment_type`, `salary_currency`, `salary_mode`, `personal_email`, `gender`, `date_of_birth` | `party_id`, the person's Party in the global directory; `payee_safe`, where pay lands; `salary_mode` `Capxul` |
| Salary Component | `salary-components` | `salary_component`, `salary_component_abbr`, `type`, `description`, `amount`, `amount_based_on_formula`, `formula`, `condition`, `depends_on_payment_days`, `statistical_component`, `do_not_include_in_total`, `is_tax_applicable`, `remove_if_zero_valued`, `disabled`, and `accounts` (Salary Component Account: `account`, `liability_account`) | `payee_party_id`, who a deduction is owed to; `portable`; `origin`; `version` |
| Salary Structure, with Salary Detail rows | `salary-structures` | `is_active`, `payroll_frequency`, `currency`, `earnings`, `deductions`, `employer_contributions` (each row's `salary_component`, `abbr`, `amount`, `formula`, `condition`, flags), `amended_from`, `docstatus` | the token's address and decimals; `origin` |
| Salary Structure Assignment | `salary-structure-assignments` | `employee`, `salary_structure`, `from_date`, `base`, `variable`, `currency`, `payroll_payable_account`, `docstatus` | `budget_ref` and `budget_id`, the budget that pays; `agreement_id` |
| Payroll Entry, with Payroll Employee Detail rows | `payroll-entries` | `posting_date`, `payroll_frequency`, `start_date`, `end_date`, `department`, `currency`, `payroll_payable_account`, `payment_account`, `employees` (`employee`, `employee_name`, `is_salary_withheld`), `number_of_employees`, `status` | `computed_by`, `company_safe`, `request_key`, `command_id`, `approval_id`, `attempt`, `version`; on a head `capxul_status` |
| Salary Slip, with Salary Detail rows | `salary-slips` | `employee`, `employee_name`, `payroll_entry`, `salary_structure`, `posting_date`, `start_date`, `end_date`, `payroll_frequency`, `total_working_days`, `payment_days`, `leave_without_pay`, `earnings`, `deductions`, `employer_contributions`, `gross_pay`, `total_deduction`, `net_pay`, `currency`, `status` | `source`, `computed_by`, `agreement_id`, `write_id`, `net_pay_raw`, `document_id`, `document_hash`, `payment_id`, `command_id`, `attempt`, `chain_payment_id`, `tx_hash`, `block_number`, `paid_at`, `version`, and on a head `capxul_status` |

Notes on the mapping:

- **Frappe's Department is Capxul's department budget.** Departments are budgets
  (`concepts.budgets`), so `employees.department` and `payroll-entries.department` hold budgets'
  `budget_ref`. Who may pay a run is who Budgets authorises on that budget.
- **The currency is a stablecoin.** Frappe's `currency` is the token's symbol, and the token's address
  and decimals sit beside it.
- **Dates and amounts are Frappe's.** Date fields are `YYYY-MM-DD` days. Currency fields are exact
  decimal strings at the token's display precision, two places, each row rounded once as Frappe
  rounds it ("Banker's Rounding", which the Capxul app sets on a head). There is no rounded total.
  `net_pay_raw` is the net in the token's raw units: the amount the chain moves
  (`payroll.money-and-rounding`).
- **Frappe's mandatory `gender` and `date_of_birth`** are null unless a head holds them. Capxul never
  needs them to pay. On the head, the Capxul app makes them optional with two Property Setters.
- **`salary_mode` is `Capxul`.** Frappe's options are Bank, Cash and Cheque, and Frappe refuses any
  other value on save, so a third Property Setter adds `Capxul` to them.
- **Fields Frappe requires that Capxul does not keep** (`company` on every doctype; Payroll Entry's
  `cost_center`, `exchange_rate` and a Payable `payroll_payable_account`; Salary Slip's
  `exchange_rate`) are filled by the Capxul app from the head's Company defaults and books' chart
  (exchange rate 1, the main cost centre, books' `payroll_payable` account).
- **Child tables are embedded rows.** No reader queries a Salary Detail or a Payroll Employee Detail
  alone.
- **Submittable doctypes are written submitted.** These are structures, assignments, runs once
  submitted, and slips once submitted. They are never edited. A structure changes by a new one with
  `amended_from`, as in Frappe.
- **One live Employee per person.** A person who left and comes back is a new Employee, as Frappe
  does on a rehire (its duplicate check counts only Active ones) (`payroll.one-live-employee`).
- **Payroll Settings** (`payroll-settings`) are the same for every Organization: leave-based,
  holidays counted as working days, no rounded total, no Frappe email. The row is born with the
  Organization's first payroll write and also holds the change log's counter. Nothing is set up at
  the Organization's `begin` (`payroll.startup`).
- **Kept by a head only, not by Capxul:** Income Tax Slab, Payroll Period, the benefit doctypes,
  gratuity, arrears, leave, attendance and timesheets. A run that needs them is computed by the head
  (`payroll.frappe-doctypes`, `payroll.one-computer-per-run`).

Who may do what (`payroll.hr-authority`):

- **The People hat is Frappe's HR Manager.** A member whose Safe wears it changes and reads the
  records: Employees, components, structures, assignments and runs. Wearers are read from indexing's
  hat-wearers. A head user's edit is applied only when the user is such a member, matched by mailbox.
- **Paying a run is the budget's.** Whoever Budgets authorises on the run's department budget may
  pay it: its holder, an agent whose Seat holds the allowance, or the Organization's FDE agent.
- **An employee reads their own slips.** They see slips from every Organization that pays them, by
  the Safe each slip pays (`payroll.payee-reads`, `salary-slips.admits`).

## Working a slip out without a head

`payroll.runs.create` drafts a run for a department and period. It works every slip out as this
version of Frappe HR's `calculate_net_pay` does (`salary_slip.py:985`, `:1359`, `:1471`, `:2250`):

- `total_working_days` is the period's calendar days. Capxul's Payroll Settings count holidays as
  working days.
- `payment_days` is the days the Employee was employed, from `date_of_joining` to `relieving_date`,
  less their leave without pay.
- **Each row, in order** (earnings, then deductions, then employer contributions):
  - its condition first; a row whose condition is false is left out;
  - its full-period `default_amount`: its amount, or its formula over `base`, `variable`, the day
    counts and the earlier rows' full-period amounts;
  - its `amount`: for a row that depends on payment days, `default_amount × payment_days /
    total_working_days`; for any other row, its formula over the earlier rows' prorated amounts;
  - a zero row is left out when its component says `remove_if_zero_valued`; a statistical row only
    feeds later formulas.
- `gross_pay` is the earnings not left out of totals, `total_deduction` the deductions, and `net_pay`
  gross less deductions. Employer contributions are in neither.
- A net below zero is refused, as Frappe refuses one on submit.

**The portable subset** (`payroll.portable-formulas`):

- numbers;
- `+ - * /` and comparisons;
- `and`, `or`, `not`, and `x if c else y`;
- eight of Frappe's helpers: `round`, `rounded`, `floor`, `ceil`, `min`, `max`, `int` and `float`;
- the names a slip has: `base`, `variable`, `payment_days`, `total_working_days`,
  `leave_without_pay`, `gross_pay`, and the abbreviations of earlier rows.

Capxul evaluates the subset exactly as CPython does: IEEE 754 binary64, true division, Python's own
`round`, `int`, `floor` and `ceil`, and `rounded` with the head's Banker's Rounding. Each row's result
is rounded at once to two places with Frappe's `_bankers_rounding` (half to even within its epsilon),
and from there every amount is an exact decimal. Exact decimals before that point would not match a
head: `ceil(0.1 * 3 * 10)` is 4 on a head and 3 in exact decimals, and `round(2.675, 2)` is 2.67 on a
head and 2.68 in exact half to even. A formula outside the subset is kept, marked not portable, and
only a head may compute a run that uses it.

The guards:

- **Runs never pay agreements.** A run covers the department's active Employees with a submitted
  assignment on or before the period's end, in the department budget's token, at the run's
  frequency. Assignments that mirror an agreement are excluded, because an agreement pays itself on
  chain. A head's run is checked the same way when it is taken in: a slip with an agreement
  assignment or an agreement component row is refused. This is what keeps one person from being paid
  twice.
- **Slips never overlap.** An Employee with a live slip whose period overlaps is refused, a stricter
  check than Frappe's `check_existing` (which compares the same dates only). The check holds each
  Employee's row lock, so two runs can never both take one Employee's period.

`payroll.runs.submit` does the rest:

1. It works the slips out once more, so a change since the draft is in them.
2. It fixes the slips: they move to submitted.
3. It stores each slip's payslip through `documents.store`. This is the new kind `payslip`, subject
   `salary-slip` (`documents.payslip-kind`). Its earnings less deductions must equal the net exactly.
   Its hash is the one the slip's Payment carries on chain (C8).
4. Once payroll depends on books, it invokes `books.record-payroll-accrual` (action submit) for the
   run's accrual, in the same transaction (`payroll.accrual`).

## A head connected: one computer per run, synced by payroll itself

Frappe works a slip out again on every save (`validate`). So two sides that both compute would be two
sources of truth, or a fork. The rule is that **a run is worked out where it is made**, and that side
owns its submit, withholding and cancel until it is paid (`payroll.one-computer-per-run`, flagged for
Aaron).

**A run made in Capxul** comes from the FDE agent, the SDK or later the CLI. Capxul computes it and
pushes it to the head as a submitted Payroll Entry. Frappe's own path decides what happens there:

- Submitting a Payroll Entry refuses slips that already exist for its dates
  (`validate_existing_salary_slips`, `payroll_entry.py:123`) and then makes its own draft slips
  (`create_salary_slips`, `:309`). So Capxul never pushes its slips first: the head's draft slips are
  the head's recompute.
- The Capxul app tags each head slip with Capxul's `capxul_id`, compares it to the cent, and submits
  each one alone when they agree. A slip's own submit posts nothing (`salary_slip.py:276`).
- It never uses the Payroll Entry's Submit Salary Slip, which posts an accrual Journal Entry
  (`submit_salary_slips_for_employees`, `:1837`). The accrual is books' voucher, fed to the head, and
  the app sets each slip's `journal_entry` to it. Frappe then lists none of these slips as unposted,
  so neither its Submit Salary Slip nor its Make Bank Entry can post a second entry. A Client Script
  also hides both buttons on a Capxul run.
- If they differ (the head recorded leave Capxul never saw), the head's slip stays a draft with the
  difference, and the money already paid stands.

**A run made in Frappe HR** is computed by its full engine: tax slabs, leave, attendance and regional
deductions. Once the head submits it (and posts its own accrual), payroll's sync takes it in by
`payroll.import-run`:

- the head user who submitted it must wear the People hat;
- every slip must add up to the cent, overlap nothing, and carry no agreement pay;
- a slip the head's Salary Withholding holds comes in `withheld` (Frappe's Withheld is a Salary
  Withholding over the period, not a flag), so it is never paid with the run;
- `by_head_name` is unique, so a repeated pull never births a second run to pay;
- Capxul never works it out again and posts no accrual: the head's accrual reaches books through
  books' sync.

Capxul pays it like any other run. A head's run is cancelled on the head, and the sync cancels it
here while nothing of it is paid.

**The sync** (`payroll.head-sync`) follows the head connection's contract: Capxul always calls and the
head only rings (`organizations.head-doorbell`, integration `frappe-head`), and each concept syncs its
own records by the three classes of `organizations.head-ownership`. The head never calls payroll's
rpcs. Payroll's process `payroll.head.sync` is one instance per head connection, like
`contacts.head.sync` and `projects.head.sync`:

- **Push.** Every write to the six records appends a row to `payroll-changes`, numbered under the
  `payroll-settings` row's lock, so the log has no gap. The record keeps that number as its `version`.
  The process pages the log after `pushed_seq` and writes each record as it stands (`upsertDocs`, by
  `capxul_id`), leaving out draft runs.
- **Pull.** On a ring, and daily in case a ring was lost, it reads the head's changes after
  `pulled_change` (`listChanges`). It applies each one as the head user, through payroll's own
  checks. A change on an older version, a change to money or identity, a change by a user without
  the People hat, or one the checks refuse is pushed back, with Capxul's version over it.

| Records | Who may change them | On a conflict |
|---|---|---|
| Employees' shared fields (name, designation, employment type, status), Salary Components, Salary Structures, Assignments | either side, each change based on a version; a head-born Employee is hired from its `personal_email` through `parties.resolve-recipient` | the older base loses; Capxul's checks refuse what they would refuse here |
| An Employee's Party, Safe and `personal_email`, a budget | Capxul only | pushed back |
| A Payroll Entry and its Salary Slips | the side that computed them; a head's Salary Withholding withholds or releases | the computing side |
| An agreement's Employee, assignment and collection slips | Capxul only, read-only on the head | pushed back |
| Every payment fact (`capxul_status`, payment id, transaction, block time) | Capxul only | pushed back |

On the head, nothing is forked. The Capxul app adds:

- **Custom Fields:**
  - `capxul_id` on all six doctypes;
  - `capxul_party` on Employee (the one Party field across the apps, `organizations.frappe-app-fields`);
  - `capxul_payee_party` on Salary Component;
  - `capxul_budget_id` and `capxul_agreement_id` on Salary Structure Assignment;
  - `capxul_budget_id`, `capxul_command_id`, `capxul_status` and `capxul_computed_by` on Payroll
    Entry. Frappe validates `status` against Draft, Submitted, Cancelled, Queued and Failed, so
    Capxul's paying and paid go in `capxul_status`.
  - on Salary Slip: `capxul_status`, `capxul_payment_id`, `capxul_chain_payment_id`,
    `capxul_tx_hash`, `capxul_paid_at`, `capxul_document_hash` and `capxul_computed_by`.
- **Property Setters:** Employee's `gender` and `date_of_birth` become optional, and `Capxul` is added
  to Employee's `salary_mode` options.
- **Settings:**
  - System Settings `rounding_method` is "Banker's Rounding". Frappe's default, "Banker's Rounding
    (legacy)", rounds half up above zero places.
  - Payroll Settings `include_holidays_in_total_working_days` is on, and `disable_rounded_total` is
    on.
  - `email_salary_slip_to_employee` is off, because Capxul's notices send mail (the payslip email is
    `notices.payroll.payslip`, `notices.payslip`).
  - `process_payroll_accounting_entry_based_on_employee` is on, so each net is credited to Payroll
    Payable with party the Employee and meets that Employee's Bank Entry
    (`payroll.employee-wise-accounting`, added at assembly).
- **A Client Script** hides Payroll Entry's Submit Salary Slip and Make Bank Entry on a Capxul run.
  The accrual and the Bank Entries come from books.

**A collection is never an Additional Salary on the head.** Frappe HR adds every submitted Additional
Salary whose payroll date falls in a slip's period to the next slip it computes for that Employee
(`get_additional_salaries`, `additional_salary.py:331`). It does not check whether the amount was
already used. A head's run would then carry the collection again, and Capxul would pay it twice. The
collection is pushed as its own submitted slip instead. Its one row is the agreement component, which
is created with `depends_on_payment_days` and `is_tax_applicable` off, so Frappe neither prorates nor
taxes it.

**The pay mailbox never comes from the head.** A changed work email must not move anyone's pay
(`payroll.mailbox-for-pay`, C27).

## A payslip from on-chain pay, both directions

### Payroll computes, Capxul pays, the facts come back

```mermaid
sequenceDiagram
  participant HR as Payroll (Capxul, or a head's run taken in)
  participant PAY as payments
  participant CH as Chain
  participant BK as books
  HR->>HR: runs.create works out gross, deductions, net; runs.submit fixes slips, stores each payslip
  HR->>BK: books.record-payroll-accrual (a Capxul run only; a head's run has the head's accrual)
  HR->>PAY: runs.pay: payments.prepare-command, one item per slip's net (its payslip hash)
  PAY->>PAY: one command, request key payroll:<entry>:<attempt>, one approval from the payer's own Safe
  Note over PAY: a person signs once, or an agent with the budget's allowance (the FDE agent) signs with its key
  PAY->>CH: Budgets.spend per item (a new hire's into a claim escrow from the budget)
  CH-->>PAY: PaymentSent(paymentId, ..., documentHash = the payslip's hash)
  PAY->>PAY: settle at finality, every term checked; the book fact in the same transaction
  PAY-->>HR: payment_transitioned (routed by command and payment id to the slip): escrowed, settled, needs_retry, cancelled (refunded), unsettle
  HR->>HR: the slip copies the settled facts: payment id, tx hash, block number, settled_at (the block's time)
  BK->>BK: from the settled fact: the Bank Entry per slip (Payroll Payable against the treasury, cheque_no the tx, dated at the block)
```

The slip's machine (`payroll.slip-machine`) keeps Frappe's Draft, Submitted, Withheld and Cancelled,
and adds Capxul's paying, escrowed and paid. A head reads those three as Submitted with
`capxul_status`. The moves:

| From | To | When |
|---|---|---|
| (none) | draft | `compute`: the run is created |
| (none) | submitted | `import`: a head's run is taken in |
| (none) | withheld | `import_withheld`: a head's slip its Salary Withholding holds |
| (none) | paid | `record_collection`: an agreement collection lands |
| draft | submitted | `submit` |
| submitted | withheld | `withhold`: Frappe's Salary Withholding; refused while the slip holds a lapsed Payment |
| withheld | submitted | `release` |
| draft, submitted or withheld | cancelled | `cancel`, with its run |
| submitted | paying | `pay`: a new command, or its own lapsed command resumed |
| paying | escrowed | `escrow`: a new hire with no account |
| paying or escrowed | paid | `settle` |
| paying | submitted | `lapse`: the approval lapsed unsent; the slip keeps its payment id and command |
| escrowed | submitted | `refund`: the budget's holder or the Board took it back; payments cancelled the Payment, so the slip forgets it and is owed again |
| paid | paying | `reverse`: a reorg's `unsettle`; it settles again as the next generation |

The run's machine (`payroll.run-machine`) is:

- `draft` to `submitted` to `paying` to `paid`;
- `cancelled`, only while no slip holds a Payment (paying, escrowed, paid, or lapsed and still
  retryable), and for a head's run only when the head cancelled it;
- `lapse` from paying back to submitted, only while nothing of the run is paid or escrowed (a later
  command's lapse returns only its own slips);
- `reopen` from paid back to paying, when a reorg takes a slip's payment back or a released slip is
  paid.

Frappe's Queued and Failed are its background jobs' states, which a run worked out in one transaction
never has. A head shows paying and paid in the Payroll Entry's `capxul_status`.

**C9: one approval for a run of payments** (`payroll.run-one-approval`). A run is one payment command
per attempt:

- one item per slip, each with its own payslip hash on chain;
- one approval from the payer's own Safe for all of them;
- nets only: a deduction's payee is paid outside the run (below).

`payments.prepare-command` already does this for requests and banking. The block was only
`payment send`'s single recipient, which payroll does not use. Asking twice answers the same command
(K1). How a later call pays:

- **A lapsed approval** is retried by `runs.pay` resuming the same command: the same key with
  `resume`, the same items and payment ids, and one new approval. A new key would birth new Payments
  while the lapsed ones stayed retryable by `payment retry`, which could pay one slip twice. While a
  slip holds a lapsed Payment it cannot be withheld, and its run cannot be cancelled.
- **A slip that holds no Payment** goes out under the next attempt's key, named in `runs.pay`. It may
  be released from withholding or refunded from escrow, and its run may be `paying` or `paid`.
- **Routing.** A run may then hold several commands, so each slip keeps its own command and payment
  id, and `payment_transitioned` reaches the slip by them (`salary-slips.by_command`).
- **Ending.** The run's process ends only when every slip of the run is paid (none withheld, released,
  escrowed or owed again) and its last settlement is confirmed (twice payments' finality depth). A
  later command always finds it.

A person signs a run once. An agent signs with its key and needs no person: one whose Seat holds the
budget's allowance, or the FDE agent. The chain still caps the run at what the budget has left
(`PAYROLL_BUDGET_EXCEEDED`).

**C10: paying a new hire with no account** (`payroll.new-hire-escrow`, under
`aaron.budget-pay-unclaimed`):

- An Employee is added by mailbox through `parties.resolve-recipient`, so a new hire is a
  provisional Party at the Safe their mailbox derives. Nothing waits on their account.
- Their net goes in the same command. Payments pays it into a claim escrow from the budget, and the
  money-waiting email tells them how to collect.
- The slip reads `escrowed` until they claim, and `paid` when the escrow's payout settles to them.
- A refund (the budget's holder or the Board) cancels the Payment (outcome refunded). The slip
  returns to `submitted`, still owed, and `runs.pay` naming it pays it under the next attempt.
- The run is paid only when the claim is. Books posts nothing while the money waits in the escrow.

**Deductions** (`payroll.deduction-remittance`). Frappe HR leaves each deduction a liability nobody
pays, and so does Capxul's run. A deduction or employer contribution may name the Party it is owed
to, such as a tax office or a pension fund (a Custom Field on a head). When a remittance falls due,
a holder of the department budget, or the FDE agent, pays that Party with an ordinary budget
payment against the component's liability account, which books posts on that liability. Remitting
inside the run's command was the first design. It was dropped because a run can hold several
commands, each of which would add the remittance again; because nothing recorded those Payments;
and because documents has no kind for a remittance schedule.

### Pay that starts on chain is reflected

```mermaid
sequenceDiagram
  participant CH as Chain (Agreements)
  participant AG as payroll: the agreement's process
  participant PAY as payments
  CH-->>AG: AgreementAccepted
  AG->>AG: hire the person payee as a new Employee unless they have a live one; assign the agreement structure from the start, base = the rate
  CH-->>AG: RateChanged (landed)
  AG->>AG: a new assignment from the effective day
  CH-->>AG: Collected + PaymentSent (kind 4, documentHash = the terms hash)
  CH-->>PAY: the same PaymentSent: a Payment born from a chain fact, settled with its book fact
  AG->>AG: record one paid slip: the window as its period, the collected amount as its one earning, no deductions, payment id, tx, block time
  AG->>AG: at the agreement's end: the Employee leaves when nothing else pays them
```

The agreement's process (`payroll.agreements.lifecycle`) now also writes Frappe's records
(`payroll.agreements-in-frappe-shape`, `payroll.collection-slips`):

- **The agreement structure.** An Organization's first acceptance makes the agreement component
  (an earning, no amount, `depends_on_payment_days` and `is_tax_applicable` off,
  `remove_if_zero_valued` on) and the agreement structure. The structure has that one earning and no
  fixed pay, so a head never works pay out of its own for an agreement. The hire runs after the
  agreement's own status move commits, so it can never hold the frozen behaviour up.
- **Frequency.** The release maps to `payroll_frequency`: `1mo` to monthly, `7d` to weekly, `1d` to
  daily. A stream's every second maps to Frappe's empty option.
- **Employment type.** A salary is `full-time`; a stream, a retainer or a fixed term is `contract`.
  A People hat wearer may change it.
- **Collection slips.** Each landed collection to a person records one slip, born paid and keyed by
  its write (`by_write`).
  - **Its payment id** is the `payment_` id that payments' Payment carries, so a ledger posts it
    once.
  - **Its period** is the collection's window: the date of its start, and the date of the instant
    before its end.
  - **Its document** is the terms document. That hash is the one the chain carried, so no new
    payslip is stored for it.
- **An Organization payee** is a Supplier in ERPNext, which is accounting's to record, not HR's.

The `Payslip` preview that `agreement collect` already shows (`payroll/shapes.ts`) is this slip
before it lands.

The eleven frozen operations are unchanged in behaviour. Their rpcs, flows and acceptance lines are
untouched. `agreements` gains only `employee_id`.

## What books posts (for the accounting lane)

Payroll posts nothing into books itself (`payroll.accrual`). Every voucher has one author
(`books.sync`, invariant `books.one-author-per-voucher`):

- **The accrual of a run Capxul computed** is books', through its door
  `books.record-payroll-accrual`. `runs.submit` invokes it (action submit) and `runs.cancel` invokes
  it (action cancel), in their own transactions (payroll now depends on books):
  - debit each earning's `accounts.account`;
  - credit each deduction's `accounts.account`, which for a deduction is its liability
    (`payroll_entry.py:891`; `liability_account` is read only for employer contributions);
  - credit Payroll Payable (`payroll_payable_account`) for each net, with party the Employee;
  - for employer contributions, debit the expense and credit the `liability_account`.

  This mirrors `make_accrual_jv_entry`. A head receives the voucher from books' feed and posts none
  of its own, because its slips are submitted one by one.
- **The accrual of a run its head computed** is the head's own Journal Entry, made when the head
  submitted its slips. It reaches books through books' sync, and taking the run in invokes nothing.
- **A Bank Entry per slip, when its Payment settles.** `voucher_type` Bank Entry:
  - debit Payroll Payable, with party the Employee, `reference_type` Payroll Entry and
    `reference_name` the run;
  - credit the treasury account of the company Safe and token;
  - `cheque_no` the transaction, `cheque_date` and `posting_date` the block's date.

  This is `make_bank_entry`, one per slip instead of one per run. Books posts it from the settled
  Payment's money fact, which carries the slip as its source.
- **A new hire's escrow:** nothing while the money waits (books' rule for a claim escrow). The claim's
  payout settles the slip's Payment, and that settlement posts the slip's Bank Entry. A refund posts
  nothing, and the net stays owed on Payroll Payable.
- **A collection to a person:** debit the agreement component's expense, credit the treasury, with
  party the Employee. To an Organization payee: a Payment Entry (Pay) to its Supplier.
- **A deduction's remittance** is an ordinary budget payment against the component's liability
  account, posted as books posts any payment with an account.

## The staged half: why `payroll/staged.ts` is not registered

Paying a run needs three links from payroll to payments:

- invoking payments' door, `payments.prepare-command`;
- waiting on `payment_transitioned`, routed by command and payment id;
- reading `payments` for the settled facts.

Today payroll does not depend on payments, and those links would break the build's boundary rules.
So the paying half is written in `payroll/staged.ts` and typechecked, but not listed in
`payroll/index.ts` (`payroll.pays-through-payments`):

- the rpc `payroll.runs.pay`;
- the workflow `payroll.runs.lifecycle`;
- the flow `client.org.payroll.runs.pay`.

Its ten transitions show in the build as `undriven-transition` gaps:

- `payroll-entry.pay`, `.lapse`, `.settle` and `.reopen`;
- `salary-slip.pay`, `.escrow`, `.settle`, `.lapse`, `.refund` and `.reverse`.

A scratch build of the target with `payments` added to payroll's dependencies and `staged` registered
has 0 problems, and those ten gaps close. The edge points down the concept order (payroll sits above
payments). So it makes no cycle, and payments still never depends on payroll.

The accrual door is the same kind of link. `books.record-payroll-accrual` exists, but payroll does not
depend on books yet, so `runs.submit` and `runs.cancel` name the door in their `about` and invoke it
once the edge exists. Books sits below payments, so that edge points down too.

## The core checks on payroll

| # | Check | Verdict now | What payroll did |
|---|---|---|---|
| C8 | Each payment carries the business document | Fits | A typed `payslip` envelope, its hash on the slip's Payment (`documents.payslip-kind`) |
| C9 | A payroll run is one approval with a payslip per item | **Settled** | One command, one approval, an item per slip with its own payslip; a lapse resumes the same command (`payroll.run-one-approval`); waits on the payments edge (staged) |
| C10 | A budget can pay someone with no account yet | **Settled** by `aaron.budget-pay-unclaimed` | The slip is `escrowed` until the claim; a refund returns it to owed (`payroll.new-hire-escrow`); payments builds the budget claim escrow |
| C11 | Agents move money within on-chain limits | Fits | A run is signed by whoever Budgets authorises: an agent with the allowance, or the FDE agent |
| C16 | Capxul's agreements and Frappe HR's payroll both exist | Fits | Both in Frappe's shapes; Capxul's runs exclude agreement assignments, and a head's run carrying agreement pay is refused when taken in |
| C17 | A collection can become a paid pay record | Fits | A paid Salary Slip, keyed by its write and payment id (`payroll.collection-slips`) |
| C26 | A payment's kind tells the ledger what it is | Fits with a mapping | Kind stays one-off; the Payment's purpose `payroll` and its slip tell books (asked of payments) |
| C27 | An employee keeps their pay after they leave | Fits | Paid at `personal_email`, never `company_email`; a head never moves it (`payroll.mailbox-for-pay`) |

## Records changed

- `books/target/payroll/data.ts`:
  - **New tables:** `employees`, `salary-components`, `salary-structures`,
    `salary-structure-assignments`, `payroll-entries` and `salary-slips`, each with `version`; and
    `payroll-settings`, `payroll-changes` and `payroll-head-syncs` for the sync.
  - **New machines, each with its event:** `employee`, `salary-structure`,
    `salary-structure-assignment`, `payroll-entry` and `salary-slip`.
  - `agreements` gains `employee_id`.
- **New areas:**
  - `employees.ts`: `payroll.employees.add`, `.change` and `.list`;
  - `structures.ts`: `payroll.structures.component`, `.create`, `.assign`, `.cancel` and `.list`;
  - `runs.ts`: `payroll.runs.create`, `.submit`, `.withhold`, `.cancel`, `.show` and `.list`, and
    `IMPORT_RUN`, the rule a head's run is taken in by;
  - `slips.ts`: `payroll.slips.mine`.
- `shapes.ts`: their inputs and outputs.
- `flows.ts`: one SDK flow per new rpc, on the `sdk` and `react` surfaces (`payroll.hr-surface`).
- `processes.ts`: the agreement's process hires, assigns, records collection slips and lets go; and
  `payroll.head.sync`, payroll's sync with a connected head.
- `staged.ts`: the paying half, not registered.
- `index.ts`: lists the new areas.
- `decisions.ts`: `payroll.scope` rewritten to `aaron.frappe-shape`, and `payroll.payee-reads`
  extended to slips. New decisions:
  - `payroll.frappe-doctypes`, `payroll.agreements-in-frappe-shape` and `payroll.collection-slips`;
  - `payroll.portable-formulas` and `payroll.one-computer-per-run` (for Aaron);
  - `payroll.slip-machine` and `payroll.run-machine`;
  - `payroll.pays-through-payments`, `payroll.run-one-approval` and `payroll.new-hire-escrow`;
  - `payroll.deduction-remittance` and `payroll.accrual`;
  - `payroll.head-sync`, `payroll.import-run`, `payroll.mailbox-for-pay` and `payroll.hr-authority`;
  - `payroll.hr-surface`, `payroll.money-and-rounding`, `payroll.one-live-employee` and
    `payroll.startup`.
- **Documents, the payslip:**
  - `documents/data.ts`: kind `payslip` and subject `salary-slip`.
  - `documents/procedures.ts`: `PayslipContent` in `Content`.
  - `documents/decisions.ts`: `documents.kinds` now has five kinds; `documents.acceptance-rewrites`
    now keeps the line; `documents.worlds` adds a run's payslip; `documents.payslip-kind` is new.
  - `documents/operations.ts`: `document render` #1 is kept word for word.
  - `documents/reading.ts`: render names a payslip's employer and employee.

Checks: `npx tsc -p books` is clean, the book builds with 0 problems, and `tools/check-frozen.ts`
reports 0 breaches. There are 548 kept claims; `document render` #1 moved from rewritten to kept.

### Changed in review

An adversarial review against Frappe's sources and payments' machine changed these:

- **A lapse resumes the same command.** The first design retried under a new key, which left the
  lapsed Payments retryable beside new ones.
- **Several commands per run.** A released or refunded slip is paid under the next attempt, even on a
  run that is `paying` or `paid`. The first design left such a run stuck in `paying`. Each slip keeps
  its own command and payment id, by which payments' events reach it.
- **The sync is payroll's own process.** It pulls with Capxul's key, as the head connection requires.
  The rpc `payroll.runs.import` and its flow, which a head would have called, are gone.
- **A head's run is checked when taken in.** No agreement pay, Withheld kept withheld, and taken in
  once by its unique head name. A collection is never an Additional Salary, which Frappe would fold
  into the next slip.
- **A Capxul run on the head.** The head's own draft slips are compared and submitted one by one,
  never through Submit Salary Slip, so its accrual is not posted twice.
- **Remittances leave the run's command.**
- **Formulas follow Python's binary64.** Exact decimals start after each row's rounding.
- **Smaller fixes:**
  - `capxul_status` on Payroll Entry;
  - a third Property Setter for `salary_mode`;
  - one live Employee per person;
  - Payroll Settings;
  - the accrual's author follows the computer, through books' new door;
  - nothing posts while an escrow waits.

## For Aaron

- **`payroll.one-computer-per-run`.** With a head connected, may people still make and pay runs from
  Capxul (the FDE agent, the CLI)? Or should the head become the only place runs are made? The
  design lets either side make a run and has the other only check it.

## For other lanes

- **Shared records** (`shared/foundation.ts`, `shared/decisions.ts`, `shared/landings.ts`):
  - Add `concept_payments` and `concept_books` to `concept_payroll.dependsOn`. Both sit below
    payroll, so neither edge makes a cycle.
  - Rewrite `concept_payroll.about`: Frappe HR's payroll (Employees, structures, runs, slips) beside
    the v4 agreements, with runs paid through `payments.prepare-command` and synced with a head by
    payroll's own process.
  - Update `dependencies.of-payroll` to add payments and books.
  - Update `dependencies.payments-payroll`: payroll depends on payments for a run's payment and its
    settlement, and payments still never depends on payroll.
  - Mark `concepts.payroll` superseded by `payroll.scope`.
  - In `OLD_AREAS`, `payroll/runs` now lands in payroll by `payroll.scope` ("Frappe HR's Payroll
    Entry and Salary Slip"). Groups and terms stay dropped.
- **Payroll's own records, once the edges exist:**
  - Add `import * as staged from "./staged.ts"` and `staged` to `payroll/index.ts` modules, then
    rebuild. A scratch build already shows 0 problems.
  - Add `procedure_books_record_payroll_accrual` to the `invokes` of `payroll.runs.submit` and
    `payroll.runs.cancel`. Each then invokes two procedures from two concepts, within
    `sys:tx-width`.
- **Payments:**
  - **Purpose and source.** `payments.prepare-command` takes `purpose: "payroll"`. Each
    `PreparedItem` takes an optional `source`, so the Payment and its book fact name it:
    `{ kind: "salary-slip", id, payroll_entry_id, employee_id }`.
  - **The mailbox.** It takes an optional `payee_mailbox` for a payee with no account.
  - **Resume.** Payroll retries a lapsed run command only with `resume` under the same key. Keep
    `resume` able to reopen a command whose Payments all lapsed.
  - **The budget claim escrow.** Rewrite `payments.claim-escrow-routes` to
    `aaron.budget-pay-unclaimed`:
    - a budget-route item to a mailbox with no live Safe becomes a claim escrow funded by the budget;
    - its refund goes back to the budget, and the budget's holder or the Board may take it back;
    - `payment_transitioned` moves it to `escrowed`, to `settled` on the claim, and to `cancelled`
      (outcome refunded) on a refund.
  - **The settlement time.** State that `payments.settled_at` is the settling block's time, and
    keep `settled_block_number` and `settled_tx_hash` readable by the payer's tenant (C6). Payroll's
    run process copies them onto the slip.
- **Books** (the accounting lane):
  - `books.record-payroll-accrual` is the door payroll invokes, as above. Its lines come from the
    run's slips and components.
  - Post a Bank Entry per settled payroll Payment, from its fact's purpose and source.
  - Post nothing while a new hire's net waits in an escrow: its claim's settlement posts the Bank
    Entry. This is books' existing rule.
  - Post a collection's expense, with party the Employee, and a Supplier Payment Entry for an
    Organization payee.
  - Provide the default Payroll Payable, salary expense and treasury accounts that payroll's
    `accounts`, `payroll_payable_account` and `payment_account` name as books' account ids.

  The exact lines are in "What books posts".
- **The head connection and the Capxul app for Frappe** (component `frappe-app`):
  - **Fields.** Add the Custom Fields, three Property Setters, settings and Client Script listed in
    "A head connected".
  - **A Capxul Payroll Entry.** Submit it, then:
    - tag each draft slip Frappe makes with Capxul's `capxul_id`;
    - compare it to the cent;
    - submit it alone, setting its `journal_entry` to books' accrual voucher.

    Never call Submit Salary Slip. Leave a differing slip as a draft with the difference.
  - **Changes for payroll's pull.** List among `listChanges` the head's own Payroll Entries
    (submitted, cancelled), Salary Withholdings, Employees, components, structures and assignments,
    each with its head user.
  - **Collections.** Write a collection slip as a submitted Salary Slip with the agreement component's
    row, never as an Additional Salary.
  - **Fields Frappe requires.** Fill `company`, `cost_center`, `exchange_rate` and the Payable
    `payroll_payable_account` from the Company's defaults.
  - **Cancelling a Capxul run on the head.** Frappe's `on_cancel` cancels every Journal Entry whose
    lines reference the Payroll Entry (`cancel_linked_journal_entries`), books' accrual voucher
    included. So apply books' feed first, or treat the feed's later cancellation of that voucher as
    already applied. Never post a second reversal.
- **Notices:**
  - Optionally, a payslip email when a slip is paid. This is Frappe HR's
    `email_salary_slip_to_employee`, which the head turns off.
  - A new hire's money-waiting email already follows payments' escrow.
  - Both follow `salary_slip_transitioned` or `payment_transitioned` through the outbox.
- **Devnet:** `org-with-documents` (`documents.worlds`) now holds a submitted payroll run's payslip
  for an Employee. Its builder needs an Employee, a structure, an assignment and a submitted run.
- **Tooling:** in `tools/report-judgments.ts`, `FLAGGED` can drop `documents.acceptance-rewrites`.
  Its line is now kept word for word, and W1 is settled.
- **The CLI pass (done):** the commands pass booked the 28 operations of `payroll.hr-surface`, accepted, in the
  grammar of `docs/design/new-commands.md` (section 5.3), with acceptance claims and worlds:
  - `org employee add|change|get|list|suspend|deactivate|reinstate|leave`;
  - `org payroll component add|change|list|disable|enable`;
  - `org payroll structure create|cancel|assign|unassign|list`;
  - `org payroll run create|submit|pay|cancel|list|get`;
  - `org payslip withhold|release`;
  - `payslip list|get` (with `--employer` as a filter).

## Not decided here

- **Income tax slabs.** Annualised tax in Capxul without a head is not computed. A business that
  needs slab tax either expresses it in the portable subset or connects a head.
- **Leave and attendance.** Capxul's only input is `leaveWithoutPay` per run.
- **Which payroll Frappe scheduled jobs count as devnet clock stops.** That is the head lane's
  question (vision section 5).
- **Loan repayments.** A head with Frappe Lending subtracts `total_loan_repayment` from the net. Its
  slips do not add up as gross less deductions, so taking the run in refuses them, which is safe.
  Supporting them is for when a customer needs Lending.
- **Whether an Organization payee's collection is a Purchase Invoice or a Payment Entry alone.**
  That is books'.

## After the assembly

The assembly of the four Frappe lanes (`assembly-items.md`) changed these parts of this design. The
records win where this page differs.

- **The edges exist.** Payroll depends on payments and books (`dependencies.payments-payroll`,
  `dependencies.books-payroll`), and `payroll/staged.ts` is registered, so "the staged half" above
  is history.
- **The accrual door is invoked.** `runs.submit` and `runs.cancel` invoke
  `books.record-payroll-accrual`. A person's paid agreement collection also accrues through it
  (`payroll.collection-accrual`). The lines arrive in the run's token and books sets the GL lines
  in the Company's currency (`books.payroll-lines`).
- **Start-up.** `payroll.startup.open` writes Payroll Settings when the setup begins, and no salary
  components (`payroll.startup`).
- **No escrow clearing account.** Nothing posts while a new hire's net waits in a claim escrow
  (`books.escrow-held`).
- **One Party field.** The Custom Field is `capxul_party` on Employee and `capxul_payee_party` on
  Salary Component (`organizations.frappe-app-fields`).
- **Timesheets.** Paying hours through a slip is deferred (`payroll.timesheet-pay`).

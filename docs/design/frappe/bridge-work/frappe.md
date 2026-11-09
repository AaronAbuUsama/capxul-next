# How Frappe and ERPNext model money, from the code

Research for the payments bridge study (`aaron.frappe-native`, 9 November 2026). Question: how does
Frappe record a payment, what must it be told to record one correctly, and where in its code does
it decide that money moved? Everything below is read from the code. Each claim cites file and line.

## Sources

| Prefix | Repository | Commit | Notes |
|---|---|---|---|
| `erpnext:` | frappe/erpnext, `develop` | `6b946b0f` (8 Nov 2026) | `/tmp/erpnext` |
| `hrms:` | frappe/hrms, `develop` | `88161025` (6 Nov 2026) | `/tmp/hrms` |
| `frappe:` | frappe/frappe, `develop` | `1a7ea577` (8 Nov 2026) | `/tmp/frappe` is a sparse checkout; files outside it (`frappe/model/document.py`, `frappe/model/naming.py`, `frappe/integrations/*`, `frappe/client.py`) were read with `git show HEAD:<path>` |
| `payments:` | frappe/payments, `develop` | `b2ceb4a0` (5 Nov 2026) | `/tmp/payments` |

Paths are relative to each repository's root. "Submittable" means the doctype has `is_submittable`
and so the life cycle draft (0), submitted (1), cancelled (2).

## The findings that matter for the bridge

1. **Payment Entry is the payment document.** It has three types: `Receive`, `Pay` and
   `Internal Transfer` (`erpnext:erpnext/accounts/doctype/payment_entry/payment_entry.json:125`).
   It posts one bank line, one party line for each document it pays, one line for each deduction and
   one for each tax. On submit it refuses any `difference_amount` that is not zero
   (`payment_entry.py:268`).
2. **Frappe allocates a payment to a document, or to a payment term of a document. It never
   allocates to an invoice line.** A Payment Entry Reference row holds `reference_doctype`,
   `reference_name`, `payment_term`, `allocated_amount` and `payment_request`. It has no item row
   (`payment_entry_reference.json:33-178`). Line-level tax exists only on the invoice, as
   `Item Wise Tax Detail` rows (`item_row`, `tax_row`, `rate`, `amount`, `taxable_amount`;
   `item_wise_tax_detail.json:15-42`).
3. **Invoice line ids are not stable.** Invoice item rows are named by a random hash
   (`erpnext:erpnext/accounts/doctype/sales_invoice_item/sales_invoice_item.json:4`). An amendment
   copies the document and clears every child row's `name` (`frappe:frappe/model/document.py:4409-4434`).
   The parent is renamed `<name>-1`, then `-2` (`frappe:frappe/model/naming.py:578-595`). A hash
   that commits to Frappe row names stops matching after an amendment. A hash that commits to row
   position and content still matches.
4. **An invoice's outstanding amount is derived.** It comes from the Payment Ledger Entry rows,
   which are themselves derived from the GL (`erpnext/accounts/utils.py:2187-2208`, `:2211-2263`).
   Allocation can change after submit without a cancel: the reconciliation tools rewrite a
   submitted Payment Entry's references in place and rebuild its ledger rows
   (`utils.py:518-589`, `:746-823`).
5. **The payments app's gateway flow cannot carry chain facts.** When a gateway reports
   `Completed`, ERPNext books a Payment Entry as Administrator. That entry is dated today, uses the
   Payment Request's name as `reference_no` and pays the Payment Request's whole outstanding amount
   (`payment_request.py:599-689`, `reference_no` at `:654`). It does not take an amount, a date or a
   transaction id from the gateway.
6. **Frappe has no idempotency key for payments.** Payment Entry `reference_no` and Bank
   Transaction `transaction_id` are plain, non-unique Data fields (`payment_entry.json:431`,
   `bank_transaction.json:130-133`). The Plaid feed dedupes with an `exists` check before it inserts
   (`erpnext/erpnext_integrations/doctype/plaid_settings/plaid_settings.py:315-317`). Integration
   Request, the gateway log, is deleted after 90 days (`frappe:frappe/hooks.py:633`, `:645`).
7. **Payroll pays through a draft.** `make_bank_entry` saves one Bank Entry Journal Entry for the
   whole run and leaves it as a draft (`hrms:hrms/payroll/doctype/payroll_entry/payroll_entry.py:1093-1136`,
   `:1196-1287`, `submit_journal_entry=False` at `:825`). Cancelling a Payroll Entry cancels every
   submitted Journal Entry that references it, the bank entry included (`:168-232`).
8. **Several documents post to a bank account with no Payment Entry:** Purchase Invoice `is_paid`,
   Sales Invoice `is_pos`, Expense Claim `is_paid`, any Journal Entry with a bank line, and the
   phone-channel Payment Request, which is marked Paid with no entry at all (section 11).
9. **Bank Transaction and the Bank Reconciliation Tool reconcile ordinary bank accounts.** They match
   by reference number, amount and party, and auto-reconcile only when the reference number matches
   (`bank_reconciliation_tool.py:1559-1620`, `:1617`). The book leaves both out today
   (`capxul-next:docs/design/frappe/accounting.md:76`). Aaron's 9 November addition, that other
   accounts are allowed, brings them back for non-Safe accounts.
10. **Some cancellation and amendment rules matter here.** A submitted document can only be cancelled.
    A cancelled document can never be edited (`frappe:frappe/model/document.py:1740-1794`). An
    amendment is a new document. With the immutable ledger on, a cancellation's reversing GL and
    Payment Ledger rows are dated from the request's `posting_date`, or today if there is none
    (`erpnext/accounts/general_ledger.py:758-762`, `utils.py:2196-2201`).

## 1. The money doctypes

| Doctype | Submittable | What it is | Posts GL |
|---|---|---|---|
| Payment Entry | yes | a payment in, out, or between own accounts, allocated to documents | yes |
| Payment Entry Reference | child | one allocation to one document (or one payment term of it) | via parent |
| Payment Entry Deduction | child | a fee, write-off, discount loss, dunning charge or exchange difference | via parent |
| Payment Request | yes | a request to be paid (Inward) or an instruction to pay (Outward), optionally with a gateway URL | no |
| Payment Order | yes | a batch of payment instructions for one company bank account | no (makes draft Journal Entries) |
| Journal Entry (+ Journal Entry Account) | yes | any balanced voucher; `voucher_type` Bank Entry is a payment | yes |
| GL Entry | yes | one ledger line | — |
| Payment Ledger Entry | yes | receivable or payable lines only, derived from GL, against a voucher | — |
| Advance Payment Ledger Entry | yes | advances against orders and employee documents | — |
| Bank Account | no | a bank account of the company or of a party, linked to a GL account | no |
| Bank Transaction (+ Bank Transaction Payments) | yes | a bank statement line and the vouchers it clears | no |
| Mode of Payment (+ Mode of Payment Account) | no | a payment method and its default account per company | no |
| Payment Terms Template, Payment Term, Payment Schedule | no / child | when an invoice falls due, in parts, with early-payment discounts | no |
| Dunning (+ Overdue Payment) | yes | a reminder of overdue terms with interest and a fee | no |
| Integration Request (frappe) | no | a log of one gateway request or webhook | no |
| Payment Gateway (payments), Payment Gateway Account (erpnext) | no | a gateway and the GL account its money lands in | no |

Sources: the `.json` files in `erpnext:erpnext/accounts/doctype/<name>/` (`is_submittable` on each);
`frappe:frappe/integrations/doctype/integration_request/integration_request.py:22-34`;
`payments:payments/payments/doctype/payment_gateway/payment_gateway.json:15-29`.

## 2. Payment Entry

### 2.1 Types and which account is the party's

- `Receive`: `paid_from` is the party's account (Receivable) and `paid_to` is the bank or cash
  account. `Pay`: `paid_from` is the bank and `paid_to` is the party's account
  (`payment_entry.py:163-176`).
- `Internal Transfer`: both are the company's own accounts. Party, references and allocation are
  cleared (`:633-643`). The two accounts must differ (`:740-742`). Each side's Bank Account is filled
  from its GL account (`:417-422`).
- Party types: Customer (Receivable), Supplier, Employee and Shareholder (Payable)
  (`erpnext/setup/setup_wizard/operations/install_fixtures.py:302-305`). The party account's type
  must equal the Party Type's, except for Employee and for Shareholder on an Equity account
  (`payment_entry.py:744-764`).

### 2.2 Validation, in order

`validate` (`payment_entry.py:178-207`) runs:

1. `validate_enabled_mode_of_payment` refuses a disabled Mode of Payment
   (`mode_of_payment.py:86-88`).
2. `set_missing_values` (`:633-684`):
   - Party Type and Party are mandatory for Pay and Receive (`:644-648`);
   - the party account defaults to `get_party_account`;
   - account currencies and types are fetched.
3. `set_liability_account` (`:301-366`): when the Company books advances in a separate party
   account and the only references are orders, it swaps the party account for the Company's
   advance account.
4. `set_exchange_rate`. A side in the Company's currency has rate 1. Otherwise the rate comes from
   the referenced document, then from `get_exchange_rate` (`:766-792`).
5. `validate_mandatory`: `paid_amount`, `received_amount` and both exchange rates must be greater
   than zero (`:794-800`).
6. `validate_reference_documents` (`:802-867`). Each reference must:
   - be a valid doctype for the party type;
   - exist and belong to the same party;
   - be submitted;
   - for an invoice, carry this same party account (`debit_to`, `credit_to` or `payable_account`);
   - for a Purchase Invoice, not be on hold.
7. `set_amounts` (`:1174-1180`): company-currency amounts, total allocated, unallocated, exchange
   gain or loss, difference.
8. `validate_transaction_reference`: when the bank side is an account of type Bank,
   `reference_no` and `reference_date` are mandatory (`:1450-1456`; also `mandatory_depends_on` at
   `payment_entry.json:431-445`).
9. `validate_duplicate_entry`: the same (document, payment term, Payment Request) may not appear
   twice in one entry (`:404-415`). Nothing checks for the same payment across entries.
10. `validate_allocated_amount`. For Customer and Supplier it re-reads each document's latest
    outstanding and refuses when:
    - the document is already fully paid;
    - it was partly paid since the form loaded;
    - a term-based document has no term on the row;
    - the allocation is more than the outstanding (`:446-601`).
11. `ensure_supplier_is_not_blocked` (`erpnext/controllers/accounts_controller.py:164`), then tax
    withholding.

On submit (`:267-277`):

- `difference_amount` must be zero;
- withholding is booked;
- the Payment Requests named on references lose outstanding (`:394-399`);
- the payment schedules are updated (`:945`);
- the GL is made, which also makes the Payment Ledger rows;
- the outstanding amounts and dunnings are refreshed;
- subscription invoices are told.

### 2.3 What a Payment Entry may reference

ERPNext's own list (`payment_entry.py:869-875`):

- Customer: Sales Order, Sales Invoice, Journal Entry, Dunning, Payment Entry
- Supplier: Purchase Order, Purchase Invoice, Journal Entry, Payment Entry
- Shareholder and Employee: Journal Entry

Frappe HR replaces the class (`hrms:hrms/hooks.py:168`) and widens Employee to Expense Claim,
Journal Entry, Employee Advance, Leave Encashment and Gratuity
(`hrms:hrms/overrides/employee_payment_entry.py:22-30`). It also registers Expense Claim as an
invoice doctype (`hrms:hrms/hooks.py:291`) and Leave Encashment, Gratuity and Employee Advance as
payable advance doctypes (`:289`). Payroll Entry and Salary Slip are not on any list, so no Payment
Entry can pay a salary.

Correction for the book. `capxul-next:docs/design/frappe/accounting.md:186-190` lists Employee as
Expense Claim, Employee Advance and Journal Entry. It leaves out Leave Encashment and Gratuity, and
it leaves out Dunning and Payment Entry for Customer and Payment Entry for Supplier.

A row can name a `payment_term`. When the referenced document's Payment Terms Template has
`allocate_payment_based_on_payment_terms`, a row without a term is refused (`:536-545`), and
`get_payment_entry` splits the allocation by term (`:2966-2978`, `:3504-3547`).

### 2.4 Amounts

- `paid_amount` is in `paid_from`'s currency and `received_amount` in `paid_to`'s. With one
  currency, `received_amount = paid_amount` except for Internal Transfer (`:1190-1196`). The
  `base_` amounts are each one times its own exchange rate (`:1227-1238`).
- Each reference's company-currency amount uses the entry's own exchange rate. The difference from
  the document's rate is stored on the row as `exchange_gain_loss` (`:1240-1279`) and later booked
  as a separate Exchange Gain Or Loss Journal Entry (`erpnext/accounts/services/exchange_gain_loss.py:56-110`).
- `unallocated_amount` is what the party side has left after allocations and non-exchange
  deductions (`:1298-1316`). With a party it stays on the party account as an advance.
- **Exchange difference row** (`:1333-1393`). `base_paid_amount - base_received_amount` (less other
  deductions on an Internal Transfer) becomes an automatic deduction row. With one currency on both
  sides it goes to the Company's `bank_charges_account`. Otherwise it goes to
  `exchange_gain_loss_account` (`:1364-1367`).
- `difference_amount` is the party side less the bank side less taxes, then less all deductions
  (`:1395-1417`). It must be zero to submit.
- **Deductions are always debits**, in the Company's currency, each with a cost centre
  (`services/gl_composer.py:284-307`). A fee is positive. A gain, a dunning charge or a discount
  is negative.
- **Early-payment discount.** `get_payment_entry` lowers the amount when a term's discount date has
  not passed. It books the loss as a deduction on `default_discount_account`, or on
  `round_off_account` when tax loss is booked separately (`:3345-3413`).
- **Taxes on the payment.** The `taxes` table holds Advance Taxes and Charges, for tax due on
  advances. `apply_tds` withholds tax at payment time (`payment_entry.json:596-789`;
  `gl_composer.py:218-282`). The money that moves is then less than the amount allocated.

### 2.5 The GL lines a Payment Entry posts

`PaymentEntryGLComposer.compose` (`services/gl_composer.py:24-46`):

- **Party lines** (`:53-178`). One per reference, on the party account, with the party,
  `against_voucher` the referenced document and the reference's company-currency amount. Plus one
  line for the unallocated amount. An advance against an order (or with separate advance accounts)
  points `against_voucher` at the Payment Entry itself and records the order as
  `advance_voucher_no` (`:122-143`).
- **Bank lines** (`:180-216`). Pay and Internal Transfer credit `paid_from` with `paid_amount`.
  Receive and Internal Transfer debit `paid_to` with `received_amount`.
- **Deduction lines** (`:284-307`), **tax lines** (`:218-282`), regional lines and a round-off line.

### 2.6 Advances

- An unallocated party amount is an advance. Invoices pull open advances into their `advances` table
  (`erpnext/accounts/services/advances.py:27-59`), and reconciliation allocates them later
  (section 3).
- Orders (Sales and Purchase) and Frappe HR's employee documents are advance doctypes
  (`erpnext:erpnext/hooks.py:611-612`, `hrms:hrms/hooks.py:289`). Their paid amount and status come
  from the Advance Payment Ledger (`advances.py:148-228`), which is written beside the Payment
  Ledger whenever a GL line names an `advance_voucher_no` (`erpnext/accounts/utils.py:2133-2184`).
- A Company may keep advances on separate liability accounts
  (`book_advance_payments_in_separate_party_account`, `payment_entry.py:301-366`). Reconciliation
  then posts extra GL that moves the amount when it is allocated. The date of that GL follows the
  Company's `reconciliation_takes_effect_on` (`utils.py:828-846`).

## 3. The Payment Ledger and reconciliation

- **The Payment Ledger Entry** is written from the GL for Receivable and Payable lines only. It
  holds `voucher` (the payment), `against_voucher` (the document paid, or the voucher itself),
  `amount`, `amount_in_account_currency` and `delinked` (`payment_ledger_entry.json:33-161`;
  `utils.py:2060-2154`).
- **Outstanding** for Sales Invoice, Purchase Invoice and Fees is recomputed from these rows and
  written to the document (`utils.py:63`, `:2211-2263`). The payment schedule follows with
  `sync_payment_schedule_outstanding`, earliest term first (`:2266-2313`).
- **Payment Reconciliation** allocates open payments and credit notes to open invoices after the
  fact. `reconcile_against_document` (`utils.py:518-589`) appends a reference row to the
  **submitted** Payment Entry, or splits an existing one, with `ignore_validate_update_after_submit`.
  It saves the entry, deletes and rebuilds its Payment Ledger rows, books an exchange gain or loss
  Journal Entry and updates each invoice's outstanding (`update_reference_in_payment_entry`,
  `:746-823`). A Journal Entry is changed the same way (`:672`). The tool's own code is
  `erpnext/accounts/doctype/payment_reconciliation/payment_reconciliation.py:576-627`.
- **Unreconcile Payment** takes allocations off again. It unlinks the document and cancels the gain
  or loss journal (`unreconcile_payment.py:64-82`).
- **Automatic reconciliation** runs in the background when `auto_reconcile_payments` is set
  (`process_payment_reconciliation.py:150`, `:193-198`; Accounts Settings fields at
  `accounts_settings.json:418`, `:521-528`).

What this means for the bridge. An allocation-only change (which invoices a payment pays) can be
made in place, the way Frappe itself does it. A cancel and amend is needed only when the bank or
party side changes. Today's book cancels and amends for every recategorization
(`capxul-next:docs/design/frappe/accounting.md:234-248`).

## 4. Payment Request and the gateway flow

### 4.1 The document

- `payment_request_type`: Inward (be paid) or Outward (pay). Status: Draft, Requested, Initiated,
  Partially Paid, Payment Ordered, Paid, Failed or Cancelled (`payment_request.json:74`, `:312`).
- A request can be made only against Sales Order, Purchase Order, Sales Invoice, Purchase Invoice,
  POS Invoice or Fees (`payment_request.py:24-31`, enforced at `:855`). Expense Claim, Employee
  Advance and Payroll Entry cannot have one.
- `make_payment_request` (`:846-1071`):
  - the amount is the document's outstanding, less what open requests already ask for;
  - or it is the sum of the payment-schedule terms chosen, unless the document already has a
    Payment Entry (`:871-934`);
  - the request is Outward for purchase documents and Inward otherwise (`:979-982`);
  - it takes `payment_gateway_account`, `payment_account` and `payment_channel` from the Payment
    Gateway Account (`:994-997`).
- On submit, `outstanding_amount` is the requested amount in the party account's currency
  (`:338-339`, `:1371-1402`). An Inward request with a gateway gets a `payment_url` and an email
  (`:346-361`).
- A Payment Entry Reference row that names the request lowers its outstanding. Its status becomes
  Paid or Partially Paid (`update_payment_requests_as_per_pe_references`, `:1405-1455`;
  `get_payment_request_status`, `:1480-1484`). Cancelling the entry adds the outstanding back.

### 4.2 The gateway (payments app, v1 flow)

1. A gateway's Settings doctype registers itself on save:
   - `create_payment_gateway` makes a Payment Gateway row naming the Settings doctype and its
     controller (`payments:payments/utils/utils.py:48-59`);
   - it calls the `payment_gateway_enabled` hook (`payments:.../stripe_settings/stripe_settings.py:154-162`);
   - ERPNext answers with a GL account named after the gateway and a Payment Gateway Account for
     it (`erpnext:erpnext/hooks.py:607`; `erpnext/accounts/utils.py:1524-1560`).
2. `get_payment_url` asks the controller for a checkout URL, passing `reference_doctype`
   "Payment Request", `reference_docname`, amount, currency and payer (`payment_request.py:567-597`).
3. The checkout page posts to the controller (`payments:payments/templates/pages/stripe_checkout.py:73-91`).
   `create_request` logs an Integration Request (`stripe_settings.py:196-204`;
   `frappe:frappe/integrations/utils.py:164-209`) and charges the card.
4. On success the controller marks the Integration Request `Completed` and calls
   `frappe.get_doc(reference_doctype, reference_docname).run_method("on_payment_authorized", "Completed")`
   (`stripe_settings.py:229-231`, `:243-256`).
5. `on_payment_authorized` → `set_as_paid` → `create_payment_entry` runs as Administrator
   (`payment_request.py:37-49`, `:599-613`). It builds the entry with `get_payment_entry` for the
   request's outstanding amount and sets `reference_no` to the request's own name "to prevent
   validation error" and `reference_date` to today (`:615-689`, `:651-657`). `get_payment_entry` sets
   `posting_date` to today (`payment_entry.py:2925`). It also allocates the request to the
   references (`payment_request.py:789`), inserts and submits.
6. On the phone channel (M-Pesa style), `set_as_paid` only writes status Paid and outstanding zero.
   It makes no Payment Entry (`:603-605`).

### 4.3 Webhooks and v2

- The newest webhook in the app (Razorpay refunds, `payments:.../razorpay_settings/webhook.py:11-102`):
  - authenticates on an HMAC before it writes anything;
  - dedupes on the provider's event id, kept in `Integration Request.request_id`;
  - answers 200 to whatever should not be resent;
  - commits, then enqueues the handler;
  - its docstring says subscribers "must still make their own writes idempotent" (`:12-16`).
- ERPNext develop already looks for a v2 `payments.controllers.PaymentController` with a "Payment
  Session Log" (`payment_request.py:52-77`, `:366-395`). payments develop at `b2ceb4a0` ships no such
  module (no match for `PaymentController` or `is_v2_gateway`). So every gateway today takes the v1
  path above.
- Integration Request has status Queued, Authorized, Completed, Cancelled or Failed
  (`integration_request.py:33`). It is deleted after 90 days by default (`frappe:frappe/hooks.py:633`,
  `:645`).

What this means for the bridge:

- A "Capxul" gateway fits the slot. A Payment Gateway, a Payment Gateway Account on the Safe's
  account, a `payment_url` that opens Capxul's pay page, and a call to `on_payment_authorized` would
  all work.
- But the stock callback would book the wrong entry: dated today, for the request's whole
  outstanding amount, with `reference_no` the request name. The chain's amount, block time and
  transaction would all be lost.
- So the Capxul app should write the Payment Entry itself, from the chain fact, and name the
  request on the reference row. That moves the request to Paid through Frappe's own code (4.1).
  Neither Integration Request nor the request's status is a durable record of a chain payment.

## 5. Payment Order

- A batch for one company Bank Account. `payment_order_type` is Payment Request or Payment Entry
  (`payment_order.json:81-89`). Each row has the amount, the supplier, the supplier's Bank Account
  and a `payment_reference` (`payment_order_reference.json:23-100`).
- Every row must be submitted, belong to the same Company, not already be paid and not sit in
  another order (`payment_order.py:102-131`). On submit, Payment Requests become Payment Ordered,
  and Payment Entries get `payment_order_status` Payment Ordered (`:182-198`).
- `make_payment_records` makes **one draft** Bank Entry Journal Entry per supplier for the rows not
  yet paid. Each debits the supplier's payable against the documents and credits the order's
  account (`:278-316`). Submitting it pays the Payment Requests (`:361-370`).
- With type Payment Entry, the entries are booked before the bank is told (rule above). That
  contradicts "Frappe never marks money moved until the chain says so". The Payment Request type
  does not, because its Journal Entries stay drafts until someone submits them. Capxul's `sendBatch`
  and PayoutBatch play this role on chain.

## 6. Journal Entry

- **Voucher types** include Journal Entry, Bank Entry, Cash Entry, Credit Card Entry, Contra Entry,
  Write Off Entry, Opening Entry and Exchange Gain Or Loss (`journal_entry.json:105`).
- **A Bank Entry needs `cheque_no` and `cheque_date`** at submit (`journal_entry.py:548-557`).
- **Row references.** A row can name `reference_type`/`reference_name` from Sales Invoice, Purchase
  Invoice, Journal Entry, Sales Order, Purchase Order, Expense Claim, Asset, Loan, Payroll Entry,
  Employee Advance, Exchange Rate Revaluation, Invoice Discounting, Fees, Full and Final Statement,
  Payment Entry or Bank Transaction (`journal_entry_account.json:189-197`). This is how a salary is
  paid.
- **Party.** A Receivable or Payable row needs a party unless the entry sets `party_not_required`,
  which payroll does (`journal_entry.py:502-528`).
- **Large entries.** An entry with more than 100 rows is submitted and cancelled in the background
  (`journal_entry.py:216-234`). A payroll entry for a large team is one of these.
- **Cancellation** reverses the GL. It also unlinks advances, Payment Order rows and invoice
  discounting (`:338-373`). Frappe HR's hooks then refresh Expense Claims, Full and Final
  Statements and salary withholdings, and unlink Salary Slips (`hrms:hrms/hooks.py:205-221`).

## 7. Bank Account, Bank Transaction and bank reconciliation

These are how ERPNext keeps an ordinary bank account true. Under Aaron's addition they serve every
account that is not a Safe.

- **Bank Account** (`bank_account.json:45-235`):
  - fields `account_name` and `bank`, plus `account`, the GL account it is (required when
    `is_company_account`);
  - optional `party_type`/`party`, so a supplier's or employee's payout details are Bank Accounts;
  - `iban`, `bank_account_no` and `branch_code`;
  - `integration_id` and `last_integration_date` for a bank feed.

  A Payment Entry carries the company's `bank_account` and the party's `party_bank_account`
  (`payment_entry.json:548-555`).
- **Bank Transaction** (`bank_transaction.json:53-274`). One statement line, submittable. It holds:
  - `date`, `deposit` or `withdrawal`, `currency` (which must equal the account's,
    `bank_transaction.py:67-84`);
  - `transaction_id`, `reference_number` and `description`;
  - the bank's view of the counterparty (`bank_party_name`, `bank_party_iban`,
    `bank_party_account_number`);
  - `included_fee` and `excluded_fee` (`:332-365`);
  - a `payment_entries` table of Payment Entries, Journal Entries, invoices, Expense Claims or other
    Bank Transactions, each with an `allocated_amount`.

  The fields `unallocated_amount` and `status` (Pending, Unreconciled, Reconciled, Cancelled) follow
  from the table (`:86-119`). Allocating sets each voucher's `clearance_date` (`:177-276`). The
  doctypes that can be cleared come from the `bank_reconciliation_doctypes` hook:
  Payment Entry, Journal Entry, Purchase Invoice and Sales Invoice (`erpnext:erpnext/hooks.py:616-621`),
  plus Expense Claim (`hrms:hrms/hooks.py:303`).
- **Party matching.** With `enable_party_matching` on, a submitted line gets its party from the Bank
  Account or Employee whose IBAN or account number matches, else by fuzzy name
  (`bank_transaction.py:309-330`; `auto_match_party.py:38-60`).
- **Bank Reconciliation Tool** (`bank_reconciliation_tool.py`):
  - `check_matching` ranks submitted, uncleared vouchers on the same bank account by equal
    `reference_no`, equal amount and equal party (`:1369-1412`, the Payment Entry query at
    `:1559-1620`);
  - `auto_reconcile_vouchers` takes only exact reference matches (`:1108-1150`; the condition at
    `:1617`, `:1673`, `:1730`);
  - from an unmatched line it can create a Payment Entry, a Bank Entry or an Internal Transfer and
    reconcile it at once (`:337`, `:772`, `:569-669`);
  - Internal Transfer is single-currency only ("TODO: Support multi-currency transactions", `:631`).
    A USD bank to USDC Safe transfer cannot be made from it.
- **Bank Transaction Rule** classifies lines automatically by description, amount and direction into
  a Bank Entry, a Payment Entry or a Transfer (`bank_transaction_rule.json:31-136`).
- **Bank feeds.** ERPNext's own feed is Plaid. It inserts and submits one Bank Transaction per
  settled line, skipping a `transaction_id` it has already seen (`plaid_settings.py:300-342`).
  Bank Clearance, the older tool, sets `clearance_date` by hand (`bank_clearance.py:100-183`).

What this means for the bridge:

- Two shapes are possible for the Safes. Capxul could keep a Safe "cleared when posted" (today's
  book, `accounting.md:76`, `:401`). Or it could feed each Safe as a bank: one Bank Transaction per
  chain transfer, keyed by a chain id in `transaction_id` and `reference_number`. Each Capxul Payment
  Entry would then carry the same `reference_no`, so Frappe's auto-reconcile clears it exactly.
- The second shape also catches money that reaches a Safe outside Capxul, such as a direct
  transfer. It does this with the tool accountants already know.

## 8. Terms, schedules and dunning

- An invoice's **Payment Schedule** rows hold `payment_term`, `due_date`, `payment_amount`,
  `paid_amount`, `discounted_amount`, `outstanding` and a discount with its own date
  (`payment_schedule.json:39-214`). They come from a Payment Terms Template; the template's flag
  `allocate_payment_based_on_payment_terms` makes payments name a term
  (`payment_terms_template.json:34`).
- A Payment Entry moves term amounts on submit and cancel (`payment_entry.py:945-1056`). An
  allocation made later by reconciliation is spread over terms, earliest first
  (`utils.py:2266-2313`).
- **Dunning** posts no GL. It lists overdue terms and adds interest and a fee (`dunning.json:70-383`).
  The charge is collected by a Payment Entry from the Customer:
  - it references the overdue Sales Invoices;
  - the charge is a **negative** deduction on the Dunning's `income_account` (`payment_entry.py:2980-3007`);
  - the deduction is validated (`:209-262`);
  - the dunning's status follows the payment (`dunning.py:486-611`).

## 9. Payroll's money path (Frappe HR)

1. **Payroll Entry** holds the period, `payment_account` (the bank), `bank_account`,
   `payroll_payable_account`, `currency` and `exchange_rate` (`payroll_entry.json:60-266`).
   `payroll_payable_account` must be of type Payable (`payroll_entry.py:154-166`). On submit it makes
   draft Salary Slips (`:119-121`, `:309`).
2. **Submitting the slips** (`:372-391`, queued above 30 slips) submits each slip. It then makes
   the **accrual** Journal Entry and submits it (`:619-701`, `submit_journal_entry=True` at
   `:696`):
   - debit each earning's expense account;
   - credit each deduction's liability account;
   - credit Payroll Payable, per employee when employee-wise accounting is on;
   - every row names the Payroll Entry;
   - each slip's `journal_entry` is set (`:1289-1295`).
3. **`make_bank_entry`** (`:1093-1136`, `:1196-1287`) makes **one** Journal Entry for the run, of
   type Bank Entry, or Cash Entry when `payment_account` is Cash:
   - credit `payment_account` with the net total, less loan repayments when the lending app is
     installed;
   - debit Payroll Payable, one row per employee and cost centre when employee-wise accounting is
     on, else one row;
   - `reference_type` Payroll Entry.

   It is saved, **not submitted** (`make_journal_entry`, `:817-862`). A person adds `cheque_no` and
   `cheque_date` and submits it (`journal_entry.py:548-557`). Withheld salaries get their own later
   bank entry (`:1093`, `for_withheld_salaries`).
4. **"Paid" is not a field.** Salary Slip status is Draft, Submitted, Withheld or Cancelled
   (`salary_slip.py:355-365`). Payroll Entry's is Draft, Submitted, Cancelled, Queued or Failed
   (`payroll_entry.json:266`). Whether a run is paid is a query for a submitted Bank or Cash Entry
   that references it (`has_bank_entries`, `payroll_entry.py:1069-1090`).
5. **Cancelling a Payroll Entry** (queued above 50 slips, `:184-198`) cancels and deletes its slips.
   It also cancels **every** submitted Journal Entry whose rows reference it, the bank entry
   included, and their Payment Ledger rows (`:168-245`).
6. **Where an employee's pay goes.** Employee `salary_mode` is Bank, Cash or Cheque, with
   `bank_name`, `bank_ac_no` and `iban` (`erpnext:erpnext/setup/doctype/employee/employee.json:417-434`,
   `:834`). The slip copies `bank_name` and `bank_account_no` (`salary_slip.json:297-302`).

The book already pays one Bank Entry per slip, not per run, from the settled fact
(`capxul-next:docs/design/frappe/payroll.md:498-504`). It also hides Make Bank Entry on a Capxul
run (`:316`). The cancel cascade in step 5 is the case it must still guard. A Capxul run's Payroll
Entry must not be cancellable once any of its pay is proven on chain. Otherwise Frappe reverses the
bank entries of money that has left the Safe.

## 10. Frappe HR's other money paths

- **Expense Claim** posts GL on submit (`hrms:hrms/hr/doctype/expense_claim/expense_claim.py:302-421`):
  - credit `payable_account` with party the Employee;
  - debit each expense account;
  - credit the employee advances it uses.

  It is paid by a Payment Entry (Pay, Employee) built by `get_payment_entry_for_employee`
  (`hrms:hrms/overrides/employee_payment_entry.py:76-161`), or by a Journal Entry row. Hooks on both
  recompute `total_amount_reimbursed` from submitted Journal Entry rows and Payment Entry References
  (`expense_claim.py:675-708`, `:971-993`; `hrms/hooks.py:197-221`). Status is Paid, Partially Paid
  or Unpaid from that sum (`:127-161`).
- **Employee Advance.**
  - Paid by a Payment Entry against the advance account (`employee_payment_entry.py:171-180`).
  - `paid_amount` and `return_amount` come from the Advance Payment Ledger, events Submit and
    returns (`employee_advance.py:185-252`).
  - An unclaimed balance comes back by a Journal Entry (`make_return_entry`, `:323-385`) or out of
    salary (`repay_unclaimed_amount_from_salary`, `employee_advance.json:180`).
- **Leave Encashment and Gratuity** are paid like Expense Claim. They are Employee references and
  advance doctypes (`employee_payment_entry.py:29-30`, `hrms/hooks.py:289`).

## 11. Every place where Frappe marks money moved

"Frappe never marks money moved until the chain says so" has to hold at each of these for a Safe
account:

| Where | What it posts or sets | Code |
|---|---|---|
| Payment Entry submit | bank line on `paid_from`/`paid_to` | `payment_entry/services/gl_composer.py:180-216` |
| Journal Entry submit with a Bank or Cash row | any line on the account | `journal_entry.py:242-255` |
| Purchase Invoice with `is_paid` | credit `cash_bank_account`, debit the supplier | `purchase_invoice/services/gl_composer.py:861-900` |
| Sales Invoice with `is_pos` | debit each `payments` row's account | `sales_invoice/services/gl_composer.py:473-500` |
| Expense Claim with `is_paid` | credit the Mode of Payment's account | `hrms:.../expense_claim.py:380-421` |
| Payment Request, phone channel | status Paid, outstanding 0, **no Payment Entry** | `payment_request.py:603-605` |
| Payment Request, gateway callback | submits a Payment Entry dated today | `payment_request.py:599-689` |
| Payment Order of Payment Entries | requires the entries already submitted | `payment_order.py:102-108` |
| Bank Reconciliation Tool | creates and submits a Payment Entry, Journal Entry or transfer from a bank line | `bank_reconciliation_tool.py:337`, `:569-669`, `:772` |

- **Frozen accounts.** A GL line on a frozen account is refused unless the user holds the Company's
  `role_allowed_for_frozen_entries` (`erpnext/accounts/doctype/gl_entry/gl_entry.py:430-440`). The
  check runs for every voucher type (`:98-104`). It is skipped for adjustment postings (`adv_adj`)
  and reposts, which is how reconciliation rewrites a submitted entry.
- **What freezing does not stop.** It does not stop the Administrator, who holds every role. It does
  not stop the phone-channel Payment Request either, because that writes no GL at all. The book's
  hooks guard only Journal Entry and Payment Entry (`accounting.md:386-392`).
- **What is still needed.** A rule on Purchase Invoice, Sales Invoice and Expense Claim that refuses
  `is_paid`/`is_pos` on a Safe account. A guard on Payment Request's paid path. A guard on Payroll
  Entry cancel.

## 12. Cancellation and amendment

- **Transitions** (`frappe:frappe/model/document.py:1740-1794`). Draft to draft or submitted;
  submitted to submitted (update after submit, only on `allow_on_submit` fields,
  `:1807-1818`) or cancelled. Draft cannot go to cancelled. A cancelled document cannot be edited.
  `cancel()` sets docstatus 2 and saves (`:2102-2125`).
- **Back links.** Cancel refuses while another live document links to this one
  (`check_no_back_links_exist`, `:2352-2358`). The doctypes in `ignore_linked_doctypes` are the
  exception: Payment Entry lists GL, Payment Ledger, reposts, unreconcile, advance ledger and tax
  withholding entries (`payment_entry.py:368-381`).
- **Amendment.** A new draft with `amended_from` the cancelled one, which must be cancelled
  (`document.py:1062-1064`, `:1174-1179`). It is named `<name>-1`, `-2` (`naming.py:578-595`).
  Child rows are copied with their names cleared, so they get new random names (`document.py:4399-4438`).
- **What a Payment Entry cancel undoes** (`payment_entry.py:368-392`):
  - withholding;
  - the Payment Requests' outstanding is restored;
  - the payment schedules;
  - the GL is reversed;
  - the invoices' outstanding;
  - dunnings;
  - advance links are delinked from invoices;
  - the schedules are re-synced.

  `AccountsController.on_cancel` also removes the entry from Bank Transactions and cancels its
  exchange gain or loss and common-party journals (`erpnext/controllers/accounts_controller.py:1339-1365`).
- **Invoice cancel with payments.** When `unlink_payment_on_cancellation_of_invoice` is on, the
  default (`accounts_settings.json:157`), cancelling an invoice strips the allocations out of its
  payments and leaves them as advances (`accounts_controller.py:1358-1359`). The book turns it off
  (`accounting.md:369-372`).
- **Immutable ledger** (`enable_immutable_ledger`, default off, `accounts_settings.json:488`).
  - **On:** a cancel writes new reversing GL rows dated from the request's `posting_date`, else
    today, and leaves the originals as they are (`general_ledger.py:758-762`). The Payment Ledger
    rows are dated the same way (`utils.py:2196-2201`).
  - **Off:** the originals are marked `is_cancelled` (`general_ledger.py:726`, `:768-780`) and the Payment
    Ledger rows are delinked (`utils.py:2316`).
- **What can change after submit.** On Payment Entry: `cost_center`, `project`, `party_name`, and
  each deduction's `cost_center` (`payment_entry.json:159`, `:201`, `:467`;
  `payment_entry_deduction.json:27`). Plus reference rows through reconciliation (section 3). A
  change to references, taxes or deductions after submit reposts the GL (`payment_entry.py:288-299`).

## 13. What Frappe needs to know to record a payment correctly

A checklist for writing a Payment Entry from a Capxul money fact. "Refused" means the insert or
submit throws.

| Field | Rule | Code |
|---|---|---|
| `company` | required | `payment_entry.json:149` |
| `payment_type` | Receive, Pay or Internal Transfer | `payment_entry.json:125`, `payment_entry.py:736-738` |
| `posting_date` | required; the GL refuses a closed Accounting Period, a frozen-till date or a closed period (Period Closing Voucher) | `payment_entry.json:141`; `erpnext/accounts/services/gl_validator.py:42`, `:108-118`, `:137` |
| `party_type`, `party` | required for Pay and Receive; must exist; the account type must match the Party Type | `payment_entry.py:644-648`, `:744-764` |
| party account (`paid_from` on Receive, `paid_to` on Pay) | defaults from the party and Company; must equal each referenced invoice's own party account | `:666-669`, `:834-856` |
| bank account (`paid_to` on Receive, `paid_from` on Pay) | required; from `mode_of_payment`'s account for the Company, else `default_bank_account` | `get_bank_cash_account`, `:3228-3246`; `journal_entry.py:1044-1074` |
| `paid_amount`, `received_amount`, `source_exchange_rate`, `target_exchange_rate` | all greater than zero; rate 1 for the Company's currency | `:794-800`, `:766-792` |
| `reference_no`, `reference_date` | required when the bank side is a Bank account; not unique | `:1450-1456`, `payment_entry.json:431-445` |
| `mode_of_payment` | optional; must be enabled | `mode_of_payment.py:86-88` |
| `references[]` | allowed doctype for the party type; submitted; same party; within the latest outstanding; a term when the template demands one; not on hold | `:802-867`, `:504-601` |
| `deductions[]` | account in the Company's currency; cost centre required | `gl_composer.py:290-293`, `payment_entry_deduction.json:18-36` |
| `cost_center` | on every profit-and-loss line | GL Entry `pl_must_have_cost_center`, `gl_entry.py:87` |
| balance | `difference_amount` zero at submit | `:268-269` |
| permissions | the submitter needs submit on Payment Entry, and the frozen role for a frozen account | `document.py:1765-1772`, `gl_entry.py:430-440` |

Exchange rates. `get_exchange_rate` takes the latest stored Currency Exchange record first, then
its inverse. Only then, with `allow_pegged_currencies_exchange_rates` on, does it use a pegged rate
from "Pegged Currencies". Last comes the external provider, and only for a system user
(`erpnext/setup/utils.py:100-175`; the peg logic at `:17-61`). So Capxul can either write a Currency
Exchange row per block day or declare USDC pegged to USD at 1.0. The precision limits for 18-decimal
tokens are in `accounting.md:379-381`.

What Capxul must add, because Frappe has no slot for it:

- a **unique** Custom Field for the chain payment, enforced in the schema. Custom Field supports
  `unique` (`frappe:frappe/custom/doctype/custom_field/custom_field.json:265`). Neither
  `reference_no` nor `transaction_id` is unique;
- the chain proof: chain id, transaction hash, log index, block time, `paymentId` and
  `documentHash`.

The book already lists most of these (`accounting.md:374-375`).

## 14. Frappe's side of the document hash

Facts that bound what `documentHash` can commit to so that both sides can check it:

- **Frappe records only document-level allocation.** The commitment can name lines, but Frappe will
  store only (document, payment term, Payment Request, amount) per allocation
  (`payment_entry_reference.json:33-178`). The line detail lives on the invoice itself: item rows,
  `taxes` rows and `item_wise_tax_details` (`item_wise_tax_detail.json:15-42`).
- **Names are not stable across an amendment** (finding 3). A commitment that must survive one has
  to use Capxul's id, which the book carries as `capxul_id` across amendments
  (`accounting.md:61-64`), or else commit to that exact version.
- **Row position is stable in a copy, but not across edits.** Each child row's `idx` is its
  position.
- **Amounts are decimals at the currency's precision.** A Currency column is decimal(21,9)
  (`accounting.md` cites `frappe/database/mariadb/database.py`). The chain amount is integer token
  units. The commitment should hold the integer units and the currency, not Frappe's float.
- **Deductions change the cash.** Withholding (`apply_tds`), early-payment discount, a dunning
  charge, a rail fee and an exchange difference all make the cash differ from the amount
  allocated. Frappe keeps each as its own deduction or tax row (sections 2.4, 8). A commitment that
  lets Frappe rebuild the entry must state the allocations and the deductions separately, not only
  the total.

From these facts, a canonical "payment advice" that Frappe can recompute from its own documents would
hold:

- the Company and the payee party, by Capxul id;
- the token and the amount in units;
- per allocation: doctype, Capxul id, document version, payment term, allocated amount, and
  optionally per-line rows (row `idx`, item, quantity, rate, amount, and each line's tax rows);
- per deduction: kind, account role and amount.

`documentHash` would be the hash of that advice. This is a proposal for the design lane, not a
Frappe fact.

## 15. What this changes in the book (for the design lane)

1. **Employee references.** Add Leave Encashment and Gratuity. Add Dunning and Payment Entry for
   Customer, and Payment Entry for Supplier (`accounting.md:186-190` against
   `employee_payment_entry.py:22-30`, `payment_entry.py:869-875`).
2. **Bank Transaction and reconciliation.** These come back for non-Safe accounts
   (`accounting.md:76`). Decide whether Safes are fed as banks (section 7).
3. **Allocation-only changes.** Use reconciliation instead of cancel and amend (section 3).
4. **The gateway slot.** Use it for the pay link and the Payment Request. Do not let the stock
   callback book the entry (section 4).
5. **The other back doors.** Guard all of them, not only Journal Entry and Payment Entry
   (section 11).
6. **Payroll Entry cancel.** Guard it once pay is proven (section 9).
7. **Large Journal Entries.** Over 100 rows they submit asynchronously (`journal_entry.py:216-221`).
   A writer must wait for the queued submit, not assume it is done.
8. **Single-currency differences.** In a single-currency entry, an automatic difference goes to bank
   charges, not exchange gain or loss (`payment_entry.py:1364-1367`). This matters if a Safe account
   is ever kept in the Company's own currency.

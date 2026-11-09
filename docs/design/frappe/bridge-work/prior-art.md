# Prior art: how others join on-chain and external payments to an ERP's records

Research for the payments bridge study (`aaron.frappe-native`, `aaron.one-product`, `aaron.other-accounts`, 9 November
2026). It covers how others connect a payment that happens outside the ERP to the ERP's documents, and what Capxul should
take from them. The sibling note `v4.md` (same folder) covers what v4's own events say. This note covers what the rest of
the world does.

The code was read, not run. Web sources were read on 9 November 2026. Paths:

- `fp/` is `/tmp/payments`: `frappe/payments`, branch `develop`, commit `b2ceb4a`, 5 November 2026.
- `en/` is `/tmp/erpnext`: `frappe/erpnext`, branch `develop`, commit `6b946b0`, 8 November 2026.
- `fr/` is `/tmp/frappe`: `frappe/frappe`, commit `1a7ea57`, 8 November 2026. It is a sparse checkout, so its files were
  read with `git show HEAD:<path>`.
- `hr/` is `/tmp/hrms`: `frappe/hrms`, commit `8816102`, 6 November 2026. It is also sparse and was read the same way.
- `pc/` is `aerele/payment-core`, commit `626b438`, 6 November 2026. It was cloned to
  `/tmp/claude-0/-home-user/c92cd756-b1a0-5414-9fe4-a7834db8d32a/scratchpad/ext-src/payment-core` and read there.
- `v4/` is `/home/user/factory/packages/contracts/v4/src/`.
- Every other path is relative to `/home/user/capxul-next/` (the book).

Web sources are numbered `[W1]` to `[W40]` and listed at the end.

## The short answer: ten things to take

1. **Two reconciliations, not one.** Mature systems answer two questions separately:
   - **What does this payment pay?** This is cash application: ERPNext's Payment Entry References and Payment Ledger,
     ISO 20022's structured remittance, and EDI 820.
   - **Did the money move?** This is bank reconciliation: ERPNext's Bank Transaction and its clearance date, and Xero
     matching a Stripe payout.

   Capxul's document hash answers the first question, and the chain is a statement for the second that cannot be wrong.
   The book currently leaves Bank Transaction out for Safes (`docs/design/frappe/accounting.md:76-77`). Prior art points
   the other way: feed each Safe into the books as if it were a bank account. ERPNext's own tool then clears Capxul's
   vouchers, and the company's other bank accounts are reconciled on the same screen (section 2).
2. **Carry a remittance advice, not a memo.** Banks already have a shape for "these lines of these documents":
   - **ISO 20022:** for each document, its type, number and date. For each line, an id and amounts: due, discount, credit
     note, tax by type, an adjustment with its reason, and the amount remitted [W7].
   - **EDI 820:** one RMR segment per invoice with the amount paid, and ADX segments for adjustments [W8][W9].

   Crypto references carry less (section 3):
   - Request Network carries an 8-byte salted reference [W3].
   - ERC-7699 carries an opaque reference [W1].
   - Coinbase Commerce carries a 16-byte id [W31].

   Capxul's document hash is the strongest carrier of all of them, because it is bound into the payment id, and the id
   can be paid only once (`v4/money/Payments.sol:15-17`, `:59-67`). What it lacks is a document worth hashing. It should
   hash a salted remittance advice in the ISO shape (section 3.4).
3. **Exactly-once delivery does not exist. Idempotent receivers plus reconciliation do the job.**
   - **Delivery is at-least-once and unordered:** Stripe, Circle and Razorpay all deliver events at least once and in no
     guaranteed order, and each says to deduplicate by event id (Stripe [W11], Circle [W15], Razorpay in section
     1.4). Bridge gives every event an `event_id` it calls "useful as an idempotency key" and tells receivers to handle
     duplicates [W18][W19].
   - **How long a key holds:** Stripe keeps an idempotency key for 24 hours [W12]. Fireblocks refuses a reused
     `externalTxId` forever [W24]. Capxul's contract refuses a reused payment id forever (`Payments.sol:64`).
   - **Frappe's own pieces are weak** (section 1.4):
     - the deduplication field is not unique;
     - the log that holds it is purged after 90 days;
     - outbound webhooks wait in process memory until the commit.
   - **Frappe's own fix exists.** Payment Core (October 2026) shows it in Frappe's style (section 1.5):
     - a unique deduplication key;
     - states that only move forward;
     - a daily re-check, in which "the provider's answer wins".
4. **Do not mark money moved on a promise.**
   - **ERPNext marks too early.** It books a Payment Entry when a gateway says "Authorized" (Razorpay) or
     "pending_submission" (GoCardless). Nothing reverses that entry when the bank later fails (section 1.3).
   - **Others wait.** Circle separates `CONFIRMED` from `COMPLETE` [W15][W16]. Coinbase Commerce separates pending from
     confirmed [W32]. ERPNext's Plaid feed skips pending rows.
   - **ERPNext already supports waiting.** Its own payroll leaves the Bank Entry as a draft, and a Journal Entry needs
     its reference only at submit (section 2.4). So the mechanics for `aaron.frappe-native`'s rule already exist in
     ERPNext.
5. **Say which finality you mean.** Base has three stages (section 6):
   - about 200 ms: the sequencer's block;
   - about 2 minutes: the batch is posted to Ethereum, and "there has never been a reorg of L2 blocks that were batched
     to Ethereum L1";
   - about 20 minutes: that Ethereum block is final [W20].

   **How others wait:**
   - Circle Mint waits 12 Ethereum blocks for Base, about 3 to 9 minutes [W17].
   - Ponder's own idea of "finalized" is a time window, 180 seconds by default, which is earlier than both [W25].

   Pick the stage explicitly, and keep a cancel path.
6. **Bridge is a clearing account with a rich statement** (section 4.2).
   - **The Stripe and Xero pattern:** Xero records Stripe's fee as its own entry and matches each payout to invoices by
     charge id [W27].
   - **Bridge deposits:** Bridge's virtual-account activity carries:
     - the gross amount;
     - the developer and exchange fees;
     - the subtotal and the gas fee;
     - the sender's name;
     - the bank's free-text description;
     - `destination_tx_hash`, the chain transaction [W22].

     That is an ERPNext Bank Transaction with `included_fee` and `bank_party_name`, joined to the chain by the hash.
   - **Bridge payouts:** Bridge matches a crypto deposit to a transfer by the sending address, the receiving address and
     the amount [W21].
7. **Refunds, partial payments and fees belong to the payment's identity.**
   - **Coinbase's AuthCaptureEscrow** keys every event by one payment hash: authorize, charge, capture, void, reclaim and
     refund. It also tracks how much can still be captured and how much can still be refunded [W30].
   - **Request Network** computes a balance as payments minus refunds under one reference [W3].
   - **v4 has none of this** (`v4.md` section 7, items 8 to 10).
   - **If a contract changes,** the change with the most prior art behind it is a refund that names the payment it
     refunds.
8. **A hash of a business document must be salted.**
   - **ERC-7699's warning:** a plain reference such as `0x20240002` tells everyone it is the payee's second invoice of
     2024 [W1].
   - **Request Network's rule:** a salt with at least 8 random bytes [W3].
   - **Why:** an invoice's lines and amounts are easy to guess, so without a salt its hash can simply be looked up.
9. **The payer's advice is not the payee's books.**
   - **Why EDI 820 exists:** payers deduct and adjust. Its ADX segments say by how much and why [W8][W9].
   - **The payee may re-allocate:** ERPNext lets the payee undo an allocation (Unreconcile Payment, section 2.5).
   - **What the hash proves:** what the payer said. The payee's allocation may differ, and the difference should be
     shown, not overwritten.
10. **Stablecoins are like cash, but in the accounts they are not yet cash** (section 7).
    - **US GAAP (proposed):** FASB's proposal of 18 August 2026 lets a stablecoin count as a cash equivalent only if the
      holder can redeem it directly with the issuer. Redemption through an intermediary was judged not enough [W33][W34].
      So a company that redeems through Bridge may not qualify.
    - **IFRS:** in 2019 the IFRS Interpretations Committee ruled that crypto with no claim on an issuer is not cash
      [W35]. A redeemable stablecoin may instead be a financial asset [W36].
    - **What to do:** keep the book's Bank-type Safe account for daily work. Leave the balance-sheet classification to
      the company's accountant.

## 1. Frappe's own payment gateways (`frappe/payments`) and ERPNext's Payment Request

### 1.1 The path every gateway takes

1. **ERPNext asks the gateway.** A Payment Request in ERPNext asks a gateway controller for a payment URL.
2. **The gateway logs the request.** It writes an Integration Request, Frappe's request log, with the reference doctype
   and name (`fr/frappe/integrations/utils.py:164-200`).
3. **The gateway confirms the payment.** This happens on a redirect or, for some gateways, on a callback.
4. **It calls back to the document.** It runs `run_method("on_payment_authorized", status)` on the reference document,
   which is the Payment Request:
   - Stripe: `fp/payments/payment_gateways/doctype/stripe_settings/stripe_settings.py:243-261`;
   - Razorpay: `razorpay_settings/razorpay_settings.py:456-463`;
   - PayPal: `paypal_settings/paypal_settings.py:333-337`;
   - GoCardless: `gocardless_settings/gocardless_settings.py:175-182`;
   - M-Pesa: `mpesa_settings/mpesa_settings.py:183-200`.
5. **ERPNext books the payment.** The Payment Request calls `set_as_paid`, which calls `create_payment_entry`. That
   builds, inserts and submits a Payment Entry as Administrator:
   - `on_payment_authorized` and `set_as_paid`: `en/erpnext/accounts/doctype/payment_request/payment_request.py:599-613`;
   - running as Administrator: `:37-49`;
   - building and submitting: `:615-689`.

### 1.2 What the Payment Entry keeps of the gateway's payment, and what it loses

- **The reference is the request's own name.** The Payment Entry's `reference_no` is the Payment Request's name, "to
  prevent validation error", and `reference_date` is today (`payment_request.py:651-657`).
- **The gateway's id is never on the voucher.**
  - PayPal's transaction id and correlation id go only into the Integration Request's data (`paypal_settings.py:323-331`).
  - Stripe's charge is not stored at all. The call `stripe.Charge.create` sends amount, currency, source, description
    and email, with no metadata and no idempotency key (`stripe_settings.py:223-229`).
- **The log that holds the gateway's data is temporary.** Integration Request is a log doctype that Frappe purges
  (`fr/frappe/hooks.py:633-645` sets 90 days for it). Its `request_id` field is not unique (field list in
  `fr/frappe/integrations/doctype/integration_request/integration_request.json`).

**Lesson.** In Frappe's own gateways, the external payment's identity never reaches the accounting voucher, and its trace
disappears after three months. Capxul must write the chain identity onto the voucher itself, in fields that are kept.
Those are the payment id, the transaction, the log index and the document hash. Today's design writes the transaction,
the log index and the chain, but not the payment id or the document hash (`docs/design/frappe/accounting.md:365-368`;
`v4.md` section 7, item 20).

### 1.3 When the books say "paid": usually too early

- **ERPNext books at authorization.** `on_payment_authorized` books the payment for both `"Authorized"` and
  `"Completed"` (`payment_request.py:599-601`).
- **Razorpay is booked before capture.** Its `authorize_payment` reports `"Authorized"` when Razorpay says the payment is
  only authorized, not captured (`razorpay_settings.py:414-431`). The Payment Entry is therefore booked before capture.
  Capture runs later, on the scheduler (`fp/payments/hooks.py:116`; `razorpay_settings.py:572-619`).
- **GoCardless is booked before the bank moves any money.** It reports `"Completed"` for the states
  `pending_submission`, `pending_customer_approval` and `submitted` (`gocardless_settings.py:145-151`).
- **A later failure never reaches the books.** GoCardless's webhook handles only mandate events
  (`gocardless_settings/__init__.py:28-33`). A payment that later fails or is charged back never reverses its Payment
  Entry.
- **The good part:** GoCardless sends `Idempotency-Key: <reference document name>` (`gocardless_settings.py:140-142`). The
  key is derived from the business document, the same idea as Capxul's payment id being derived from the payment's terms.
- **Plaid's bank feed waits.** It does not import pending transactions
  (`en/erpnext/erpnext_integrations/doctype/plaid_settings/plaid_settings.py:315-317`).

**Lesson.** Frappe's gateway code lets a promise of payment become a submitted Payment Entry. `aaron.frappe-native` rules
this out for Safes. The Capxul app must:

- refuse the Payment Request path (`on_payment_authorized`) for Safe money;
- post only on the chain's word, at the chosen finality (section 6).

### 1.4 Webhooks in, webhooks out

**Razorpay's refund webhook** (`fp/payments/payment_gateways/doctype/razorpay_settings/webhook.py`) is the most careful
code in the app:

- **Who may call:** guests may call the endpoint, but it checks the HMAC signature before it writes anything (`:52-55`,
  `:11-26`).
- **Which events:** only `refund.processed` and `refund.failed` are handled (`:8`, `:28-29`).
- **Deduplication:** it looks up the event id, `X-Razorpay-Event-Id`, in the Integration Request log, and a second
  delivery reuses the logged row (`:31-35`, `:63`). The docstring adds: "Subscribers must still make their own writes
  idempotent" (`:11-17`).
- **Commit, then queue:** it commits before queueing the job, "so it has to be there before the job is" (`:82-89`).
- **Which errors Razorpay should see:**
  - A rejected or malformed delivery gets a 200, because retrying it changes nothing and Razorpay disables an endpoint
    that keeps failing (`:56-77`).
  - When the queue is down, the error is left to reach Razorpay, so the delivery comes back.

**Its gap:** the deduplication field, `request_id`, is not unique, so two deliveries at the same moment can both insert a
row. The row is also purged at 90 days (section 1.2).

**Frappe's outbound webhooks** (`fr/frappe/integrations/doctype/webhook/__init__.py:73-119`) work differently:

- **They wait in memory.** A webhook is put on an in-memory list, `frappe.local._webhook_queue`. That list is pushed to
  the job queue only by an `after_commit` hook (`:75-77`, `:112-119`).
- **Retries are logged.** A failed delivery is logged in Webhook Request Log, which has a next-retry time
  (`fr/frappe/integrations/doctype/webhook/webhook.py:183-208`).
- **They are signed.** Each delivery carries `X-Frappe-Webhook-Signature` (`webhook.py:21`, `:363-376`).

**Their gap:** if the process dies after the commit but before the job is queued, the event is lost. That is not a
transactional outbox (section 5.1). The Capxul app must not rely on Frappe's Webhook doctype to tell Capxul about a
change. It should rely on a table it writes inside the same transaction, read by a cursor. The book's head sync already
pulls changes by a cursor (`listChanges(after pulled_change)`, `docs/design/frappe/accounting.md:295-300`).

### 1.5 The newer pattern: ERPNext's v2 gateway hook and Payment Core

**ERPNext's v2 gateway hook.**

- **The hook:** ERPNext `develop` already calls a version-2 `PaymentController.initiate(...)` and stores the "Payment
  Session Log" it returns, "for debugging and reconciliation" (`payment_request.py:59-70`, `:366-395`).
- **No implementation yet:** nothing in `fp/` at `b2ceb4a` defines `PaymentController` (grep). The ERPNext pull request,
  merged on 8 May 2026, depends on `frappe/payments` pull request #192, whose status we could not confirm [W37].

**Payment Core (aerele, open-sourced 24 October 2026 [W38]).** It is a third-party app that does what `fp/` does not:

- **A unique key per delivery.**
  - **The key:** Payment Webhook Log has a unique column, `dedupe_key = "<source>:<event_id>"`
    (`pc/payment_core/webhooks.py:20-58`).
  - **Two deliveries at once:** if they race, the database's unique index refuses the second insert, and the code
    reports it as a duplicate (`:53-57`).
  - **A retry after a failure:** a row that failed earlier is reused, so the provider's retry can succeed (`:36-39`).
- **A unique idempotency key on the transaction.** Payment Transaction has a unique `idempotency_key` and a
  `provider_transaction_id` (field list in
  `pc/payment_core/payment_ledger/doctype/payment_transaction/payment_transaction.json`).
- **States that only move forward.** Draft, Requested and Initiated lead to Partially Paid, Paid, Failed or Cancelled,
  and Paid leads only to Refunded (`pc/payment_core/payment_ledger/status_flow.py:39-51`).
  - **Late messages are ignored:** "Refunded is terminal - a late "Paid" must not undo a refund".
  - **Deliveries can repeat:** writing the same state again is allowed, because that is what a repeated delivery does
    (`:66-70`).
- **A daily re-check.** A scheduled job asks the provider again about every open transaction older than 24 hours, and
  "the provider's answer wins". Only then does it expire the stale ones (`pc/payment_core/tasks.py:18-36`; scheduled in
  `pc/payment_core/hooks.py:292-296`).
- **One booking when the webhook and the redirect race.**
  - **The race:** the provider's webhook and the payer's return to the site can arrive at the same moment.
  - **The guard:** the code locks the Payment Request row (`SELECT ... FOR UPDATE`) and re-reads its status under the
    lock (`pc/payment_core/utils.py:976-991`). Exactly one of the two books the Payment Entry.
- **The provider's references are copied onto the Payment Entry** through a hook, `annotate_payment_entry`
  (`pc/payment_core/api/gateway.py:38-39`, `:52`; called at `pc/payment_core/utils.py:1083-1084`).

**Lesson.** This is the shape for the Capxul app's inbound side, in Frappe's own style:

- a unique key on each delivery;
- a state machine that only moves forward;
- a lock on the document being settled;
- a scheduled re-check against the source of truth (for Capxul, the chain);
- the source's ids copied onto the voucher.

## 2. Bank feeds and reconciliation in ERPNext

### 2.1 The Bank Transaction

**Fields.** One Bank Transaction is one statement line (`en/erpnext/accounts/doctype/bank_transaction/bank_transaction.json`).

| Field | What it holds |
|---|---|
| `date` | the statement line's date |
| `bank_account` | the account it belongs to |
| `deposit`, `withdrawal`, `currency` | the amount and its direction |
| `description` | the bank's text |
| `reference_number` | the reference, editable after submit |
| `transaction_id` | the feed's id, read-only |
| `bank_party_name`, `bank_party_iban`, `bank_party_account_number` | the other side |
| `party_type`, `party` | the matched party |
| `included_fee`, `excluded_fee` | the fee |
| `payment_entries` | the vouchers it settles, each with an allocated amount, a clearance date and a type (`Matched` or `Voucher Created`) |
| `unallocated_amount` | what is not yet matched |
| `matched_transaction_rule` | the rule that classified it |

- **Uniqueness:** `transaction_id` is not unique in the schema.
- **Fees:** an excluded fee is folded into the included fee when the line is saved
  (`bank_transaction.py:342-366`). An included fee larger than the withdrawal is refused (`:332-340`).

**Feed import, as Plaid does it** (`plaid_settings.py:229-251`, `:294-350`):

- **One savepoint per line,** so one bad line does not lose the rest.
- **Duplicates are skipped by an existence check on `transaction_id`, not by a unique index.**
- **Pending lines are skipped.**
- **The reference** comes from the bank's cheque number, its payment reference, or its name.
- **Lines are inserted and submitted at once.**

### 2.2 Matching and clearance

**How candidates are ranked** (`en/erpnext/accounts/doctype/bank_reconciliation_tool/bank_reconciliation_tool.py`):

- **Payment Entries** score one point for an equal reference, one for an equal amount and one for an equal party
  (`:1576-1597`).
- **Journal Entries** match on `cheque_no` (`:1657`, `:1674-1686`).
- **Other Bank Transactions** also score for the unallocated amount (`:1515-1543`).

**Automatic reconciliation** (`:1108-1148`, `:1151-1188`):

- **Exact references only.** It adds `pe.reference_no == transaction.reference_number` as a hard filter (`:1617-1618`).
  Without an exact reference, nothing reconciles automatically.
- **Writable vouchers only.** It reconciles only the vouchers the user may write (`:1154-1155`, `:1173`).

**Clearance.**

- **Reconciling clears the voucher:** reconciling a Bank Transaction sets the voucher's `clearance_date`
  (`bank_transaction.py:259-276`).
- **The clearance date is the statement's date:** it is the Bank Transaction's own date, or the later allocation date
  (`bank_transaction.py:424-483`, at `:433` and `:480`).

**Rules.** Bank Transaction Rule classifies the lines that have no voucher, by direction, amount range and description
pattern. It makes a Bank Entry, a Payment Entry or a Transfer (fields in `bank_transaction_rule.json`).

### 2.3 What this means for Safes and for other accounts

**Today's design** posts a Capxul voucher as cleared on its posting date, "because the bank is the chain and there is no
statement to match" (`docs/design/frappe/accounting.md:76-77`).

**Prior art suggests the opposite.** The chain is the best statement there is: complete, ordered, always available, and
impossible to forge. So the Capxul app could write one Bank Transaction per Safe per Transfer at finality, with:

- `transaction_id`: `<chain>:<tx>:<log>`, under a unique key;
- `reference_number`: the voucher's reference, for example the transaction hash or the payment id;
- `bank_party_name`: the counterparty's Party;
- `included_fee`: any fee.

**What follows from that.** ERPNext's own tool would then do the following:

- **Clear Capxul's vouchers**, which carry the same reference, with the block date as the clearance date.
- **Show the gap.** A Transfer with no voucher shows as unreconciled, which is what the book now calls a Movement
  (`v4.md` section 6).
- **Treat every account alike.** A company's ordinary bank account (`aaron.other-accounts`) goes through the same tool,
  fed by Plaid, a statement import or Bridge. So the user sees one way to reconcile any account, all of it under
  Capxul's name.

**What is required.** The voucher's reference and the Bank Transaction's reference must be the same string (`:1617-1618`).
Which string to use (the transaction hash, the payment id, or both, with the hash as `reference_no` and the id in a
custom field) is a design choice, but it must be exactly one.

### 2.4 What vouchers need before they can be submitted

- **Payment Entry:** a Payment Entry against a Bank-type account needs `reference_no` and `reference_date`
  (`en/erpnext/accounts/doctype/payment_entry/payment_entry.py:1450-1456`). The field is `Data`, 140 characters, which
  holds a 66-character hash.
- **Journal Entry:** a Bank Entry needs `cheque_no` and `cheque_date`, but only at submit
  (`journal_entry.py:242-246` calls `validate_cheque_info`, `:548-557`).
- **HRMS payroll:** a payroll run makes one Bank Entry for the whole run (`hr/hrms/payroll/doctype/payroll_entry/payroll_entry.py:1093`,
  `:1277-1287`) and links it to every salary slip (`:1289-1295`). By default the entry is saved as a draft and not
  submitted (`make_journal_entry`, `:817-854`, `submit_journal_entry=False`). A person submits it once the bank reference
  exists.

**Lesson.** ERPNext already has the state "written, waiting for the money": a draft voucher whose reference is not yet
known. A Capxul payment is known before it is signed, because its id is computed from its terms (`v4.md` section 2). So:

- The Capxul app can save the draft Payment Entry or Bank Entry at prepare, with the payment id.
- It submits the entry, with the transaction hash, only at finality.

This is "Frappe never marks money moved until the chain says so", done in ERPNext's own style. One chain transaction that
pays a batch, such as a payroll run, maps to HRMS's one Bank Entry per run, with each slip's payment id on the slip (the
book already has `capxul_chain_payment_id` on slips, `books/target/payroll/decisions.ts:1256`).

### 2.5 Allocation, and changing it later

**Allocation is per document, not per line.**

- **What a reference names:** a Payment Entry Reference names a document (`reference_doctype`, `reference_name`), an
  `allocated_amount`, and optionally a `payment_term` (fields in `payment_entry_reference.json`). It never names a line.
- **Where outstanding is tracked:** the Payment Ledger Entry. Each row names the voucher and the document it settles
  (`voucher_no`, `against_voucher_no`; fields in `payment_ledger_entry.json`).
- **Changing it later:** the payee can undo an allocation without cancelling the payment, with Unreconcile Payment (fields
  in `unreconcile_payment.json`).
- **Cancelling:** cancelling a Payment Entry reverses its GL entries (`payment_entry.py:368-386`). With the immutable
  ledger enabled, the reversal is dated on the day of the cancel, not the original date
  (`en/erpnext/accounts/general_ledger.py:655-690`).

**Lesson.**

- **Lines stay in the document, not the voucher.** ERPNext cannot hold a line-level allocation on a voucher. So "these
  lines" must live in the hashed document, and the voucher keeps per-document totals derived from it.
- **The proof stays fixed while the books may change.** The payee may re-allocate (section 3.5), and a reorg undoes a
  payment by a cancel, dated per the immutable-ledger setting.

## 3. References carried with the money

### 3.1 The bank world: structured remittance

**ISO 20022** puts the structured part under `RmtInf/Strd/RfrdDocInf` [W7]:

- **The document:** its type (a code such as `CINV` for an invoice or `CREN` for a credit note, or a proprietary type,
  with its issuer), its number (`Nb`, up to 35 characters) and its date.
- **`LineDtls`, repeated:** each line's id (type, number, date), a description, and amounts:
  - `DuePyblAmt`, the amount due;
  - `DscntApldAmt`, the discount, by type;
  - `CdtNoteAmt`, a credit note;
  - `TaxAmt`, the tax, by type (city, county, local, province, state, or proprietary);
  - `AdjstmntAmtAndRsn`, an adjustment, with a credit or debit flag, a reason code and text;
  - `RmtdAmt`, the amount remitted.

**EDI 820** has one RMR segment per invoice, debit memo or credit memo, with the amount paid in RMR04 [W8][W9]:

- **Adjustments:** ADX carries them. A negative adjustment reduces the payment, with a reason in REF.
- **Placement rule:** an ADX inside an RMR loop adjusts only that RMR. Adjustments not tied to one invoice go in an outer
  loop.

**Lesson.** The question "which lines of which documents, for how much, net of what tax and what deductions" already has
an answer that banks and ERPs share. Capxul should hash a document of this shape, not invent one. This shape includes tax
by type and adjustments with reasons, which is what Aaron meant by "invoice line numbers, potentially tax stuff".

### 3.2 The crypto world: references on chain

| Scheme | Where the reference lives | Can a log filter find it? | Bound to the terms? | Used once? | Refunds | Partial payments | Fee | Privacy |
|---|---|---|---|---|---|---|---|---|
| **Request Network**, ERC20FeeProxy [W3][W4] | `paymentReference` = the last 8 bytes of `keccak(lowercase(requestId + salt + address))`, in the call and the event `TransferWithReferenceAndFee(token, to, amount, paymentReference, feeAmount, feeAddress)` | yes, by an indexer or subgraph | to the request and the address only | no: the balance is the sum of payment events, so partial payments work | a payment to the refund address with the reference computed from that address; balance = payments − refunds | yes | yes, `feeAmount` and `feeAddress` | salted, at least 8 random bytes, unique per request |
| **ERC-7699** (Draft, 2024) [W1][W2] | `transfer(to, amount, bytes transferReference)`; `event TransferReference(bytes32 indexed loggedReference)` before the ERC-20 Transfer | yes, indexed (hashed when longer than 32 bytes) | no | no | none | n/a | none | the spec warns a reference "may expose sensitive information" and suggests encryption |
| **Coinbase Commerce** Transfers [W31] | `TransferIntent{recipientAmount, deadline, recipient, recipientCurrency, refundDestination, feeAmount, bytes16 id, operator, signature, prefix}`; `event Transferred(address indexed operator, bytes16 id, recipient, sender, spentAmount, spentCurrency)` | by operator only | yes: the operator signs the intent | yes: `error AlreadyProcessed()` | a refund destination, not a link | no: an exact amount | yes, `feeAmount` | the id is opaque |
| **Coinbase/Base Commerce Payments**, AuthCaptureEscrow [W30] | `PaymentInfo{operator, payer, receiver, token, maxAmount, preApprovalExpiry, authorizationExpiry, refundExpiry, minFeeBps, maxFeeBps, feeReceiver, salt}`, hashed with `block.chainid` and `address(this)` | yes: `paymentInfoHash` is indexed on every event | yes | per hash, with capturable and refundable amounts | `PaymentRefunded(hash, amount, tokenCollector)` under the same hash | yes: partial capture and partial refund | yes, `feeAmount` and `feeReceiver` on capture and charge | salted |
| **Bridge liquidation address** [W23] | the address itself: a permanent address per destination | by address | no | no | a `return_address` | n/a | off chain | the address is public |
| **Capxul v4 Payments** (`v4/money/Payments.sol`, `v4/interfaces/IPayments.sol:23-31`) | `documentHash` inside `paymentId = keccak(TYPEHASH, chainId, router, jobNonce, executor, recipient, token, amount, kind, documentHash)` | `paymentId` is indexed; `documentHash` is not | yes: every term (`:80-95`) | yes, forever (`:64`) | none (`v4.md` section 7, item 9) | none: an exact amount | none | depends on what is hashed: salted only if the document is |

**What the table shows.**

- **Capxul already has the best identity.** Its payment id is like AuthCaptureEscrow's `paymentInfoHash`: a typed hash
  bound to the chain and the contract, indexed on the event, and refused when reused.
- **What Capxul lacks is everything else AuthCaptureEscrow puts under that id.** That is partial capture, refund,
  and a fee on the event.
- **Request Network shows two more things:**
  - a simple way to support partial payments and refunds: sum the events under one reference;
  - a reason to salt.

### 3.3 Where the reference lives on fiat and memo rails

**Bridge** [W21][W22][W23]:

- **Transfers:** a transfer takes a `client_reference_id`, and every POST requires an `Idempotency-Key` [W13][W14].
- **Deposits:** a virtual account's activity carries the bank's free-text `description`, which is where a payer types an
  invoice number.
- **Memo chains:** for Stellar and Tron, Bridge gives a `blockchain_memo` that "must be included". On EVM chains it
  matches a crypto deposit by the sending address, the receiving address and the amount.

**Lesson.** On a bank rail the invoice reference is free text written by the payer. Expect fuzzy matching on deposits,
which is what ERPNext's Bank Transaction Rule and ranked matching are for. On Capxul's own rail the reference is exact.

### 3.4 What prior art says the document hash must commit to

The design is the study's to make. This list only records which field each source shows to be needed, so that both
systems can prove that "this payment pays these lines of these documents". A typed EIP-712 message is the book's existing
form (`books/target/documents/data.ts:76-90`). Its fields would be:

- **The domain:** chain id and Payments' address. EIP-712 domains already bind them, as AuthCaptureEscrow's hash does
  [W30].
- **A schema version.** The book's envelope already carries kind and format.
- **The payer's and payee's identity in the business system.** That means Capxul's Party ids, which become Frappe's
  `party_type` and `party`. ISO 20022 and EDI 820 name both sides.
- **The token and the raw amount,** and for each allocation the amount in the document's currency. ISO 20022's
  `RmtdAmt` is per document and per line [W7]. ERPNext's `allocated_amount` is per document.
- **Allocations,** one per document:
  - **The document's identity:** its type (Sales Invoice, Purchase Invoice, Expense Claim, Salary Slip, and so on, as
    ISO's `CINV`, `CREN` and the like), its name in the business system, its date, and the keccak of its canonical
    issued content. The content hash is what lets a verifier prove that this exact version of the invoice was paid.
  - **Lines:** for each, its id (ERPNext's child row name or line number) and its amount.
  - **Tax:** amounts by tax type, at line or document level.
  - **Discounts and credit notes applied.**
  - **Adjustments, each with a reason code** (EDI 820's ADX, ISO's `AdjstmntAmtAndRsn`).
  - **A payment term, when one applies:** ERPNext's Payment Entry Reference has a `payment_term`, and instalments are
    otherwise unlinked on chain (`v4.md` section 7, item 8).
- **A purpose line for payments with no document:** a Memo, as today.
- **`refund_of`:** the payment id this payment refunds. This is Request Network's and AuthCaptureEscrow's lesson,
  expressed without a contract change.
- **Fees:** for a Bridge payout, the quote's fee and the bank payee, so the "paid Bridge" hop names its real purpose
  (`v4.md` section 7, item 16).
- **A salt** of at least 16 random bytes. Request Network requires at least 8; 16 makes guessing hopeless [W3].
- **Optionally, a Merkle root** over the allocations instead of a flat list, so one allocation can be shown to one party
  without revealing the others. No source above does this. It is an option, not prior art.

### 3.5 The payer's advice and the payee's cash application are different records

- **EDI 820 exists because payers deduct.** The 820 shows the invoice amount, the deduction and the net, and the payee
  reconciles by checking that the invoice amount less the adjustment equals RMR04 [W8][W9].
- **ERPNext lets the payee re-allocate** with Unreconcile Payment (section 2.5).
- **Today the book's annotation is last-write-wins** (`books/target/books/data.ts:421-468`, as `v4.md` section 6 reads
  it).

**Lesson.** The on-chain hash fixes what the payer committed to. The payee's allocation in its own books is a separate
record that can change. When the two differ, show the difference as a reconciliation item. Never overwrite the payer's
committed advice, and never force the payee's books to match it.

## 4. Gateways and stablecoin rails as event sources

### 4.1 How the large providers deliver events

| Provider | Delivery | Order | Deduplication key | Retries | Signature | States worth noting |
|---|---|---|---|---|---|---|
| **Stripe** [W11][W12] | at least once ("might occasionally receive the same event more than once") | not guaranteed; `created` is in seconds, so do not use it to order events | the event id; sometimes two Event objects are made, so also the object id plus the event type | up to 3 days with back-off in live mode; manual resend for 15 days in the Dashboard, 30 days with the CLI | `Stripe-Signature`: HMAC-SHA256 over the timestamp and the body, 5-minute tolerance | return 2xx before doing the work; idempotency keys are kept 24 h and errors are replayed |
| **Circle** [W15][W16][W17] | at least once | "can arrive in a different order"; act on the state a notification carries | `notificationId`, reused on retry | 11 retries in production, starting at 1 s (CPN docs; the full schedule was not confirmed) | `X-Circle-Signature`, ECDSA over the body, with `X-Circle-Key-Id` | `CONFIRMED`, then `COMPLETE` after the chain's confirmation threshold; a block explorer may show a transaction that is not yet `COMPLETE` |
| **Bridge** [W18][W19][W22] | not stated; the docs say "implement idempotency to handle duplicate events" | not stated; examples carry an `event_sequence` | `event_id`, "useful as an idempotency key" | not documented | `X-Webhook-Signature: t=..,v0=..`, RSA over SHA-256; the examples refuse events older than 10 minutes | `event_object_changes` gives the change since the last event; virtual-account activity goes `funds_received`, `payment_submitted`, `payment_processed` ("confirmed on-chain, final state") |
| **Coinbase Commerce** [W32] (secondary sources) | best effort with retries | — | — | up to 3 days with back-off (Hookdeck's guide) | `X-CC-Webhook-Signature`, HMAC-SHA256 | `charge:pending` (seen on chain), `charge:confirmed` (final), `charge:failed`, `charge:delayed` |
| **Razorpay**, as Frappe handles it (section 1.4) | resent until it gets a 2xx | — | `X-Razorpay-Event-Id` | Razorpay disables an endpoint that keeps failing (as the code reads it) | HMAC | refunds only |

**Lessons.**

- **Make each object's state a machine.**
  - **Keep only newer news:** apply a provider's state only when it is newer than the last one applied. The book already
    does this for Bridge: "only when newer than `bridge_updated_at`" (`books/target/banking/processes.ts:211-213`, and
    the verification process at `:100-101`).
  - **Allow repeats:** the same state arriving twice changes nothing.
- **Reply quickly and work later.**
  - **Write the delivery durably,** then answer 2xx, then process it from a queue. Stripe and Razorpay both describe
    this.
  - **When to let the provider see an error:** only if the write itself fails. Then the delivery comes back.
- **Trust a provider's "final", not its "seen":** Circle's `COMPLETE`, Coinbase's `confirmed` and Bridge's
  `payment_processed`.

### 4.2 Bridge as the edge: deposits and payouts

**A deposit on a virtual account** [W22] carries:

- the `deposit_id`;
- `amount` and `currency`;
- `developer_fee_amount`, which is Capxul's own fee and how Capxul is paid;
- `exchange_fee_amount`;
- `subtotal_amount`, the source amount less those fees;
- `gas_fee`;
- `source`, which holds the payment rail, `sender_name`, the sender's routing number and the bank's `description`;
- `destination_tx_hash`.

**How a deposit maps onto ERPNext:**

- **It is a Bank Transaction** on the Safe's account:
  - `deposit`: the amount, in the token;
  - `included_fee`: the fees;
  - `bank_party_name`: the sender's name;
  - `description`: the bank's description;
  - `reference_number`: the transaction hash.
- **It joins the chain exactly:** `destination_tx_hash` is the chain Transfer into the Safe that the book's deposit
  process waits for (`books/target/banking/processes.ts:229-262`, its wait at `:253-254`).
- **Matching to an invoice is fuzzy:** it depends on the sender's name and the description, so ERPNext's ranked matching
  and Bank Transaction Rule are the right tools.

**A payout** (crypto to fiat) [W21]:

- **The chain hop:** the money goes to Bridge's deposit address, and Bridge matches it to the transfer by the sending
  address, the receiving address and the amount.
- **The receipt:** Bridge's receipt carries `initial_amount`, `developer_fee`, `exchange_fee` and `final_amount`.

**How the industry books a payment processor** [W27]:

- The processor is the cash account the customer's payment lands in.
- The processor's fee is recorded at once as an expense, on its own line.
- The later payout to the bank is matched against the payments it bundles, by the processor's ids (Stripe's `ch_` charge
  ids).

For a Bridge payout this means:

- **The voucher pays the supplier,** not Bridge, and Bridge's fee is a deduction line. ERPNext's Payment Entry Deduction
  is the field for it (fields in `payment_entry_deduction.json`; the book's chart has 6500 Bank charges).
- **The chain shows a Transfer to Bridge.** Bridge's receipt and delivery event complete the story.
- **A bank's later return** (the book follows returns for 60 days, `banking/processes.ts:123-124`, `:158-163`) is the
  bank-world equivalent of a reorg. It arrives as a new money fact that refers back to the payout
  (`banking/processes.ts:124-128`).

**How ERPNext ties a gateway to a ledger account.** Payment Gateway Account links a gateway to a `payment_account`
(fields in `payment_gateway_account.json`). That is the "processor as an account" idea in ERPNext's own terms.

### 4.3 Custody platforms: a reference the client owns

- **Fireblocks's `externalTxId`** [W24]:
  - **It is permanent.** Fireblocks "automatically rejects all future transactions with the same ID", up to 255
    characters long.
  - **It is how clients recover from a timeout.** After an error or no answer, the docs say to look the transaction up
    by that id.
  - **It is separate from the note.** The `note` is described as "not sent to the blockchain".
- **Capxul has the same thing.** The payment id is known before signing, and the contract refuses it a second time. So
  "look up by payment id" is the recovery step after any lost answer, on both the Capxul side and the Frappe side.

### 4.4 Crypto-to-ERP integrations

- **Loop** marks the QuickBooks invoice paid once the payment confirms on chain, and "include[s] the transaction hash"
  [W28].
- **Cryptio** exports one journal entry per transaction to NetSuite and exports manual journals to Xero [W29].
- **Bitwave** pushes journal entries to NetSuite, QuickBooks and Xero, or summarized entries for high volumes [W29].
- **What we could not confirm:** whether any of them models a wallet as a bank account with a bank feed. Their product
  pages do not say.
- **The pattern they share:**
  - wait for confirmation;
  - write the transaction hash onto the ERP record;
  - post through journals.
- **What Capxul adds over them:** a commitment, made before payment, to what is being paid.

## 5. Exactly-once between two systems

### 5.1 The patterns

- **Transactional outbox** [W5]. This solves the dual write, "How to atomically update the database and send messages":
  - **Write the message in the same transaction** as the business change.
  - **A relay then publishes it.** "The Message relay might publish a message more than once", so "a message consumer
    must be idempotent". Messages go out in the order they were written.
- **Idempotency keys with atomic phases** (Brandur Leach, on Stripe's design) [W6]:
  - **Commit before reaching out:** commit local changes before any call to an outside system, because "once we make our
    first foreign state mutation, we're committed one way or another".
  - **Recovery points:** record where each request got to, so a retry continues from there.
  - **A completer:** a background process that finds requests "that look like they never finished" and pushes them
    through.
  - **A reaper:** it deletes keys after about 72 hours.
- **Idempotence makes retries safe** (Pat Helland) [W10]. "Messages may be retried. Idempotence means that's OK."
- **The end-to-end argument** (Saltzer, Reed and Clark, 1984) [W39]. Only the end points can guarantee that a transfer
  was correct and complete. Here that means: only a comparison of the chain against the books proves the books are right,
  however good the delivery in between.
- **Reconciliation as the backstop:**
  - Payment Core re-asks the provider daily (section 1.5).
  - Circle says to act on the state carried, not the arrival order [W15].
  - Coinbase guidance (secondary) says to "reconcile charge status against the API as a backstop" [W32].

### 5.2 What this means between Capxul and the Frappe site

**What the book already has.**

- **Facts are numbered.** Every money fact gets its Organization's next `seq` (`docs/design/frappe/accounting.md:139-146`).
- **Capxul pushes.** It sends `upsertDocs(..., capxul_id, capxul_version)` and advances `pushed_seq` (`:290-292`).
- **Capxul pulls.** It reads `listChanges(after pulled_change)` (`:295-300`).

This is an outbox with a cursor on each side, which is the pattern above.

**Gaps that prior art points to:**

1. **A unique key on the receiving side.**
   - **Today:** `capxul_id` "is indexed but not unique, because an amendment carries its predecessor's id"
     (`accounting.md:71-74`).
   - **Why it matters:** Payment Core relies on a database-unique key exactly to survive two deliveries at once (section
     1.5). Razorpay's handler, without one, can double-insert (section 1.4).
   - **One way out:** a mapping row with a unique `capxul_id`, pointing to the live document.
2. **Frappe's outbound side must be an outbox, not `after_commit`** (section 1.4).
3. **A completer and a reaper.** A scheduled job should find Capxul payments that are past finality and still not
   posted in Frappe, and Frappe drafts that are still not submitted, and push them through or flag them. This is Brandur's
   completer and Payment Core's daily re-check.
4. **Reconciliation that proves the books,** run continuously. For each Safe and token:
   - the on-chain balance at block N equals the GL balance of the Safe's account up to N's time;
   - every `PaymentSent` and every Transfer touching the Safe is either on a voucher or is an unreconciled Bank
     Transaction;
   - every Bridge receipt matches a Bank Transaction.

   The chain makes this check cheap and exact. No bank-rail integration above can do as well.

## 6. Finality and reorgs on Base

**Base's own stages** [W20]:

1. **About 200 ms:** the sequencer builds the block. "Less than 0.00000002% of transactions have ever reorged."
2. **About 2 minutes:** the batch is posted to Ethereum. "There has never been a reorg of L2 blocks that were batched to
   Ethereum L1." Base can repost batch data after an Ethereum reorg without changing the L2 blocks.
3. **About 20 minutes:** the batch is older than two epochs (64 Ethereum blocks) and "in practice impossible to reverse".

Withdrawals to Ethereum are a separate 5-day window, or 1 day on the dual-proof path. They do not affect finality on
Base.

**The OP Stack's terms** [W26]:

- **Unsafe:** the sequencer can still "reorg the transaction away".
- **Safe:** the data is on Ethereum. Nodes "will downgrade "safe" transactions to "unsafe" if needed" when Ethereum
  reorgs.
- **Finalized:** finality is hard, and the block is safe even from those reorgs.
- **How to read them:** the RPC exposes all three through the block tags `safe` and `finalized`, and through
  `optimism_syncStatus` [W40].

**What operators wait for:**

- **Circle Mint:** 12 Ethereum blocks for Base, about 3 to 9 minutes, "because" Layer 2 chains also wait for Ethereum
  blocks after the batch [W17].
- **Circle Wallets:** each chain's own threshold before `COMPLETE` [W16].

**Ponder.**

- **What "finalized" means to Ponder:** `getFinalizedBlock` treats as final the newest block whose timestamp is more than
  the chain's `reorgWindow` behind the head. `DEFAULT_REORG_WINDOW = 180` seconds (`packages/core/src/utils/finality.ts`
  on `main`, read 9 November 2026 [W25]).
- **Base Sepolia:** finality there is minutes (`books/target/indexing/decisions.ts:257-274`).
- **On Base mainnet,** 180 seconds is past stage 2 but well short of stage 3.
- **Who decides:** the book already makes finality the reader's choice, "at the deployment's finality depth"
  (`books/target/indexing/decisions.ts:257-274`; `books/target/shared/external.ts:185`, `:208`). The pinned Ponder
  version should be checked against this source.

**Lessons.**

- **Name the stage behind "the chain says so"** for Base: the `safe` tag (about 2 minutes, never reorged once batched)
  or the `finalized` tag (about 20 minutes). Do not leave it to Ponder's time window. Circle Mint's practice sits near
  `safe` and above.
- **A reorg after posting is a cancel.** ERPNext reverses the GL entries, and with the immutable ledger the reversal is
  dated on the day of the cancel (section 2.5). The book already reopens and reverses on a reorg (`v4.md` section 5,
  citing `books/target/payments/data.ts:445-450`).
- **Use flashblocks and unsafe blocks only for display.** Base says to confirm critical operations against finalized
  data [W20].

## 7. Stablecoins in the accounts

- **US GAAP (proposed).** FASB issued a proposed update on 18 August 2026 to Topic 230; comments are due 19 November 2026
  [W33][W34]. It adds examples rather than changing the definition of a cash equivalent. A stablecoin may be a cash
  equivalent only with all three of:
  1. an on-demand contractual right to redeem for cash, with no significant fees or restrictions;
  2. a direct redemption right with the issuer, for a known amount of cash;
  3. segregated reserves held 1:1 in short-term, highly liquid assets.

  **It is an accounting policy choice,** not a requirement.

  **Intermediaries do not count.** "The Board noted that intermediary relationships introduce additional counterparty
  credit risk". The Board judged indirect redemption, such as redeeming USDC through Coinbase, "would not be appropriate"
  [W34]. So a company that holds USDC in a Safe and redeems only through Bridge may not meet the second test.

  **The GENIUS Act** also says a payment stablecoin not issued by a permitted issuer shall not be treated as cash or a
  cash equivalent for accounting purposes [W34].
- **IFRS.** In June 2019 the IFRS Interpretations Committee decided that a cryptocurrency holding is not cash and not a
  financial asset. It is an intangible asset (IAS 38), or inventory (IAS 2) when held for sale in the ordinary course,
  because it "does not give the holder a right to receive a fixed or determinable number of units of currency" [W35].

  A stablecoin with a redemption right is different: the key question becomes whether it is a financial asset under
  IFRS 9. That turns on whether the redemption right is real, given restrictions, issuer discretion and minimum
  redemption sizes [W36].
- **Operational practice.**
  - **Gateways and wallets:** Stripe and Xero treat the processor's account as a bank-type account [W27], and the
    crypto-to-ERP tools above post wallet movements through journals [W29].
  - **The book's design:** one Safe account per token, of type Bank, in the token's own currency, frozen so only
    Capxul's app user can post (`docs/design/frappe/accounting.md:125-128`). That is consistent with this practice.

**Lesson.**

- **Keep the Bank-type account per Safe and token,** because ERPNext's bank tools (Payment Entry, Bank Transaction,
  reconciliation, clearance) need it.
- **Do not hard-code "cash equivalent" anywhere.** The balance-sheet line is the company's policy election, and under the
  US proposal it depends on the company's own redemption rights.
- **Show the pricing.** Books' USD pricing at the block (`v4.md` section 6) is the fair-value input either treatment
  needs.

## 8. What prior art does not answer

- **No standard hashes an ERP document for a payment to commit to.** ISO 20022 and EDI 820 carry the remittance in clear
  over private rails. Request Network commits to a request, not to invoice lines. Section 3.4 is a synthesis, not a copy.
- **No crypto-to-ERP product we found treats the chain as a bank statement** for ERPNext's own reconciliation tool.
  Section 2.3 is an inference from ERPNext's code, not a pattern seen elsewhere.
- **Bridge's delivery and retry guarantees are not documented** [W18][W19]. Design for at-least-once and unordered
  delivery, and re-check Bridge's API, as Payment Core does with its providers.
- **The fiat leg of a Bridge payout has no chain proof.** Only Bridge's events and receipt evidence delivery. A bank's
  return is the only reversal, and it can come weeks later (`books/target/banking/processes.ts:123-124`, `:158-163`).
- **Whether `frappe/payments`' version-2 `PaymentController` lands upstream** is unconfirmed [W37]. Payment Core [W38] is
  third-party.

## Sources

**Local code** (commits in the header):

- `frappe/payments`: Stripe, Razorpay (with `webhook.py`), PayPal, GoCardless, M-Pesa and the hooks.
- ERPNext: Payment Request, Payment Entry, Payment Entry Reference, Payment Entry Deduction, Payment Ledger Entry,
  Unreconcile Payment, Journal Entry, Bank Transaction, Bank Transaction Rule, the Bank Reconciliation Tool, Payment
  Gateway Account, `general_ledger.py`, and the Plaid integration.
- Frappe: `integrations/utils.py`, Integration Request, the Webhook doctype and `hooks.py`.
- HRMS: Payroll Entry.
- Payment Core: `webhooks.py`, `status_flow.py`, `tasks.py`, `utils.py`, `api/gateway.py` and the Payment Transaction
  doctype.
- v4: `money/Payments.sol` and `interfaces/IPayments.sol`.

**Web** (read 9 November 2026):

- [W1] ERC-7699: ERC-20 Transfer Reference Extension (Draft) — https://eips.ethereum.org/EIPS/eip-7699
- [W2] ERC-7699 discussion — https://ethereum-magicians.org/t/erc-7699-erc20-transfer-reference-extension/19826
- [W3] Request Network, ERC20 Fee Proxy payment network spec 0.1.0 — https://raw.githubusercontent.com/RequestNetwork/requestNetwork/master/packages/advanced-logic/specs/payment-network-erc20-fee-proxy-contract-0.1.0.md
- [W4] Request Network, How payment networks work — https://docs.request.network/advanced/protocol-overview/how-payment-networks-work
- [W5] Chris Richardson, Pattern: Transactional outbox — https://microservices.io/patterns/data/transactional-outbox.html
- [W6] Brandur Leach, Implementing Stripe-like Idempotency Keys in Postgres — https://brandur.org/idempotency-keys
- [W7] Ripple, ISO 20022 `RfrdDocInf` (structured remittance, `LineDtls`) — https://docs.ripple.com/products/payments-odl/api-docs/ripplenet/resources/srpo/supporting-info-properties/rfrddocinf
- [W8] Stedi, X12 820 Payment Order/Remittance Advice — https://www.stedi.com/edi/x12-006010/820
- [W9] 3M, EDI 820 guideline (RMR per invoice, ADX) — https://www.3m.com/about3m/ec/guidelines/820.pdf
- [W10] Pat Helland, Idempotence Is Not a Medical Condition, ACM Queue 10(4), 2012 — https://dl.acm.org/citation.cfm?id=2187821
- [W11] Stripe, Receive Stripe events in your webhook endpoint — https://docs.stripe.com/webhooks
- [W12] Stripe, Idempotent requests — https://docs.stripe.com/api/idempotent_requests
- [W13] Bridge, Idempotence — https://apidocs.bridge.xyz/api-reference/introduction/idempotence
- [W14] Bridge, Create a transfer — https://apidocs.bridge.xyz/api-reference/transfers/create-a-transfer
- [W15] Circle, Webhook notifications — https://developers.circle.com/wallets/webhook-notifications ; CPN webhook retries — https://developers.circle.com/cpn/concepts/webhooks/webhook-retries
- [W16] Circle, Blockchain confirmations (Wallets) — https://developers.circle.com/wallets/blockchain-confirmations
- [W17] Circle Mint, Blockchain confirmations — https://developers.circle.com/circle-mint/references/blockchain-confirmations
- [W18] Bridge, Webhook event structure — https://apidocs.bridge.xyz/platform/additional-information/webhooks/structure
- [W19] Bridge, Setting up webhooks — https://apidocs.bridge.xyz/get-started/introduction/quick-start/setting-up-webhooks
- [W20] Base, Transaction finality — https://docs.base.org/base-chain/network-information/transaction-finality
- [W21] Bridge, Transfers — https://apidocs.bridge.xyz/platform/orchestration/transfers/transfer
- [W22] Bridge, Onramp with virtual accounts — https://apidocs.bridge.xyz/get-started/guides/move-money/virtualaccounts
- [W23] Bridge, Liquidation address — https://apidocs.bridge.xyz/platform/orchestration/liquidation_address/liquidation_address
- [W24] Fireblocks, Create a new transaction (`externalTxId`) — https://developers.fireblocks.com/reference/createtransaction ; Idempotency key and externalTxId best practices — https://support.fireblocks.io/hc/en-us/articles/15109492473500-Idempotency-key-and-externalTxId-usage-best-practices
- [W25] Ponder, `packages/core/src/utils/finality.ts` (main) — https://raw.githubusercontent.com/ponder-sh/ponder/main/packages/core/src/utils/finality.ts
- [W26] Optimism, Transaction finality — https://docs.optimism.io/op-stack/transactions/transaction-finality
- [W27] Stripe Support, Payouts and reconciliation with Xero and Stripe — https://support.stripe.com/questions/payouts-and-reconciliation-with-xero-and-stripe
- [W28] Loop, Xero + Loop — https://loop-crypto.gitbook.io/old-loop-crypto/integrations/xero-+-loop
- [W29] Cryptio for NetSuite — https://cryptio.co/solutions/netsuite ; Cryptio on the Xero App Store — https://apps.xero.com/us/function/reporting/app/cryptio ; Bitwave, How to connect NetSuite — https://docs.bitwave.io/docs/how-to-connect-netsuite
- [W30] Base, commerce-payments `AuthCaptureEscrow.sol` — https://raw.githubusercontent.com/base/commerce-payments/main/src/AuthCaptureEscrow.sol
- [W31] Coinbase, commerce-onchain-payment-protocol `ITransfers.sol` — https://raw.githubusercontent.com/coinbase/commerce-onchain-payment-protocol/master/contracts/interfaces/ITransfers.sol
- [W32] Hookdeck, Guide to Coinbase webhooks (secondary) — https://hookdeck.com/webhooks/platforms/guide-to-coinbase-webhooks-features-and-best-practices ; Coinbase Commerce webhooks overview — https://docs.cloud.coinbase.com/commerce/docs/webhooks
- [W33] Forvis Mazars, FASB's Stablecoin Proposal on Cash Equivalent Classification (1 October 2026) — https://www.forvismazars.us/forsights/2026/10/fasb-s-stablecoin-proposal-on-cash-equivalent-classification
- [W34] The Network Firm, Are Stablecoins Cash Equivalents? Inside FASB's 2026 Proposed ASU — https://www.thenetworkfirm.com/blog/stablecoins-cash-equivalents-fasb-proposed-asu
- [W35] IFRS Interpretations Committee, Holdings of Cryptocurrencies (June 2019) — https://www.ifrs.org/content/dam/ifrs/supporting-implementation/agenda-decisions/2019/holdings-of-cryptocurrencies-june-2019.pdf
- [W36] KPMG, Q&A: cryptoassets, stablecoins (IFRG 2026) — https://kpmg.com/xx/en/our-insights/ifrg/2026/qa-cryptoassets-stablecoins.html ; ICAEW, How are stablecoins taxed — https://www.icaew.com/insights/viewpoints-on-the-news/2025/nov-2025/how-are-stablecoins-taxed
- [W37] ERPNext pull request #51723 (v2 gateway support, depends on frappe/payments #192) — https://github.com/frappe/erpnext/pull/51723
- [W38] Frappe Forum, Introducing Payment Core and Stripe Payment for Frappe and ERPNext (24 October 2026) — https://discuss.frappe.io/t/introducing-payment-core-and-stripe-payment-for-frappe-and-erpnext/165361
- [W39] J. H. Saltzer, D. P. Reed, D. D. Clark, End-to-End Arguments in System Design, ACM TOCS 2(4), 1984 — https://web.mit.edu/Saltzer/www/publications/endtoend/endtoend.pdf
- [W40] OnFinality, Base and OP Stack finality: safe and finalized blocks over RPC — https://onfinality.io/en/learn/base-op-stack-finality-safe-finalized-blocks-rpc

**Caveats on the sources.**

- **Secondary sources:** [W32] (Coinbase Commerce retry details), [W33] and [W34] (summaries of the FASB proposal; the
  exposure draft itself was not read), [W36] (the ICAEW part), and [W29] (product pages).
- **Read through a summarizing fetch:** the ISO 20022 element names come from Ripple's rendering of the schema [W7], and
  the EDI 820 details from implementation guides [W8][W9], not from the ISO or X12 standards themselves.

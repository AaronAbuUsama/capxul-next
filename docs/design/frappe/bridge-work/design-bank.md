# Bank-first: each Safe is a bank account, and the chain is its statement

A from-scratch design for the payments bridge (`aaron.frappe-native`, 9 November 2026). It is one of several independent
designs. This one is **bank-first**: Capxul behaves as a bank, the chain is that bank's statement, and Frappe books from
the statement the way any ERP books from a bank. Nothing in the book or in any repository was edited.

Aaron's question: "Some of the contracts may have to change. Do they or not? How do we sync between a Capxul payment
event and a Frappe payment event? Our Capxul events may be naive and may not fully fit the shape. If we were building
this from scratch, how would we do it?"

The rulings this design obeys, in `blueprint/shared/rulings.ts`:

- `aaron.frappe-native` (:667-694). Frappe keeps the business records. Capxul keeps Safes, budgets, payments and
  escrow. Every movement of a Safe's money goes through Capxul, and Frappe never marks money moved until the chain says
  so.
- `aaron.one-product` (:696-714). There is no Frappe to anyone: every name, message and error says Capxul.
- `aaron.other-accounts` (:716-740). Other bank accounts are allowed and reconciled the usual way. Safes and Bridge are
  the default path.
- `aaron.departments` (:405-427). A budget belongs to a department, and whoever wears its hat now acts for it.
- `aaron.escrow-general` (:379-403). The general escrow: the recipient's future account claims it, and the sender
  takes it back until then.
- `aaron.world-clock` (:501-524). Everything in a world follows its one clock.
- `aaron.sdk-reaches-everything` (:526-547). The SDK and the CLI reach everything.

## Sources and how to read the citations

| Prefix | What | Commit |
|---|---|---|
| `v4/` | `/home/user/factory/packages/contracts/v4/src/` | factory `0d2be303e` |
| `pv4/` | `/home/user/factory/docs/planning/protocol-v4/` | the same |
| `en:` | ERPNext, `/tmp/erpnext` (paths from the repository root) | `6b946b0` |
| `hr:` | Frappe HR, `/tmp/hrms` (a sparse checkout, read with `git show`) | `8816102` |
| `fr:` | Frappe, `/tmp/frappe` (a sparse checkout, read with `git show`) | `1a7ea57` |
| no prefix | the book, `/home/user/capxul-next/` | working tree, 9 November 2026 |
| `frappe.md`, `v4.md`, `prior-art.md` | the three research notes beside this file | 9 November 2026 |

Every claim about code cites a file and line. A claim cited to a research note was checked by that note's author
against the code. Each design choice is marked as a decision, with an id in `bank.*`, so a later book pass can record
it.

---

## The answer

### From scratch: Capxul is the bank, and the chain is its statement

Banks and ERPs settled long ago how a payment made outside the ERP becomes the ERP's payment. They keep two questions
apart (`prior-art.md:24-33`):

1. **Did money move?** The bank's statement answers. An ERP never books a bank account on its own say-so; it
   reconciles the account to the statement.
2. **What does it pay?** The remittance advice answers: which invoices, which lines, what tax, what deductions.

Capxul fits that split better than any bank does:

- **Capxul is the payment engine.** It runs approvals, Budgets and Payments.
- **The chain is the statement.** Every movement of a Safe's tokens is an ERC-20 Transfer. The statement is complete,
  ordered, final and impossible to forge.
- **The payment id is the end-to-end id.** It is a hash of every term, known before anyone signs, and it pays at most
  once, forever (`v4/money/Payments.sol:59-67`, `:80-95`).
- **The document hash is the remittance advice's fingerprint.** It is bound into the id, so it cannot change once the
  id is fixed (`v4/money/Payments.sol:56`, `:80-95`).
- **Frappe is the ERP.** It books from the statement and applies cash using the advice.

So the design is:

1. **Every Safe, per token, is a Bank Account in Frappe.** So is **Money waiting**, which holds the Organization's open
   escrows, and **Payouts in transit**, which is Bridge. The company's other bank accounts are ordinary Bank Accounts
   beside them.
2. **The chain is the bank feed.** At finality, every Transfer that touches a Capxul account becomes one submitted
   Bank Transaction (a statement line). Only the Capxul app writes these lines. Each is keyed by its chain occurrence
   and carries the payment id as its reference.
3. **Capxul's commands move money and attach references.** Before anyone signs, Capxul writes the payment order into
   Frappe as a **Capxul Payment**, named by its payment id. It holds the advice whose hash goes on chain. Nothing posts
   at this point.
4. **Reconciliation books the payment.** A statement line whose reference names a Capxul Payment is booked in the same
   database transaction that writes the line. The voucher the advice describes is created from the line and reconciled
   to it, through ERPNext's own "create a voucher and reconcile" path (`en:erpnext/accounts/doctype/bank_reconciliation_tool/bank_reconciliation_tool.py:979-1018`;
   `en:erpnext/accounts/doctype/bank_transaction/bank_transaction.py:156-174`).

   A line with no Capxul Payment waits in the reconciliation queue. That covers Bridge deposits, outside transfers and
   direct Board transfers. ERPNext's own tools match these, or the Capxul payment reference printed on the invoice does.
5. **A Capxul account's ledger is the sum of its statement lines, and nothing else.** That is what "Frappe never marks
   money moved until the chain says so" means here, and it can be checked: for each Capxul account,
   GL balance = Σ statement lines = `balanceOf` at that block.

### Do the contracts change? No.

**Payments, Budgets and Agreements do not change.** Escrow changes only as Aaron already ruled (`aaron.escrow-general`,
`docs/design/escrow.md`). Bank-first asks nothing more of the escrow.

Bank-first needs only three things from the chain, and v4 already gives all three:

- **Every movement as a Transfer.** The token emits one.
- **An exact reference on every Capxul payment.** `PaymentSent.paymentId` is indexed, and each item has its own, even
  inside a batch (`v4/interfaces/IPayments.sol:23-31`; `v4/money/Payments.sol:42-46`, `:77`).
- **A commitment to what the payment pays.** `documentHash` is never zero and is bound into the id
  (`v4/money/Payments.sol:56`, `:80-95`).

Everything `v4.md` calls naive is supplied off chain, by the advice and by Frappe: no allocation, no partial payment,
no fee, no currency, no tax, no batch structure (`v4.md:377-458`). Section 4 lists what is lost without a contract
change, and the smallest optional changes if Aaron wants them.

### How a Capxul payment event and a Frappe payment event stay one

They are not two events kept in step. There is one payment, with one identity, the payment id, and two flows:

- **Intent flows down:** a Frappe document, then a Capxul command, then the advice, then the chain.
- **Facts flow up:** the chain, then the statement line, then the voucher.

The money fact always comes from the chain. Frappe's voucher is derived from it, never the other way round. Exactly
once rests on four things (section 1.6):

- unique names in Frappe: the Capxul Payment is named by its payment id, and each statement line by its chain
  occurrence;
- an ordered per-Organization feed, read by a cursor;
- writes that are idempotent;
- a completer that compares the chain with the books every day.

### What the document hash commits to, in short

It commits to an EIP-712 **payment advice** (section 2) that holds:

- a salt;
- both parties;
- the token and raw amount;
- the amount in the currency of the documents paid, with the exact rate the payer applied;
- one allocation per document. Each allocation names the document by Capxul's stable id and by its issued number and
  date, the hash of its exact version's content, the payment term, the amount it takes off the outstanding, and,
  optionally, the lines it pays with their tax by type and the document's adjustments with reason codes;
- payment-level adjustments, such as a rail's fee;
- an amount on account;
- a memo;
- the payment it refunds;
- the route, including a Bridge payout's real payee, its bank amount and its fee;
- the payment's place in a batch.

Both systems can then prove that "this payment pays these lines of these documents" by hashing the stored advice and
re-hashing their own documents.

---

## 1. The model

### 1.1 The accounts

| Frappe Bank Account | GL account | Its statement | Who writes the statement |
|---|---|---|---|
| **Safe · token**, one per Safe and token (the company Safe's USDC is "Treasury · USDC") | type Bank, in the token's currency, frozen (`docs/design/frappe/accounting.md:125-128`) | every Transfer of that token into or out of the Safe | the Capxul app, from the chain at finality |
| **Money waiting · token** | type Bank, the token's currency | every Transfer into or out of an escrow whose `sender` is this Organization's Safe | the Capxul app, from the chain |
| **Payouts in transit · fiat currency** | type Bank, the fiat currency | Bridge's transfer events: funded, delivered, returned | the Capxul app, from Bridge's events |
| **Any other bank** (the company's ordinary accounts) | type Bank, as usual | the bank's statement: imported, or from a feed | ERPNext as usual (`aaron.other-accounts`) |

Decision `bank.safe-is-a-bank`. It reverses the book's choice to leave Bank Transaction and the Bank Reconciliation
Tool out (`docs/design/frappe/accounting.md:76-77`, `:401`). With other accounts allowed, those tools come back anyway
(`frappe.md:60-64`). The Safes then use the same tools and the same screen.

Two clarifications:

- **Department budgets are not bank accounts.** A department's money stays in the company Safe. A budget is spending
  authority on chain (`v4/money/Budgets.sol:206-232`). In Frappe a department is a Department plus a Cost Center,
  linked to its budget id (`docs/design/frappe/payroll.md:127-129`).
- **Money waiting** is decision `bank.money-waiting`. It reverses `books.escrow-held`
  (`blueprint/books/decisions.ts:1427-1458`), which posted nothing while money waited. Under bank-first the
  Safe's statement shows the money leaving at funding, so the ledger must show it too. The money is still the
  company's, because the sender can take it back (`docs/design/escrow.md:62`, G6). That decision's own rejected
  option, a clearing account, is what bank-first needs.

### 1.2 The statement: one line per finalized Transfer

The Capxul app writes one submitted Bank Transaction per Transfer log, per Capxul account the log touches. For a
transfer between two of the Organization's own Capxul accounts, such as Treasury to Money waiting, one log makes two
lines. It writes the line once the log reaches the deployment's finality (decision `bank.finality`, section 5).

| Field | Value |
|---|---|
| `bank_account`, `currency` | the Capxul account; its token, which must equal the account's currency (`en:erpnext/accounts/doctype/bank_transaction/bank_transaction.py:67-84`) |
| `date` | the block's day in the Company's time zone |
| `deposit` / `withdrawal` | the amount at Frappe's precision |
| `reference_number` | the payment id when a PaymentSent pairs with the Transfer. Otherwise the escrow's payment id for an escrow refund or surplus, Bridge's reference for a deposit (section 3, P10), and else the transaction hash. |
| `transaction_id` | `<chain id>:<tx hash>:<log index>`, which is read-only (`bank_transaction.json:130`) |
| `description` | Capxul's line text. For a Bridge deposit, Bridge's text. |
| `bank_party_name`, `bank_party_account_number` | the counterparty's Capxul name and its address |
| `party_type`, `party` | the counterparty's Customer, Supplier or Employee, when the directory knows its Party |
| `included_fee` | a Bridge deposit's fees |
| Custom Fields | `capxul_chain_ref` (unique: see 1.6), `capxul_amount_raw`, `capxul_block_number`, `capxul_block_time`, `capxul_payment_id`, `capxul_document_hash`, `capxul_budget_id` (from the sibling `Spent`, `ScheduledPaid` or `ReservedPaid`, `v4/money/Budgets.sol:231`, `:299`, `:340`), `capxul_actor_safe` (from the transaction's `UserOperationEvent`, `v4.md:231`), `capxul_line_kind` (`payment`, `deposit`, `escrow_refund`, `escrow_surplus`, `bridge`, `movement`) |

**Pairing a Transfer with its PaymentSent.** Payments moves the tokens and then emits PaymentSent for the same item
(`v4/money/Payments.sol:69`, `:77`). So within a transaction, each PaymentSent pairs with the nearest earlier Transfer
of its token from its sender to its recipient for its amount. Two identical items in one batch pair in log order.
Both are still distinct payments with distinct ids.

**A Transfer from an address to itself moves nothing.** No line is written for it. A PaymentSent whose recipient is its
sender reports an amount that never moved (`v4/money/Payments.sol:71-75`). It has no Transfer that changes a balance,
so it never posts. Capxul also refuses to prepare one.

### 1.3 The Capxul Payment: the payment order and its advice

The Capxul app adds one doctype, **Capxul Payment**, shown to users as "Payment" (`aaron.one-product`). Its name is the
payment id. Frappe's `field:` autoname makes the field the primary key (`fr:frappe/model/naming.py:220`), so one
payment id can never have two rows.

| Field | Holds |
|---|---|
| `payment_id` (the name), `document_hash` | the chain identity |
| `item` | the PaymentItem exactly as sent: recipient, token, `amount_raw`, kind, the job nonce given to Payments (for a budget spend, `keccak256(Budgets, budgetId, callerNonce)`, `v4/money/Budgets.sol:229`) and the executor. With it, anyone can recompute the id (`v4/money/Payments.sol:80-95`), which the log alone does not allow (`v4.md:119-121`). |
| `advice` | the canonical bytes of the advice (section 2), as `documents.store` keeps them (`blueprint/documents/data.ts:76-90`) |
| `allocations` (child table) | one row per allocation in the advice: `reference_doctype`, `reference_name`, `payment_term`, `allocated_amount`, the content hash, and the lines. The invoice's Connections tab shows the payment in flight. |
| `adjustments` (child table) | the advice's adjustments, each mapped to a Company account role |
| `route` | `direct`, `board`, `budget`, `schedule`, `escrow`, `bridge_payout`, `collection` or `inbound`; with `budget_id`, `pay_at`, `escrow_address`, `funding_payment_id` (unique), `payout_id` |
| `classification` | for a payment with no document (a memo, or money on account): account, cost centre and project. This is the payer's own books choice, so it is not hashed. |
| `status` | Prepared, Scheduled, Needs retry, Escrowed, In transit, Settled, Cancelled, Mismatched |
| `voucher_type`, `voucher`, `generation`, `statement_lines` | the live voucher and the line or lines it is reconciled to |
| `prepared_by` (the asker's User), `signed_by` (the Safe), `approval_id` | who caused it (section 6) |

Capxul writes the row at prepare, in the same step that stores the advice and opens the approval. Users can only read
it. Its permission and a `validate` hook admit only the Capxul app's user.

Decision `bank.payment-order`. The draft-voucher alternative was weighed and rejected. A draft Payment Entry is
ERPNext's own "written, waiting for the money" state, used by Frappe HR for payroll
(`hr:hrms/payroll/doctype/payroll_entry/payroll_entry.py:817-862`, `submit_journal_entry=False` at `:825`). But:

- **A draft is editable.** A user can change its references away from what the hash committed to.
- **A draft is not a statement match.** ERPNext matches lines only to submitted, uncleared vouchers
  (`bank_reconciliation_tool.py:1608`, `:1610`).
- **Submitting it early would break the ruling.** A voucher submitted before the chain speaks posts the Safe's GL early.

A read-only order, from which the voucher is created when the line arrives, has none of these problems. It also holds
what Frappe cannot hold: lines, tax per payment and the route.

### 1.4 The match: an exact reference becomes the voucher

When a statement line arrives, the Capxul app's matcher runs in the same database transaction as the line's insert.
The line's reference is either a payment id or a funding id. For a Bridge or escrow line it is the id the sibling
event or Bridge's record names.

1. **Lock and check the Capxul Payment.** It locks the Capxul Payment by name and checks the chain terms: the
   recompute of the id, the document hash, the recipient, the token and the raw amount, as payments' settle guard does
   (`blueprint/payments/data.ts:431-436`). If they differ, the payment is Mismatched, the line stays Unreconciled,
   and nothing posts.
2. **Build the voucher the advice describes** (table below), with these fields:
   - posting date = the line's date;
   - `reference_no` = the payment id (66 characters; the field holds 140, `prior-art.md:345-347`);
   - `reference_date` = the line's date;
   - for a budget payment, the cost centre is the department's;
   - the Custom Fields `capxul_payment_id`, `capxul_document_hash` and `capxul_chain_ref`.
3. **Insert, submit and reconcile it to the line** through ERPNext's own path. The app inserts and submits the voucher,
   then calls `_reconcile_vouchers(line, [voucher], is_new_voucher=True)`
   (`bank_reconciliation_tool.py:1251-1262`). The line then:
   - records the voucher with reconciliation type `Voucher Created` (`bank_transaction.py:173`);
   - sets the voucher's `clearance_date` to the line's date (`bank_transaction.py:480`);
   - becomes Reconciled.

   The public `create_payment_entry_and_reconcile` does the same, but it resets both exchange rates from stored
   Currency Exchange rows (`bank_reconciliation_tool.py:1021-1045`). The app uses its own rates (section 3, P17).
4. **Settle the Capxul Payment** (status Settled, `voucher`, `generation`).

| What the advice allocates to, or the route | The voucher made from the line |
|---|---|
| Purchase Invoice, Purchase Order (as an advance), or a payable Journal Entry | Payment Entry **Pay**, party Supplier |
| Sales Invoice, Sales Order or Dunning (money in) | Payment Entry **Receive**, party Customer |
| Expense Claim, Employee Advance, Leave Encashment or Gratuity | Payment Entry **Pay**, party Employee (`hr:hrms/overrides/employee_payment_entry.py:22-30`) |
| Salary Slip | Journal Entry **Bank Entry**: Dr Payroll Payable (party Employee, reference Payroll Entry), Cr the bank account, `cheque_no` = the payment id. No Payment Entry may reference a Payroll Entry (`frappe.md:168-173`). |
| A refund of an earlier payment (`refundOf`) | Payment Entry **Receive** from the party, referencing the original Payment Entry (Supplier and Customer may reference Payment Entry, `en:erpnext/accounts/doctype/payment_entry/payment_entry.py:869-875`), or the return document |
| A transfer between two of the company's own accounts (escrow funding and refund, Treasury to Payouts in transit, a Safe and an outside bank) | Payment Entry **Internal Transfer**, reconciled to both sides' lines |
| A memo, or money on account | Journal Entry **Bank Entry** against the Capxul Payment's classification; or a Payment Entry to the party with the amount unallocated |
| No Capxul Payment | nothing automatic: the line stays Unreconciled (below) |

**Lines with no Capxul Payment** are ERPNext's ordinary queue:

- ERPNext's party matching by account number or name (`bank_transaction.py:309-330`);
- its ranked matching (`bank_reconciliation_tool.py:1369-1412`);
- Bank Transaction Rules;
- a person creating the voucher from the line.

The voucher a person creates is also `Voucher Created`, so G2 below still holds. One more rule runs on the lines of
every bank account, Capxul's or not: **a line whose reference is an invoice's Capxul payment reference** (section 3,
P10) matches that invoice exactly.

**When an allocation no longer fits.** Between prepare and finality an invoice can lose outstanding, for example when
it is paid from another account. ERPNext then refuses the allocation at submit (`payment_entry.py:446-601`). The
money has already moved, so the matcher never refuses the line:

- it allocates what still fits;
- it leaves the rest unallocated as an advance to the party;
- it records the difference against the advice on the Capxul Payment.

This follows `prior-art.md:478-488`: the payer's advice is not the payee's books, so show the difference and never
overwrite it.

### 1.5 "Frappe never marks money moved until the chain says so", as guards

Freezing an account is not enough. The site's Administrator holds every role, so the guards are hooks that check
facts, not roles (`frappe.md:527-536`). The Capxul app enforces these:

- **G1. Only the Capxul app writes statement lines on a Capxul account.** A `before_insert` hook refuses any other
  writer. That includes ERPNext's statement import and the Plaid feed for these accounts.
- **G2. Every GL line on a Capxul account is backed by the statement.** A Payment Entry or Journal Entry with a line on
  a Capxul account submits only if, in the same request, it is reconciled `Voucher Created` to a submitted line of that
  account for the same amount.

  ERPNext's tool endpoints that create a voucher from a line are wrapped with `override_whitelisted_methods`
  (`fr:frappe/__init__.py:1491`), so a person's classification of an unexplained line passes this guard and nothing
  else does. Those endpoints are `create_payment_entry_bts`, `create_journal_entry_bts`, `create_internal_transfer`
  and `create_payment_entry_and_reconcile` (`bank_reconciliation_tool.py:172`, `:338`, `:570`, `:980`).
- **G3. No other document may pay into or out of a Capxul account.** On a Capxul account the hooks refuse Purchase
  Invoice `is_paid`, Sales Invoice `is_pos`, Expense Claim `is_paid` and Payment Order (`frappe.md:515-525`). They
  also refuse both of Payment Request's "paid" paths: the gateway path books a Payment Entry dated today, and the
  phone path marks Paid with no entry at all (`en:erpnext/accounts/doctype/payment_request/payment_request.py:599-689`, `:603-605`).
- **G4. Payroll Entry.** On a Capxul payment account, Make Bank Entry is refused (Capxul pays). Once any of a run's
  slips has a settled Capxul Payment, cancelling the run is refused, because the cancel would also cancel the bank
  entries (`hr:hrms/payroll/doctype/payroll_entry/payroll_entry.py:168-245`).
- **G5. A document cannot be cancelled while a Capxul Payment is in flight against it** (Prepared, Scheduled,
  Escrowed or In transit). A settled one stays protected by `unlink_payment_on_cancellation_of_invoice` off
  (`docs/design/frappe/accounting.md:369-372`).
- **G6. Only the Capxul app may cancel or unreconcile a voucher reconciled to a Capxul line,** and it does so only on a
  reorg (P15) or a return (P11).
- **G7. Allocation-only changes after settlement are allowed.** Payment Reconciliation and Unreconcile Payment work as
  in ERPNext (`en:erpnext/accounts/utils.py:518-589`, `:746-823`). They never touch the Capxul account's line. The
  Capxul Payment shows any difference from the advice.

  This replaces the book's cancel-and-amend for every recategorization
  (`docs/design/frappe/accounting.md:227-240`). The only line ERPNext cannot change in place is the bank line, and that
  is the one line that must not change.

### 1.6 Exactly once

| Key or mechanism | What it guards |
|---|---|
| **K1. The Capxul Payment is named by its payment id.** | A second open writes nothing. A different advice under the same id cannot exist, because the id binds the hash. |
| **K2. `capxul_chain_ref`** = `<chain id>:<block hash>:<tx hash>:<log index>:<account address>`, a unique Custom Field (`fr:frappe/custom/doctype/custom_field/custom_field.json:265`) | One line per occurrence per account. The block hash is in the key, so a transaction re-included after a reorg is a new line, while the cancelled line keeps its key. `transaction_id` is not unique (`bank_transaction.json:130`). Plaid only checks before it inserts (`en:erpnext/erpnext_integrations/doctype/plaid_settings/plaid_settings.py:315-317`). |
| **K3. One live voucher per Capxul Payment** | The matcher locks the Capxul Payment row (`SELECT … FOR UPDATE`), as Payment Core does when a webhook races a redirect (`prior-art.md:244-247`). `voucher` and `generation` name the live one. |
| **K4. One Frappe database transaction per chain transaction** | All of a transaction's lines post together or not at all: a payroll run's N lines, or an escrow funding's two sides. |
| **K5. An ordered feed** | Capxul numbers every money fact per Organization with `seq`, gap-free under a row lock (`docs/design/frappe/accounting.md:139-146`). The push carries the seq, and the app keeps `last_seq`. A seq that arrives early waits. A repeated one changes nothing. |
| **K6. The completer** | It runs daily and whenever the site rings. For every Capxul account and block B it checks three things: `balanceOf` at B equals the raw sum of the lines through B; the GL balance equals the sum of the lines; and every Capxul Payment settled on chain has exactly one reconciled voucher. It re-pushes what is missing and flags the rest. This is Payment Core's daily re-check, where "the provider's answer wins" (`prior-art.md:241-243`), with the chain as the provider. |
| **K7. Frappe tells Capxul through an outbox row** | The app writes the row in the same transaction as the document change, as a `doc_events` hook. Capxul pulls the rows by cursor (`docs/design/frappe/accounting.md:295-300`). Frappe's Webhook doctype is not used: it waits in process memory until after the commit, so a crash loses the event (`prior-art.md:203-214`). |

**Capxul's calls into the app.** Capxul always calls the site with the app's service user. The calls are:

- `payment.open(advice, item, route, classification)`;
- `payment.status(id, status)`;
- `statement.post(transaction's lines, seq)`;
- `statement.retract(chain refs, seq)`;
- `bridge.post(event)`;
- `rates.post(day, pairs)`.

Each call is idempotent by its key. The site calls Capxul only through the outbox.

---

## 2. The payment advice: exactly what `documentHash` commits to

### 2.1 What the hash must make provable

Both the payer's and the payee's systems must be able to prove that this payment pays these lines of these documents,
for these amounts, net of this tax and these deductions. The constraints that shape the advice:

- **Frappe allocates only to a document or a payment term, never to a line** (`frappe.md:26-31`;
  `en:erpnext/accounts/doctype/payment_entry_reference/payment_entry_reference.json:33-178`). So the lines live in the
  advice, and the voucher keeps per-document totals.
- **Frappe's row names change when a document is amended.** Rows are named by a random hash
  (`en:erpnext/accounts/doctype/sales_invoice_item/sales_invoice_item.json:4`), and an amendment clears every child
  row's name and renames the parent `-1` (`frappe.md:32-37`). So a line is named by its position plus a hash of its
  content, and a document by Capxul's own stable id.
- **Deductions make the cash differ from what is allocated:** withholding, an early-payment discount, a dunning charge,
  a rail's fee and an exchange difference (`frappe.md:633-637`). So the advice states allocations and adjustments
  separately.
- **An invoice's lines and amounts are easy to guess.** An unsalted hash could simply be looked up, so the advice is
  salted (`prior-art.md:102-106`).
- **The banks' own shape already exists:** ISO 20022 structured remittance and EDI 820 (`prior-art.md:388-410`). The
  advice follows that shape.

### 2.2 The typed message

The advice is an EIP-712 typed message, the book's existing document form (`blueprint/documents/procedures.ts:150-158`).
Its domain is `{name: "Capxul", version: "1", chainId, verifyingContract: Payments}`.
`documentHash = hashTypedData(domain, Advice)`.

```
Advice(uint16 version,bytes32 origin,bytes16 salt,Party payer,Party payee,address token,uint256 amount,
       Money cash,Allocation[] allocations,Adjustment[] adjustments,int256 onAccount,string memo,
       bytes32 refundOf,Route route,Batch batch)
Party(bytes32 party,address account)
Money(string currency,uint8 precision,int256 minor,uint256 rateNum,uint256 rateDen)
Allocation(uint8 docType,bytes32 doc,bytes32 counterDoc,string number,uint32 date,bytes32 content,
           bytes32 term,int256 allocated,Line[] lines,Adjustment[] adjustments)
Line(uint32 idx,bytes32 row,int256 amount,Tax[] taxes)
Tax(bytes32 taxType,uint32 rateBps,int256 amount)
Adjustment(uint8 kind,bytes32 reason,int256 amount)
Route(uint8 kind,uint256 budgetId,uint64 payAt,address escrow,bytes32 payout,Money fiat,int256 fee)
Batch(bytes32 id,uint32 index,uint32 count)
```

### 2.3 Field by field

| Field | Commits to | Why |
|---|---|---|
| `version` | the schema, 1 | a later schema can coexist |
| `origin` | `keccak256(subject kind, Capxul Payment's own id)`, the book's origin binding (`blueprint/documents/procedures.ts:150-154`) | one advice serves one payment. The payment id cannot be used, because it depends on this hash. |
| `salt` | 16 random bytes, fixed at prepare and kept with the advice | the hash of an invoice cannot be guessed (`prior-art.md:474`) |
| `payer`, `payee` | `party` = `keccak256(Capxul Party id)`; `account` = the paying Safe, and the payee's Safe or bank account id | each side finds its Customer, Supplier or Employee by `capxul_party`. A Bridge payout names the real payee, not Bridge's deposit address. |
| `token`, `amount` | exactly the chain item's | the advice can be checked against `PaymentSent` alone, with no item |
| `cash` | the currency of the documents paid, its precision, the amount in minor units, and the rate the payer applied as a fraction (minor units per raw token unit) | exact integer arithmetic, with no floats: `cash.minor == roundHalfEven(amount × rateNum / rateDen)`. At par for USDC to USD at 6 to 2 decimals, the rate is 1/10,000. |
| `allocations[].docType` | Sales Invoice, Purchase Invoice, Purchase Order, Sales Order, Journal Entry, Expense Claim, Employee Advance, Leave Encashment, Gratuity, Salary Slip, Dunning, Payment Entry, Other | the reference doctype in the voucher |
| `allocations[].doc` | `keccak256` of the issuer's Capxul id for the document. It survives amendment (`docs/design/frappe/accounting.md:69-74`). | stable naming across `-1`, `-2` |
| `allocations[].counterDoc` | `keccak256` of the other side's record of the same document (the payer's Purchase Invoice for the supplier's invoice), or zero | when both sides use Capxul, one advice proves both books |
| `allocations[].number`, `.date` | the document's number and date as issued: the supplier's bill number, or the Sales Invoice's name | the human reference: ISO 20022's referred document number (`prior-art.md:392-393`) |
| `allocations[].content` | `keccak256` of the canonical content of the exact version paid (2.4) | proves which version was paid. A later amendment shows up as a difference. |
| `allocations[].term` | `keccak256` of the payment term's name, or zero | the term Frappe allocates to (`payment_entry.py:536-545`), so instalments of one invoice link through their shared `doc` |
| `allocations[].allocated` | how much the document's outstanding goes down by, in `cash.currency` | becomes the reference row's `allocated_amount` |
| `allocations[].lines[]` | `idx` (the row's position in that version), `row` (the hash of the row's canonical content), the amount paid against the row, and its `taxes` (the tax type as the hash of the Company's tax account's Capxul id, the rate in basis points, the amount) | "these lines", and the tax paid with this payment, line by line. Cash-basis VAT needs exactly this. Empty means the whole document. |
| `allocations[].adjustments[]` | per document: discount, withholding, credit note applied, dunning charge or write-off, each with a reason code and a signed amount | EDI 820's ADX inside the RMR loop (`prior-art.md:402-406`) |
| `adjustments[]` | payment-level: a rail's fee carried by the payer, or exchange rounding | ADX outside the RMR loop |
| `onAccount` | the part paid on account, as an advance | the voucher's unallocated amount |
| `memo` | up to 280 characters | a payment with no document |
| `refundOf` | the payment id this one gives back, or zero | links a refund to its payment, which v4 cannot do (`v4.md:412-416`) |
| `route` | the kind (direct, board, budget, schedule, escrow, bridge payout, collection), the budget id, `payAt`, the escrow's address, Bridge's payout id, the bank amount in fiat (`fiat`), and the fee | the hop to Bridge names its purpose. Today it hashes only the payout id (`blueprint/banking/decisions.ts:917-945`). |
| `batch` | the run's id (`keccak256` of the Payroll Entry's Capxul id and the attempt), the line's index, and the count | each line of a run proves its place in it, with no batch id on chain |

**The balance rule.** The amounts must add up:

```
cash.minor = Σ allocated + Σ allocation adjustments + Σ adjustments + onAccount
```

Every adjustment is signed. A discount or withholding is negative: the payer pays less. A dunning charge, or a fee the
payer carries, is positive. Capxul refuses to prepare an advice that does not balance, with INVALID_INPUT.

**What is not hashed.** The payer's own classification is not hashed: the account, cost centre and project of a memo
or of money on account. It belongs to the payer's books and may be re-classified, and the payee has no claim on it.

### 2.4 Canonical content, and who computes it

The Capxul app holds the one canonicalizer, inside Frappe. For a document version it returns RFC 8785 canonical JSON of
these fields:

- doctype, Capxul id, `capxul_version`, party (by Capxul Party id), currency, posting date and due date;
- items, each with `idx`, item code, description, quantity and rate (as decimal strings), amount, UOM and item tax
  template;
- taxes, each with `idx`, type, account (by Capxul id), rate and amount;
- the item-wise tax rows (`en:erpnext/accounts/doctype/item_wise_tax_detail/item_wise_tax_detail.json:15-42`);
- the totals and the payment schedule.

`content` is `keccak256` of those bytes, and a line's `row` is `keccak256` of its row's canonical JSON. For a salary
slip, `content` is the payslip document's own hash (`documents.payslip-kind`). For a request's invoice, `content` is
the request Invoice document's hash (`blueprint/documents/procedures.ts:51-63`).

Capxul stores the canonical bytes beside the advice. A verifier therefore re-hashes bytes and never needs to
re-implement the canonicalizer.

### 2.5 How each side proves it

Payer or payee, given the PaymentSent (`v4/interfaces/IPayments.sol:23-31`), proves it in five steps:

1. `hashTypedData(Advice)` from the stored bytes equals the event's `documentHash`.
2. `keccak256(TYPEHASH, chainid, Payments, item…)` from the Capxul Payment's `item` equals the event's `paymentId`
   (`v4/money/Payments.sol:15-17`, `:80-95`).
3. The advice's `token` and `amount` equal the event's.
4. For each allocation, the side's own document is found by `doc` or `counterDoc` (by `capxul_id`), and its canonical
   content at the committed version re-hashes to `content`.
5. The voucher's references equal the allocations, document by document and term by term. Any difference is listed,
   never overwritten.

An auditor with the advice bytes, the canonical bytes and the item proves the same thing from the chain alone. Without
them, an outsider cannot, which is also the privacy the salt buys (section 4).

---

## 3. Every money path, end to end

Each path is a table with the same rows. **Frappe before**: what Frappe holds. **Capxul does**: what Capxul does.
**Chain**: what the chain records. **Comes back**: the line or event that returns. **Frappe after**: what Frappe holds
after. **Once**: why it happens exactly once.

The examples use one Company, "Acme", in USD, with company Safe "Treasury · USDC" (USDC has 6 decimals). Amounts are
illustrative.

### P1. A department pays one supplier invoice

| | |
|---|---|
| Frappe before | Purchase Invoice PI-0101 from the supplier Northwind is submitted: 1,200.00 USD (1,000.00 plus 200.00 VAT at 20%), outstanding 1,200.00, cost centre Engineering. No Capxul Payment. |
| Capxul does | The pay command runs, from the CLI, the SDK or the invoice's Pay action (Frappe holds no key and moves no money). It reads PI-0101 and checks that it is submitted, not on hold, and that its outstanding less what is in flight covers the amount. It then reads, at one block, `Budgets.authorised(engineering, wearer's Safe)` and `leftOf` (`v4/money/Budgets.sol:373-383`). It builds the advice: one allocation (`doc` = PI-0101's Capxul id, `number` = Northwind's bill number, `content`, `allocated` 1,200.00) and, if chosen, both lines with their VAT. It stores the advice and computes the item: recipient Northwind's Safe, 1,200,000,000 raw, kind 1, the job nonce derived as `Budgets.spend` derives it (`v4/money/Budgets.sol:229`), executor the company Safe (`:515`), giving the id **P**. It writes Capxul Payment P (Prepared, allocation PI-0101 1,200.00) and opens one approval from the wearer's Safe: `Budgets.spend(engineering, Northwind, amount, 1, H, nonce)`. |
| Chain | In one transaction: Transfer (company Safe → Northwind, 1,200 USDC); `PaymentSent(P, company Safe, Northwind, USDC, amount, 1, H)` (`v4/money/Payments.sol:77`); `Spent(…, P)` (`v4/money/Budgets.sol:231`); the wearer's `UserOperationEvent`. |
| Comes back | At finality, one line on Treasury · USDC: withdrawal 1,200.000000, dated the block's day, reference P, `capxul_budget_id` Engineering, `capxul_actor_safe` the wearer. |
| Frappe after | Payment Entry Pay: paid from Treasury · USDC (1,200 USDC at the block's USDC/USD rate), party Supplier Northwind, reference PI-0101 for 1,200.00. The difference at par goes to exchange gain or loss (`docs/design/frappe/accounting.md:195-200`). It has `reference_no` P, cost centre Engineering, and is submitted, `Voucher Created`, cleared on the block's day. PI-0101 is Paid. Capxul Payment P is Settled. If Northwind uses Capxul, its own site gets the deposit line and a Receive against its Sales Invoice named by `counterDoc` (P4). |
| Once | The Capxul Payment is named P; the line is unique by `capxul_chain_ref`; the voucher is made under P's row lock. |

**Variants.**

- **The Board pays.** It sends `approve` and `Payments.send` from the company Safe with the executor set to the
  company Safe (`blueprint/payments/commands.ts:196`). There is no `Spent`, so the cost centre comes from the
  Capxul Payment's classification, Main by default.
- **A member pays the company's supplier from their own Safe.** Their Safe is not the company's bank. That is an
  expense claim (P6), whose advice names the supplier's invoice.

### P2. Several invoices in one payment

| | |
|---|---|
| Frappe before | PI-0101 (1,200.00) and PI-0102 (300.00), both from Northwind. |
| Capxul does | One item for 1,500 USDC and one advice with two allocations, in the order given. To pay several suppliers at once, it sends one item per supplier, each with its own advice. A person or the Board sends them with `sendBatch` (`v4/money/Payments.sol:42-46`); a budget sends one `Budgets.spend` per item in one operation. |
| Chain | One PaymentSent, P, for 1,500. |
| Comes back | One line, 1,500 USDC, reference P. |
| Frappe after | One Payment Entry with two reference rows (1,200.00 and 300.00). Both invoices are Paid. |
| Once | As P1. If one invoice lost outstanding while the payment was in flight, what fits is allocated and the rest is left on account, with the difference recorded (1.4). |

### P3. A partial payment

| | |
|---|---|
| Frappe before | PI-0103 for 2,000.00, with a payment schedule (Deposit 40%, Balance 60%) whose template has `allocate_payment_based_on_payment_terms`, so every allocation must name a term (`payment_entry.py:536-545`). |
| Capxul does | An advice with one allocation: `term` = Deposit, `allocated` 800.00, and optionally the lines the deposit covers. |
| Chain | PaymentSent P for 800. |
| Comes back | One line of 800, reference P. |
| Frappe after | A Payment Entry referencing PI-0103 under the Deposit term for 800.00. Outstanding is 1,200.00, status Partly Paid, and the schedule row is updated (`payment_entry.py:945-1056`). The lines paid stay on the Capxul Payment's allocation row, because Frappe cannot hold them (`payment_entry_reference.json:33-178`). The next instalment is another payment with `term` = Balance and the same `doc`, so the two instalments link off chain. v4 has no link between them (`v4.md:408-411`). |
| Once | As P1. |

### P4. A customer pays the Organization's invoice

The request becomes the Sales Invoice (`aaron.frappe-native`). There are four ways the money comes in.

**(a) A customer on Capxul pays from their own Safe** (`requests.inbox.pay`).

| | |
|---|---|
| Frappe before | At Acme: Sales Invoice SINV-0042, made from request R, 1,000.00 USD outstanding, with its Capxul payment reference (P10) and the hash of the request's Invoice document. |
| Capxul does | The payer prepares. The advice's allocation has `docType` Sales Invoice, `doc` = SINV-0042's Capxul id (Acme issued it), `content` = the request Invoice's hash, and `counterDoc` = the payer's Purchase Invoice when the payer is an Organization. Capxul writes Capxul Payment P to Acme's site with route `inbound`, and, for a payer Organization, to the payer's site as Prepared. |
| Chain | Transfer (payer → Acme's Treasury); PaymentSent P. |
| Comes back | Acme: a deposit line with reference P. The payer, if an Organization: a withdrawal line with reference P. |
| Frappe after | Acme: Payment Entry Receive from Customer into Treasury, referencing SINV-0042 for 1,000.00, so it is Paid and the request is paid. Payer: a Pay against its Purchase Invoice. One advice proves both sets of books. |

**(b) An outside payer at a link** (the invoice escrow).

The escrow's condition is amount-reached, its sender is the payer's email Safe, and its owner is Acme's Safe
(`docs/design/escrow.md:197`). Until it pays out, the money is the payer's, who can take it back while the escrow is
short (`v4/money/Escrow.sol:176-186`). So Acme's books show nothing. `payout()` sends PaymentSent P, with the escrow as
sender and no executor (`v4/money/Escrow.sol:146-149`). Acme gets a deposit line from the escrow's address with
reference P, and the same Receive as in (a). Any surplus goes back to the payer, not to Acme
(`v4/money/Escrow.sol:158-170`).

**(c) By bank transfer:** P10. **(d) Into an outside bank account:** P12.

### P5. Payroll: Frappe HR computes it, and Capxul pays many people in one batch

| | |
|---|---|
| Frappe before | Payroll Entry PAY-2026-11 (department Engineering, payment account Treasury · USDC). Frappe HR made and submitted the slips and its accrual Journal Entry: Dr each earning, Cr each deduction, Cr Payroll Payable per employee (`hr:hrms/payroll/doctype/payroll_entry/payroll_entry.py:619-701`). There is no bank entry, because Make Bank Entry is refused on a Capxul account (G4). |
| Capxul does | The pay command reads the submitted slips. For each slip it builds an advice: `docType` Salary Slip, `doc` = the slip's Capxul id, `content` = the payslip document's hash, lines = earnings and deductions with the tax withheld, and `batch` = {run, i, n}. It writes one Capxul Payment per slip and opens **one approval** from the department wearer's Safe: N `Budgets.spend` calls of kind 2 in one operation. A new hire with no account is paid into an escrow (P8). |
| Chain | One transaction with, per slip: Transfer, PaymentSent(Pi), Spent. Each line has its own payment id and log index (`v4/money/Payments.sol:77`). Budgets has no batch spend, so a run is N spends (`v4/money/Budgets.sol:206-232`). |
| Comes back | N lines on Treasury, one per slip, all posted in one Frappe transaction (K4). |
| Frappe after | Per slip, a Journal Entry Bank Entry made from its line: Dr Payroll Payable (party Employee, `reference_type` Payroll Entry), Cr Treasury, `cheque_no` Pi, `cheque_date` the block's day (`en:erpnext/accounts/doctype/journal_entry/journal_entry.py:548-557`), reconciled. The run now answers `has_bank_entries` (`payroll_entry.py:1069-1090`). Each slip's Capxul fields read paid. |
| Once | Each Pi is its own Capxul Payment and line. A lapsed approval is retried with the same ids. |

Decision `bank.entry-per-slip`. Frappe HR makes one Bank Entry per run (`payroll_entry.py:1093-1136`). Bank-first makes
one per slip instead, for three reasons:

- each slip is its own statement line, so a one-to-one match is exact;
- a new hire's escrow settles on its own day, later than the run;
- each entry stays far below the 100 rows above which a Journal Entry submits in the background
  (`journal_entry.py:216-221`).

### P6. An expense claim

| | |
|---|---|
| Frappe before | Expense Claim EXP-0007 for Ada, 84.00 USD in two rows, approved and submitted: Dr expenses, Cr the employee's payable (`hr:hrms/hr/doctype/expense_claim/expense_claim.py:302-421`). |
| Capxul does | Pay, from the department's budget by its wearer, with kind 3. The advice has `docType` Expense Claim and lines for the expense rows with their tax. When Ada paid a supplier's invoice herself, the row's hash is her receipt's document hash. |
| Chain | Transfer, PaymentSent P, Spent. |
| Comes back | A withdrawal line with reference P. |
| Frappe after | Payment Entry Pay, party Employee Ada, referencing EXP-0007 for 84.00 (`employee_payment_entry.py:22-30`). Frappe HR recomputes the amount reimbursed and sets the claim Paid (`expense_claim.py:675-708`). |

### P7. An employee advance, and its return

| | |
|---|---|
| Frappe before | Employee Advance EA-0003, 300.00, submitted. It has no GL until it is paid. |
| Capxul does | Pay, with an advice whose `docType` is Employee Advance. |
| Chain | Transfer, PaymentSent P, Spent. |
| Comes back | A withdrawal line with reference P. |
| Frappe after | Payment Entry Pay to the Employee against the advance account, referencing EA-0003 (`employee_payment_entry.py:171-180`). The advance's paid amount follows from the Advance Payment Ledger (`frappe.md:501-506`). |
| Return | If the unspent 40.00 is paid back from Ada's Safe, her advice has `refundOf` P and an allocation to EA-0003. Acme gets a deposit line, and the matcher makes the return entry Frappe HR's `make_return_entry` would make (`frappe.md:505-506`). If instead it is taken back out of salary by Frappe HR, no money moves, so there is no line. |

### P8. A payment to someone with no account: funding, claim and refund (the general escrow)

| | |
|---|---|
| Frappe before | PI-0110 from a freelancer known only by email, 500.00 USD (or a new hire's slip). |
| Capxul does | The advice is as in P1, with route `escrow`. The escrow's terms are those of the general escrow (`docs/design/escrow.md:61-63`): owner = the mailbox's derived Safe, sender = the company Safe, authority = Budgets and the budget id. Its `documentHash` is the advice's hash, used both in its terms and in the funding item. Two ids exist: the payout's **P** (`EscrowFactory.predictPaymentId`) and the funding's **F**. Capxul writes Capxul Payment P with `funding_payment_id` F and `escrow_address`. The approval is `Budgets.spend` to the escrow's predicted address, plus the deploy. |
| Chain (funding) | Transfer (company Safe → escrow); PaymentSent F; Spent; EscrowDeployed and EscrowCreated. |
| Comes back | Two lines from the one log: Treasury withdrawal 500 (reference F) and Money waiting deposit 500 (reference F). |
| Frappe after funding | Payment Entry Internal Transfer from Treasury to Money waiting, reconciled to both lines. PI-0110 is still outstanding, because the payee has nothing yet. Capxul Payment P is Escrowed. |
| Chain (claim) | `payment claim`: Transfer (escrow → the owner's Safe); PaymentSent P, with the escrow as sender and executor (`v4/money/Escrow.sol:146-149`); EscrowPaid. |
| Frappe after the claim | A Money waiting withdrawal line with reference P. Then Payment Entry Pay from Money waiting, party Supplier, referencing PI-0110, which is now Paid. For a slip, it is a Bank Entry: Dr Payroll Payable, Cr Money waiting. Capxul Payment P is Settled. |
| Chain (refund) | `payment cancel` by the sender, or by whoever Budgets admits on the budget now (`docs/design/escrow.md:63`): Transfer (escrow → company Safe) and `EscrowRefunded(sender, by, P, amount, state)` (`docs/design/escrow.md:104`). There is no PaymentSent; the reference comes from EscrowRefunded in the same transaction. |
| Frappe after the refund | A Money waiting withdrawal and a Treasury deposit, both with reference P. Payment Entry Internal Transfer back to Treasury. PI-0110 is still owed. Capxul Payment P is Cancelled (refunded). The budget's room is not restored (`docs/design/escrow.md:165`, G10). That is Capxul's fact and does not touch Frappe. |
| Surplus | When an escrow held more than its amount, the claim's transaction also sends the surplus back to the sender (`v4/money/Escrow.sol:158-170`): a Money waiting withdrawal and a Treasury deposit, as an Internal Transfer. |

### P9. A department's budget spend, under `aaron.departments`

The money path is P1. What is specific to departments:

- **Who may.** Whoever `Budgets.authorised` admits at the call: the budget's hat or one above it, in good standing, or
  the Safe (`v4/money/Budgets.sol:219`, `:373-383`), within Roles' ceiling (`pv4/architecture.md:135-143`).
- **What Frappe records.** The Department and Cost Center linked to the budget id, read from `Spent`, because the
  budget is on the sibling event, not on PaymentSent (`v4.md:265-268`). The voucher's `owner` is the asker's User.
  `capxul_actor_safe` comes from the transaction's UserOperationEvent, because `Spent` does not name who acted
  (`v4/money/Budgets.sol:231`). The hat that Safe wore at that block is read from Hats.
- **What survives a swap.** A Capxul Payment in flight is the department's, not the person's:
  - an approval prepared by a holder who has since been swapped out fails at sponsorship, with nothing moved;
  - the new wearer may retry the same payment id (`docs/design/authority.md`, the swap table and row 17);
  - a dated payment or an escrow can be cancelled by whoever wears the hat now.
- **Budgets live on chain, not in Frappe.** Frappe's Budget doctype is not used (`docs/design/frappe/accounting.md:82`).
  Capxul's budget reports read the chain, and Frappe's cost-centre reports read the GL. They differ at period edges,
  because budget periods are UTC calendar periods (`pv4/architecture.md:168`) while the Company's books follow its
  own time zone. Agreement collections never count in a budget's spent (`v4/money/Budgets.sol:337-340`; P18).

### P10. A fiat deposit through Bridge into a Safe

| | |
|---|---|
| Frappe before | SINV-0042, 1,000.00 USD. It is printed with Acme's bank details (its Bridge virtual account, `blueprint/banking/data.ts:330-385`) and its **Capxul payment reference**: an ISO 11649 RF creditor reference, whose check digits catch typing errors, stored as a unique Custom Field on Sales Invoice. The customer wires 1,000 USD with the reference in the memo. |
| Capxul does | Nothing to sign. Banking follows Bridge's deposit events, through `funds_received` to `payment_processed` with `destination_tx_hash` (`prior-art.md:518-541`), and waits for the Transfer (`blueprint/banking/processes.ts:229-262`). |
| Chain | Transfer (Bridge → Treasury, 994 USDC). There is no PaymentSent. |
| Comes back | A Treasury deposit line of 994 USDC with: reference = the RF reference found in Bridge's description (else Bridge's deposit id); description = Bridge's text; `bank_party_name` = the sender's name; `included_fee` 6, made of Bridge's developer fee of 5 and exchange fee of 1. The fee is counted only where the bank currency and the token are one (`blueprint/banking/decisions.ts:837-871`). |
| Frappe after | The reference names SINV-0042, so the matcher makes Payment Entry Receive from the Customer: paid to Treasury 994 USDC, allocated 1,000.00 to SINV-0042, with deductions of 5 and 1 on bank charges. The invoice is Paid and the request matched. With no reference, the line stays Unreconciled. ERPNext's party matching and ranked matches propose a match, and a person picks it in the reconcile screen or with `bank match`. The voucher is still made from the line. |
| Once | The line is unique by its chain occurrence, and Bridge's deposit id is unique on the line. |

Notes:

- **The line waits for Bridge's text.** A line's `description` cannot change after submit (`bank_transaction.json:114`
  has no `allow_on_submit`; `reference_number` does, at `:125`). So the line is written once Bridge's metadata has
  come, which normally happens before the Transfer is final. If it never comes, the line is written from the chain
  alone after a grace period.
- **This is how Capxul is paid.** The developer fee is Capxul's revenue, set on the Bridge account
  (`blueprint/banking/data.ts:363`). Acme's books show it as a bank charge.
- **A deposit is one hop; a payout is two (P11).** A deposit's fiat leg is over before its chain leg begins, so the
  chain line is the last word. A payout's fiat leg comes after its chain leg and can fail days later.

### P11. A fiat payout through Bridge, and a return

| | |
|---|---|
| Frappe before | PI-0120 from a supplier paid by bank, 2,000.00 USD; the supplier's Bank Account (with party); the Bank Account **Payouts in transit · USD**. |
| Capxul does | `bank pay` from a department budget. Bridge's quote is: the bank receives 2,000.00 USD, the Safe sends 2,004.10 USDC, and the fee is 4.10. The advice names the real payee, the supplier (not Bridge). It allocates 2,000.00 to PI-0120, adds an adjustment of +4.10 (kind fee, reason bridge), and has route `bridge_payout` with the payout id, the bank amount and the fee, at the quote's rate. Its hash replaces `keccak256(payout id)` (`blueprint/banking/decisions.ts:917-945`). The recipient is Bridge's deposit address (`blueprint/banking/payouts.ts:69-90`). Capxul writes Capxul Payment P. |
| Chain | Transfer (Treasury → Bridge's deposit address); PaymentSent P with kind 1; Spent. |
| Comes back (chain) | A Treasury withdrawal of 2,004.10 USDC with reference P. In the same push, a Payouts in transit deposit of 2,004.10 USD at the quote's rate, also with reference P. |
| Frappe after the chain | Payment Entry Internal Transfer from Treasury (USDC) to Payouts in transit (USD), reconciled to both lines. PI-0120 is still unpaid and shows the payment in flight. Capxul Payment P is In transit. |
| Comes back (Bridge) | Bridge's delivered event, carrying the quote's bank amount (`blueprint/banking/processes.ts:112-200`, step `deliver`). A Payouts in transit withdrawal of 2,004.10 with an included fee of 4.10 (the fee may not exceed the withdrawal, `bank_transaction.py:332-340`), reference P. |
| Frappe after delivery | Payment Entry Pay from Payouts in transit, party Supplier, allocated 2,000.00 to PI-0120, with a deduction of 4.10 on bank charges. PI-0120 is Paid. Capxul Payment P is Settled. |
| Return | Bridge sends the USDC back to Treasury in the refund transaction it names (`blueprint/banking/processes.ts:112-200`), with no PaymentSent. **Before delivery:** a Treasury deposit and a Payouts in transit withdrawal, as an Internal Transfer back. **After delivery** (a bank can return a payment for 60 days): first a Payouts in transit deposit for the returned fiat, with the supplier as party. Unreconcile Payment then takes the delivery entry's allocation off PI-0120 (`frappe.md:252-253`). A Receive from the Supplier referencing the delivery's Payment Entry nets it (`payment_entry.py:869-875`). Then comes the Internal Transfer back to Treasury. PI-0120 is owed again. |

Decision `bank.payout-two-hops`. The chain proves only that the money left the Safe, and only Bridge's statement
proves the supplier's bank received it. An invoice is paid when its payee has the money. A return then rarely has to
re-open a paid invoice. This is the processor-as-clearing-account practice (`prior-art.md:548-562`). It is offered to
Aaron as a question, because the invoice reads unpaid while the payout is in transit (section 9).

### P12. Outside bank accounts

**(a) Paid from an outside bank.**

- **Frappe before:** PI-0130, and the company's ordinary Bank Account "Barclays · GBP".
- **Capxul does:** nothing on chain. A person records the payment through the CLI or the SDK document family
  (`aaron.sdk-reaches-everything`). Frappe submits it as usual: on a non-Capxul account a voucher may come before
  the statement, as ERPNext expects.
- **Comes back:** the bank's statement line, imported or from a feed.
- **Frappe after:** ERPNext's tool reconciles it, automatically when the reference matches exactly
  (`bank_reconciliation_tool.py:1576`). None of G1 to G6 applies.

**(b) Received into an outside bank.** The same, plus one thing: the invoice's RF reference makes the match exact,
through the same Capxul rule, which runs on every bank account's lines.

**(c) Between an outside bank and a Safe.** From the company's own bank into a Safe, via Bridge:

- **Comes back:** the bank's line (a withdrawal of 1,000 USD, from its statement) and the Treasury line (a deposit
  of 996 USDC, from the chain, with Bridge's metadata naming the company's own account as the sender).
- **Frappe after:** one Payment Entry Internal Transfer from USD to USDC, with the fee as a deduction. The Capxul app
  makes it, because ERPNext's tool cannot make a transfer across currencies (`bank_reconciliation_tool.py:631`),
  while Payment Entry itself can (`payment_entry.py:1186-1196`, `:1333-1367`). It is reconciled to the Treasury line
  at once, and to the bank's line when that statement arrives (Matched).

The reverse direction, from a Safe to the company's own bank, is P11 with the company as payee: an Internal Transfer
from Payouts in transit to the bank.

### P13. A scheduled payment

| | |
|---|---|
| Frappe before | PI-0140, due 30 November. |
| Capxul does | Pay on 30 November. That is `Budgets.schedule(budget, to, amount, kind, payAt, H, nonce)` (`v4/money/Budgets.sol:235-265`). The id is known now, because `execute` derives the job nonce from the stored one (`:263`, `:296`; `v4/interfaces/IBudgets.sol:245-247`). Capxul writes Capxul Payment P with status Scheduled and `pay_at`. |
| Chain | First PaymentScheduled, which reserves the amount. On the day, anyone may call `Budgets.execute` at or after `payAt` (`v4/money/Budgets.sol:283-300`); Capxul's executor key does. That gives Transfer, PaymentSent P and ScheduledPaid P. |
| Comes back | The line, dated the day the execution was mined, which is on or after `pay_at`. |
| Frappe after | As P1. The posting date is the block's day, not `pay_at`. |

### P14. A cancel before settlement

| | |
|---|---|
| Frappe before | Capxul Payment P, Prepared or Scheduled. Nothing posted. |
| Capxul does | `payment cancel`, or one of: an approval declined, withdrawn or expired; a Board proposal rejected; `Budgets.cancel` (`v4/money/Budgets.sol:268-278`); a Bridge quote expired (`blueprint/banking/processes.ts:112-200`). A **lapse** whose approval may still be retried under the same id is not a cancel: the Capxul Payment becomes Needs retry. |
| Chain | Nothing, or `ScheduleCancelled`, which carries no amount (the amount is on the Capxul Payment). |
| Frappe after | Capxul Payment P is Cancelled. Its allocations are no longer in flight, and G5 releases the invoice. No voucher or line ever existed, so there is nothing to reverse. |
| Race | A signed operation can still land after a cancel is asked for. So the Capxul Payment becomes Cancelled only once the chain makes landing impossible: the approval's window has closed (`not_after`), or `ScheduleCancelled` has landed. If the payment lands first, its line arrives and is booked: money that moved wins. An escrow refund is a cancel after funding (P8). |

### P15. A reorg after settlement

| | |
|---|---|
| Frappe before | Line L (block b, hash h) reconciled to Payment Entry V; PI-0101 Paid; Capxul Payment P Settled. |
| Chain | Ponder rolls back the block (`blueprint/indexing/decisions.ts:255-274`). Payments `unsettle`s P (`blueprint/payments/data.ts:445-450`). |
| Capxul does | `statement.retract(L)`, under the next seq. |
| Frappe after | The app runs ERPNext's unreconcile on L. It cancels every `Voucher Created` voucher (`bank_transaction.py:373-401`), so V is cancelled, and L is then cancelled too (its cancel removes the clearance, `:148-154`). With the immutable ledger on, the reversal is dated on the cancel's posting date (`frappe.md:567-570`), which is the world's today. PI-0101 is outstanding again. Capxul Payment P goes back to Prepared and its generation goes up by one. |
| Re-landing | If the same operation lands again, it is the same id, so a new line L′ comes with a new key (a new block hash) and a new voucher V′ with `amended_from` V (`frappe.md:548-550`). PI-0101 is Paid again. If it never lands, the Capxul Payment ends Needs retry. |
| How rare | Frappe posts at Base's `safe` head, when the block has been batched to L1. Base says such blocks have never been reorganized (`prior-art.md:648-692`). This path covers what remains. |

### P16. Fees

| Fee | Where it lives | In Frappe |
|---|---|---|
| Bridge's deposit fees, including Capxul's developer fee | Bridge's deposit record (`prior-art.md:518-528`) | `included_fee` on the line; deductions on bank charges (P10) |
| Bridge's payout fee | the quote, and the advice's adjustment (P11) | a deduction on the delivery Payment Entry |
| Capxul's own charges: seats and the hosted FDE (`blueprint/shared/rulings.ts:450-467`) | Capxul issues a Purchase Invoice into the Organization's site from the Supplier "Capxul" | paying it is P1, with that invoice in the advice |
| Gas | paid by Capxul's paymaster | none, unless Capxul bills it as a line on its own invoice |
| Early-payment discount, withholding, dunning charge | the advice's per-document adjustments, with reason codes | deductions and taxes on the Payment Entry (`frappe.md:199-207`; dunning at `frappe.md:440-445`) |
| Exchange difference | the advice's rate against the block's rate | the automatic deduction to exchange gain or loss (`payment_entry.py:1333-1367`) |
| On chain | none: Payments has no fee and refuses fee-on-transfer tokens (`v4/money/Payments.sol:68-75`) | — |

### P17. A currency other than the token

The example is a Company in EUR, paying a UK supplier's invoice in GBP, from Treasury · USDC.

- **The advice.** `cash` = {GBP, 2, minor, the rate}. The rate is Bridge's quote for a bank payout, or the payer's
  chosen rate for a payment to the supplier's Safe. The allocations are in GBP.
- **The voucher.** The bank account is in USDC, the party account (Creditors) in GBP, and the Company in EUR. So the
  matcher sets `source_exchange_rate` to USDC/EUR at the block and `target_exchange_rate` to GBP/EUR, from Capxul's
  price feed. The difference from the advice's rate goes to exchange gain or loss.
- **Rates in Frappe.** Capxul writes the block day's Currency Exchange rows (`rates.post`) before the matcher runs.
  ERPNext looks for stored rows first (`frappe.md:600-605`), and its tool's create-and-reconcile resets the rates from
  them (`bank_reconciliation_tool.py:1021-1045`). A Company may instead peg USDC to USD at 1.0 (`frappe.md:600-605`).
- **Precision.** An 18-decimal token rounds in Frappe, whose Currency column is decimal(21,9)
  (`docs/design/frappe/accounting.md:375-377`). The raw units stay exact on the line (`capxul_amount_raw`) and on the
  Capxul Payment, and the completer compares raw units.

### P18. An agreement collection: the one path whose advice cannot go on chain

- **The chain gives no commitment.** The payee collects any amount up to what has been released
  (`v4/money/Agreements.sol:216-217`). Every collection carries the agreement's terms hash (`:222`), and the collection
  index is hidden inside the job nonce (`:219-222`).
- **So Capxul writes the Capxul Payment when the line arrives,** with route `collection`.
- **Frappe allocates it FIFO.** For a contractor, the matcher makes a Payment Entry Pay to the Supplier, allocated
  oldest first across the agreement's open Purchase Invoices, as ERPNext's Payment Reconciliation does. For an
  Employee, it makes a Bank Entry to Payroll Payable.
- **What is lost:** the chain cannot say which period a collection pays (section 4).

### A refund from a counterparty

A supplier who returns money sends a payment whose advice has `refundOf` = the original payment id. Acme's deposit
line makes a Receive from the Supplier, referencing the original Payment Entry or the supplier's credit note
(`payment_entry.py:869-875`). Under one id, Frappe's Payment Ledger then shows payments less refunds, which is Request
Network's balance rule (`prior-art.md:416`).

---

## 4. Do the v4 contracts change?

**No.** Payments, Budgets and Agreements stay exactly as they are. Escrow and EscrowFactory change only as
`aaron.escrow-general` already rules (`docs/design/escrow.md:106-141`). Bank-first adds no field to that change: the
refund's `EscrowRefunded` keeps the payment id, which is the refund line's reference (`docs/design/escrow.md:104`).

### 4.1 What bank-first needs from the chain, and where v4 already has it

| Need | v4 gives it | Where |
|---|---|---|
| Every movement of a Safe's tokens | the ERC-20 Transfer | the token |
| An exact reference on every Capxul payment | `PaymentSent.paymentId`, indexed | `v4/interfaces/IPayments.sol:23-31` |
| Each line of a batch on its own | one item, id, Transfer and PaymentSent per line, in order | `v4/money/Payments.sol:42-46`, `:77` |
| What the payment pays | `documentHash`, never zero, inside the id | `v4/money/Payments.sol:56`, `:80-95` |
| The id known before signing, so the order can be written first | `paymentId(item)`; a schedule's id from its stored nonce | `v4/money/Payments.sol:32-34`; `v4/money/Budgets.sol:263`, `:296` |
| Which budget | `Spent`, `ScheduledPaid` or `ReservedPaid`, each with the payment id | `v4/money/Budgets.sol:231`, `:299`, `:340` |
| A refund's link to its escrow payment | `EscrowRefunded(…, paymentId, …)` | `v4/money/Escrow.sol:185`; `docs/design/escrow.md:104` |
| Who acted | the transaction's UserOperationEvent, plus Hats at that block | `v4.md:231` |
| Fees, currency, tax, business dates and lines | none on chain: the advice, Bridge and Frappe hold them | — |

### 4.2 What is lost by not changing them, said plainly

1. **An agreement collection cannot say on chain which period it pays.** Frappe allocates it oldest first. This is
   right for ordinary pay, but wrong when a contractor disputes one period and is paid for a later one.
2. **An outsider with only the chain cannot recompute a payment id or open its document.** `PaymentSent` lacks the job
   nonce and the executor (`v4.md:119-121`). Both parties can always prove a payment, from the Capxul Payment's `item`
   and the advice bytes. The public cannot, and that is the privacy the salt is for.
3. **No log filter finds "every payment of document X",** because `documentHash` is not indexed
   (`v4/interfaces/IPayments.sol:30`). Capxul's own index answers it (the Capxul Payment's allocations).
4. **A refund is linked only by its advice (`refundOf`) or by the escrow's event.** A plain Transfer back carries no
   link, such as a Bridge return or a counterparty who pays back outside Capxul. It waits for reconciliation like any
   unexplained deposit.
5. **A payment to oneself still reports an amount that never moved** (`v4/money/Payments.sol:71-75`). It never posts,
   because lines come from Transfers, and Capxul refuses to prepare one.
6. **A direct token transfer by the Board,** which the Gate does not refuse (`v4.md:76-85`), is an unexplained line.
   Bank reconciliation exists for exactly this.

None of these stops a path in section 3 from booking exactly once.

### 4.3 If Aaron wants more, the smallest changes, field by field

They are ranked by value for their cost. **None is recommended now.**

| # | Contract | Change | Gains | Cost |
|---|---|---|---|---|
| 1 | Agreements | `Collected(safe, id, payee, token, amount, paymentId)` gains `uint64 index` and `uint128 collectedTotal` (the running total after this collection). `collect` itself does not change. | Anyone can map a collection to accrued periods exactly (FIFO over accrual) from the chain alone. Fixes item 1 for readers outside Capxul. | Agreements, IAgreements, the indexer. Frappe gains nothing, because its FIFO already gives the same answer. |
| 2 | Budgets | `Spent` gains `address by`, the `msg.sender` at `v4/money/Budgets.sol:231` | Who spent for a department, with no join to the UserOperationEvent | Budgets, IBudgets, the indexer |
| 3 | Payments | `PaymentSent` gains `bytes32 jobNonce` and `address executor` | The id can be recomputed from the log alone. Fixes item 2 for outsiders. | Payments is the one contract every payment uses: a new deployment of Payments and of everything that names its address, plus a re-audit |

The alternative to change 1, letting the payee pass their own `documentHash` to `collect`, is rejected. It would
commit the payee's claim, not the payer's advice, and it would change Budgets' `payReserved` hash path
(`v4/money/Budgets.sol:325-341`).

**Kinds.** Frappe never classifies by kind; the advice does that. Capxul still sets the kind by v4's table so that
chain readers see sense: 1 for an invoice, 2 for payroll, 3 for a reimbursement or an advance, 0 otherwise
(`pv4/architecture.md:151-165`). Budgets allows kinds 0 to 3 (`v4/money/Budgets.sol:27`, `:448-450`). This corrects
the book, which pays salary slips with kind one-off (`blueprint/payroll/staged.ts:75`) and every `payment send` with
kind 0 (`blueprint/payments/commands.ts:117`). It is a book change, not a contract change.

---

## 5. The world clock

Decision `bank.dates-from-blocks`:

- **Posting date, statement date, clearance date and reference date** are all the block's day in the Company's time
  zone, as the books already rule (`docs/design/frappe/accounting.md:203-204`, `:420-428`). The block's exact time is
  kept in `capxul_block_time`.
- **A closed period.** If that day is on or before the latest Period Closing Voucher, the voucher posts on the first
  open day, and the line keeps the block's day (`docs/design/frappe/accounting.md:403-418`).
- **Inside a world, every date is one clock.** On a devnet the supervisor mines every block at the world's now
  (`docs/design/time.md:54`, `:165`), and the site's `now_datetime` is the world's now (`docs/design/time.md:61`). So
  a voucher booked at the end of a stop has posting date = block day = Frappe's today. A cancel's reversal (P15) is
  dated the world's today, by the immutable ledger. In a shared world that runs four hours per real hour, or jumps time
  between seasons (`aaron.seasons`, `blueprint/shared/rulings.ts:616-633`), the same holds, because Frappe's
  scheduler and the chain move together.
- **Bridge's lines** (P11's delivery and returns) are dated at the event's time on the world clock. A devnet's Bridge
  stand-in follows the world (`time.world-channels`).
- **Schedules.** `payAt` is checked against block time by the chain (`v4/money/Budgets.sol:288`). On a frozen clock,
  a payment is executed at the stop that reaches its second, and its line is written once that stop has mined to
  finality.

**Finality** (decision `bank.finality`). A line is written at Base's `safe` head on mainnet and on staging: the L2
block has been batched to L1, which happens within about two minutes, and Base reports no reorg of such a block
(`prior-art.md:648-692`). On a devnet it is the deployment's depth, mined at a stop. Capxul's own screens can show a
payment as sent earlier. The books wait.

The alternative is `finalized`, about 20 minutes, which is safer still and slower to show "paid" in the books.
Payments' settlement and the statement must use the same tag, so that a Settled Capxul Payment always has its line.

---

## 6. Authority: who may cause each payment

**The rule.** Money moves only by the chain's checks: the calling Safe's hats now, or the Board's threshold
(`docs/design/authority.md`). Capxul adds a current Seat and the officer hats. Frappe's roles never authorize Safe
money:

- a Frappe user, even with the System Manager role, cannot write a Capxul line (G1) or a GL line on a Capxul account
  (G2);
- Frappe's "Pay" action only asks Capxul's command, which the asker's own Safe signs.

The roles the asker's Frappe User holds are set from their hats at each call (`organizations.doc-authority`). The
Books hat gives the accounts roles, Invoicing gives the selling roles, and People gives the HR roles.

| Path | Who may cause it | The chain's check | Capxul's own check | What Frappe records |
|---|---|---|---|---|
| A department pays (P1–P3, P9, P11, P13), and payroll (P5), claims and advances (P6, P7) | the wearer of the budget's hat or one above it, now | `Budgets.authorised` at the call, room, Roles' ceiling (`v4/money/Budgets.sol:219-226`) | a current Seat; the document is submitted and not on hold; Frappe's approval workflow state where the Organization has one | `owner` = the asker's User; `capxul_actor_safe`; the budget and its cost centre; `signed_by` |
| The Board pays (P1 variant) | the Directors, to the threshold | the Gate's threshold (`docs/design/authority.md`, "The company Safe and the Board") | a Director proposes | the same, with no budget |
| Cancel a dated payment (P13, P14) | the budget's wearers now, anyone above, or the Board | `Budgets.cancel`: `authorised(budget)` (`v4/money/Budgets.sol:271`) | a Seat | the Capxul Payment's status, with who cancelled and when |
| Execute a dated payment | anyone | `Budgets.execute`: due and pending (`v4/money/Budgets.sol:283-288`) | none: Capxul's executor key | the actor is the executor key, not a person; the payment stays the department's |
| Claim an escrow (P8) | the owner's Safe, once it can act | the general escrow's `collect` (`docs/design/escrow.md`, "Functions") | none | the payee's side |
| Take an escrow back (P8) | the sender, or whoever Budgets admits on the budget now, or the Board | the general escrow's `refund` and its authority term (`docs/design/escrow.md:63`) | a Seat | `by` from EscrowRefunded |
| A customer pays (P4) | the payer, from their own Safe; anyone at a link | the payer owns its Safe | none on the payee's side | an inbound Capxul Payment |
| A deposit's match (P10), reconciling an unexplained line, re-allocating (G7) | the Invoicing hat for requests; the Books hat for the rest | none: no money moves | the hat's guard | a normal Frappe change by the asker's User |
| Outside banks (P12) | the asker's Frappe roles, from the Books hat | none | the Books hat | as ERPNext |
| The hosted FDE | it acts for its asker, with the asker's hats only (`docs/design/authority.md`, "The hosted FDE acts as its asker") | the asker's Safe signs | the act-for token | the asker's User |

---

## 7. How an eval proves each path

Every eval runs on a devnet world. It drives the path through the Core SDK (`aaron.sdk-reaches-everything`), steps the
world clock to finality, and reads both the chain and Frappe's documents, the latter through the SDK's document family.
It never reads the site's database directly.

### 7.1 The invariants that every path must keep

The book derives `inv:` evals from invariant records. These are the bank-first invariants:

| Invariant | What it asserts |
|---|---|
| `inv:bank.statement-complete` | Every finalized Transfer touching a Capxul account's address has exactly one line on that account. No other line exists. |
| `inv:bank.statement-balances` | For every Capxul account and block B: the sum of `capxul_amount_raw` through B equals `balanceOf(address, token)` at B. |
| `inv:bank.ledger-is-statement` | Every GL Entry on a Capxul account belongs to a voucher reconciled `Voucher Created` to a line of that account. The account's GL balance equals the sum of its lines. |
| `inv:bank.nothing-before-finality` | One block short of finality, no line and no GL exist on a Capxul account for the payment. One block later, both do. |
| `inv:bank.one-voucher-per-payment` | Every settled Capxul Payment has exactly one live voucher, and no Capxul Payment that is not settled has one. |
| `inv:bank.advice-proves` | `hashTypedData(advice)` equals the event's `documentHash`. The recomputed id equals the event's `paymentId`. Every allocation's document re-hashes to its `content`. The voucher's references equal the allocations, or the difference is recorded. |
| `inv:bank.replay-is-noop` | Pushing an Organization's whole feed again from seq 1 changes nothing. |
| `inv:bank.crash-converges` | If the push is killed after the line is written and before the voucher (fault injection at each step), one completer run reaches the same state as a clean run. |

### 7.2 One acceptance eval per path

| Path | World | Drive | Assert, in addition to 7.1 |
|---|---|---|---|
| P1 | `org-with-supplier-invoice`: a department with one wearer and PI-0101 | pay the invoice from the department, and sign | PI-0101 is Paid; one Payment Entry with reference P, cost centre = the department's, `clearance_date` = the block's day |
| P1, Board | the same, with Directors | propose, and approve to the threshold | the same, with no budget |
| P2 | two invoices | pay both in one payment | one line; one Payment Entry with two references |
| P3 | an invoice with payment terms | pay the Deposit term | Partly Paid; the term's row is paid; the advice's lines are on the Capxul Payment |
| P4a, P4b | an Organization customer; an outside payer at a link | inbox pay; fund the escrow, then `payout()` | P4a: both sites book from one advice. P4b: nothing is booked at funding, a Receive at payout, and the surplus is not booked. |
| P5 | a run of 3 Employees and 1 new hire with no account | pay the run | 3 Bank Entries, each with its slip's id; the new hire Escrowed; `has_bank_entries` |
| P6, P7 | a claim; an advance, then its return | pay; pay, then pay back | the claim is Paid; the advance is paid, then returned |
| P8 | a freelancer with a mailbox | fund, then claim; fund, then refund (by a new wearer after a hat swap) | the funding is an Internal Transfer to Money waiting; the claim is a Pay from Money waiting; the refund is an Internal Transfer back, with the invoice still owed |
| P9 | a department whose holder is swapped while an approval is open | sign with the old holder; retry with the new one | the old holder is refused with nothing moved; the new one settles the same id |
| P10 | a deposit stand-in with and without an RF reference | Bridge's events and the Transfer | with: Paid, with fees on bank charges. Without: the line is Unreconciled, then booked after `bank match`. |
| P11 | a supplier's bank account | `bank pay`, then deliver; again with a return before delivery and after delivery | In transit, then Paid; a return before delivery leaves the invoice owed without re-opening it; a return after delivery re-opens it |
| P12 | an outside bank with a statement import | record a payment; import its statement; deposit from own bank via Bridge | auto-reconciled by reference; one multi-currency Internal Transfer matched to both lines |
| P13 | a dated payment | schedule; warp to `payAt`; execute | nothing until the execute's block; posting date = that block's day |
| P14 | a dated payment; an approval | cancel; let the approval expire | Cancelled, with no voucher or line ever written; G5 releases the invoice |
| P15 | an anvil reorg of a settled payment's block, then re-inclusion | reorg; re-mine | the voucher is cancelled, the invoice is owed, then a new voucher with `amended_from` |
| P16, P17 | a EUR Company, a GBP invoice, an 18-decimal token | pay via Bridge and directly | exchange gain or loss as computed; raw units exact; Currency Exchange rows for the block's day |
| P18 | an agreement with two accrued periods | the contractor collects 1.5 periods | allocated oldest first |

### 7.3 Negative evals

- **G1–G6.** As the site's Administrator, try each forbidden post: a line on a Capxul account; a Purchase Invoice with
  `is_paid` on Treasury; Make Bank Entry on a Capxul run; cancelling a run after pay; cancelling an invoice with a
  payment in flight; cancelling a `Voucher Created` voucher. Each is refused with a Capxul error, never a Frappe one
  (`aaron.one-product`).
- **The advice refuses** an advice that does not balance, a self-payment and a zero salt, each with INVALID_INPUT.
- **Mismatch.** A PaymentSent whose recipient differs from the order: the payment is Mismatched, nothing posts and the
  line is Unreconciled.

---

## 8. What this design changes in the book

These items are for the design lane. Each is book first.

1. **Books.** The Capxul copy of the ledger goes: Frappe keeps the GL under `aaron.frappe-native`, and books'
   head-voucher copy and annotations give way to Frappe's documents. What stays is the money facts feed (seq, gap-free,
   `docs/design/frappe/accounting.md:139-146`) as the statement's outbox, plus the completer.
   - `books.vouchers`'s cancel-and-amend becomes G7.
   - `books.escrow-held` is reversed by `bank.money-waiting`.
   - The Bank Reconciliation workspace is shown and re-skinned, not hidden (`docs/design/frappe/accounting.md:401`).
2. **Documents.** A new kind, `advice`, as in section 2. It replaces the Memo as the document of every Capxul payment
   by an Organization. The request's Invoice and the payslip become `content` hashes inside an advice.
3. **Payments.** At prepare, the Payment writes its Capxul Payment to the site (`payment.open`). The settle guard is
   unchanged. Kinds follow v4's table (4.3).
4. **Banking.**
   - A payout's document hash is the advice, superseding `banking.payout-document-hash`.
   - A payout is two hops through Payouts in transit (`bank.payout-two-hops`).
   - A deposit's line waits for Bridge's metadata.
   - Each Sales Invoice gets an RF payment reference.
5. **Requests.** A request is its Sales Invoice. `bank match` books a line by making its voucher from the line.
6. **Payroll.** Frappe HR computes the run and books the accrual. Capxul pays it. There is one Bank Entry per slip,
   made from its line (`bank.entry-per-slip`), and G4 applies.
7. **Indexing.** Pairing a Transfer with its PaymentSent (1.2). `capxul_actor_safe` comes from the UserOperationEvent.
   One finality tag for settlement and the statement (`bank.finality`).
8. **Corrections already found by `frappe.md:653-668`:**
   - Employee may also reference Leave Encashment and Gratuity;
   - Customer may reference Dunning and Payment Entry, and Supplier may reference Payment Entry;
   - a single-currency difference goes to bank charges.

---

## 9. Risks, and what is left open

### Risks

- **ERPNext internals.**
  - The matcher calls `_reconcile_vouchers`, a private function (`bank_reconciliation_tool.py:1251-1262`).
  - The public create-and-reconcile path overwrites exchange rates (`:1021-1045`).

  So: pin the ERPNext version, and give each call a contract test in the app's own suite.
- **Volume.** One line per Transfer and one voucher per payment. A run of 500 people makes 500 lines and 500 Journal
  Entries in one Frappe transaction (K4). It must be measured. If it is too slow, a transaction's lines can post in
  pages under one seq, with the Capxul Payments not marked Settled until the last page.
- **Outstanding moving while a payment is in flight.**
  - Capxul reserves what is in flight (G5, and prepare's check of outstanding less what is in flight).
  - A payment from an outside bank can still race it.
  - The fallback is on-account plus a difference (1.4), never a refusal.
- **Two canonicalizers would drift.** There is one, in the app. Capxul stores the canonical bytes, and conformance
  vectors in the evals pin it.
- **Bridge.**
  - Its webhook ordering and retries are undocumented (`prior-art.md:740-741`), so each line waits on both the chain
    and Bridge's event, keyed by the deposit id.
  - A Bridge event that never arrives costs a deposit line its description, not its money.
- **Two-hop payouts change what users see.** An invoice reads unpaid for the one to three days a payout is in transit
  (a question for Aaron, below).
- **Money waiting as a bank account is unusual.** Its "statement" pools many escrow addresses under one Bank Account,
  whose `bank_account_no` cannot list them. The Capxul app keeps that list. ERPNext's tool still works on it.
- **Agreement collections allocate FIFO.** This is wrong in disputes (4.2, item 1).
- **Stablecoins' classification.** The Safe accounts are type Bank for daily work. Whether a stablecoin is a cash
  equivalent is the company's own accounting policy, and under FASB's proposal it may not be when it is redeemed
  through Bridge (`prior-art.md:695-732`). Nothing here hard-codes it.

### Open, for the design lane, not for Aaron

- How the reconcile screen and the CLI name things: "Statement line", "Payment" and "Reconcile" are suggestions only,
  for the surface pass.
- Whether the RF reference also goes into the bank details' memo field that Bridge pre-fills.
- Paging a very large run (above).

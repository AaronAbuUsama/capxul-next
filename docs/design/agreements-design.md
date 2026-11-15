# Agreements, invoices and escrow: one document, one hash, one payment

Status: agreed with Aaron, 14 and 15 November 2026, as the study the roadmap's decision "Every payment settles one sealed document" cites, except its §3.2, §3.4 and §5, which `invoice-ledger.md` replaces, and its streaming (§3.3), which the decision "No streaming pay" settles.

Design study of 14 November 2026, read-only. It replaces the agreement recommendation (P1-B, "no invoices; accrual journal
entries") of `primitive-mapping.md`, which Aaron rejected. Its budgets (P3) and departments (P5) stand.

**How paths are cited.** As in `primitive-mapping.md`:
- `C:` is `packages/contracts/src/` on `master` (read in `/home/user/wt/records`). `F:` is `packages/frappe-app/capxul/`.
  `BP:` is `packages/blueprint/src/`.
- `E:` and `H:` are ERPNext v16.54.0 and Frappe HR v16.53.2, read from the bench image's layers
  (`.../overlayfs/snapshots/1170/fs/.../apps/erpnext/erpnext/`, `.../1171/fs/.../apps/hrms/hrms/`).
- `infra:` is the old stack at `/home/user/infrastructure`. `main:` is `origin/main` of capxul-next.
- **[K]**: from my knowledge of ERPNext/HRMS, not read in source. **[A]**: an assumption. **[G]**: a guess.

## 0. The answer in eight lines

1. **The rule.** Every on-chain money movement settles exactly one sealed Frappe document. It carries that document's
   hash. Its payment id is derived from the document, so **a document can be paid only once, by any route**.
2. **The hash becomes salted and disclosable.** Today's hashes have no secret salt, so anyone who can guess the fields can
   confirm a guess. A per-document random salt, held only by the parties, fixes that, and a separate line-items hash lets a
   holder prove the header without showing the lines.
3. **Invoices go both ways.** The payee's Sales Invoice is sealed once. Core delivers it to the payer's site as a Purchase
   Invoice carrying the same hash. One payment posts both books.
4. **An agreement is a cap and a terms hash.** Each collection names the hash of a new invoice or statement it settles.
   The invoice is raised per period, per milestone or on demand. The cap is enforced on chain; the document is in Frappe.
5. **Streaming goes Frappe-side by default.** A "Payment Stream" (a Capxul Payment Agreement driving ERPNext's
   Subscription) raises the documents, and the chain settles each one within the cap. Per-second accrual stays only for
   early access to pay, and each early collection is still a document.
6. **Escrow is the general escrow (`aaron.escrow-general`), settling one document.** For a Stripe crypto payer with no
   account, the escrow's owner is the payer's email-derived Safe. It pays the invoice automatically once it holds the
   amount. Otherwise the payer claims the account and takes the money back.
7. **Payroll.** Each Salary Slip is a sealed document, paid by one payment. Early access to pay is an Employee Advance,
   recovered in the slip.
8. **What changes.** Five contracts change (Payments, Budgets, Agreements, Escrow with its factory, and Companies House's
   claimer), and the Capxul app gains four doctypes. Both are serial lanes; the blueprint work around them parallelises.

## 1. What the old system was trying to do

| Idea | Intent (what it was for) | Implementation (how the old stack did it) |
|---|---|---|
| **Document hash** | Make the database a cache of the chain. Every settled payment carries enough on chain (its purpose, the document hash and its terms) to rebuild and audit the ledger. A "settled" row with no chain event becomes impossible (`infra:docs/adr/0018-…md:58-64`, P4). Purpose: attestation and best-effort obfuscation, "never meaning-making" (`:228-232`). | The hash is an EIP-712 typed hash of a versioned envelope (Memo, Invoice, Payslip, Receipt; v4 and v5 Invoices) under a constant domain salt per version (`infra:packages/protocol/src/documents/hash.ts:47-106`, `schema.ts:33,191`). `originId` is deterministic: `keccak("capxul.checkout.origin:"+id)` (`infra:packages/backend/src/requests/writes/purchases.ts:125`). The hash is mandatory and non-zero on chain (`C:money/Payments.sol:56`). |
| **Invoice** | An immutable promise to pay, whose terms the chain can prove: "the document hash binds amount/dueAt/lineItemsHash — this is physics" (`infra:…/0018…md:146-148`). Line items stay off chain behind `lineItemsHash` (`hash.ts:68-79`). Recurring invoices commit series and period, so double billing and unpaid periods are provable (R7, `0018…md:176-183`). | A `paymentRequests` row, frozen at issue, stores its envelope (`infra:packages/backend/src/requests/README.md:12-15`). A public pay link resolves it (P7). |
| **Settlement id** | One invoice is paid once, whoever pays and by whatever route. "An existing Invoice id becomes its jobNonce"; for invoices the executor is zero, so anyone may pay (`infra:docs/adr/0033-…md:73-77`; ADR-0038 table, "economic settlement id for an Invoice", `0038…md:26`). | V3 router id `keccak(chainId, router, jobNonce, executor, recipient, token, amount, kind, documentHash)` (`infra:packages/contracts/src/CapxulPaymentsV3.sol:10`). |
| **Requests and inbox** | The issuer asks; the named payer sees exact terms in an inbox and approves. Approval and the payment's birth are one transaction (`requests/README.md:1-25`). Outside payers pay by link. | `requests.receivables`, `requests.inboxes` and `checkouts`. Main collapses link checkout to "name your email, then the escrow or your inbox" (`main:blueprint/requests/decisions.ts:271-296`). |
| **Escrow** | Two payments cannot carry a settlement id straight to the payee: an outside payer (an external wallet, or **Stripe Crypto, which "must deliver to an address the buyer controls, never to a third party"**), and a payee not on Capxul. Money waits for a condition; it is never lost (`infra:docs/adr/0035-…md:10-20`). | One CREATE2 escrow per job. Its conditions are "invoice amount reached" (anyone pays out) or "payee claimed" (`C:money/Escrow.sol:18-20,98-107`). The ownership rule moved: ADR-0035 says the sender owns it (`:31-37`). `aaron.escrow-general` says the recipient's future account owns it and the sender reclaims until then (`main:blueprint/shared/rulings.ts:396-420`). Main's general terms carry both roles (`main:blueprint/shared/external.ts:1150-1159`). |
| **Counterfactual account** | Anyone reachable by email already has a Safe address, so money can be sent before sign-up. Proving the email later hands that Safe to its person (`infra:packages/backend/src/accounts/README.md:3-8`). | Salt nonce `keccak(namespace ":" email)`. Companies House is the bootstrap owner, and `claim` swaps in the person's signer (`C:interfaces/ICompaniesHouseClaimer.sol:8-38`; `C:companies-house/CompaniesHouseClaimer.sol:98-114`). The trust root is accepted for the beta (`aaron.claim-trust`, `rulings.ts:305-319`). |
| **Agreements and streams** | The payer does not lock capital. The payee withdraws earned pay with their own signature, and no Capxul key moves money (`infra:docs/adr/0037-…md:24-38`). The agreement's document hash is stamped on each withdrawal (`:26-28`). | First a Roles allowance (ADR-0037), now `C:money/Agreements.sol`. Every collection carries the **same** terms hash (`:221-222`), so a collection settles no document of its own. |

**What it was reaching for and did not finish.** Each payment tied, provably, to a document both sides hold, without
publishing it. It fell short: the hash is unsalted; an agreement's collections share one hash, as do an escrow's funding
and payout (`C:money/Escrow.sol:135-147`); and the rebuild's thin line hashes the payer's own **Payment Entry**
(`F:canon.py:36-63`), not the invoice both sides hold, which it reaches only by name (`:37-43`).

## 2. The privacy model

**On chain, public:**
- every movement's payer address, payee address, token, amount, time and `kind`;
- the opaque `documentHash` and the `paymentId`;
- an agreement's rate, period, dates, budget id and terms hash;
- an escrow's terms (owner, sender, payee Safe, amount, hash).

Amounts and addresses cannot be hidden without a privacy token. That is out of scope; it is noted for Q-list review.

**In Frappe** (the full record, on the site of each party that has one):
- the document;
- its seal: the canonical bytes, the salt and the hashes;
- the links to the payment.

**In Core's document store:** a copy of the sealed bundle, kept **only** for delivery between companies and for a party
with no site yet, such as an outside payer [A: consistent with `main:blueprint/documents/decisions.ts:103-123`
(current-scope), but Aaron's "Frappe holds the full records" may want Core to forget the bundle once both sites hold it].

**The seal (canon v2).** It follows main's `documents.encoding-v1` byte rules (`main:blueprint/documents/decisions.ts:397-409`):
recursively sorted keys, UTF-8, no whitespace, amounts as integer minor-unit strings and lowercase addresses. It adds two
salts:
```
lines_hash    = keccak256(canon({ "salt": lines_salt, "lines": [...] }))          // the line items, salted separately
content_hash  = keccak256(canon(header))   // header = kind, issuer {org, safe}, counterparty {ref, safe}, number,
                                           // issued_on, due_on, token, total_minor, tax_minor, lines_hash,
                                           // terms_hash (if under an agreement), agreement_id, period {from, to}
document_hash = EIP-712 hashStruct Document(bytes32 salt, uint16 kind, bytes32 contentHash)
                under domain { name "Capxul Document", version "2", chainId }
```
Both salts are 32 random bytes, generated when the document is submitted (sealed). They are stored only in the seal and
disclosed only with the document. EIP-712 is kept so that a wallet can show the hash it signs, for an agreement's terms
(`C:money/Agreements.sol:193-199`).

**Who can verify what.**

| Holder | Holds | Can prove |
|---|---|---|
| Anyone | the chain | that a payment of X went from A to B, settling some hash H |
| Payer, payee, or an auditor they give the **full bundle** | header, lines, both salts | everything: recompute H, then find the payment by H |
| An auditor or bank given the **header bundle** | header, `salt` (not `lines_salt`) | parties, total, dates and number match H, without the line items |
| A guesser with no salt | only public data | nothing: H is a commitment under 256 random bits |

**Proof that a document matches the chain.** The operation is `documents.verify` (main keeps a `verify`,
`documents/decisions.ts:275`). It takes four steps:
1. Recompute `content_hash` and `document_hash` from the bundle.
2. Derive the expected `paymentId` from (payee Safe, token, total, kind, H), as in §5 C1.
3. Read `PaymentSent` by that id from the indexer.
4. Answer `{matches, paid: {tx, block, amount, from, to}}`.

Because the id is derived from the document, it is "this document was paid", not "some payment mentions this hash".

**Privacy gaps found today**, fixed below: (a) **unsalted hashes**: `F:canon.py:44-59` hashes the entry name, company,
date, party and amount, all guessable, and `stored_hash` likewise (`:78-84`); (b) **the email in plaintext on chain**:
`claim(namespace, email, signer)` puts it in calldata (`C:companies-house/CompaniesHouseClaimer.sol:98`), and anyone can
derive a guessed email's Safe (`ICompaniesHouseClaimer.sol:45-52`); (c) **one hash, many payments** (collections, escrow
legs); (d) **`kind` publishes the category**, payroll included.

## 3. The architecture

### 3.0 The rule, and its key

- **The document is the unit.** A submitted Sales Invoice, Purchase Invoice, Salary Slip, Expense Claim, Employee Advance
  or Contract is **sealed** on submit (a Capxul Document Seal, §4). A sealed document is immutable. ERPNext already forbids
  editing a submitted document; amending makes a new name [K], and so a new seal and a new hash.
- **The reconciliation key is `paymentId`, derived from the document**:
  `keccak(typehash, chainId, payments, recipient, token, amount, kind, documentHash)`, with no route component (§5 C1).
  Frappe computes it at seal time, stores it on a Capxul Settlement (§4) and matches `PaymentSent` by it, not by hash
  (replacing `F:payments.py:165-168`).
- **A payment for a sealed hash with a different amount or recipient** gets another id, so it lands as an unmatched Bank
  Transaction (`F:payments.py:221-235`), as today.

### 3.1 Invoices, both ways

```
payee site (BrightSide)                  Core                         payer site (Acme)
Sales Invoice SI-031 ─submit→ seal H ──→ deliver bundle (H, bytes) ──→ Capxul Document Seal (inbound, H re-verified)
Payment Request (Inward, pay link) [E]                                  └→ draft Purchase Invoice, bill_no = SI-031,
                                                                           capxul_document_hash = H  → person submits
                                     invoice.pay (op) ← Mia ──────────── Capxul Settlement: id = f(BrightSide Safe, 450, H)
                                     Budgets.spend(…, H) → PaymentSent(id, Acme Safe → BrightSide Safe, 450, H)
Payment Entry (Receive) vs SI ←── chain event, by id ──→ Payment Entry (Pay) vs PI, posted by the chain
```

- **The payer's site.**
  - It re-derives H from the delivered bytes before it drafts the Purchase Invoice.
  - A person on the payer's site submits the PI. This is the inbox's approve, now an ordinary submit with Frappe's
    permissions.
  - Paying it is an operation that drafts a Payment Entry against the PI and holds it, as the thin line does
    (`F:core_api.py:122-172`). The hash it carries is **the Sales Invoice's H**, not the entry's own (`F:core_api.py:141`
    changes).
- **The payee's site.** Its chain event posts a Receive Payment Entry against the SI, keyed by the same id. An ERPNext
  Payment Request (Inward) gives the email and the payment URL (`E:accounts/doctype/payment_request/payment_request.py:329-347`,
  via `primitive-mapping.md`).
- **A payer with no site** uses the pay link and §3.4's escrow. **A payee with no site** (a person) gets a
  **self-billed** Purchase Invoice from the payer's site, sealed and paid the same way.
- **Instalments.** An invoice with a Payment Schedule seals one instalment sub-document per row: a header with the parent
  H, its portion and its due date. Each is paid once. If not, the rule is one invoice per payment (Q8).

### 3.2 Payment agreements

**The agreement is the standing authority, and its terms are a document.** The terms are an ERPNext Contract (party
Supplier, Customer or Employee; `contract_terms`; start and end; fulfilment terms;
`E:crm/doctype/contract/contract.json:49-253`). The Contract is sealed: `termsHash` = H(Contract). A Capxul Payment
Agreement (§4) links the Contract, the party, the budget, the schedule and the chain id.

**Every collection settles a new document**, raised by Frappe in one of three ways:
- **per period:** ERPNext Subscription (`E:accounts/doctype/subscription/subscription.py:328,414-491,604`; intervals Day,
  Week, Month and Year, with proration, `:537-544`) makes the invoice on the right side;
- **per milestone:** an invoice for a Contract fulfilment row;
- **on demand:** for accrual mode, a statement for exactly the window being collected.

The invoice's header carries `terms_hash` and `agreement_id`, so the document names its agreement.

**Who raises it** (Q1): the payee, as a Sales Invoice delivered as in §3.1, when it has a site (an Organization);
otherwise (people, employees) the payer's site self-bills a Purchase Invoice or an Employee Advance.

**The chain enforces the money rule. Frappe enforces the document rule.** The contract cannot read a document; it checks
that the amount is within the cap, the hash is non-zero, not the terms hash and new for this agreement, the caller is the
payee, and the review window has passed. The payer's site reconciles every `Collected` against the Capxul Settlement it expected. A collection whose hash no
document of the agreement has is flagged as unmatched, and the payer can pause or end the agreement.

**Agreements v2: the interface** (§5 C3):
```solidity
struct Terms { address token; uint8 mode;            // 0 Accrual (rate released by step) | 1 Allowance (ceiling per period)
               uint128 rate; uint8 period; uint64 step; uint128 ceiling; uint128 totalCap;   // totalCap 0 = none
               uint64 startsAt; uint64 endsAt; uint64 offerExpiresAt; uint32 reviewWindow; }
function offer(uint256 budgetId, address payee, Terms calldata t, bytes32 termsHash) external returns (uint256 id);
function accept(uint256 id, bytes32 termsHash) external;                         // unchanged check (TermsMismatch)
function amend(uint256 id, Terms calldata t, bytes32 newTermsHash, uint64 effectiveAt) external;  // payer's hat
function acceptAmendment(uint256 id, bytes32 newTermsHash) external;             // payee; a raise applies without it
function present(uint256 id, uint128 amount, bytes32 documentHash) external;     // payee: holds `amount` of available
function reject(uint256 id, bytes32 documentHash) external;                      // payer's hat, inside the window
function collect(uint256 id, bytes32 documentHash) external returns (bytes32 paymentId); // payee, once collectable
function collectNow(uint256 id, uint128 amount, bytes32 documentHash) external returns (bytes32); // reviewWindow == 0
// pause, resume, end, withdrawOffer, settle: unchanged.
// views: availableOf(id), presentedOf(id, hash), paymentIdFor(id, amount, hash)
event Presented(address indexed safe, uint256 indexed id, bytes32 documentHash, uint128 amount, uint64 collectableAt);
event Rejected(address indexed safe, uint256 indexed id, bytes32 documentHash);
event Collected(address indexed safe, uint256 indexed id, address payee, uint128 amount, bytes32 documentHash, bytes32 paymentId);
event TermsAmended(address indexed safe, uint256 indexed id, bytes32 termsHash, uint64 effectiveAt);
```

**Caps.** Accrual: today's Calendar maths (`C:libraries/Calendar.sol`), `available = released − collected − presented`.
Allowance: `ceiling − (collected + presented this calendar period)`, never past `totalCap`. The budget reservation is as
today (`C:money/Agreements.sol:89-92`).

**`amend` fixes `changeRate` keeping a stale hash** (`:124-148`; `primitive-mapping.md` Q4). A rate change is a new
Contract version, so it has a new terms hash.

**The review window** (Q2): 0 for pay, a few days for supplier agreements. It is the payer's on-chain veto, without the
payer having to sign each payment.

### 3.3 Streaming: on-chain accrual or a Frappe Payment Stream

| | A. On-chain accrual (today's Agreements) | B. Frappe "Payment Stream" raising invoices; the chain settles each within a cap |
|---|---|---|
| Precision | To the second, released by step | Per invoice: a day at finest in practice [A] |
| The payer's action per payment | None | None (the payee collects within the cap); with a review window, an optional veto |
| Documents and books | None of its own; needs a Capxul accrual JE (the rejected P1-B) | Each period is a submitted invoice: **that is the accrual** (Dr expense, Cr Creditors on submit, `E:…/purchase_invoice.py:853,920` via `primitive-mapping.md`). AP ageing, taxes, withholding and credit notes are ERPNext's own |
| Proration, pause, rate change | Calendar maths on chain | Subscription's prorate (`subscription.py:537-544`), and pause by Subscription status; chain cap updated by `amend` |
| Coupling | The payee can always collect | Collection waits on a document existing. Mitigation: Core builds and seals a payer-issued statement from chain facts if the site is unreachable [A] |
| Contract | The full Calendar engine (`Agreements.sol` 440 lines) | Allowance mode only: a ceiling per period |
| Agent ergonomics | "Collect" is a chain call with no record | "Collect" settles a named invoice; one record per payment |

**Recommendation: B, with A kept as a cap mode, not a ledger.** The default is the Frappe-side Payment Stream (the
Capxul Payment Agreement with a schedule) plus an Allowance-mode agreement. Accrual mode stays for early access to earned
pay only, and even there every collection is an on-demand document (§3.5). This is Aaron's "new doctypes in Frappe" with
the money rule on chain; the invoices are the accrual, and Frappe owns the schedule, so nothing invents one.

### 3.4 Escrow for counterfactual accounts, end to end (a Stripe crypto payer)

**Interpretation [A].** In Aaron's example, the crypto must land in an account the **buyer** controls (ADR-0035, line 15),
and that account controls the escrow. The general escrow has an `owner` and a `sender` (`main:…/external.ts:1150-1159`).
For a checkout, both are the buyer's email Safe.

Example: Acme bills Carol, who is not on Capxul, 450 USDC on a Sales Invoice.

| # | Step | Chain | Frappe (Acme's site) | Hash and ids |
|---|---|---|---|---|
| 1 | Acme submits the SI | — | SI sealed (Seal); ERPNext **Payment Request** (Inward) emails the pay link | H = H(SI) |
| 2 | Carol opens the link and enters her email; Core sends a code; she proves the email | — | Capxul Escrow drafted: `payer_email` (restricted), status Predicted | — |
| 3 | Counterfactual Safe: S_c = Safe(namespace, blind(email)) (§5 C6), not deployed | — | Capxul Escrow `owner_safe` = S_c | — |
| 4 | Terms: owner = sender = S_c; payee = Acme Safe; amount 450; token; kind invoice; H; condition amount-reached; optional `notBefore`. E = `predictAddress(terms, salt)` | — | Capxul Escrow `escrow_address` = E, `payment_id` = id(Acme Safe, 450, H) | the payout id equals any other route's id for H |
| 5 | Stripe onramp delivers to **E**: an address only Carol's Safe can take money back from (Q3) | a Transfer into E | Capxul Escrow: Funding (each Transfer logged); **no GL entry**: the money is Carol's | — |
| 6 | The request's process sees a balance ≥ 450, deploys E, and calls `payout()` (anyone may) | `PaymentSent(id, E → Acme Safe, 450, H)`; any surplus goes to S_c | Settlement matched by id → Payment Entry (Receive) vs the SI; Payment Request Paid; Escrow Paid | id, H |
| 7a | Short by fees: E waits; Carol tops up | further Transfers | Escrow stays Funding | — |
| 7b | Or Carol signs up with that email: Companies House's `claim` installs her signer on S_c; S_c calls `refund()` and the money goes to S_c | `EscrowRefunded` | Escrow Refunded; the SI stays unpaid (overdue is derived) | — |
| 7c | Someone paid H another way | `paid[id]` already true, so `payout` returns the balance to S_c (`C:money/Escrow.sol:124-130`) | Escrow "Completed by another payment" | — |

Once she has an account, Carol's own site (if any) imports the sealed SI from Core as a Purchase Invoice, and the payment
already on chain posts it at once.

**Paying an email (a supplier or new hire with no account).** This is the same escrow:
- owner = the payee's S_p; sender = the company Safe; authority = Budgets and the budget id; condition owner-collects
  (`main:blueprint/payments/decisions.ts:960-1030`);
- **funding:** `Budgets.spend` to E (id_f, recipient E). Acme posts an Internal Transfer from the Safe to "Money in escrow";
- **collection:** the payout id is the same as a direct payment of H to S_p. It posts the Pay entry from "Money in escrow"
  against the PI or Slip;
- **refund:** an Internal Transfer back (P4-B of `primitive-mapping.md`, now keyed by distinct ids rather than a shared
  hash).

### 3.5 Payroll

**Path (i), computed pay.**
- A Payroll Entry makes the Salary Slips (`H:payroll/doctype/payroll_entry/payroll_entry.py:80`). Each submitted slip is
  sealed, with H_slip including the net pay.
- Paying the run is one `Budgets.spend` per slip, in one batch: kind payroll, the employee's Safe, the net, H_slip.
- Each `PaymentSent` posts the Bank Entry share (Dr Payroll Payable, party Employee; Cr Safe). It is keyed by id. This
  replaces `make_bank_entry`'s draft (`payroll_entry.py:1054,1238`), held as `F:core_api.py:146` holds a Payment Entry.
- Withheld tax and statutory deductions are paid to the authority as a separate sealed Purchase Invoice or Journal Entry.
- A new hire with no account gets §3.4's escrow.

**Early access (earned-wage access).**
- An Accrual-mode agreement with the employee as payee, rate = the expected **net** pay.
- Each collection is an on-demand **Employee Advance**, self-billed and sealed (H_adv), collected with `collectNow`.
- At period end the advance is recovered through Additional Salary
  (`H:hr/doctype/employee_advance/employee_advance.py:266-282`, `repay_unclaimed_amount_from_salary`, `.json:180`). The
  slip's net is reduced by it, and only the remainder is paid on chain [K: that the recovery lands in the same slip
  depends on the Additional Salary payroll date].
- This answers "gross on chain against net in the slip": the chain only ever advances net pay.

**Contractors and retainers** are agreements with invoices (§3.2), never slips. This matches main's
`payroll.agreements-in-frappe-shape` (`main:blueprint/payments/agreements/decisions.ts:649-670`).

## 4. Frappe doctypes to add

Each one changes the Capxul app on the shared bench. The app is copied into the image, and a world that changes it brings
its own bench (`docs/roadmap.md:19`). Each scores "Frappe app change", so it is **not** parallel-safe (`docs/roadmap.md:33`).
They are built **serially**, in the order of §6.

| Doctype | Purpose | Key fields | Lifecycle | Link to the chain |
|---|---|---|---|---|
| **Capxul Document Seal** | Freezes one submitted document's canonical bytes and salts; the only place the salts live | `ref_doctype`, `ref_name`, `kind`, `canon_version`, `salt`, `lines_salt` (both permlevel 1: the doc's owner roles and Core only), `content_hash`, `lines_hash`, `document_hash`, `canonical_json`, `origin` (Local or Inbound), `issuer_org`, `parent_hash` (instalments, agreement terms) | Made on `on_submit` of SI, PI, Salary Slip, Expense Claim, Employee Advance, Contract and Capxul Payment Agreement (hooks beside `F:hooks.py:21-29`); immutable; an inbound one is re-verified on insert. Cancelling the referenced doc is refused while a Settlement of it is Sent | `document_hash`; custom field `capxul_document_hash` on each sealed doctype |
| **Capxul Settlement** (replaces Capxul Payment Request, ending the name clash with ERPNext's Payment Request, `primitive-mapping.md` P6) | One expected or observed on-chain movement | `payment_id` (unique), `document_hash`, `settles` (Dynamic Link), `route` (Spend, Schedule, Batch item, Escrow funding, Escrow payout, Collection, Receipt), `direction` (Pay or Receive), `payment_entry` or `journal_entry`, `amount`, `recipient`, `approval_id`, `tx_hash`, `block_time`, `status` | Prepared → Waiting for signature → Sent → Posted; or Failed, Mismatch, Unmatched. Receipts are born Sent | `payment_id` is the key; `apply_payment_sent` matches on it |
| **Capxul Payment Agreement** (the "Payment Stream") | Terms and schedule of one standing agreement; drives the documents | `party_type` and `party`, `contract` (sealed; `terms_hash`), `budget` (Department or Cost Center, with `budget_id`), `mode` (Accrual or Allowance), `rate`, `period`, `step`, `ceiling`, `total_cap`, `review_window`, `starts_on`, `ends_on`, `offer_expires_on`, `schedule` (Per period, Per milestone, On demand), `issuer` (Payee or Self-billed), `subscription` (an ERPNext Subscription when per period), `agreement_id`, `status` (Prepared, Offered, Active, Paused, Ending, Ended, Lapsed, Withdrawn), child `collections` (document, hash, amount, payment_id, presented_at, collected_at, state) | Draft → Submitted (the offer is sent) → mirrored from chain events (accepted, paused, amended, ended); an amendment makes a new Contract version and `amend` | `agreement_id`, `terms_hash`; each collection's `payment_id` |
| **Capxul Escrow** | One escrow job and its funding | `escrow_address`, `salt`, `owner_safe`, `sender_safe`, `authority`, `authority_key`, `payee_safe`, `token`, `amount`, `condition`, `not_before`, `document_hash`, `settles`, `payer_email` (restricted), child `fundings` (tx, amount, from), `funding_payment_id`, `payout_payment_id`, `status` (Predicted, Funding, Paid, Refunded, Completed by another payment) | Made by the checkout or pay-to-email operation; mirrored from Transfer, EscrowDeployed, PaymentSent and EscrowRefunded | `escrow_address`; both payment ids; `document_hash` |

**Custom fields and settings.** `capxul_document_hash` on every sealed doctype; `capxul_inbound_from` on Purchase
Invoice; `capxul_payment_id` on Payment Entry and Journal Entry; the "Money in escrow" account in Capxul Settings; new
chain-event kinds `collected`, `presented`, `rejected`, `escrow_*` and `agreement_*` (`F:api.py:13-20`).

## 5. Contract changes, and what migrates

1. **C1. Payments: the payment id is the document's.**
   `paymentId = keccak(TYPEHASH_V2, chainId, this, recipient, token, amount, kind, documentHash)`. `jobNonce` leaves the id;
   `executor` stays an optional caller check, outside the id.
   - *Why:* one sealed document is paid once, whatever the route: Budgets, Agreements, Escrow, or an outside wallet. This
     is ADR-0033's "invoice id becomes its jobNonce; executor zero" made universal.
   - *What it removes:* today an escrow payout (executor 0 or E) and a budget spend (executor = the Safe,
     `C:money/Budgets.sol:515`) of the same invoice get different ids and could both land.
2. **C2. Budgets: follow C1.** `spend`, `schedule` and `payReserved` stop wrapping `jobNonce` (`Budgets.sol:229,338`);
   their signatures keep `documentHash`. This is the smallest change, and it is a change to Budgets, which
   `aaron.escrow-general` said not to touch (Q5).
3. **C3. Agreements v2 (§3.2).**
   - Per-collection `documentHash`, unique per agreement and not the terms hash.
   - An Allowance mode (a ceiling per period, plus a total cap).
   - `present`, `reject` and `collect` with a review window.
   - `amend` with a new terms hash.
   - The collection id comes from C1 (the hash), not `keccak(agreements, id, index)` (`Agreements.sol:222`).
   - *Why:* each collection settles its own document, and the payer gets a cap and a veto without signing every payment.
4. **C4. Escrow, general.** Main's designed terms (`main:…/external.ts:1150-1159`; `payments/decisions.ts:835-905`):
   - `owner`, `sender`, `authority`, `authorityKey`, `bootstrapOwner`, `condition`, `ownerTakesSurplus`;
   - plus `notBefore`;
   - payout through the C1 id.
   *Why:* one escrow serves checkout (owner = sender = the buyer), pay-to-email (owner = the payee, sender = the company)
   and Exits (`C:equity/Exits.sol:36,264` stop needing `isExitClaimEscrow`).
5. **C5. EscrowFactory.** The general terms; `predictPaymentId` uses C1.
6. **C6. CompaniesHouseClaimer: a blinded email.** The salt nonce becomes `keccak(namespace ":" emailCommitment)`, where
   `emailCommitment = HMAC(pepper, normalised email)` is computed by Core. Then `claim(namespace, emailCommitment, signer)`.
   *Why:* privacy gap (b). The trust root is unchanged (`aaron.claim-trust`). Who holds the pepper is Q4.
7. **C7 (optional). Coarser public kinds.** Kinds become: document payment, collection, escrow funding, exit. The fine
   kind (payroll, expense) moves into the sealed header. *Why:* privacy gap (d). Budgets' kind gate (`Budgets.sol:25-27,448`)
   changes with it.

**What migrates.** On chain, nothing: master's worlds are created and destroyed whole (AGENTS.md, "Worlds") [A: no
long-lived money sits on master's contracts]. Code follows: the deploy manifest (`packages/contracts/deploy/manifest.json`),
the indexer's ABIs, `BP:chain/logs.ts`, the Frappe canon (`F:canon.py` v1 → v2) and the starting world `payment-drafted`
(`BP:starting-worlds.ts:128-145`). Every email-derived Safe address changes (C6). Old envelopes (v3-v5, main's v1) are
reference only.

## 6. The order to build it

There are two **serial lanes**: contracts (new contracts; not parallel-safe) and the Capxul app (a Frappe app change). The
blueprint and operation units around them go into the parallel waves (`docs/roadmap.md:33`).

| Unit | Lane | Depends on | Content |
|---|---|---|---|
| U0. Canon v2 and decisions | blueprint (wave-safe) | Aaron's answers | Canon v2 in the blueprint (vectors for both salts, the header list per kind); refusals and events of agreements v2 and the general escrow; `documents.verify` |
| U1. C1 + C2 | contracts | U0 | Document-derived ids; Budgets follows; tests and the Certora/Halmos specs updated |
| U2. The seal and the thin line on v2 | app | U0 | Capxul Document Seal; custom fields; the thin line's entry carries the PI's hash; `payment-drafted` re-seeded |
| U3. Capxul Settlement | app | U1, U2 | Replace Capxul Payment Request; match by id; the unmatched path keyed by id |
| U4. Invoices both ways | app + ops | U3 | Core delivers sealed SIs; inbound PI; Receive entries; `invoice.issue`, `invoice.pay`, `documents.verify` |
| U5. C4, C5 and C6 | contracts | U1 | The general escrow and its factory; the blinded claim |
| U6. Escrow checkout and pay-to-email | app + ops | U4, U5 | Capxul Escrow; the pay link (Payment Request Inward); the request process; the claim and refund journey |
| U7. C3 | contracts | U1 | Agreements v2 |
| U8. Payment agreements and streams | app + ops | U6, U7 | Capxul Payment Agreement; Subscription wiring; `agreement.offer`, `accept`, `amend`, `collect`, `reject` |
| U9. Payroll | app + ops | U3 (and U6 for new hires, U8 for early access) | Per-slip payments; the chain-posted bank entry; Employee Advance early access |

The contracts lane (U1 → U5 → U7) runs alongside the app lane (U2 → U3 → U4 → U6 → U8 → U9). Operation-only follow-ups
of each app unit (CLI shapes, journeys, scenarios written by someone other than the builder) join the parallel waves once
their app unit is merged.

## 7. Open questions for Aaron

1. **The issuer of collection documents.** Should the payee issue the invoice when it has a site, with the payer's site
   self-billing for people and employees? Or should the payer always self-bill?
2. **The review window.** May a payer reject a presented invoice within a window set per agreement (0 for pay, a few days
   for suppliers)? Or is the cap the payer's only protection?
3. **The Stripe destination.** Is the escrow address (whose only exits are the invoice's payee or the buyer's own Safe)
   acceptable as "an address the buyer controls"? Or must the money land in the buyer's Safe first? That needs a deployed
   Safe with a forwarding module.
4. **The blinded email.** Accept changing every email-derived Safe to `HMAC(pepper, email)`, so that no email is on chain
   and none can be enumerated? And should Companies House's owners hold the pepper?
5. **One document, one payment.** Accept a payment id derived from the document alone, which means changing Budgets
   (against "we don't need to change the budgets") so that no route can pay a document twice?
6. **Streaming.** Accept Frappe-scheduled documents with an on-chain cap as the default, keeping per-second accrual only
   for early access to net pay, recovered in the slip?
7. **Escrow conditions.** Amount reached plus an optional not-before date only? Or also a third-party attestation (for
   example, delivery confirmed by a named Safe)?
8. **Instalments.** Seal one sub-document per Payment Schedule row, so that each is paid once? Or allow exactly one payment
   per invoice?

# The invoice ledger: how money reaches a sealed document

Agreed with Aaron on 15 November 2026, in the contracts-from-first-principles thread. This note is the direction he
settled on. It replaces the contract changes of `agreements-design.md` (its §3.2, §3.4 and §5); that note's seal and
privacy model (§2) stand. **This is a direction, not a specification. Do not build from it.** The spec that names every consequence is the job
set out in `handoff-knock-on-map.md`.

Paths: `C:` is `packages/contracts/src/`, `F:` is `packages/frappe-app/capxul/`, `K:` is `packages/core/src/`.

## The design in eight lines

1. **Payments is the invoice ledger.** It keeps a running total paid against each sealed document, where today it keeps
   a paid/unpaid flag per payment.
2. **The id names the invoice, not a payment.** It is derived from the payee, token, total, kind and document hash. No
   nonce and no executor are in it.
3. **A part-payment is just a payment.** Each one becomes one Payment Entry allocated against the invoice in Frappe.
4. **The chain does not refuse an overpayment.** The surplus sits on account in the payee's books.
5. **Three ways money reaches an invoice:** a company pays through Budgets; anyone pays the invoice's own address by
   plain transfer; a held payment keeps custody with the payer until the full amount is there.
6. **Payments and held money stay separate contracts.** Payments never holds funds.
7. **Agreements is one thin shared contract that only authorises.** A collection pays one of the payee's own sealed
   invoices, within a cap per period. The accrual maths goes.
8. **An invoice is signed off chain by the issuing member's own Safe**, checked against the department's hat.

## What is wrong today

- **The same document can be paid twice.** The payment id includes `jobNonce` and `executor` (`C:money/Payments.sol`,
  `_paymentId`). Core makes the nonce from its own request id (`K:approvals/payments.ts:59-72`), and Budgets wraps it
  again and sets the executor (`C:money/Budgets.sol:229, 515`). A second approval of the same entry gets a new id and
  lands. The site notices only afterwards and records an unmatched bank line (`F:payments.py:171-208`).
- **The hash is not the invoice.** It covers the payer's Payment Entry and has no salt (`F:canon.py:36-63`). The payee
  holds nothing that matches it.
- **An agreement's collections share one hash**, the terms hash (`C:money/Agreements.sol:221-222`).
- **Only a Safe that calls a function can pay.** A plain transfer carries no hash, so an exchange withdrawal or an
  on-ramp cannot pay an invoice.
- **No part-payments.** The amount is in the id, so a document is paid in exactly one payment.

## Payments

```solidity
struct Invoice { address payee; address token; uint256 total; uint16 kind; bytes32 documentHash; }

mapping(bytes32 => uint256) public paidOf;        // today: mapping(bytes32 => bool) paid

function invoiceId(Invoice calldata inv) public view returns (bytes32);
// keccak(INVOICE_TYPEHASH, chainId, this, payee, token, total, kind, documentHash)

function pay(Invoice calldata inv, uint256 amount, uint256 paidBefore) external;
// reverts PaidMoved unless paidOf[id] == paidBefore; sets paidOf[id] = paidBefore + amount (may pass total);
// moves exactly `amount` from the caller to the payee; emits
// InvoicePaid(id, payer, payee, token, amount, paidAfter, total, documentHash)
```

- **`paidBefore` stops the same part landing twice.** The caller names the paid-so-far figure it saw. A repeat, or a
  payment racing another, reverts and is retried against the new figure.
- **Unchanged from today:** no owner, no privileged function, no funds held, the exact-transfer check, the reentrancy
  lock, and a batch call.
- **`total` is in the id** so the on-chain record commits to the invoice's amount as well as its hash.

## The seal and the books

- **The seal** is canon v2 of `agreements-design.md` §2: a salt for the document and a second salt for the line items,
  so a holder can prove the header without showing the lines. The sealed document is the invoice both sides hold, not
  the payer's Payment Entry.
- **The site computes `invoice_id` when it seals**, and stores it on the seal.
- **Matching is by `invoice_id`.** Each `InvoicePaid` posts one Payment Entry against the sealed document, allocated up
  to the outstanding amount. Anything beyond it is left unallocated, as money received on account. ERPNext's own
  outstanding amount does the rest.
- **A payment whose id no seal has** stays an unmatched bank line, as today (`F:payments.py:221-235`).

## Three ways money reaches an invoice

| Way in | Who pays | Deployed | Refund |
|---|---|---|---|
| Budgets | A member of a Capxul company, in full or in part | Nothing | None |
| The invoice's address | Anyone, by plain transfer of any amount | A small clone, only once money has arrived | None, and no named payer |
| A held payment | A payer who must keep custody until the full amount is there | A small clone per invoice and payer | The payer claims a surplus or a short payment |

**Budgets.** `spend(budgetId, invoice, amount, paidBefore)`. The check of authority and of the limit is as today
(`C:money/Budgets.sol:206-232`); it then calls `Payments.pay`. It stops wrapping a nonce. `schedule` and
`payReserved` follow.

**The invoice's address.** A minimal clone whose address is computed from the invoice alone. `forward()`, callable by
anyone, sends its whole balance into `Payments.pay` against that invoice.

**A held payment.** Today's Escrow with its "invoice amount reached" condition (`C:money/Escrow.sol`), made a minimal
clone, with the payer's email-derived Safe as owner. The payer proves an email and Capxul generates the Safe for it.
Card or Apple Pay through a crypto on-ramp is one use; it is not the only one. For an invoice of 49:

- 49 arrives: `release()`, callable by anyone, pays 49 through `Payments.pay`.
- 50 arrives: 49 is paid, and 1 stays for the owner to claim once they have their account.
- 25 arrives and no more: nothing is paid, and the owner claims the 25 back.

Paying someone who has no account yet is the same contract with the "payee claimed" condition that Escrow has today.

## Payment agreements

An agreement holds no money. It is a standing permission for the payee to collect from the payer's budget without the
payer signing each time.

- **One shared contract.** Not inside Payments, which must keep having no power over anyone's Safe. Not one contract per
  agreement, which would need its own permission on the payer's side for a contract that holds nothing.
- **A cap per period replaces accrual.** Streaming pay is already dropped (roadmap, 15 November 2026), so the Calendar
  release maths and `settle` go. Offer, accept, pause and end stay.
- **A collection names its own sealed invoice.** `collect(id, invoice, amount, paidBefore)` checks that the caller is
  the agreement's payee and the invoice's payee, that the amount is within the period's cap, then calls
  `Budgets.payReserved`, which ends in `Payments.pay`.

## Who signs an invoice

How authority works today:

- The company Safe is signed by the Board: the wearers of the Director hat, to a threshold
  (`C:authority/InstallerMoney.sol`). The founder decides who is a Director.
- Officer hats, such as Books, sit under the Board's top hat and are administered by the company Safe.
- A budget names one hat. A department is a budget plus its hat; there is no department contract. Frappe holds its name
  and people, linked by a Capxul Hat Grant.
- Spending is the member's own Safe signing, plus `Budgets.authorised` checking that the Safe wears the budget's hat or
  one above it (`C:money/Budgets.sol:373-383`). The Board signs nothing.
- Nothing on chain says who may issue an invoice.

**Decided (option A): the department's hat.** The issuing member's own Safe signs the invoice id when the invoice is
sealed. The signature is stored with the seal and travels with the invoice. Before it offers "pay", the payer's side
checks three things: the signature is that Safe's, the Safe wears the hat, and the hat belongs to the payee company.
So one hat lets a member spend a department's budget and issue its invoices. It costs no gas, puts nothing on chain and
needs no new contract. Money still arrives in the company Safe.

Rejected: a separate "may invoice" hat (another hat to keep in step with departments); the company Safe signing (the
Board would sign every invoice); no signature (no defence against a look-alike invoice, and no proof for an auditor).

## What this changes in decisions already made

- **Roadmap, "Every payment settles one sealed document".** "Paid once" becomes: each payment is recorded against one
  sealed document, which may be paid in parts and may be overpaid. Aaron agreed the rewording on 15 November 2026. The
  build session records it.
- **Budgets changes.** Its three paying functions take an invoice and stop wrapping a nonce.
- **Escrow stays parked as a build item**, but its shape is now set: the held payment above.

## To be closed by the spec

Nothing below may stay undecided. `handoff-knock-on-map.md` lists each point and what must be written down.

- **The hat check: decided.** The payer's side checks the hat once, when it receives the invoice, and records the
  result. A hat removed later does not undo an invoice already received (Aaron, 15 November 2026).
- **The email at claim: decided.** The claim is done exactly as classic does it (Aaron, 15 November 2026): one
  sponsored operation sent by the email's Safe itself, its deployment with a hashed salt and an owner swap signed by
  the bootstrap owner, so the email never reaches the chain. `CompaniesHouseClaimer.claim` here takes the email as
  plain text and must be replaced. This is a fault on `master` today, apart from this design.
- **Payment kinds**, **measured gas costs**, and **invoices not issued through Capxul** (parked by Aaron).

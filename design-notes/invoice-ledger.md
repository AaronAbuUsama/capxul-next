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

## Claiming an email-derived Safe

A held payment is owned by the payer's email-derived Safe, so the design depends on how that Safe is claimed.

**Decided** (Aaron, 15 November 2026, relayed by the conductor session; and `docs/roadmap.md` on `master`, "Account
identity"): Companies House stays the first owner of every personal Safe. It approves the owner swap through a
permission, and the email never reaches the chain. `claim` takes the salt, never the email. This replaces this note's
earlier line that the claim be done exactly as classic, where a key Capxul holds is the first owner.

**The salt** is computed off chain by Core: an HMAC of the normalised email under `capxul:person:v<N>`, with the grade
group's pepper (roadmap, "Account identity"). Nobody without the pepper can find a real person's Safe from an email.

**The role.** The mechanism exists today and is kept:

- Companies House has a Roles module. A role on it, keyed `capxul.claim.<tier>` (today `capxul.claim.devnet`,
  `packages/core/src/chain/seeded.ts:43`), has one member: a backend key that Core holds
  (`packages/world/src/chain/contracts.ts`, `CLAIMS`).
- The role allows exactly one thing: a delegatecall to `CompaniesHouseClaimer.claim`, sent through the Roles module's
  `execTransactionWithRole`. The code then runs as Companies House, so the Safe accepts the swap because its caller is
  its owner (`packages/contracts/src/companies-house/CompaniesHouseClaimer.sol`).
- **What changes:** `claim(string namespace, string email, address signer)` becomes `claim(bytes32 salt, address
  signer)`. `safeAddressFor` takes the salt too. The email check (`EmailNotNormalized`) leaves the contract and moves
  to the blueprint, which owns the email's normalisation.

**What the role can do.** For any salt: deploy that personal Safe if it has no code, and replace Companies House with a
named signer as its only owner.

**What it cannot do.**

- Make any other call as Companies House. Minting a company Safe is a separate role (`capxul.company.<tier>`).
- Touch a Safe that is already claimed: Companies House is no longer its owner, so the swap is refused.
- Change who holds the role, or the Roles module itself.
- Run the claimer outside Companies House: a plain call reverts `NotDelegateCall`.

**What it is trusted with.** The key can claim any unclaimed Safe for any signer. Money waiting in an unclaimed Safe,
or in a held payment that such a Safe owns, is therefore only as safe as this key. That is the trust root already
accepted for the beta (ruling `aaron.claim-trust`); the role keeps it to this one act.

**Granting and revoking.** Companies House, as owner of its Roles module, grants the role with `assignRoles(key holder,
[role], [true])` and revokes it with `[false]`. Rotating the backend key is a revoke and a grant. Revoking stops new
claims at once and changes no Safe already claimed.

## The claim permission as a blueprint delta

Asked for by Aaron through the conductor session on 15 November 2026, so that the accounts pilot (roadmap step 5.2)
builds it through the loop of `AGENTS.md` on `master`, "How a feature is built". No code is written here. The formats
for roles (step 5.1), machines (3.4) and steps (4.1) are not built yet, so this is written to their description in
`AGENTS.md`, as tables. It is a new domain of the blueprint, `accounts`.

**One role per account version, with nothing to pin.** The roadmap puts Companies House at one address per account
version. Each version therefore has its own Roles module, and a role on it is already bounded to that version. The role
key is `capxul.claim.v<N>`. This closes the question of pinning a namespace.

### Roles

| Role | Where it comes from | Who holds it |
|---|---|---|
| `person` | A platform sign-in (exists today) | Anyone signed in |
| `companies-house-signer` | A Safe signer of that account version's Companies House | Capxul's own officers. In a test world, the seeded signer |
| `claimer` | A credential: a backend key that is a member of `capxul.claim.v<N>` on Companies House's Roles module | Core only. No person or agent is ever given it, and no operation lists it under `allowed` |

### Operations

| Operation | Allowed | Payload | Answer | Events |
|---|---|---|---|---|
| `account.claim` | `person`, for their own sign-in only | none: the email and the signer come from the sign-in | `Claimed {safe, accountVersion, deployed}` or `AlreadyClaimed {safe, accountVersion}` | `account_claimed` on `Claimed`; none on `AlreadyClaimed` |
| `claimer.grant` | `companies-house-signer` | `{accountVersion, key}` | The approval it opened, as for any act a Safe signs | `claimer_grant_opened`, then `claimer_granted` when it lands |
| `claimer.revoke` | `companies-house-signer` | `{accountVersion, key}` | The approval it opened | `claimer_revoke_opened`, then `claimer_revoked` when it lands |
| `claimer.list` | `companies-house-signer` | `{accountVersion}` | Every grant of that version with its state | none |

`account.claim` is where Core uses the `claimer` credential: it computes the salt, sends `claim(salt, signer)` through
the Roles module with its key, and waits for it to land.

### Events

No event carries an email or a salt.

| Event | Carries |
|---|---|
| `account_claimed` | `person`, `safe`, `signer`, `accountVersion`, `deployed` |
| `account_claim_failed` | `person`, `accountVersion`, `reason` |
| `claimer_grant_opened`, `claimer_revoke_opened` | `accountVersion`, `key`, `approval`, `by` |
| `claimer_granted`, `claimer_revoked` | `accountVersion`, `key`, `transaction` |

Chain logs: `CapxulSafeClaimed(safe, signer, deployed)` from the claimer, which the indexer already records, and the
Roles module's own log of a role being assigned, which the indexer must start to record for Companies House.

### Machines

**A person's account**, one per person and account version.

| State | `account.claim` |
|---|---|
| `unclaimed` | moves to `claiming` |
| `claiming` | refused: `ClaimInProgress` |
| `claimed` | answers `AlreadyClaimed` when the Safe's owner is the caller's signer; otherwise refused: `ClaimedByAnotherSigner` |

`claiming` moves to `claimed` when the claim lands (`account_claimed`), and back to `unclaimed` when it fails
(`account_claim_failed`).

**A claimer grant**, one per account version and key.

| State | `claimer.grant` | `claimer.revoke` |
|---|---|---|
| `absent` | moves to `granting` (`claimer_grant_opened`) | refused: `ClaimerNotGranted` |
| `granting` | refused: `ClaimerChangePending` | refused: `ClaimerChangePending` |
| `granted` | refused: `ClaimerAlreadyGranted` | moves to `revoking` (`claimer_revoke_opened`) |
| `revoking` | refused: `ClaimerChangePending` | refused: `ClaimerChangePending` |
| `revoked` | moves to `granting` (`claimer_grant_opened`) | refused: `ClaimerNotGranted` |

`granting` moves to `granted` when the approval lands (`claimer_granted`), and `revoking` to `revoked`
(`claimer_revoked`). An approval that expires or is rejected returns the grant to the state it left.

### Refusals

| Refusal | Carries | When | Who acts |
|---|---|---|---|
| `NotCompaniesHouseSigner` | `person`, `accountVersion` | A caller without the role calls `claimer.grant`, `claimer.revoke` or `claimer.list`. Generated from `allowed` | A Companies House signer |
| `ClaimInProgress` | `person`, `accountVersion` | `account.claim` from `claiming` | The caller waits |
| `ClaimedByAnotherSigner` | `safe`, `accountVersion` | `account.claim` from `claimed`, and the Safe's owner is not the caller's signer | Capxul support |
| `ClaimerUnavailable` | `accountVersion` | `account.claim` when no grant of Core's key is `granted`. A server-side fault, not the caller's | A Companies House signer |
| `ClaimerNotGranted` | `accountVersion`, `key`, `state` | `claimer.revoke` from `absent` or `revoked` | none |
| `ClaimerAlreadyGranted` | `accountVersion`, `key` | `claimer.grant` from `granted` | none |
| `ClaimerChangePending` | `accountVersion`, `key`, `state`, `approval` | Either from `granting` or `revoking` | Sign or reject the open approval |

A signer that is zero or is Companies House itself cannot come from a sign-in, so it is a defect, not a refusal.

### Steps

| Operation | Steps, in order |
|---|---|
| `account.claim` | database (read the account), chain (read the Safe's code and owners), chain (send `claim` through the Roles module), wait (it lands), database (write the account) |
| `claimer.grant`, `claimer.revoke` | database (read the grant), chain (read the role's membership), database (open the approval). The landing is the approval's own steps |
| `claimer.list` | database |

Budgets are provisional until measured.

### Journeys

Written by a different agent from the builder, each failing against empty handlers first.

1. **Claim an account.** From a starting world where one signed-in person has no claimed Safe and the claimer is
   granted: the person claims (`Claimed`, `deployed` true); claims again (`AlreadyClaimed`); the Safe's only owner is
   their signer.
2. **Only a Companies House signer changes the claimer.** A person without the role calls `claimer.grant`, then
   `claimer.revoke`, then `claimer.list`: each is refused `NotCompaniesHouseSigner`.
3. **Rotate the claimer.** A signer revokes Core's key; a second person's claim is refused `ClaimerUnavailable`; the
   signer grants a new key; the second person claims; the first person's Safe is unchanged.
4. **The grant's refusals.** Grant when granted (`ClaimerAlreadyGranted`); revoke twice (`ClaimerNotGranted` the
   second time); grant while a grant is waiting for its signature (`ClaimerChangePending`).

A new starting world is needed: today `world.create` claims every cast member's Safe, so no person starts unclaimed.

What the contract alone must prove, in its own tests, because no operation can reach it: the key's role cannot make
any call but `claim`; a plain call to `claim` reverts; a claimed Safe refuses a second swap.

### Two things this delta does not decide

- **Who Companies House's signers are in a real world, and its threshold.** That is Aaron's to name.
- **How a world's enrolment calls `account.claim`.** Enrolment is the other half of step 5.2 and is not designed here.

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
- **The claim: decided.** See "Claiming an email-derived Safe" above.
- **Payment kinds**, **measured gas costs**, and **invoices not issued through Capxul** (parked by Aaron).

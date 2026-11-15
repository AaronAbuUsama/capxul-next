# Handoff: the knock-on map for the invoice ledger

Written on 15 November 2026 for whoever the orchestrating session launches next. It is a complete brief: a fresh
session can start from this file alone.

## The job

`design-notes/invoice-ledger.md` is a **direction** Aaron agreed. It says which contracts exist and what they do. It is
not buildable, because it leaves the joins between the parts for a builder to invent.

Produce the **knock-on map**: one document, `design-notes/invoice-ledger-spec.md`, that names every consequence of the
direction in every part of the system, with nothing left open. When it is done, an implementing agent makes no design
decision. Aaron's words: "We don't want to leave anything for the implementing agents to figure out or make up."

**Do not build. Do not open pull requests. Push only to `design/contracts-first-principles`.** The main build session
turns the finished spec into roadmap decisions and slices.

## Read first

1. `AGENTS.md` and `docs/roadmap.md` (the decisions table).
2. `design-notes/invoice-ledger.md` (the direction), then `design-notes/agreements-design.md` §2 (the seal) and
   `design-notes/parity-inventory.md` (what classic does, as journeys).
3. The blueprint, `packages/blueprint/src`: how an operation, a refusal, an event, a chain log, a span and a starting
   world are declared today. Read `documents/`, `approvals/`, `chain/logs.ts`, `errors.ts`, `telemetry.ts`,
   `starting-worlds.ts`.
4. The thin line's payment path, end to end: `packages/frappe-app/capxul/{canon,payments,core_api,hats}.py`,
   `packages/core/src/approvals/payments.ts`, `packages/core/src/site-ops/`, `packages/indexer/src/index.ts`,
   `packages/scenarios/src/journeys/pay-and-branch.ts`.
5. The contracts: `packages/contracts/src/money`, `authority`, `companies-house`, and `deploy/manifest.json`.
6. Classic Capxul, the repository `xelmar-tech/infrastructure`. Attach it to the session. Most of these questions were
   answered there once. Start with `docs/adr/0018`, `0023`, `0032` to `0040`, and `packages/backend/src/{requests,
   payments,accounts}`.

## Decided. Do not reopen

- Payments keeps a running total paid per sealed invoice. The id is derived from payee, token, total, kind and document
  hash. `pay(invoice, amount, paidBefore)`.
- Part-payments are ordinary payments. One Payment Entry per payment, allocated against the invoice.
- The chain does not refuse an overpayment. The surplus sits on account in the payee's books.
- Three ways in: Budgets; the invoice's own address (anyone, plain transfer, no refund); a held payment (owner is the
  payer's email-derived Safe; released when the full amount is there; the owner claims a surplus or a short payment).
- Payments and held money are separate contracts. Payments holds no funds and has no owner.
- Agreements is one shared contract that only authorises: a cap per period, no accrual maths, each collection names its
  own sealed invoice.
- An invoice is signed off chain by the issuing member's own Safe, under the department's hat (option A).
- **The hat is checked once, when the payer's side receives the invoice, and the result is recorded.** A hat removed
  later does not undo an invoice already received (Aaron, 15 November 2026).
- The roadmap's "paid once" becomes "each payment is recorded against one sealed document".
- From the roadmap: no email on chain; no streaming pay; the chain budget is the only gate; the founder governs the
  Board; nobody calls the chain directly.

## What the spec must contain

One section per row. Each entry names the file that will own it and its exact shape. Where classic had the same thing,
cite it and say what is kept and what changes.

| Area | What to write down |
|---|---|
| Operations | Every blueprint operation added, changed or removed: name, domain, typed payload, typed result, who may call it. At least: issue an invoice, deliver it to the payer, verify a document, pay in full or part, open the invoice's address, forward, open a held payment, release, claim, and the agreement operations (offer, accept, pause, end, collect) |
| Refusals | Every tagged error each operation can give, with its code, its fields, and who must act. Include each contract revert and the refusal it becomes |
| Events | Every event an operation emits, and every message between Core and a site (today `paid`), with its typed body |
| Chain logs | Every contract event, its fields, which are indexed, and its entry in `chain/logs.ts` and the indexer's schema |
| Spans and timings | The spans of each operation and what each measures. No budget is set; measurement comes first |
| Journeys | The journeys that prove the design, as ordered operations with their refusal steps: a part-paid invoice; an overpaid one; an outside payer through the invoice's address; a held payment at exactly, above and below the amount; an agreement collection; a look-alike invoice refused. Name the starting world each needs. A different agent writes the scenarios |
| Starting worlds | Which exist, which are new, and what each holds |
| Contracts | The full interface of each contract: functions, events, errors, storage. What is deleted. The deploy manifest's new entries. How the two clones are created and their addresses computed |
| Core | What changes in approvals and landings; how Core learns of a plain transfer to an invoice's address or a held payment, and who calls `forward` and `release`, when, and who pays the gas |
| Indexer | New tables and handlers, and how clone addresses are tracked |
| Frappe app | The seal doctype and its fields; what replaces Capxul Payment Request; how each invoice doctype is sealed; the Payment Entry posted per payment; how a surplus is posted; the unmatched path |
| SDK and CLI | The commands and calls each operation becomes |
| Build order | The units, their lane (contracts, Frappe app, operations), what each depends on, and which can run in parallel under the roadmap's rules |

## Points to close, each with a decision

The spec may not end with an open list. Each of these needs a stated answer, checked against classic first, and
confirmed by Aaron where it is his to make.

1. **The claim.** Decided: Companies House stays the first owner and approves the swap through a narrow Roles
   permission held by a backend key; `claim` takes the salt, never the email (`invoice-ledger.md`, "Claiming an
   email-derived Safe"; roadmap, "Account identity"). Classic instead uses a bootstrap key as first owner
   (`infrastructure: packages/backend/src/accounts/claims/external/ownership.ts`); read it for the operations, errors
   and events around a claim, not for the mechanism. Its blueprint delta is in `invoice-ledger.md`, "The claim
   permission as a blueprint delta", for roadmap step 5.2. Two things remain Aaron's: who Companies House's signers
   are in a real world, and how a world's enrolment calls `account.claim`.
2. **Who owns a held payment before the payer has claimed their account**, and who signs for it. In classic the
   bootstrap owner holds the Safe until the claim.
3. **The signature's exact form:** the typed data signed, how a Safe's signature is verified, and what is stored on the
   seal (signer, hat, time, result of the check).
4. **Which hat belongs to which company:** how the payer's side proves a hat is the payee company's.
5. **Payment kinds:** whether `kind` stays detailed on chain or moves into the sealed header, and what Budgets' kind
   check becomes.
6. **Racing payments:** what each way in does when `paidBefore` has moved (retry, refuse, or tell the user).
7. **Which invoice doctypes are sealed**, and the header fields of each.
8. **Delivery between companies:** how the payer's site receives the payee's sealed invoice, and what Core keeps.
9. **Tokens:** one token per invoice is assumed; say what happens when the wrong token arrives at an invoice's address
   or a held payment.
10. **Gas:** measure the clone deploys and `pay`, and record the figures. No estimate stands in the spec.
11. **Invoices not issued through Capxul.** Aaron parked this. State that it is out of scope and what the design must
    not block.

## Done when

- Every row of the table is filled, with file paths.
- Every point above has a decision and its source (classic, the roadmap, or Aaron on a date).
- The word "open" appears nowhere in the spec.
- Aaron has read it and agreed it.

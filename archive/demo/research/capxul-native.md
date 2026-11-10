# Research: Capxul's own screens, the ones with no Frappe original

Step: Research (capxul-native) of the Capxul mock-up (`demo/PROGRESS.md`). Written 9 November 2026.

The sibling research pages (`accounting.md`, `hr-payroll.md`, and the CRM and projects pages) describe screens that
re-skin a Frappe original. This page describes the screens that exist only because Capxul owns money and identity:

- **money:** Safes and their balances, the ordinary bank account, Bridge deposits and fiat payouts with their quotes
  and fees, payments with their document-hash proof and on-chain status, money waiting in escrow with claim and cancel,
  and scheduled payments;
- **departments** as budgets with hats: holders, spend against the period's budget, swapping a person in or out;
- **approvals:** what waits for whom;
- **the Board** and its proposals;
- **equity:** the cap table, rounds, SAFEs, options and shareholder votes;
- **seats and agents;**
- **the FDE** and its conversations;
- **the activity feed** and **notices**.

For every screen it gives the purpose, the layout (regions, tabs and sections in order), every field or column a user
sees with an example value, the actions and their states, and how the mock-up presents it, with the matching
`capxul` command. Every command is spelled as `docs/design/command-surface.md` books it.

Since these screens have no Frappe original, their structure comes from the book's records: the tables, the state
machines, the operations' `--json` returns and refusals. A screen shows what the records hold, in the order the
operation prints it. Where the book has no command for a screen (Home, the approvals queue, notices), the page says so
(section 7).

## Contents

1. [Sources](#1-sources)
2. [What every native screen shares](#2-what-every-native-screen-shares)
3. [Money](#3-money)
4. [Departments, allowances and ceilings](#4-departments-allowances-and-ceilings)
5. [Approvals, the Board and equity](#5-approvals-the-board-and-equity)
6. [Seats, agents, the FDE, activity and notices](#6-seats-agents-the-fde-activity-and-notices)
7. [Every screen and action and its command](#7-every-screen-and-action-and-its-command)
8. [Harbourline's native data on 9 November 2026](#8-harbourlines-native-data-on-9-november-2026)
9. [Points for the later steps](#9-points-for-the-later-steps)

---

## 1. Sources

Paths are relative to `/home/user/capxul-next` unless they start with `/`. Line numbers are of the working tree on 9
November 2026.

| Source | Used for |
|---|---|
| `books/target/shared/rulings.ts` | `aaron.one-product` (:696-714): all Capxul, Frappe invisible; `aaron.other-accounts` (:716-740): other bank accounts, Safes and Bridge the default; `aaron.departments` (:405-427); `aaron.escrow-general` (:379-403); `aaron.money-waiting` (:162-183); `aaron.payment-claim` (:549-561); `aaron.seats` (:129-146); `aaron.buy-seats` (:348-364); `aaron.fde-hosted` (:429-448); `aaron.fde-anyone` (:563-580); `aaron.test-prices` (:450-466): a seat 10 USDC once, the hosted FDE 20 USDC a month |
| `docs/design/command-surface.md` | every command's spelling (section 6), the tree (section 1), the SDK rule (section 2, rule 6) |
| `books/frozen/operations.ts`, `books/frozen/flags.ts` | each frozen command's title, about, who, arguments, flags and `--json` fields (read with a script; e.g. `payment.send` at operations.ts:18498, flags.ts:2408) |
| `docs/design/authority.md` | who may take each money action and why the chain allows it; the swap table (lines 172-196); the role conflict (lines 238-246) |
| `docs/design/escrow.md` | the general escrow: terms, functions, the nine money paths, what happens next (escrowed, collected, taken back) |
| `docs/design/frappe/bridge-work/design-bank.md` | the payment advice the document hash commits to (section 2), the five proof steps (2.5), Bridge deposits (P10), payouts and returns (P11), outside bank accounts (P12), scheduled payments (P13), fees (P16) |
| `docs/design/frappe/bridge-work/prior-art.md` (4.2) | Bridge's deposit and payout fields: `developer_fee_amount`, `exchange_fee_amount`, `subtotal_amount`, `destination_tx_hash` |
| `docs/design/frappe/projects-and-startup.md` (sections 1, 3) | start-up, the FDE's Seat and authority |
| `docs/vision/erp.md` (sections 3, 6) | what Capxul owns against what the business system owns; agents with Seats |
| `books/target/payments/data.ts` | `payments` (:137), statuses (:37-48), outcomes (:51-63), sources (:72-83), the `payment` machine (:366-400), `movements` (:293) |
| `books/target/payments/operations.ts` | `payment send` (:125), `retry` (:187), `cancel` (:224), `reschedule` (:269), `get` (:303), `list` (:331), `wait` (:359), `org department pay` (:387), `org seats buy` (:443), `org fde pay` (:595), `payment claim` (:749); the `--json` shapes (:96-121) |
| `books/target/banking/data.ts` | verifications (:50), bank details (:328, public fields :358-366), saved bank accounts (:484), deposits (:631, states :626, :739-743), payouts (:850, quote :881-888, states :835, :965-971, reasons :837-848) |
| `books/target/budgets/data.ts`, `budgets/shapes.ts` | budgets (:89), budget changes (:149, kinds :44-54); `BudgetLine` (shapes :116), `Ceiling` (shapes :105), `Holder` and `Office` |
| `books/target/approvals/data.ts` | the approval's states (:104-107) and the page's `Summary` (:40-58) |
| `books/target/board/data.ts` | proposals (:65; kinds :49, statuses :107), Director changes (:199), officer changes (:268) |
| `books/target/equity/data.ts`, `equity/shapes.ts` | rounds, investments, grants, sales, votes (vote matters :51-61); the cap table's return (shapes :339-353), `shares` (:356-366), the exit preview (:398-404) |
| `books/target/organizations/data.ts`, `organizations/operations.ts` | Organizations (:71), Seats (:245, seat use :67), invitations (:337), seat purchases (:444), the hosted FDE (:632), its payments (:690), guests (:745), asks (:803); `org fde show` (:844), `ask` (:882), `turn get` (:946), `guest add` (:979), `org seats show` (:1093) |
| `books/target/agents/data.ts` | agents (:77, states :42), agent changes (:275) |
| `books/target/activity/feed.ts` | feed rows: `PaymentItem` (:67), `MovementItem` (:84), the page (:103), the evidence (:124-135) |
| `books/target/notices/*.ts` | the notice templates (`notices/payments.ts` :125 money waiting, :160 reminders; `notices/board.ts`, `hr.ts`, `banking.ts`, `organizations.ts`) |
| `books/target/indexing/data.ts` | the chain views every read uses: `safe-balances`, `chain-budgets`, `hat-wearers`, `escrows`, `chain-payments`, `equity-positions` |
| `books/target/shared/decisions.ts` :1710-1726 | `responsibilities.summaries`: Home and "needs you" are web-app flows over activity's, approvals' and requests' reads, with no command |
| `demo/research/accounting.md`, `demo/research/hr-payroll.md` | the company (Harbourline Studio Ltd), the cast, the chart, the rate 1 USDC = £0.7893, the naming series |

Outside documentation, read for names, fields and behaviour:

- Bridge (Stripe): virtual accounts https://apidocs.bridge.xyz/get-started/guides/move-money/virtualaccounts ;
  transfers https://apidocs.bridge.xyz/platform/orchestration/transfers/transfer and
  https://apidocs.bridge.xyz/api-reference/transfers/create-a-transfer ; idempotence
  https://apidocs.bridge.xyz/api-reference/introduction/idempotence ; webhooks
  https://apidocs.bridge.xyz/platform/additional-information/webhooks/structure (as cited in `prior-art.md`).
- Safe smart accounts: https://docs.safe.global/ . Hats Protocol and Hats Signer Gate:
  https://docs.hatsprotocol.xyz/ and https://docs.hatsprotocol.xyz/hats-integrations/hats-signer-gate .
- EIP-712 typed data (the document hash): https://eips.ethereum.org/EIPS/eip-712 . ERC-4337 user operations (each
  approval): https://eips.ethereum.org/EIPS/eip-4337 . ISO 11649 RF creditor references (the deposit reference,
  `design-bank.md` P10).
- Base, chain id 8453, explorer https://basescan.org . USDC on Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`;
  EURC on Base `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42`.

---

## 2. What every native screen shares

### 2.1 The words

These screens are Capxul's from the start, so they already use Capxul's words. Never show "Frappe", "ERPNext",
"head", "site" (for the business system), "DocType" or "Desk" (`aaron.one-product`). The chain's machinery is named
only where a person needs it, and then in plain words:

| The book says | The screen says |
|---|---|
| company Safe | **Treasury** (the Organization's Safe), with its address |
| personal Safe | **your Safe** |
| budget with an office hat (`kind` department) | **department**, or **team** under a department |
| office hat; wearer | **hat**; **holder** ("wears the Engineering hat") |
| allowance (a budget whose hat is under the Board's top hat) | **allowance** |
| Board batch, Safe transaction | **Board proposal** |
| `approveHash`, UserOperation | **approval** ("Approve with your passkey") |
| claim escrow, route `claim_escrow` | **money waiting** |
| `refund()` | **take back** |
| `collect()` | **claim** |
| PaymentSent, payment id | **on chain**, **payment ID** (shown in the proof only) |
| document hash, payment advice | **proof**: "what this payment pays" |
| Movement | **outside money** ("received from outside Capxul") |
| Bridge virtual account | **bank details** ("Pay us by bank") |
| Bridge transfer, payout | **bank payout** |
| Payout ceiling (Roles allowance) | **payout ceiling** |
| Seat, `seat_use` organization | **seat**; "the company's agent" |
| hosted FDE | **FDE**, "Harbourline's Forward Deployed Engineer" |

Bridge may be named: it is Capxul's banking partner and the verification flow names it already ("Bridge, Capxul's
banking partner, sets the questions", frozen `verify.start`). It appears as a small "via Bridge" mark, never as a
product the person signs into.

### 2.2 Money on screen

- **Token amounts** show two decimals in lists ("2,051.00 USDC") and the token's six in a proof ("2,051.000000").
  The raw amount (`amount_raw`, "2051000000") appears only in the proof's raw view.
- **Fiat beside tokens.** Harbourline's books are in GBP, so every USDC figure carries its pound value in muted text:
  "229,404.21 USDC · £181,068.75". The rate is the one the books use (1 USDC = £0.7893 on 9 November 2026), shown in
  the top bar's tooltip and in the proof as the rate the payer applied.
- **Signs and direction.** Out is shown "−2,051.00", in "+15,716.61"; direction also has an arrow glyph and the word
  ("Out", "In", "Between your Safes") for colour-blind readers.
- **Addresses** shorten to six and four characters ("0x4A1f…9c2E") with a copy button and an explorer link
  (https://basescan.org/address/…). A transaction shortens the same way and links to `…/tx/…`.
- **Tabular numbers** everywhere (`font-variant-numeric: tabular-nums`); amounts right-aligned.
- **Times** in Europe/London for display, with UTC in the proof. A dated payment's day is shown as the book stores it
  ("15 Nov 2026, 00:00 UTC").

### 2.3 Status pills

One vocabulary per machine, taken from the book's state lists. Colours are tokens the shell defines; the role names
below say which token.

| Machine (record) | States as shown | Colour role |
|---|---|---|
| Payment (`payments/data.ts:37-48`) | Prepared · Scheduled · Due · Money waiting (`escrowed`) · Sent (`submitted`) · Needs retry · Settled · Mismatched · Cancelled | neutral · info · warning · escrow · info · warning · success · danger · muted |
| Payment outcome (:51-63) | Declined · Refused · Rejected · Expired · Displaced · Reverted · Window closed · Voided · Cancelled in budget · Taken back (`refunded`) · Withdrawn | shown as a second word after Cancelled or Needs retry: "Cancelled · Taken back" |
| Approval (`approvals/data.ts:104-107`) | Preparing (`sponsoring`) · Waiting for you (`pending`) · Signed · Sending · Sent · Done (`landed`) · Reverted · Replaced (`displaced`) · Expired · Declined · Refused · Withdrawn | info · warning · info · info · info · success · danger · muted · muted · muted · danger · muted |
| Board proposal (`board/data.ts:107`) | Waiting for approvals · Executed · Failed · Rejected · Replaced | warning · success · danger · muted · muted |
| Bank deposit (`banking/data.ts:626`, :739-743) | Processing · Arriving · Credited · Below minimum · Returned; match: Unmatched · Matched · Not a request | info · info · success · muted · muted |
| Bank payout (:835, :965-971) | Quoted · In transit · Delivered · Returning · Refunded · Expired · Needs attention | neutral · info · success · warning · muted · muted · danger |
| Budget (`budgets/data.ts`) | Proposed · Active; Closed is a flag | info · success; muted |
| Budget change (:181) | Proposed · Applied · Abandoned | info · success · muted |
| Escrow standing (indexing `escrows`) | Open · Claimed (`Paid`) · Taken back (`Refunded`) | escrow · success · muted |
| Agent (`agents/data.ts:42`) | Creating · Active · Frozen · Removed · Failed | info · success · warning · muted · danger |
| FDE hosting (`organizations/data.ts:661`) | Provisioned · Running · Due · Paused · Resuming · Retired | info · success · warning · danger · info · muted |
| Invitation (`organizations/data.ts:376`) | Authorizing · Pending · Active · Revoking · Declined · Cancelled · Expired | info · warning · success · info · muted · muted · muted |
| Equity: round (`equity/data.ts:505`), grant (:772), vote (:1030) | Proposed · Open · Allocated · Closed · Cancelled; Proposed · Offered · Active · Ended · Lapsed; Proposing · Proposed (voting) · Executed · Lapsed · Failed | as above |

"Money waiting" gets its own colour role (escrow), distinct from warning: it is not a problem, it is held for someone.

### 2.4 The command strip

Every screen and every action shows its `capxul` command (`aaron.sdk-reaches-everything`: everything is a CLI command
and an SDK call). The strip sits under the page head, collapsed to one line:

```
capxul payment get payment_01JC2W8K4T6Y9QZ3M7N5B1R0FD --org harbourline     [Copy] [SDK] [--json]
```

- **SDK** swaps the line for the method: `client.payments.get("payment_01JC2W8K…")`. The SDK rule
  (`command-surface.md` section 2, rule 6): `org` becomes `client.org(orgId)`, a group is a namespace, nouns are plural
  camelCase, the verb comes last. Where the frozen book names the method, use its name (`payment send` is
  `client.payments.pay`, `balance` is `client.accounts.read`).
- **--json** shows the shape the command prints, filled with the screen's values (the field names from the frozen
  `returns`, e.g. `PaymentJson` at `payments/operations.ts:96-109`).
- **Actions** show their own command in a tooltip and in the confirmation sheet, with the arguments the form filled in:
  `capxul payment cancel payment_01JC… --org harbourline`.
- **Who may run it**, one line under each write action, from the operation's `who` ("Whoever wears the Design hat or
  one above it now, or the Board").

### 2.5 The hand-over: every write ends at an approval

Capxul never signs for anyone. A write that moves money or authority opens an **approval** from the signer's own Safe
(`approvals/data.ts:84`), or a **Board proposal** that Directors approve. The mock-up shows the same sheet for both:

1. **Title**, from the approval's `summary.title`: "Pay Kestrel Cloud Ltd".
2. **From**, with label and address: "Harbourline Treasury · 0x4A1f…9c2E · Engineering budget".
3. **To**: "Kestrel Cloud Ltd · 0x91c2…44Be".
4. **Amount**: "2,051.00 USDC (£1,618.80)".
5. **Recipients**, for a batch: one row each, with its amount, its rail (Wallet or Bank), the bank amount it must
   deliver ("requested output £5,040.00"), whether it is exact, and any warning.
6. **Warnings**: e.g. "The address is new to you", "Kestrel's bank details changed 2 days ago".
7. **Signer**: "Tom Ashworth · your Safe 0x2C6e…B814 · wears the Engineering hat".
8. **Deadline**: "Expires in 14:52" (`deadline`); for a dated payment, "Sent on 15 Nov 2026 (`send_after`)".
9. Buttons **Approve with passkey** (primary) and **Decline**.

States after: "Sending…", "Done · on chain in block 53,108,442", or the refusal in words ("Refused: you no longer wear
the Engineering hat", `integrations.sponsor-refusals`). The CLI's `--json` answer at the hand-over is
`{status: "awaiting_approval", approvalId, approvalUrl, paymentIds, expiresAt, next}` (`payments/operations.ts:111-118`);
the sheet's footer shows `next`: `capxul payment wait approval_01JC…`.

For a Board proposal, the sheet adds **Proposal sp_0193 · nonce 40 · 1 of 2 approvals** and lists which Directors
approved. The Director's own signature is still an approval from their Safe (an `approveHash`), so the same sheet
serves.

### 2.6 The proof block

On every record that moved money: a payment, a payslip, an expense claim, a payout, a deposit, an escrow. Its fields
are in section 3.6. It always ends with **Verify**, which runs the five checks of `design-bank.md` 2.5 and shows each
with a tick, and with the command `capxul document verify --document-hash 0x3c8d… --content-hash 0xa41f…`.

### 2.7 Who you are acting as

The top bar has an **Acting as** switch: "Harbourline Studio Ltd" or "Yourself" (`use org`, `use personal`). Personal
screens (your Safe, your payslips, your shares, money waiting for you) read your own records; the Organization's read
Harbourline's. The mock-up should also offer a **Viewing as** switch between personas (section 8.2), because the
point of several screens is that what a person may do follows the hats they wear now: Maya sees "Approve" on a
Board proposal, Kwame sees "Only Directors approve proposals", Hannah (an employee with no seat) sees no Treasury at
all, and the guest accountant sees only his own dealings.

### 2.8 The FDE is on every screen

A button "Ask the FDE" opens a side panel on any screen, with the screen's context ("You are looking at Payment
payment_01JC… to Kestrel Cloud Ltd"). Its conversation is section 6.5. What it prepares comes back as a hand-over
card for the asker to approve (section 2.5), never signed by it.

---

## 3. Money

Sidebar section **Money**: Overview · Payments · Scheduled · Money waiting · Bank · Requests to pay. Personal side
(Acting as yourself): Your money · Money waiting for you.

### 3.1 Money overview (the Treasury)

**Purpose.** Where Harbourline's money is, right now, in every account it keeps: the company Safe, money held in
escrows, payouts on their way through Bridge, and the ordinary bank account. Read by any member
(`balance`, `address`, frozen who).

**Layout.**

1. **Page head.** "Money" and the Acting-as company; buttons **Send money** (primary), **Pay a bank account**, **Get
   paid by bank**; a menu with "Show deposit address" and "Payout ceilings".
2. **Position strip:** one large figure, "Total cash £214,760.61", then its parts as cards in one row (they wrap at
   400 px).
3. **Account cards** (one per account):
   - **Treasury** · Safe · Base: holdings by token, available, address.
   - **Money waiting** · Escrow: open escrows Harbourline funded.
   - **Payouts in transit** · via Bridge: bank payouts funded and not yet delivered.
   - **Barclays Business** · Bank: the ordinary account, reconciled in Books.
4. **This month** (from `activity summary`): In, Out, Net, Pending in, with the row count.
5. **Needs you** (a short list, linking to Approvals, section 5.1): the waiting approvals and proposals that move
   money, unmatched deposits, money uncollected.
6. **Latest activity** (five rows of section 6.6) and "See all".

**Fields.**

| Field | Example | Source |
|---|---|---|
| Treasury · USDC balance | 229,404.21 USDC · £181,068.75 | `balance --org`: `balances[].balance` (indexing `safe-balances`) |
| Available | 207,353.21 USDC | `balances[].available`: the balance less the dated payments reserved against it (9.4) |
| Reserved for dated payments | 22,051.00 USDC (4 payments) | the open `Budgets.schedule` reservations (3.7) |
| Address | 0x4A1f6B2c93D0e7A5f18C4b2E9a7d3F60c11b9c2E · Base (8453) | `address --org`: `address`, `network`, `chainId`, `currency`, `label` |
| Money waiting | 2,400.00 USDC in 1 escrow · £1,894.32 | open escrows whose sender is the Treasury (indexing `escrows`, standing open) |
| Payouts in transit | £1,920.00 (1 payout) · 2,436.30 USDC sent | `bank-payouts` in `in_transit` |
| Barclays Business · GBP | £29,877.54 per books · statement to 6 Nov 2026 · 3 to reconcile | the Bank Account in Books (`aaron.other-accounts`); `accounting.md` 5.17 |
| This month in | +16,522.58 USDC | `activity summary --from 2026-11-01`: `totals[].in` |
| This month out | −12,888.25 USDC | `totals[].out` |
| Net | +3,634.33 USDC | `totals[].net` |
| Pending in | +4,200.00 EUR arriving | `totals[].pendingIn`, and arriving deposits |

(For the builder: escrowed money has already left the Treasury for the escrow's address, so it is not reserved, and a
quoted payout is not reserved until it is signed. Available is the balance less the dated payments' reservations:
229,404.21 − 22,051.00 = 207,353.21. October's payroll fell on 31 October, so November's out is suppliers, the
escrow, seats and the two allowances so far.)

**Actions.**

| Action | Who may | Command |
|---|---|---|
| Send money | a holder of a department or allowance, or Directors | `capxul payment send <to> <amount> --org harbourline --from <budget>` (3.4) |
| Pay a bank account | the same | `capxul bank pay contact <amount> --org harbourline --from <budget>` (3.10) |
| Get paid by bank | any member reads; opening needs authority to manage | `capxul bank details --org harbourline` (3.8) |
| Show deposit address | any member | `capxul address --org harbourline` |
| Copy the address | anyone | |
| Open Barclays in Books | Books readers | link to Books › Banking (`accounting.md` 5.17) |

**Capxul presentation.** The overview reads like a bank's home, not a crypto wallet: the GBP total is the headline,
tokens are the detail. The Treasury card has a small "Safe" mark and a lock icon whose tooltip says "Only an approval
by a department's holder, or a Board proposal, can move this money." Command strip: `capxul balance --org
harbourline` · `client.accounts.read({ org: "harbourline" })`.

### 3.2 Treasury (the company Safe)

**Purpose.** One Safe in full: what it holds, who controls it, how money can leave it, and its statement.

**Layout.** Page head "Treasury" with the Safe mark and address. Tabs in order: **Holdings · Statement · Control ·
Deposit address**.

- **Holdings:** one row per admitted token.

  | Token | Balance | Available | Value (GBP) | Ceiling left this year |
  |---|---|---|---|---|
  | USDC · 0x8335…2913 | 229,404.21 | 207,353.21 | £181,068.75 | 641,222.25 of 2,100,000.00 |
  | EURC · 0x60a3…db42 | 0.00 | 0.00 | £0.00 | none set |

- **Statement:** every Transfer in or out of the Safe, newest first, one line each (`design-bank.md` 1.2): Date (block
  day), Description ("Payment to Kestrel Cloud Ltd", "Received via Bridge from Northstar Retail Ltd", "To money
  waiting for jules.marchetti@proton.me"), Reference (payment ID or deposit ID), Transaction (`0x5e1a…c9d0`),
  Out, In, Balance after. Filter: kind (Payments, Outside money), direction, date range. Paging by cursor.
- **Control:** who can move this money, in plain words, from the chain:
  - "Board proposals: 2 of 3 Directors approve" (Maya Okafor, Tom Ashworth, Ruth Calloway; link to the Board);
  - "Department and allowance holders, within each budget's room and the payout ceiling" (link to Departments);
  - "Nothing else. The Safe's guard refuses any other change."
  - Next proposal nonce 42; 2 proposals waiting.
- **Deposit address:** network Base, chain ID 8453, address, currency USDC, a QR code, and the warning "Send only
  USDC or EURC on Base. Anything else is lost." (`address`'s fields.)

**Actions.** Copy address; View on explorer; Open a waiting proposal. No write acts on the Safe directly.

**Command strip.** `capxul balance --org harbourline`; Control: `capxul org director list --org harbourline` (Safe,
Directors, threshold, nonce, waiting); Deposit address: `capxul address --org harbourline`; Statement: `capxul
activity list --org harbourline`.

### 3.3 Payments (list)

**Purpose.** Every payment Harbourline sent or received through Capxul, newest first, with where each one stands.

**Layout.** Page head "Payments", primary **Send money**. Tabs: **All · Out · In · Scheduled · Money waiting · Needs
attention** (Needs retry, Mismatched, Prepared over a day old). Filter row: counterparty, department, status, date.
Rows grouped by command where one command made many (a payroll run): a group row "Payroll run October 2026 · 23
payments · −118,402.77 USDC · Settled" opens to its payments.

**Columns.**

| Column | Example | Source (`PaymentJson`, `payments/operations.ts:96`) |
|---|---|---|
| Date | 5 Nov 2026, 14:03 | `timing.settledAt`, else `createdAt` |
| Counterparty | Kestrel Cloud Ltd | `counterparty` (the label the payer gave at birth) |
| Direction | Out | `direction` |
| Amount | −2,051.00 USDC | `amount` |
| From | Engineering | the budget (`budget_id`), "Board" for route board, "your Safe" for personal |
| Route | Department | `route`: Personal · Department (budget) · Board · Money waiting (claim_escrow) · From chain |
| Status | Settled | `status` (2.3), with the outcome after Cancelled or Needs retry |
| Paid to | Wallet / Bank via Bridge | a bank payout's Payment (`purpose` bank_payout) shows "Bank" |
| Proof | ✓ | a document hash is on chain and verifies |
| ID | payment_01JC2W8K… | `id` |

Example rows, 9 November 2026 (Organization's side):

| Date | Counterparty | Amount | From | Status |
|---|---|---|---|---|
| 9 Nov 10:42 | Brightfield Workspace Ltd (bank) | −6,390.40 USDC | Operations | Prepared · waiting for Nadia Farouk |
| 7 Nov 16:20 | Hollis & Reed Accountants (bank) | −2,436.30 USDC | Operations | Settled · payout in transit |
| 6 Nov 11:58 | Northstar Retail Ltd, via Bridge | +15,716.61 USDC | | Outside money · matched SINV-2026-00087 |
| 5 Nov 14:03 | Kestrel Cloud Ltd | −2,051.00 USDC | Engineering | Settled |
| 4 Nov 09:15 | Marta Kowalczyk | −4,800.00 USDC | Engineering | Settled |
| 2 Nov 17:31 | jules.marchetti@proton.me | −2,400.00 USDC | Design | Money waiting |
| 1 Nov 12:00 | Capxul (10 seats) | −100.00 USDC | Capxul allowance | Settled |
| 31 Oct 18:05 | Payroll run October 2026 (23) | −118,402.77 USDC | Harbourline | Settled (22) · collected from money waiting (1) |
| 28 Oct 10:10 | Copperline Inc. (refund) | −120.00 USDC | Growth | Needs retry · Expired |
| 24 Oct 09:00 | Capxul (FDE, 1 month) | −20.00 USDC | Capxul allowance | Settled |
| scheduled | Studio Varga | −3,200.00 USDC | Design | Scheduled · 15 Nov |
| scheduled | Northbank Ventures | −12,000.00 USDC | Board | Scheduled · 30 Nov |
| 14 Jul 13:40 | m.osie@gmail.com | −750.00 USDC | Growth | Cancelled · Taken back |

**Actions.** Send money; open a row; on a Needs retry row, **Retry** (`payment retry`); on a Prepared row, **Open
approval** (shows whose it waits for). Bulk: none (money moves one command at a time).

**Command strip.** `capxul payment list --org harbourline --limit 25` (`--scheduled` for the Scheduled tab; the other
tabs filter the same list in the page) · `client.payments.list({ org: "harbourline" })`. "In" rows that are outside
money come from `capxul activity list --org harbourline --kind movement`.

### 3.4 Send money (form)

**Purpose.** Pay someone from a department's budget, an allowance, or the Treasury itself by Board proposal.

**Layout.** A sheet with one column of fields, then a **Review** step showing the approval summary (2.5).

| Field | Example | Notes (frozen `payment.send` flags, flags.ts:2408) |
|---|---|---|
| To | Studio Varga · @studiovarga, or an email, or 0x… | `<to>`: email, `@handle` or address. An email with no account shows "No Capxul account yet: the money will wait for them in escrow until they claim it, and you can take it back until then." |
| Amount | 3,200.00 | `<amount>` |
| Asset | USDC | `--asset` (default USDC; only what the Treasury holds) |
| Pay from | Design (team) · 28,680.00 USDC left this year | `--from <budget>`: only budgets whose hat (or one above) you wear now; or **Treasury, by Board proposal** (`--as-directors`, Directors only) |
| When | Now / On a day: 15 Nov 2026 / At a time | `--on`, `--at` (in the future) |
| What it pays | Purchase invoice PINV-2026-00145 · Studio Varga · £2,525.76 | the documents the advice allocates to (`design-bank.md` 2.3); or "Nothing, add a note" |
| Booked to | 6100 · Subcontractors | `--account` (a code of the chart); `--suggest` for a new one |
| Note for the Directors | "Seed legal costs, per the term sheet" | `--note`, with `--as-directors` only |

**Review step** shows: the approval summary; "Design has 31,880.00 USDC left this year; after this, 28,680.00"; "The
payout ceiling has 641,222.25 USDC left"; the proof preview ("This payment will carry a proof that it pays PINV-2026-00145,
£2,104.80 + VAT £420.96"); **Send for approval** (primary).

**States and refusals** (from `payments/operations.ts:152-178`), shown inline under the field they concern:

| Refusal | Shown as |
|---|---|
| INVALID_RECIPIENT | "Nobody has the handle @studio-varga. Check it, or pay an email." |
| INSUFFICIENT_BALANCE | "The Treasury holds less than 3,200.00 USDC." |
| ROLE_PERMISSION_DENIED | "You don't wear the Design hat or one above it. Ask Priya Raman or Maya Okafor, or ask the FDE to draft it for them." |
| PAYROLL_BUDGET_EXCEEDED | "Design has 1,240.00 USDC left this year." |
| WRONG_STATE | "Design is closed." |

**Command strip** (fills as the form fills): `capxul payment send @studiovarga 3200 --org harbourline --from design
--on 2026-11-15 --account 6100` · `client.payments.pay({ org, to: "@studiovarga", amount: "3200", from: "design",
payAt: "2026-11-15" })`. The Board variant: `capxul payment send northbank@nbv.vc 12000 --org harbourline
--as-directors --on 2026-11-30 --note "Seed legal costs"`.

### 3.5 Payment (form), with its proof

**Purpose.** One payment in full: what it is, where it stands, who approved it, what it pays, and the chain's proof.

**Layout.**

1. **Page head.** "Payment to Kestrel Cloud Ltd", pill **Settled**, amount "−2,051.00 USDC · £1,618.80"; actions by
   state (below).
2. **Progress line:** Prepared 5 Nov 14:01 → Approved by Tom Ashworth 14:02 → Sent 14:02 → On chain 14:03 (block
   53,108,442) → Booked PAY-2026-00317. For a dated payment: Scheduled → Due → Sent → Settled. For money waiting:
   Funded → Money waiting → Claimed or Taken back.
3. **Summary** (two columns):

   | Field | Example | Source |
   |---|---|---|
   | From | Harbourline Treasury · 0x4A1f…9c2E | `payer_label`, `payer_safe` |
   | Paid from | Engineering budget | `budget_id`, `route` budget |
   | Approved by | Tom Ashworth, wearing the Engineering hat, from his Safe 0x2C6e…B814 | the approval's signer; the hat read at that block (`design-bank.md` P9) |
   | To | Kestrel Cloud Ltd · 0x91c2…44Be | `payee_label`, `payee_safe` |
   | Amount | 2,051.00 USDC | `amount_raw`, `asset` |
   | In GBP | £1,618.80 at 1 USDC = £0.789273 | the advice's `cash` and rate |
   | Fee | none (a bank payout shows Bridge's fee here) | `fee_raw` |
   | Booked to | 2000 · Accounts payable, against PINV-2026-00141 | `against` |
   | Created | 5 Nov 2026, 14:01:37 | `created_at` |
   | Settled | 5 Nov 2026, 14:03:09 | `settled_at` (the block's time) |
   | Payment ID | payment_01JC2W8K4T6Y9QZ3M7N5B1R0FD | `id` |

4. **What it pays** (the advice, in words): one card per allocation.
   - "Purchase invoice **KC-88213** from Kestrel Cloud Ltd, 31 Oct 2026 (Capxul's PINV-2026-00141), version
     paid 0xa41f…77c0. Allocated **£1,618.80**."
   - Lines: "1 · Cloud hosting, October 2026 (4 application servers, 2 databases) · £1,349.00 · VAT 20% £269.80".
   - Adjustments: none. On account: £0.00. Memo: none.
5. **Proof** (2.6):

   | Field | Example | What it proves |
   |---|---|---|
   | Network | Base · chain ID 8453 | |
   | Payment ID (on chain) | 0x9b3f1e0c4a7d52e8f6b0c3a91d4e7f20b8c65a13d9e04f7a2c1b6e83d5f09e21c | a hash of every term; pays at most once |
   | Document hash | 0x3c8d6a02f1e94b7c5d03a8e61f2c9b47e0d5a3f18c6b29e74d0a1f53c8e6b912 | commits to the advice above (EIP-712) |
   | Transaction | 0x5e1a…c9d0 · block 53,108,442 · 5 Nov 2026 14:03:09 UTC | links to basescan |
   | Log | PaymentSent #118, Transfer #117 | `settled_log_index`, the feed's `paymentEventLogIndex`, `transferLogIndex` |
   | Settled through | Budgets (the Engineering budget) | `settledThrough` (`activity/feed.ts:129`) |
   | Finality | Final (posted in an L1 batch) | |
   | Booked | Payment entry PAY-2026-00317, 5 Nov 2026 | the books' voucher (`accounting.md` 5.9) |

   **Verify** shows five ticks: "The stored advice hashes to the document hash on chain"; "The terms hash to the
   payment ID"; "Token and amount match the chain"; "Purchase invoice PINV-2026-00141 re-hashes to the version paid";
   "The payment entry's references equal the allocations". A **Raw** toggle shows the advice's typed message.
6. **Documents:** "Payment advice (proof) · document get · Save as PDF", from `documents`.
7. **Timeline:** every transition with who and when ("Prepared by Tom Ashworth", "Approval opened", "Signed",
   "Settled at block 53,108,442", "Booked").

**Actions by state** (who from `payments/operations.ts`):

| State | Actions | Who | Command |
|---|---|---|---|
| Prepared | Open approval; Withdraw | the approval's signer; the preparer | `capxul payment wait approval_01JC…` |
| Scheduled, Due | Reschedule; Cancel | whoever wears the budget's hat or one above it now, or the Board for a Board payment | `capxul payment reschedule <id> --on 2026-11-20`; `capxul payment cancel <id>` |
| Money waiting | Take back; Copy claim link | the same (a personal one: the payer) | `capxul payment cancel <id>` |
| Needs retry | Retry | any current wearer of the budget's hat, or above | `capxul payment retry <id>` |
| Settled | Verify proof; Save advice as PDF; Open in Books | anyone who can read it | `capxul document verify --document-hash 0x3c8d… --content-hash 0xa41f…`; `capxul document render …` |
| Mismatched | (none: shown red with what differed) | | `capxul payment get <id>` |

**Command strip.** `capxul payment get payment_01JC2W8K4T6Y9QZ3M7N5B1R0FD --org harbourline` ·
`client.payments.get("payment_01JC2W8K4T6Y9QZ3M7N5B1R0FD")`; follow it live: `capxul payment wait payment_01JC…`.

### 3.6 The proof block, field by field

What the document hash commits to (`design-bank.md` 2.2-2.3), in the order the Raw view shows it, with Harbourline's
example. The mock-up's Raw view prints it as the typed message.

| Field | Example | Shown in words as |
|---|---|---|
| `version` | 1 | |
| `origin` | 0x77d1…0b4e | "for payment payment_01JC2W8K…" |
| `salt` | 0x5f2a91c0d3e84b17a6c2f0e9d1b37a48 | "salted, so nobody can guess the invoice from the hash" |
| `payer` | party 0xa8e2…19d3, account 0x4A1f…9c2E | Harbourline Studio Ltd, Treasury |
| `payee` | party 0x3f07…c2a1, account 0x91c2…44Be | Kestrel Cloud Ltd |
| `token`, `amount` | USDC, 2051000000 | 2,051.000000 USDC |
| `cash` | GBP, 2 decimals, 161880, rate 161880/2051000000 | £1,618.80 at 1 USDC = £0.789273 |
| `allocations[0]` | Purchase Invoice, doc 0x6c1e…, number KC-88213, date 2026-10-31, content 0xa41f…77c0, allocated 161880 | "KC-88213, £1,618.80" |
| `allocations[0].lines` | idx 1, row 0x2b90…, amount 134900, taxes [VAT, 2000 bps, 26980] | "Cloud hosting, October 2026, £1,349.00 + VAT 20% £269.80" |
| `adjustments` | [] | none |
| `onAccount` | 0 | |
| `memo` | "" | |
| `refundOf` | 0x0 | |
| `route` | budget, budgetId 0x…0007 (Engineering), payAt 0 | "from the Engineering budget, now" |
| `batch` | 0x0, 0, 0 | (a payroll slip shows "line 7 of 23 of run HR-PRUN-2026-00010") |

Other proof examples the data step should carry:

- **A bank payout** (Brightfield, 3.10): the advice names Brightfield as payee (not Bridge's deposit address), allocates
  £5,040.00 to PINV-2026-00142, adds an adjustment "+4.10 USDC, fee, Bridge", route "bank payout" with Bridge's payout
  ID, the bank amount £5,040.00 and the fee (`design-bank.md` P11).
- **A payslip** (from `hr-payroll.md`): allocation Salary Slip, batch "line 7 of 23".
- **Money waiting**: the escrow's terms carry the same document hash, so the proof exists before anyone claims it
  (`escrow.md`, terms `documentHash`).
- **A deposit** has no document hash on chain (Bridge's Transfer carries none): its proof is the Transfer, Bridge's
  deposit ID and the RF reference it matched (`design-bank.md` P10). Show "No proof on chain: matched by reference
  RF18 HL26 0087" in muted text, not an error.

### 3.7 Scheduled payments

**Purpose.** Money that will leave on a day: what, when, from which budget, and whether there will be enough.

**Layout.** A list sorted by day, soonest first (`payment list --scheduled`), with a small calendar strip above it
(the next 60 days, a dot on each day with a payment). Columns: Day · To · Amount · From · Reserved (a budget's dated
payment reserves the room when scheduled) · Status (Scheduled, Due within a day) · Shortfall (if `shortfall` is set:
"Treasury short" or "Budget exhausted") · Scheduled by.

| Day | To | Amount | From | Reserved | Status | Scheduled by |
|---|---|---|---|---|---|---|
| 15 Nov 2026 | Studio Varga | 3,200.00 USDC | Design | yes | Scheduled | Priya Raman |
| 30 Nov 2026 | Northbank Ventures | 12,000.00 USDC | Board (Treasury) | yes | Scheduled | Board proposal sp_0187 |
| 4 Dec 2026 | Marta Kowalczyk | 4,800.00 USDC | Engineering | yes | Scheduled | Tom Ashworth |
| 5 Dec 2026 | Kestrel Cloud Ltd | 2,051.00 USDC | Engineering | yes | Scheduled | @tom-build for Tom Ashworth |

(These four make the overview's "Reserved for dated payments": 3,200.00 + 12,000.00 + 4,800.00 + 2,051.00 = 22,051.00
USDC. Each is reserved in its budget from the day it was scheduled, so Design's and Engineering's spent in 4.1 already
count theirs, and the Board's sits on the company's own top budget, which no member holds.)

**Actions.** Reschedule (date picker, `--on`); Cancel; both show who may: "Whoever wears the Design hat or one above it
now (Priya Raman, Maya Okafor), or the Board." A Board payment's cancel opens a Board proposal
(`payment cancel <id> --as-directors`).

**Capxul presentation.** A dated payment's row explains, in a tooltip, that it was signed already and that "on the day,
Capxul asks the budget to pay it; nobody needs to be online". The swap rule is visible: "Priya scheduled this. If
someone else wears the Design hat on the day, it still pays, and they can cancel it."

**Command strip.** `capxul payment list --org harbourline --scheduled` · `client.payments.list({ org, scheduled: true
})`; row actions `capxul payment reschedule <id> --on <day>` and `capxul payment cancel <id>`.

### 3.8 Money waiting (escrows Harbourline funded)

**Purpose.** Money Harbourline sent to someone with no Capxul account yet, held in an escrow only that person's
future account can claim, and that Harbourline can take back until then (`aaron.escrow-general`,
`aaron.money-waiting`).

**Layout.** Tabs: **Waiting · Claimed · Taken back**. One card per escrow.

| Field | Example | Source |
|---|---|---|
| For | jules.marchetti@proton.me | `payee_mailbox` |
| Amount | 2,400.00 USDC · £1,894.32 | |
| From | Design budget, sent by Priya Raman | `budget_id`; the command's `requested_by` |
| What it pays | PINV-2026-00146 · Illustration set for Aldermoor annual report | the advice |
| Waiting since | 2 Nov 2026, 17:31 (7 days) | the `escrow` transition |
| Reminders | Sent 5 Nov (3 days) · next 12 Nov (10 days), when Design's holders are told it is uncollected · last 2 Dec (30 days) | `notices.payments.money-reminders` (`notices/payments.ts:160`): 3, 10 and 30 days |
| Escrow | 0xE7c4…5a90 (on chain, open) | `escrow_address`; indexing `escrows.standing` |
| Who can take it back now | Priya Raman (Design), Maya Okafor (Harbourline, above), or the Board | `Budgets.authorised(Design)` now (`escrow.md` G9) |
| Expires | Never: it waits until claimed or taken back | `escrow.md`: no expiry |

**Claimed** example: "Hannah Cole · 2,186.42 USDC · October pay (payslip Sal Slip/HR-EMP-00024/00001) · waiting from 31
Oct 18:05 · claimed 4 Nov 09:12 when she set up her account" (`hr-payroll.md` cast).

**Taken back** example: "m.osie@gmail.com · 750.00 USDC · from Growth, sent by Leo Brennan on 14 Jul · taken back by Leo
Brennan on 15 Jul (the email was mistyped) · the money returned to the Treasury; Growth's room for the year was not
restored" (`escrow.md`: "its room for the period stays spent").

**Actions.**

| Action | Shown to | Command |
|---|---|---|
| Take back | whoever Budgets admits on the funding budget now, or Directors (a Board proposal) | `capxul payment cancel payment_01JBZK… --org harbourline` |
| Resend the email | the sender's side (the reminder) | none booked (see 9.6) |
| Copy what to tell them | anyone | "Sign up at capxul.com with jules.marchetti@proton.me to claim 2,400.00 USDC from Harbourline Studio Ltd." |

A take-back sheet says plainly: "The money goes back to the Treasury. Design's budget for 2026 stays spent: taking it
back does not give the room back." On a race (they claim while you take back) the chain decides; the result shows
whichever landed (`escrow.md` G7).

**Command strip.** `capxul payment list --org harbourline` (Money waiting tab filters status escrowed) ·
`client.payments.list`; take back `capxul payment cancel <id>` · `client.payments.cancel(<id>)`.

### 3.9 Money waiting for you (the recipient's side)

**Purpose.** What a person sees when money waits for them: before they have an account (the email and the sign-up
page) and after (the claim).

**Layout, three moments.**

1. **The email** (`money-waiting`, `notices/payments.ts:125`): subject "Harbourline Studio Ltd sent you 2,400.00 USDC";
   body: the amount, the payer, "It is waiting for you. Sign up with this email address to claim it. Until you do,
   Harbourline can take it back."; a link to the escrow on the explorer; the sign-up button. Reminders at 3, 10 and 30
   days ("This is the last reminder", at 30).
2. **Sign-up's last step**: "2,400.00 USDC from Harbourline Studio Ltd is waiting for you. Claim it into your new Safe."
   One approval from the new Safe (`accounts.setup.personal-safe` opens it), button **Claim 2,400.00 USDC**.
3. **Later** (Acting as yourself › Money › Money waiting for you): a list of escrows whose owner is your Safe, each with
   amount, from, waiting since, and **Claim**; "Claim all" when several. Empty state: "Nothing is waiting for you."

**Refusals shown.** "Harbourline took this back on 15 Jul." (WRONG_STATE: already refunded); "Already claimed on 4
Nov."

**Command strip.** `capxul payment claim` · `client.payments.claim()` (it takes no payment ID: it claims everything
waiting for you, `escrow.md` "Which commands").

### 3.10 Bank: pay a bank account (Bridge payout)

**Purpose.** Pay someone in pounds, euros or dollars to their bank. The USDC leaves the Treasury for Bridge, and Bridge
delivers fiat (`aaron.other-accounts`: "paying someone in fiat goes out through Bridge").

**Layout.** A form, then a **quote** card, then the approval.

| Field | Example | Source |
|---|---|---|
| Pay | Brightfield Workspace Ltd (saved contact) / yourself / a new account | `bank pay self|contact` |
| Their account | Brightfield Workspace Ltd · NatWest · ending 2291 · GBP · Faster Payments | the saved bank account (`bank-accounts`: `holder_name`, `bank_name`, last four, `currency`) |
| Amount | £5,040.00 reaches the bank (fixed) / 6,390.40 USDC leaves the Treasury (fixed) | `fixed`: receive or send (an amount on its own fixes what reaches the bank; `USDC` after it fixes what leaves) |
| Pay from | Operations · 15,881.38 USDC left this year | `--from` |
| What it pays | PINV-2026-00142 · BW-2026-1107 · due 15 Nov | the advice |

**The quote card** (`banking/data.ts:881-888`):

| Field | Example |
|---|---|
| Bank receives | £5,040.00 |
| Treasury sends | 6,390.40 USDC |
| Rate | 1 USDC = £0.78919 |
| Bridge fee | 4.10 USDC |
| Slippage buffer | 0.89 USDC |
| Rail | Faster Payments, usually within minutes |
| Quote expires | 10:52 (in 9:41) |

Then the approval sheet (2.5), whose recipient row shows rail Bank, "requested output £5,040.00", exact.

**Payouts list** (tab **Payouts**): Date · To · Bank amount · Sent (USDC) · Fee · From · Status · Reason.

| Date | To | Bank amount | Sent | Fee | From | Status |
|---|---|---|---|---|---|---|
| 9 Nov | Brightfield Workspace Ltd | £5,040.00 | 6,390.40 USDC | 4.10 | Operations | Quoted · waiting for Nadia Farouk's approval |
| 7 Nov | Hollis & Reed Accountants | £1,920.00 | 2,436.30 USDC | 3.75 | Operations | In transit |
| 31 Oct | Payroll October: 9 bank payouts | £41,388.12 | 52,470.66 USDC | 34.20 | Harbourline | Delivered |
| 28 Oct | Fieldwork Catering Ltd | £412.50 | 525.10 USDC | 2.40 | Operations | Refunded · bank returned (account closed); 522.70 USDC back in the Treasury |
| 3 Oct | Tallis Insurance Brokers | £1,344.00 | | | Operations | Expired · quote expired unpaid |

**A payout's page** shows the two hops (`design-bank.md` P11, decision `bank.payout-two-hops`): "1 · From the Treasury
to Bridge: on chain 7 Nov 16:20, block 53,190,118 (proof)" and "2 · Bridge to Hollis & Reed's bank: in transit, Faster
Payments", then "Delivered" with the delivered amount, or "Returned" with the refund transaction. A returned payout
shows its reason in words (`banking/data.ts:837-848`: "The bank returned it", "Bridge could not deliver", "The bank
account changed before you approved", "Delivery is taking longer than usual").

**Actions.** Get a new quote (after expiry); Approve; for a returned payout, "Pay again" (a new payout).

**Command strip.** `capxul bank pay contact 5040 --org harbourline --account bacc_brightfield --from operations` (the
CLI asks which contact; the account flag names the saved account) · `client.approvals.prepare(...)` per the frozen
SDK name; list: no booked list command for payouts (9.6), the mock shows `capxul payment list --org harbourline` with
the bank rows.

### 3.11 Bank: get paid by bank (bank details and deposits)

**Purpose.** The bank details customers pay Harbourline by. Money paid in is converted to USDC at the edge and lands in
the Treasury (`aaron.other-accounts`; `design-bank.md` P10).

**Layout.** Tabs: **Bank details · Deposits · Verification**.

**Bank details**: one card per currency (`bank-details`, public fields `banking/data.ts:358-366`), masked until asked.

| Currency | State | Bank | Payee | Account | Rails | Minimum | Capxul fee | Becomes |
|---|---|---|---|---|---|---|---|---|
| GBP | Active | ClearBank | Harbourline Studio Ltd | sort code •• •• ••, account ending 6630 | Faster Payments | £2.00 | 0.50% | USDC in the Treasury |
| USD | Active | Lead Bank | Harbourline Studio Ltd | routing ••••••644, account ending 7731 | ACH, Wire | $2.00 | 0.50% | USDC |
| EUR | Active | (EU partner bank) | Harbourline Studio Ltd | IBAN ending 4410 | SEPA | €2.00 | 0.50% | USDC |

(Bank names are illustrative; the data step may use fictional ones. The fee is Capxul's developer fee on Bridge, which
is how Capxul is paid, `design-bank.md` P10 notes.)

Each card: **Show full details** (`bank details --currency GBP`, which reveals the numbers to someone with authority),
**Change what it becomes** (USDC or EURC, `bank settle GBP --to USDC`), and the line "Invoices print these details and
an RF reference, so a payment matches its invoice by itself."

**Deposits** (`bank deposits`): Received · From · Amount (bank) · Net (tokens) · Fees · Status · Matched to.

| Received | From | Bank amount | Net | Fees | Status | Matched to |
|---|---|---|---|---|---|---|
| 8 Nov 09:40 | Tessellate GmbH | €4,200.00 | | | Arriving | |
| 6 Nov 11:52 | Northstar Retail Ltd | £12,480.00 | 15,716.61 USDC | 94.87 USDC (Capxul 0.50%, exchange 0.10%) | Credited | SINV-2026-00087, by reference RF18 HL26 0087 |
| 4 Nov 15:07 | PAYPAL *HARBOURLN | £640.00 | 805.97 USDC | 4.87 USDC | Credited | Unmatched |
| 29 Oct 10:21 | Copperline Inc. | $8,500.00 | 8,449.00 USDC | 51.00 USDC | Credited | SINV-2026-00084 |
| 21 Oct 08:02 | R PATEL | £1.00 | | | Below minimum | |
| 14 Oct 13:30 | (unknown sender) | $300.00 | | | Returned | |

A deposit's page: the bank side (sender name, rail, reference, Bridge's deposit ID), then the chain side ("Arrived in
the Treasury: 15,716.61 USDC, transaction 0x0b77…3e12, block 53,150,906"), the fees, and the match.

**Actions.** Match (for an unmatched credited deposit): pick a likely invoice or request from a ranked list, or "Not an
invoice"; `bank match <deposit> <request|none>`. Who: someone with current authority to manage (frozen who).

**Verification**: the business's verification for bank transfers (`verify status`): Status Approved; currencies USD
approved, EUR approved, GBP approved (`CurrencyStatus`, `banking/data.ts:38`); the people Bridge asked for: Maya
Okafor (Director, owner of 46.25%), approved 14 May 2025; a line "Bridge, Capxul's banking partner, made these
decisions."

**Command strip.** `capxul bank details --org harbourline` (masked) and `--currency GBP` (full);
`capxul bank deposits --org harbourline` (`--unmatched` for the Unmatched filter); `capxul bank match bdep_01JC… none`;
`capxul bank settle GBP --to USDC`; `capxul verify status --org harbourline`. SDK: `client.banking.details.get`,
`client.banking.deposits.list`, `client.banking.deposits.match`, `client.banking.details.settle`,
`client.verification.status`.

### 3.12 Bank: accounts

**Purpose.** Two different things, kept apart on purpose:

1. **Saved bank accounts**: where Harbourline pays out to (`bank accounts`): its own Barclays account (scope self), and
   suppliers' and payees' accounts (scope contact and payee).
2. **Other accounts Harbourline keeps**: the ordinary Barclays account, whose balance and statement live in Books and
   are reconciled the usual way (`aaron.other-accounts`; `accounting.md` 5.17-5.18).

**Layout.** Two sections.

**Saved bank accounts** (`bank-accounts`, `banking/data.ts:484`): Holder · Bank · Last four · Currency · Scope ·
State · Saved by · ID.

| Holder | Bank | Last four | Currency | For | State | Saved by |
|---|---|---|---|---|---|---|
| Harbourline Studio Ltd | Barclays | 4417 | GBP | Yourself (move money to Barclays) | Active | Maya Okafor |
| Brightfield Workspace Ltd | NatWest | 2291 | GBP | Supplier | Active | Nadia Farouk |
| Hollis & Reed Accountants | Lloyds | 8804 | GBP | Supplier | Active | Nadia Farouk |
| Ellis Hart | Monzo | 1176 | GBP | Payee (salary) | Active | Kwame Mensah |
| Fieldwork Catering Ltd | Starling | 0932 | GBP | Supplier | Inactive (returned 28 Oct) | Nadia Farouk |

Actions: **Save a bank account** (a form asking each field the currency needs, numbers typed hidden), **Remove**.

**Other accounts**: one card, "Barclays Business · GBP · sort code 20-45-77 · ending 4417 · £29,877.54 per books ·
statement to 6 Nov 2026 · 3 lines to reconcile", with **Reconcile in Books**. A note: "Payments from this account are
recorded in Books. Capxul does not move money in it." Moving money between the Treasury and Barclays is a bank payout
to "Yourself" (3.10) one way, and a bank transfer into the GBP bank details the other (`design-bank.md` P12c).

**Command strip.** `capxul bank accounts --org harbourline` · `client.account.bankAccounts.list`; save
`capxul bank accounts add --org harbourline --currency GBP`; remove `capxul bank accounts remove bacc_01JB…`. The
Barclays card: `capxul org doc get bank-account "Barclays Business"` (the document family with "head" dropped,
`accounting.md` 2.4 rule 2).

### 3.13 Requests to pay (inbox)

**Purpose.** Payment requests other Capxul users sent to Harbourline, to pay exactly or decline (`inbox`). Short,
because the invoices themselves are Books' (purchase invoices, `accounting.md` 5.6).

**Columns.** Received · From · Reference · Amount · Due · Status (Open, Paid, Declined, Expired) · ID.

| Received | From | Reference | Amount | Due | Status |
|---|---|---|---|---|---|
| 7 Nov | Studio Varga | SV-0412 Motion design, Aldermoor film | 3,200.00 USDC | 15 Nov | Open (scheduled for 15 Nov) |
| 2 Nov | Kestrel Cloud Ltd | KC-88213 | 2,051.00 USDC | 5 Nov | Paid |

**Actions.** Pay (now or on its due date: `--on due`), Decline. Who: a holder of a budget, paying from it.

**Command strip.** `capxul inbox list --org harbourline`; `capxul inbox pay req_01JC… --org harbourline --on due`;
`capxul inbox decline req_01JC…`.

---

## 4. Departments, allowances and ceilings

Sidebar section **Departments**: Departments · Allowances · Payout ceilings. The Books sidebar's "Department budgets"
link lands here (`accounting.md` 5.1).

### 4.1 Departments (the budget tree)

**Purpose.** How Harbourline's money is divided, who acts for each part, and how much each has left this period
(`aaron.departments`: budgets belong to departments; people are swapped in and out by hat).

**Layout.**

1. Page head "Departments", period selector "2026 (1 Jan to 31 Dec, UTC)", primary **New department** (Directors:
   a top department; a holder: a team under theirs), secondary **Payout ceilings**.
2. A **tree table** (indent by level), one row per budget (`BudgetLine`, `budgets/shapes.ts:116`).
3. A bar on each row: spent (solid), committed (hatched), left (empty), against the amount.

**Columns.**

| Column | Example (Engineering) | Source |
|---|---|---|
| Department | Engineering (team, under Harbourline) | `name`, `kind`, `parent` |
| Holders | Tom Ashworth | `office.holders` (by email or an agent's @handle; a Safe Capxul cannot name shows its address) |
| Budget | 180,000.00 USDC / year | `amount`, `period` |
| Teams and allowances | 0.00 | `childrenAmount` |
| Spent | 128,904.55 | `spent` |
| Committed | 8,400.00 (1 agreement) | `committed`, `runningAgreements` |
| Left | 42,695.45 | `left` |
| Refills | 1 Jan 2027 | `refillsAt` |
| Status | Active | `status`, `closed` |

**Harbourline's tree on 9 November 2026** (USDC, year 2026):

| Department | Holders | Budget | Teams and allowances | Spent | Committed | Left |
|---|---|---|---|---|---|---|
| Harbourline | Maya Okafor | 1,900,000.00 | 520,000.00 | 1,102,436.18 | 0.00 | 277,563.82 |
| ├ Design | Priya Raman | 90,000.00 | 0.00 | 61,320.00 | 0.00 | 28,680.00 |
| ├ Engineering | Tom Ashworth | 180,000.00 | 0.00 | 128,904.55 | 8,400.00 | 42,695.45 |
| ├ Delivery | Grace Adeyemi | 110,000.00 | 24,000.00 | 53,215.30 | 0.00 | 32,784.70 |
| │ └ Travel (allowance, 2,000.00/month) | Grace Adeyemi | | | | | |
| ├ Growth | Leo Brennan | 80,000.00 | 0.00 | 58,960.10 | 0.00 | 21,039.90 |
| └ Operations | Nadia Farouk | 60,000.00 | 16,800.00 | 27,318.62 | 0.00 | 15,881.38 |
|   ├ Subscriptions (allowance, 1,200.00/month) | @kwame-ops | | | | | |
|   └ Capxul (allowance, 200.00/month) | Kwame Mensah | | | | | |

(Notes for the data step: Harbourline's own spend is payroll, paid from the top department in one run a month, as
`hr-payroll.md` proposes; the teams' spend is suppliers, contractors and tools. A team's amount is carved from its
parent, so Harbourline's left is 1,900,000 − 520,000 − 1,102,436.18. Allowances are budgets too: an allowance's amount
counts in its parent's "Teams and allowances". The monthly allowances count 12 months: Travel 24,000, Subscriptions
14,400, Capxul 2,400.)

**Actions** (menu on each row; each shows who may, `authority.md` lines 203-224):

| Action | Who may | Carried by | Command |
|---|---|---|---|
| Pay from this department | its holders, or a holder above | an approval from the payer's Safe | `capxul org department pay design --to @studiovarga --amount 3200` |
| New team under it | its holders, or above, or the Board | an approval (or a Board proposal) | `capxul org department create "Brand" --parent design --budget 20000/year --holder amira@harbourline.studio` (9.5) |
| New top department | the Board | a Board proposal | `capxul org department create "Research" --budget 60000/year --holder ruth@…` |
| Change its budget | for a team: the holder of the department above, or the Board; for a top department: the Board. Never its own holders | an approval or a Board proposal | `capxul org department budget set engineering --budget 200000/year --note "Two hires in Q1"` |
| Add a holder | as above (a team: the department above; a top department: the Board) | as above | `capxul org department holder add delivery ravi.shah@harbourline.studio` |
| Remove a holder | as above; or the Board | as above | `capxul org department holder remove delivery grace.adeyemi@harbourline.studio` |
| Close / Reopen | as for its budget | as above | `capxul org department close growth`, `… reopen growth` |

The ROLE_CONFLICT rule shows as a disabled holder choice: Kwame Mensah wears the People hat, so "Kwame Mensah cannot
hold a department or team while he wears People" (`authority.md` lines 238-246; `budgets.role-conflict-people-hat`).

**Command strip.** `capxul org department list --org harbourline` · `client.org(orgId).departments.list()`.

### 4.2 Department (one)

**Purpose.** One department's money and people: its budget this period, its holders now and before, what it set
running, and what it paid.

**Layout.** Page head "Engineering", pill Active, the holder chips ("Tom Ashworth · Engineering hat"), primary **Pay
from Engineering**. Then tabs in order:

1. **Overview**: the budget bar; four figures (Budget 180,000.00 · Spent 128,904.55 · Committed 8,400.00 · Left
   42,695.45); a monthly spend chart for 2026 (bars, January to November); "Who can act for Engineering now: Tom
   Ashworth (holder); Maya Okafor (holder of Harbourline, above); the Board (2 of 3 Directors)"; the payout ceiling it
   pays within ("USDC ceiling: 641,222.25 left of 2,100,000.00 this year").
2. **Holders**: the swap screen (4.3).
3. **Running**: what the department set running, which stays the department's whoever holds the hat:
   - agreements: "Sofia Lindqvist · 4,800.00 USDC a month · running since 2 Feb 2026 · collected 43,200.00 to 2 Nov · committed 8,400.00 to the year's end";
   - dated payments: Marta Kowalczyk 4 Dec, Kestrel Cloud 5 Dec;
   - money waiting: none;
   - teams: none.
4. **Payments**: the payments list filtered to this budget.
5. **Changes**: every change proposed on this budget (`budget-changes`, `budgets/data.ts:149`): Kind · Terms · Signed
   by (Board or the office above) · Proposal or approval · State · Outcome · When.

   | When | Change | Terms | Signed by | State |
   |---|---|---|---|---|
   | 9 Nov 2026 | Set amount | 180,000 → 200,000 USDC/year | Maya Okafor (office above), once Harbourline's raise sp_0193 executes | Proposed |
   | 2 Feb 2026 | Add holder | @tom-build | Maya Okafor (office above) | Applied |
   | 12 Jan 2026 | Set amount | 140,000 → 180,000 | Maya Okafor | Applied |
   | 1 May 2025 | Create | Engineering, under Harbourline, 140,000/year, holder Tom Ashworth | Maya Okafor | Applied |

   (The 2 Feb row is an example of an agent holding a team hat with its owner; the data step may drop it. If kept, the
   Holders tab lists @tom-build beside Tom, and 4.1's holders column reads "Tom Ashworth, @tom-build".)

**Command strip.** `capxul org department show engineering --org harbourline` · `client.org(orgId).departments.get
("engineering")`.

### 4.3 Swap a holder

**Purpose.** Put a person into a department or take one out, the operation the departments ruling exists for.

**Layout.** On the Holders tab:

- **Holders now**: one row each: name, email or @handle, their Safe, "since 1 May 2025", **Remove**.
- **Add a holder**: a member picker (seated people and agents; People-hat wearers greyed out with the reason).
- **What stays with the department** (always visible, from `authority.md` lines 183-192): "Agreements keep paying and
  their payees keep collecting. Dated payments still pay on their day. Money waiting can still be taken back. Teams
  keep their budgets. The budget, its room and the payout ceiling don't change. Whoever wears the hat next acts on all
  of them." And: "An approval the old holder opened and didn't sign will be refused."
- **History**: holders before ("Growth: Maya Okafor 1 May 2025 to 19 Jan 2026; Leo Brennan from 19 Jan 2026").

**The example swap for the mock-up**: Grace Adeyemi starts parental leave on 1 December; Ravi Shah takes the Delivery
hat. Maya, who wears the Harbourline hat above Delivery, adds Ravi and later removes Grace, each with one approval from
her own Safe. The sheet for the removal says: "Grace stops being able to act for Delivery's money at once. Her
Delivery travel allowance is a separate hat: remove it too?" (allowance hats are the Board's to change,
`authority.md` lines 104-107, so that second step is a Board proposal).

**Refusals.** ROLE_CONFLICT ("Kwame wears People"); ROLE_PERMISSION_DENIED ("Only the holder of Harbourline, above
Delivery, or the Board can change Delivery's holders"); WRONG_STATE ("Delivery is closed").

**Command strip.** `capxul org department holder add delivery ravi.shah@harbourline.studio --org harbourline` and
`capxul org department holder remove delivery grace.adeyemi@harbourline.studio --org harbourline` ·
`client.org(orgId).departments.holders.add({ department: "delivery", member: "ravi.shah@harbourline.studio" })`.

### 4.4 Allowances

**Purpose.** Small budgets for one person or agent to spend from, with a monthly refill (`org allowance`). Their hats
sit under the Board's, so only the Board changes who holds them, while their amount follows the parent's room
(`authority.md` lines 90-94).

**Columns.** Name · Holder · Under · Amount / period · Spent this period · Left · Refills · State · ID.

| Name | Holder | Under | Amount | Spent (Nov) | Left | Refills |
|---|---|---|---|---|---|---|
| Subscriptions | @kwame-ops (Kwame Mensah's agent) | Operations | 1,200.00 / month | 486.20 | 713.80 | 1 Dec |
| Capxul | Kwame Mensah | Operations | 200.00 / month | 100.00 | 100.00 | 1 Dec |
| Travel | Grace Adeyemi | Delivery | 2,000.00 / month | 614.75 | 1,385.25 | 1 Dec |

The "Capxul" allowance exists because the People hat cannot hold a department, and seats are bought by a People-hat
wearer from a budget whose hat they wear (`authority.md` contradiction 16; `payments.seat-authority`).

**Actions.** New allowance (Board proposal, `org allowance create --input …`); Assign or Revoke a holder (Board
proposal); Change amount.

**Command strip.** `capxul org allowance list --org harbourline`; `capxul org allowance get subscriptions`;
`capxul org allowance assign subscriptions --member @kwame-ops`. SDK `client.org(orgId).allowances.list()`.

### 4.5 Payout ceilings

**Purpose.** The most that can leave the Treasury through budgets each year, per token: the company's brake
(`Ceiling`, `budgets/shapes.ts:105`).

| Token | Ceiling | Left this year | Period | Frozen |
|---|---|---|---|---|
| USDC | 2,100,000.00 | 641,222.25 | year | No |

Actions (Directors, Board proposals): **Set**, **Freeze** (with "leave" amount), **Unfreeze**. The freeze sheet says:
"Every department and allowance stops paying out in USDC until the Directors unfreeze it. Agreements don't end."

**Command strip.** `capxul org department ceiling set --token USDC --amount 2100000/year`; `capxul org department
ceiling freeze --token USDC --leave 0`; `capxul org department ceiling unfreeze --token USDC`.

---

## 5. Approvals, the Board and equity

### 5.1 Approvals: what waits for whom

**Purpose.** One place for everything waiting on a person: approvals from their own Safe, Board proposals, HR
decisions their hat makes, requests to pay, deposits to match, money uncollected, hosting due. Book:
`responsibilities.summaries` makes this a web-app flow over approvals', board's, requests', banking's and payroll's
reads, with no command of its own (section 7, 9.6).

**Layout.** Page head "Approvals", with two tabs: **Waiting for you** (the signed-in person) and **Waiting for
others** (everything open in Harbourline, grouped by who it waits for). Each item is a row with: what (a sentence),
amount, opened by, opened when, expires, and the action button for the person it waits for.

**Waiting for you, as Maya Okafor** (Director, Harbourline holder):

| What | Amount | Opened by | When | Expires | Action |
|---|---|---|---|---|---|
| Board proposal sp_0193: raise Harbourline's budget to 2,000,000 USDC/year | | Maya Okafor | 9 Nov 09:30 | | Approved by you · waiting for Tom or Ruth |
| Board proposal sp_0194: grant Books to Nadia Farouk | | Kwame Mensah asked the FDE; Maya proposed | 8 Nov 16:12 | | **Approve** |
| Leave: Grace Adeyemi, 1 Dec 2026 to 28 Feb 2027 (parental) | | Grace Adeyemi | 6 Nov | | **Approve** / Reject (Harbourline is above Delivery; Grace cannot decide her own) |
| Money uncollected: jules.marchetti@proton.me, 2,400.00 USDC from Design, 7 days | 2,400.00 USDC | | | | Take back (also Priya's) |

**Waiting for others**:

| Waits for | What | Amount | Expires |
|---|---|---|---|
| Nadia Farouk (Operations) | Approval: pay Brightfield Workspace Ltd £5,040.00 by bank | 6,390.40 USDC | quote 10:52 today |
| Tom Ashworth or Ruth Calloway (Directors) | Board proposal sp_0193 | | |
| Tom Ashworth or Ruth Calloway (Directors) | Board proposal sp_0194 | | |
| Priya Raman (Design) | 2 expense claims from Amira Haddad and Ben Okoro | 318.40 USDC | |
| Kwame Mensah (Books) | 1 unmatched deposit: PAYPAL *HARBOURLN £640.00 | | |
| Anyone with the Capxul allowance (Kwame Mensah) | FDE hosting due 24 Nov: 20.00 USDC | 20.00 USDC | 1 Dec (paused after) |
| Owen Grady (invited) | Invitation to a seat, sent 3 Nov | | 17 Nov |

**Actions.** Each row's action opens its own sheet (2.5) or screen. A filter by kind (Money, Board, HR, Banking,
People).

**Capxul presentation.** Lead with the sentence, not the record type. Show the hat that makes it the person's: "because
you wear the Harbourline hat". An item that waits for a hat shows every current wearer, so a swap changes who sees it
at once.

**Command strip.** Per row: `capxul payment wait approval_01JC…`; `capxul org proposal list --org harbourline --status
waiting`; `capxul org hr leave list --org harbourline` (HR's); `capxul inbox list`; `capxul bank deposits --unmatched`;
`capxul org fde show`. Your standing: `capxul org me --org harbourline` (role, whether you can manage people or spend,
whether you are a Director, how many approvals changes need, the budgets you can pay from).

### 5.2 Board

**Purpose.** Who controls the Treasury and how many must agree; who wears the officer hats.

**Layout.** Page head "Board". Sections in order:

1. **Directors** (`org board show`): Name · Safe · Signs Board proposals · Seat · Elected by · Term ends · "You".

   | Director | Safe | Signs | Seat | Elected by | Term ends |
   |---|---|---|---|---|---|
   | Maya Okafor (you) | 0x91aD…3F07 | Yes | Founder | Shareholder vote vt_0003 | 20 Aug 2028 |
   | Tom Ashworth | 0x2C6e…B814 | Yes | Common | Shareholder vote vt_0003 | 20 Aug 2028 |
   | Ruth Calloway (Northbank Ventures) | 0xE40b…77A2 | Yes | Seed Preferred | Shareholder vote vt_0003 | 20 Aug 2028 |

2. **Threshold**: "2 of 3 Directors must approve every Board proposal." Changed by: "the shareholders' vote, since the
   equity handover on 20 Aug 2026" (before the handover, the founder's Safe; `authority.md` lines 82-84).
3. **Officer hats** (no money, Capxul's own permissions, `authority.md` lines 109-120):

   | Hat | What it lets you do | Worn by |
   |---|---|---|
   | Books | the chart, assets, annotations, bank details (with a Director) | Kwame Mensah |
   | Invoicing | requests, services, bank matches, the Organization's keys | Leo Brennan, Kwame Mensah |
   | People | invitations and seats, the contact book and CRM, HR records, projects | Kwame Mensah |

4. **Treasury**: address, nonce 42, proposals waiting 2 (link to Proposals).
5. **History**: Director and threshold changes (`board-changes`): "20 Aug 2026 · Ruth Calloway seated by vote vt_0003";
   "20 Aug 2026 · Equity handed over to the shareholders' vote"; "1 Sep 2025 · Tom Ashworth seated by Maya Okafor;
   threshold 1 → 2".

**Actions.** Grant or revoke an officer hat (a Board proposal: `org member grant`); Propose (opens Proposals); for the
shareholders (after handover): elect or remove a Director by vote (5.6).

**Command strip.** `capxul org board show --org harbourline` · `client.org(orgId).board.get()`; grant `capxul org member
grant nadia.farouk@harbourline.studio --permission manage-books --note "Month-end close"`.

### 5.3 Board proposals (list)

**Purpose.** Every company Safe transaction, waiting or done, newest nonce first (`org proposal list`).

**Columns.** Nonce · Proposal · Kind (Transaction, Rejection, Scheduled payment) · Note · Proposed by · Approvals ·
Status · When.

| Nonce | Proposal | Note | Proposed by | Approvals | Status |
|---|---|---|---|---|---|
| 41 | sp_0194 · Grant Books to Nadia Farouk | "Month-end close" | Maya Okafor | 1 of 2 | Waiting |
| 40 | sp_0193 · Raise Harbourline's budget to 2,000,000 USDC/year | "Two engineering hires in Q1" | Maya Okafor | 1 of 2 | Waiting |
| 39 | sp_0187 · Pay Northbank Ventures 12,000.00 USDC on 30 Nov | "Seed legal costs" | Ruth Calloway | 2 of 2 | Executed |
| 38 | sp_0181 · Allowance "Capxul" for Kwame Mensah, 200 USDC/month | | Maya Okafor | 2 of 2 | Executed |
| 37 | sp_0176 · Freeze USDC payouts | "Test, rejected" | Tom Ashworth | | Rejected by sp_0177 |

Tabs (`--status`): **Waiting · Executed · Rejected · Replaced · All**.

**Command strip.** `capxul org proposal list --org harbourline --status waiting` · `client.org(orgId).proposals.list
({ status: "waiting" })`.

### 5.4 Board proposal (one)

**Purpose.** Check exactly what you are about to approve.

**Layout.** Page head "Raise Harbourline's budget to 2,000,000 USDC/year", pill "Waiting · 1 of 2". Sections:

1. **What it does**, in words, then the calls decoded: "1 · Budgets.setAmount(Harbourline, 2,000,000.00 USDC) · 2 ·
   Roles: resize the USDC payout ceiling to 2,200,000.00". A **Raw** toggle shows to, value, data per call. Why the
   Board: Harbourline is a top department, and nobody changes their own budget through its own hat (`authority.md`
   lines 98-100). Engineering, a team under it, Maya then raises herself.
2. **Note**: "Two engineering hires in Q1 (Owen Grady, one more)".
3. **Approvals**: Maya Okafor approved 9 Nov 09:31 (her approval approval_01JC…, on chain); Tom Ashworth: not yet;
   Ruth Calloway: not yet. "The next approval executes it."
4. **Details**: Proposal ID sp_0193, nonce 40, Safe transaction hash 0x4d0e…91ab, proposed by Maya Okafor from Safe
   0x91aD…3F07, created 9 Nov 09:30.
5. Once executed: execution transaction and block.

**Actions.** For a Director who has not approved: **Approve** (opens the sheet, 2.5); **Reject** (proposes a
rejection at the same nonce, which needs the threshold too). For others: "Only Directors approve. You're a member."

**Command strip.** `capxul org proposal get sp_0193 --org harbourline`; `capxul org proposal approve sp_0193`;
`capxul org proposal reject sp_0193`; `capxul org proposal wait sp_0193`. SDK `client.org(orgId).proposals.approve
("sp_0193")`.

### 5.5 Equity: cap table

**Purpose.** Who owns Harbourline, as the chain holds it (`org cap-table`, return at `equity/shapes.ts:339-353`).

**Layout.** Page head "Cap table", toggle **Issued / Fully diluted** (`--fully-diluted`), "as at 9 Nov 2026"
(`--at`). A stacked bar of ownership, then the table, then the classes.

**Columns.** Holder · Member · Common · Seed Preferred · As converted · Fully diluted %.

| Holder | Member | Common | Seed Preferred | As converted | Fully diluted |
|---|---|---|---|---|---|
| Maya Okafor | yes | 6,000,000 | | 6,000,000 | 46.25% |
| Tom Ashworth (vesting: 937,500 vested) | yes | 2,500,000 | | 2,500,000 | 19.27% |
| Northbank Ventures | no | | 1,891,892 | 1,891,892 | 14.58% |
| Fennel Capital | no | | 600,601 | 600,601 | 4.63% |
| Juniper Angels Syndicate | no | | 300,300 | 300,300 | 2.31% |
| Ifeoma Chukwu | no | | 90,090 | 90,090 | 0.69% |
| Daniel Whitlock | no | | 90,090 | 90,090 | 0.69% |
| Options granted (13 holders) | | | | 712,000 | 5.49% |
| Pool not yet granted | | | | 788,000 | 6.07% |
| **Total** | | 8,500,000 | 2,972,973 | **12,972,973** | 100% |

Issued shares (not diluted): 11,472,973. Classes: Common (authorised 20,000,000), Seed Preferred (authorised
3,000,000; 1x non-participating preference; converts to Common one for one).

(The arithmetic for the data step: SAFEs of 450,000 USDC at a 6,000,000 post-money cap convert to 810,811 shares;
the seed's pre-money of 9,000,000 over 10,810,811 shares gives 0.8325 USDC a share; 1,800,000 USDC buys 2,162,162
shares.)

**Actions.** Issue shares (Board proposal, `org equity issue`); Preview an exit (`org exit preview --proceeds
30000000`: per Common share, by class, by holder).

**Command strip.** `capxul org cap-table --org harbourline --fully-diluted` · `client.org(orgId).equity.capTable({
fullyDiluted: true })`.

### 5.6 Equity: rounds, SAFEs, options and votes

Four tabs on the Equity page after **Cap table**.

**Rounds and SAFEs.**

| Round | Kind | Terms | Raised | Investors | Status | Dates |
|---|---|---|---|---|---|---|
| Pre-seed SAFE | SAFE | cap 6,000,000 post-money, no discount | 450,000.00 USDC of 450,000 | Northbank Ventures 250,000; Juniper Angels 100,000; Ifeoma Chukwu 50,000; Daniel Whitlock 50,000 | Closed · converted 20 Aug 2026 | opened 6 Oct 2025, closed 31 Oct 2025 |
| Seed | Priced, Seed Preferred | pre-money 9,000,000; price 0.8325 | 1,800,000.00 USDC of 1,800,000 | Northbank Ventures 1,200,000 (lead); Fennel Capital 500,000; Juniper Angels 100,000 | Closed | opened 15 Jul 2026, closed 20 Aug 2026 |

A round's page: terms (with the terms document's hash, "matches the signed copy"), each investor's place (`fundraise-
investments`: invited, committed, allocated, paid, signed), the payment of each investment (a link to its Payment and
proof), and the conversions.

Commands: `capxul org round show rd_0002`; `capxul org safe show rd_0001`; new round `capxul org round create --class
"Seed Preferred" --pre-money 9000000 --raise 1800000 --pay-by 2026-08-15 --terms seed-terms.pdf`; `capxul org round
preview …`; `capxul org round invite …`; `capxul org round allocate …`; `capxul org round close …`.

**Options.** The pool and each grant (`equity-grants`; `GrantRow`, `equity/shapes.ts:149-155`).

| Grantee | Shares | Strike | Vesting | Vested | Status |
|---|---|---|---|---|---|
| Priya Raman | 120,000 | 0.10 USDC | 4 years, 1-year cliff, from 12 May 2025 | 42,500 | Active |
| Kwame Mensah | 80,000 | 0.10 | from 2 Jun 2025 | 28,333 | Active |
| Ellis Hart | 60,000 | 0.12 | from 1 Sep 2025 | 17,500 | Active |
| Grace Adeyemi | 60,000 | 0.12 | from 6 Oct 2025 | 16,250 | Active |
| Leo Brennan | 50,000 | 0.14 | from 12 Jan 2026 | 0 (cliff 12 Jan 2027) | Active |
| Daniel Price | 40,000 | 0.12 | from 3 Nov 2025 | 0 | Ended 31 Mar 2026 · 40,000 back to the pool |
| … 8 more | 342,000 | | | | |

Pool: 1,500,000 reserved; 712,000 granted and active; 788,000 left. Commands: `capxul org options grant --to
owen.grady@… --shares 40000 --strike 0.25 --agreement option-agreement.pdf --vest 4y --cliff 1y --start 2026-12-01`;
`capxul org options show`; `capxul org options end <grant>`. The person's side: `capxul shares` (their shares, waiting
grants, options vested and exercised); `capxul shares exercise <grant> …`.

**Votes** (shareholder votes; matters at `equity/data.ts:51-61`).

| Vote | Matter | Opens | Closes | For | Against | Abstain | Quorum | Status |
|---|---|---|---|---|---|---|---|---|
| vt_0005 · Authorise 1,000,000 more Common for the option pool | authorise | 6 Nov 2026 | 16 Nov 2026 | 8,500,000 | 0 | 0 | 50% | Voting |
| vt_0003 · Elect Maya Okafor, Tom Ashworth and Ruth Calloway | elect | 20 Aug 2026 | 27 Aug 2026 | 10,992,493 | 0 | 0 | 50% | Executed |
| vt_0002 · Approve the seed round | approve-round | 6 Aug 2026 | 13 Aug 2026 | 8,500,000 | 0 | 0 | 50% | Executed |

Commands: `capxul org vote list`; `capxul org vote show vt_0005`; `capxul org vote create authorise --class Common
--authorised 21000000 --note "Pool top-up"`; a shareholder casts `capxul vote cast vt_0005 --for --reason "…"`; `capxul
vote list`.

---

## 6. Seats, agents, the FDE, activity and notices

Sidebar section **Company**: Seats · Agents · FDE · Board · Equity. **Activity** and **Notices** sit in the top bar
(a feed icon and a bell).

### 6.1 Seats

**Purpose.** Who belongs to Harbourline in Capxul, how many seats it has, and what each seat is for (`aaron.seats`:
ten seats, one agent per seat, plus the company's own agent; `aaron.buy-seats`).

**Layout.**

1. **Seat meter**: "17 of 20 seats in use · 16 people, 1 open invitation · + 5 agents on their owners' seats · + the
   company's FDE". Under it: "Started with 10. Bought 10 on 1 Nov 2026 for 100.00 USDC. One more costs 10.00 USDC,
   once." Button **Buy seats** (People hat).
2. **Members** table (`org member list`): Name · Email or @handle · Kind (Person, Agent) · Seat (Own seat, Rides on
   Tom Ashworth's, The company's) · Hats worn now · Departments held · Joined · Status.

   | Name | Email or handle | Kind | Seat | Hats worn now | Joined |
   |---|---|---|---|---|---|
   | Maya Okafor | maya@harbourline.studio | Person | Own | Director; Harbourline | 1 May 2025 |
   | Tom Ashworth | tom@harbourline.studio | Person | Own | Director; Engineering | 1 May 2025 |
   | Priya Raman | priya@harbourline.studio | Person | Own | Design | 12 May 2025 |
   | Kwame Mensah | kwame@harbourline.studio | Person | Own | People; Books; Invoicing; Capxul allowance | 2 Jun 2025 |
   | Ruth Calloway | ruth@northbank.vc | Person | Own | Director | 20 Aug 2026 |
   | Grace Adeyemi | grace@harbourline.studio | Person | Own | Delivery; Travel allowance | 6 Oct 2025 |
   | Leo Brennan | leo@harbourline.studio | Person | Own | Growth; Invoicing | 12 Jan 2026 |
   | Nadia Farouk | nadia@harbourline.studio | Person | Own | Operations | 3 Mar 2026 |
   | Ellis Hart, Amira Haddad, Ben Okoro, Isla Morgan, Josh Pemberton, Ravi Shah, Chloe Martin, Freya Lund | … | Person | Own | none | 2025-2026 |
   | @tom-build | Tom Ashworth's agent | Agent | Rides on Tom's | none | 2 Feb 2026 |
   | @kwame-ops | Kwame Mensah's agent | Agent | Rides on Kwame's | Subscriptions allowance | 1 Jul 2025 |
   | @leo-outreach | Leo Brennan's agent | Agent | Rides on Leo's | none | 20 Jan 2026 |
   | @priya-studio | Priya Raman's agent | Agent | Rides on Priya's | none | 4 Sep 2025 |
   | @grace-pm | Grace Adeyemi's agent | Agent | Rides on Grace's | none | 10 Nov 2025 |
   | @harbourline-fde | Harbourline's FDE | Agent | The company's | none (acts with the asker's) | 1 May 2025 |

   A note under the table: "People paid by Harbourline don't need a seat. Hannah Cole, for example, uses her own HR
   and payslips without one." A seat never ends: people leave a department, not the company
   (`organizations.members-are-seats`).
3. **Invitations** (`org invite list`): Owen Grady · owen.grady@gmail.com · Person · Pending · sent 3 Nov · expires 17
   Nov · offers: none. Actions: Resend, Cancel.
4. **Seat purchases** (`org-seat-purchases`): "1 Nov 2026 · 10 seats · 100.00 USDC · bought by Kwame Mensah from the
   Capxul allowance · payment_01JBX… · limit 10 → 20".

**Actions.**

| Action | Who | Command |
|---|---|---|
| Invite someone | People hat (Kwame); offering a grant also needs a Director | `capxul org member invite owen.grady@gmail.com --org harbourline --request-key …` (`--agent` for an agent; `--preview` first) |
| Buy seats | a People-hat wearer paying from a budget whose hat they wear now | `capxul org seats buy 5 --org harbourline --from capxul` |
| Grant a permission (officer hat) | Directors (a Board proposal) | `capxul org member grant <email> --permission manage-books` |
| Resend or cancel an invitation | People | `capxul org invite resend <id>`, `capxul org invite cancel <id>` |

Refusal on invite when full: SEAT_LIMIT_REACHED, "All 20 seats are in use. Buy more seats (10.00 USDC each)."

**Command strip.** `capxul org seats show --org harbourline` (seatLimit 20, seatsUsed 16, offersReserved 1,
seatsBought 10, ownAgent true, price 10 USDC) and `capxul org member list --org harbourline` · `client.org(orgId).seats.show
()`, `client.org(orgId).members.list()`.

### 6.2 Member (one seat)

**Purpose.** One person's standing in Harbourline: their seat, their hats, their agent, what they can do.

**Layout.** Page head the name and photo, "Person · own seat". Sections: **Hats worn now** (each with where it came
from: "Engineering · minted by Maya Okafor's approval, 1 May 2025"); **What they can do** (from `org me` read for them:
"Can spend from Engineering; is a Director; can't manage people"); **Their agent** (@tom-build, with its state);
**Departments they are paid by** ("Engineering", from HR, a different thing from holding it, `authority.md` lines
194-196); **Personal Safe** address.

**Command strip.** `capxul org member get acct_01J… --org harbourline` · `client.org(orgId).members.get(…)`. For
oneself: `capxul org me --org harbourline`.

### 6.3 Agents

**Purpose.** The agents Harbourline's people own, one per seat, and the company's own (`aaron.seats`). An agent has
its own Safe and key; its owner can freeze, re-key, sweep or remove it, and it can never change itself
(`authority.md` lines 135-149).

**Layout.** Two lists: **Seat agents** and **The company's agent** (link to the FDE, 6.4). Columns: Agent · Owner ·
State · Safe · Holds · Hats · Created.

| Agent | Owner | State | Safe | Holds | Hats |
|---|---|---|---|---|---|
| @kwame-ops | Kwame Mensah | Active | 0x0E9a…6c44 | 12.40 USDC | Subscriptions allowance |
| @tom-build | Tom Ashworth | Active | 0xB5c2…19Ef | 0.00 | none |
| @leo-outreach | Leo Brennan | Frozen (since 30 Oct) | 0xA3f8…5D10 | 0.00 | none |
| @priya-studio | Priya Raman | Active | 0x1F6d…8e2B | 0.00 | none |
| @grace-pm | Grace Adeyemi | Active | 0xD92c…407A | 0.00 | none |

**Agent page.** Its handle, owner, key's address ("signer 0x6b1f…02cd, kept in a file on Kwame's machine"), Safe and
holdings by token (read from the chain), state, the history of changes (`agent-changes`: created, frozen, key
rotated, swept, each with its transaction), and what it did recently (its rows in the activity feed: "Paid Figma
47.88 USDC from Subscriptions, 3 Nov").

**Actions (the owner only, each an approval from the owner's Safe).** Freeze (stops its key at once), Unfreeze, Rotate
key, Sweep (move what it holds back to you), Remove. A note on Freeze: "Freezing stops its key. It keeps its hats: to
take it out of an allowance, revoke the allowance."

**Command strip.** `capxul agent list` (your own) and `capxul agent show @kwame-ops`; `capxul agent freeze
@leo-outreach`; `capxul agent unfreeze …`; `capxul agent key rotate …`; `capxul agent sweep @kwame-ops --asset USDC`;
`capxul agent remove …`; create `capxul agent create "Ops helper" --handle kwame-ops`. SDK `client.me.agents.*`.

### 6.4 The FDE

**Purpose.** Harbourline's Forward Deployed Engineer: Capxul runs it for the company (`aaron.fde-hosted`), anyone in
Harbourline may talk to it, and it acts only with the asker's permissions (`aaron.fde-anyone`; `authority.md` lines
150-159).

**Layout.** Page head "FDE", the FDE's name and handle "@harbourline-fde", pill **Running**. Tabs: **Talk · Your
conversations · Hosting · Guests**.

**Hosting** (`org fde show`; `org-fdes`, `organizations/data.ts:632`):

| Field | Example |
|---|---|
| Status | Running on Capxul |
| Handle and Safe | @harbourline-fde · 0x7d3E…a01B |
| Hats its Safe wears | none ("It acts with each asker's hats, not its own.") |
| Started | 1 May 2025 |
| Paid through | 1 Dec 2026, 00:00 |
| Due | 24 Nov 2026 (seven days before) |
| Price | 20.00 USDC a month |
| Months paid | 18 (360.00 USDC) |
| Last asked | 9 Nov 2026, 09:12, by Kwame Mensah |

A note: "If hosting is not paid by 1 Dec, the FDE pauses. Nothing on chain changes, and paying resumes it." Action
**Pay for hosting** (a person whom a budget admits, never an agent; `org fde pay 1 --from capxul`).

**Guests** (`org fde guest list`): people outside the company whom management named, who may ask it about their own
dealings only.

| Guest | Note | Named by | Since | Status |
|---|---|---|---|---|
| Sam Hollis · sam@hollisreed.co.uk | Our accountant (Hollis & Reed) | Kwame Mensah | 14 Apr 2026 | Active |
| Jo Bates · jo.bates@aldermoorhousing.org | Client: Aldermoor Housing Trust | Leo Brennan | 2 Sep 2026 | Active |
| Alice Penrose · alice@penroselegal.co.uk | Lawyer, seed round | Maya Okafor | 1 Jul 2026 | Removed 30 Aug 2026 |

Actions: Name a guest, Remove (People hat or a Director).

**Command strip.** `capxul org fde show --org harbourline`; `capxul org fde pay 1 --org harbourline --from capxul`;
`capxul org fde guest list`; `capxul org fde guest add sam@hollisreed.co.uk --note "Our accountant"`; `capxul org fde
guest remove …`.

### 6.5 Talking to the FDE (conversations)

**Purpose.** Ask it anything, from any screen; see what it did and what it prepared for you.

**What the book keeps.** Capxul records each ask (who asked, when, and until when the FDE may act for them), never the
message (`org-fde-asks`, `organizations/data.ts:803`; `org fde ask`'s `changes`). The conversation itself is on the
FDE's host, and only the asker reads their own turns ("the reply may hold what only they may see", `org fde turn
get`). So **Your conversations** lists only your own, and nobody sees another person's.

**Layout.** A chat panel (side panel on any screen; full page on the FDE tab).

- A header: "Harbourline's FDE · acting as you (Kwame Mensah: People, Books, Invoicing, Capxul allowance)".
- Messages: yours on the right; the FDE's on the left. A turn shows **Working…** while it runs; at the end, the reply.
- Inside a reply, two kinds of block:
  - **What I looked at**: the commands it ran as you, collapsed, each one a line: `capxul org department show
    engineering --org harbourline` → "Engineering: 42,695.45 left".
  - **Ready for you to approve**: a hand-over card (2.5), with **Review and approve** and **Not now**. The FDE never
    signs.
- A refused step shows plainly: "I can't do that as you: only Directors approve proposals. I've drafted it for Maya."
- Footer: the input, and "The FDE can make mistakes. It can only do what you can do."

**Example conversations for the mock-up** (the replies are scripted):

1. **Maya** (on Departments): "Why is Engineering already at 76% of its budget?" The FDE reads the department and its
   payments, and answers: "Engineering has spent 128,904.55 and committed 8,400.00 of its 180,000 USDC this year.
   Most of the spend is contractors: Marta Kowalczyk (48,000 over ten months) and Studio Varga. Kestrel's hosting is
   2,051 a month. Sofia Lindqvist's agreement is the 8,400 committed; what she collects never counts as spent. At this
   pace Engineering ends the year with about 25,000 left. To give it 200,000 next year you proposed raising
   Harbourline (sp_0193); Tom or Ruth still need to approve that, and then you raise Engineering yourself."
2. **Kwame** (on Seats): "We need five more seats for the January hires." It drafts `org seats buy 5 --from capxul`
   and hands it over: "50.00 USDC from the Capxul allowance, which has 100.00 left this month. Approve it here." The
   card shows the approval sheet for Kwame's own Safe.
3. **Tom** (on Payments): "Hannah said her October pay never arrived." It reads the payroll run and the escrow, and
   answers: "Her pay waited for her because she had no account yet. She claimed it on 4 November at 09:12: 2,186.42
   USDC is in her Safe. Nothing more to do."
4. **Nadia** (on Bank): "Pay Brightfield's rent today." It finds PINV-2026-00142, gets a quote and hands over the bank
   payout: "£5,040.00 to NatWest ending 2291, 6,390.40 USDC from Operations, Bridge fee 4.10. The quote holds for 10
   minutes."
5. **Sam Hollis, guest** (from his own Capxul): "Can I have Harbourline's VAT summary for Q2?" It answers: "I can only
   show you your own dealings with Harbourline: your two invoices and their payments. Ask Kwame to share the VAT
   summary." (`org fde ask` acceptance: a guest's FDE reads nothing of the Organization's.)
6. **Priya** (on Money waiting): "Take back the money for Jules, she wants paying by bank." It drafts the take-back
   (`payment cancel`) for Priya, who wears the Design hat, and a bank payout to Jules's account once Priya saves it.

**States.** A turn is working, ended or failed (the host's reason). At the deadline the CLI stops waiting and the
FDE carries on: the panel keeps showing "Working…" and the answer arrives later. A paused FDE: "The FDE is paused
because its hosting is unpaid. Pay 20.00 USDC to resume it."

**Command strip.** `capxul org fde ask "Why is Engineering already at 76% of its budget?" --org harbourline` ·
`client.org(orgId).fde.ask({ message })`; a turn later: `capxul org fde turn get turn_01JC…`.

### 6.6 Activity

**Purpose.** Everything that moved money for whoever you act as, newest first: Capxul payments and outside money
(`activity list`; `PaymentItem` and `MovementItem`, `activity/feed.ts:67-96`).

**Layout.** Page head "Activity", filters: Kind (Payments, Outside money), Direction (In, Out, Between your Safes),
Status, From, To. A **summary bar** for the filter's window (`activity summary`): per asset In, Out, Net, Pending in,
Count. Then the feed, grouped by day.

**Row fields.**

| Field | Example |
|---|---|
| Time | 6 Nov 2026, 11:58 |
| Kind | Outside money (received via Bridge) |
| Direction | In |
| Amount | +15,716.61 USDC |
| Counterparty | Northstar Retail Ltd (named from the deposit), else the address "0x1b2E…99f0" |
| Status | (payments only) Settled |
| Account and memo | 4000 · Design services · "Northstar website, phase 2" (`activity annotate`) |
| Transaction | 0x0b77…3e12 |

A row's page (`activity get`) shows the evidence (`PaymentEvidence`, `activity/feed.ts:124-135`: chain, contract,
settled through, token, transaction, block, log indexes) and the annotation, with **Annotate** (choose the account;
"Not sure" puts it in 6999 or 4999 for Books to review).

A banner when the chain reader is behind (`readWarning` indexer-unavailable): "Some outside money may be missing while
Capxul catches up with the chain."

**Live updates.** The page follows changes (`activity events --wait`), new rows sliding in at the top.

**Command strip.** `capxul activity list --org harbourline --limit 25`; `capxul activity summary --org harbourline
--from 1793491200000`; `capxul activity get --kind movement --id 8453:0x0b77…3e12:211:in`; `capxul activity annotate
--kind payment --id payment_01JC… --account 6100 --memo "…"`; `capxul activity events --org harbourline --wait`. SDK
`client.activity.list`, `.summary`, `.get`, `.annotate`, `.changes`.

### 6.7 Notices

**Purpose.** What Capxul told you, and what it will. Notices are emails (`notices`, `notices/data.ts`); the bell shows
the same notices in the app, newest first, unread in bold.

**Layout.** A drop-down from the bell (eight latest) and a full page **Notices** with filters by kind (Money, Board,
HR, People, Banking, FDE) and a per-row "Open" to the record.

**Example notices for Maya, 9 November:**

| When | Notice | Opens |
|---|---|---|
| 9 Nov 09:31 | Board proposal sp_0193 (raise Harbourline to 2,000,000 USDC/year) waits for one more Director | the proposal |
| 8 Nov 16:12 | Board proposal sp_0194 waits for your approval: grant Books to Nadia Farouk | the proposal |
| 7 Nov 16:25 | Bank payout sent: £1,920.00 to Hollis & Reed Accountants | the payout |
| 6 Nov 12:00 | Grace Adeyemi asked for leave, 1 Dec to 28 Feb: waits for the Harbourline hat | the leave |
| 6 Nov 11:59 | Northstar Retail Ltd paid SINV-2026-00087 by bank: 15,716.61 USDC credited | the deposit |
| 4 Nov 09:12 | Hannah Cole claimed her October pay (2,186.42 USDC) | the payment |
| 1 Nov 12:01 | Harbourline bought 10 seats (100.00 USDC) | Seats |
| 24 Oct 09:02 | FDE hosting paid through 1 Dec 2026 | FDE |

Other templates the mock-up may show (from `notices/*.ts`): the money-waiting email and reminders, money uncollected
(to the budget's current holders), money taken back, scheduled payment sent or cancelled, payment short on its day,
payout delivered or returned, verification approved, invitation sent or opened, officer hat granted, Director seated,
threshold changed, department office changed, leave and expense decisions, payslip ready, FDE ready, due, paused,
guest named.

Recipients follow the departments ruling: a notice about a budget's money goes to whoever wears its hat when it is
sent, and to the person who acted only while they still wear it (`notices.recipients`, chosen
`directors-and-wearers`; `authority.md` contradiction 11).

**Command strip.** No command lists a person's notices (9.6). The mock-up shows "Notices are sent by email to
maya@harbourline.studio" and, for the devnet, `capxul dev mail notices --to maya@harbourline.studio`.

### 6.8 Home

**Purpose.** The first screen after signing in: today for Harbourline, from the person's own seat.

**Layout** (a web-app flow over the reads above, `responsibilities.summaries`):

1. "Good morning, Maya" and the date, "Monday 9 November 2026".
2. **Waiting for you** (the top of 5.1, at most five).
3. **Money**: the position strip (3.1) and this month's in and out.
4. **Departments**: each department's bar for the year (4.1), colour turning amber above 85% spent.
5. **Coming up**: scheduled payments (3.7), payroll on 30 Nov, FDE hosting due 24 Nov, vote vt_0005 closes 16 Nov.
6. **Latest activity**: five rows.
7. **Ask the FDE**: an input with three suggestions ("What's due this week?", "How much runway do we have?", "Who
   hasn't submitted timesheets?").

**Command strip.** No single command (9.6). Each card shows its own: `capxul balance --org harbourline`, `capxul org
department list`, `capxul payment list --scheduled`, `capxul activity list --limit 5`.

---

## 7. Every screen and action and its command

Spelled as `docs/design/command-surface.md` section 6 books them. "(none)" marks a screen the book serves with no
command of its own; 9.6 lists them.

| Screen or action | Command | SDK method |
|---|---|---|
| Money overview | `capxul balance --org harbourline` | `client.accounts.read` |
| Deposit address | `capxul address --org harbourline` | `client.account.profile.depositInstructions` |
| Treasury control | `capxul org director list --org harbourline` | `client.org(orgId).directors.get` |
| Payments list | `capxul payment list --org harbourline` | `client.payments.list` |
| Scheduled | `capxul payment list --org harbourline --scheduled` | `client.payments.list` |
| Payment | `capxul payment get <payment>` | `client.payments.get` |
| Follow a payment or approval | `capxul payment wait <payment|approval>` | `client.payments.subscribe` |
| Send money (department, allowance) | `capxul payment send <to> <amount> --org harbourline --from <budget>` | `client.payments.pay` |
| Send money (Board) | `capxul payment send <to> <amount> --org harbourline --as-directors --note "…"` | `client.payments.pay` |
| Pay from a department | `capxul org department pay <department> --to <who> --amount <n>` | `client.org(orgId).departments.pay` |
| Cancel or take back | `capxul payment cancel <payment>` | `client.payments.cancel` |
| Reschedule | `capxul payment reschedule <payment> --on <day>` | `client.payments.reschedule` |
| Retry | `capxul payment retry <payment>` | `client.payments.retry` |
| Claim money waiting for you | `capxul payment claim` | `client.payments.claim` |
| Verify a proof | `capxul document verify --document-hash <h> --content-hash <c>` | `client.paymentDocuments.verify` |
| Read a proof's document | `capxul document get --document-hash <h> --content-hash <c>` | `client.paymentDocuments.get` |
| Save a document as PDF | `capxul document render --document-hash <h> --content-hash <c>` | `client.paymentDocuments.render` |
| Bank payout | `capxul bank pay self|contact <amount> --org harbourline --from <budget>` | `client.approvals.prepare` |
| Bank details | `capxul bank details --org harbourline [--currency GBP]` | `client.banking.details.get` |
| What deposits become | `capxul bank settle GBP --to USDC` | `client.banking.details.settle` |
| Deposits | `capxul bank deposits --org harbourline [--unmatched]` | `client.banking.deposits.list` |
| Match a deposit | `capxul bank match <deposit> <request|none>` | `client.banking.deposits.match` |
| Saved bank accounts | `capxul bank accounts --org harbourline` | `client.account.bankAccounts.list` |
| Save / remove a bank account | `capxul bank accounts add --currency GBP`, `capxul bank accounts remove <id>` | `client.account.bankAccounts.add`, `.remove` |
| Verification | `capxul verify status --org harbourline`, `capxul verify start` | `client.verification.status`, `.start` |
| Barclays (other account) | `capxul org doc get bank-account "Barclays Business"` (booked `org head doc get`, 9.1) | `client.org(orgId).docs.get` |
| Requests to pay | `capxul inbox list`, `capxul inbox pay <request>`, `capxul inbox decline <request>` | `client.account.inbox.list`, `client.approvals.prepare` |
| Departments | `capxul org department list` | `client.org(orgId).departments.list` |
| Department | `capxul org department show <department>` | `client.org(orgId).departments.get` |
| New department | `capxul org department create <name> --budget <n>/year --holder <email>` | `client.org(orgId).departments.create` |
| Change a budget | `capxul org department budget set <department> --budget <n>/year` | `client.org(orgId).departments.setAmount` |
| Add / remove a holder | `capxul org department holder add|remove <department> <member>` | `client.org(orgId).departments.holders.add`, `.remove` |
| Close / reopen | `capxul org department close|reopen <department>` | `client.org(orgId).departments.close`, `.reopen` |
| Payout ceilings | `capxul org department ceiling set|freeze|unfreeze --token USDC` | `client.org(orgId).departments.setCeiling`, `.freezeCeiling`, `.unfreezeCeiling` |
| Allowances | `capxul org allowance list|get|create|assign|change|revoke|replace` | `client.org(orgId).allowances.*` |
| Approvals (waiting for you) | (none); per row: `payment wait`, `org proposal list --status waiting`, `org hr leave list`, `inbox list`, `bank deposits --unmatched` | |
| Your standing | `capxul org me --org harbourline` | `client.org(orgId).me` |
| Board | `capxul org board show` | `client.org(orgId).board.get` |
| Officer hats | `capxul org member grant|revoke <email> --permission manage-books|issue-invoices|manage-people` | `client.org(orgId).members.grant`, `.revoke` |
| Directors and threshold (before the handover) | `capxul org board director add|remove`, `capxul org board threshold <n>` | `client.org(orgId).board.directors.add`, `.setThreshold` |
| Proposals | `capxul org proposal list [--status waiting]` | `client.org(orgId).proposals.list` |
| Proposal | `capxul org proposal get|approve|reject|wait <sp_…>` | `client.org(orgId).proposals.*` |
| Cap table | `capxul org cap-table [--fully-diluted]` | `client.org(orgId).equity.capTable` |
| Issue shares | `capxul org equity issue --class Common --to <who> --shares <n>` | `client.org(orgId).equity.issue` |
| Rounds | `capxul org round create|preview|invite|allocate|show|close|cancel` | `client.org(orgId).rounds.*` |
| SAFEs | `capxul org safe create|invite|show|close` | `client.org(orgId).safes.*` |
| Options | `capxul org options grant|show|end` | `client.org(orgId).options.*` |
| Exit preview | `capxul org exit preview --proceeds <n>` | `client.org(orgId).exits.preview` |
| Votes | `capxul org vote create|list|show|wait|execute` | `client.org(orgId).votes.*` |
| Your shares, options, votes | `capxul shares`, `capxul shares exercise`, `capxul vote cast <vt_…> --for`, `capxul vote list`, `capxul invest show` | `client.me.shares…`, `client.me.votes.cast` |
| Seats | `capxul org seats show`, `capxul org seats buy <n> --from <budget>` | `client.org(orgId).seats.show`, `.buy` |
| Members | `capxul org member list|get` | `client.org(orgId).members.list`, `.get` |
| Invite | `capxul org member invite <email|@handle> [--agent] [--preview]` | `client.org(orgId).invitations.invite` |
| Invitations | `capxul org invite list|resend|cancel` | `client.org(orgId).invitations.*` |
| Agents | `capxul agent list|show|create|freeze|unfreeze|key rotate|sweep|remove` | `client.me.agents.*` |
| FDE | `capxul org fde show`, `capxul org fde pay <months> --from <budget>` | `client.org(orgId).fde.show`, `.pay` |
| Ask the FDE | `capxul org fde ask "<message>"`, `capxul org fde turn get <turn>` | `client.org(orgId).fde.ask`, `.turns.get` |
| FDE guests | `capxul org fde guest add|list|remove` | `client.org(orgId).fde.guests.*` |
| Activity | `capxul activity list|summary|get|annotate|events` | `client.activity.*` |
| Notices | (none); devnet: `capxul dev mail notices --to <email>` | |
| Home | (none) | |
| Act as the company / yourself | `capxul use org harbourline`, `capxul use personal` | |

---

## 8. Harbourline's native data on 9 November 2026

A proposal for the data step, consistent with sections 3 to 6. The sibling pages own the business records; this
section owns the money, governance and seat facts they lean on.

### 8.1 The Organization

- Harbourline Studio Ltd, handle `@harbourline`, London, GBP books, Europe/London, fiscal year from 1 April
  (`accounting.md`). Founded on Capxul 1 May 2025 (18 months and a week before "today", 9 November 2026).
- Treasury (company Safe) `0x4A1f6B2c93D0e7A5f18C4b2E9a7d3F60c11b9c2E` on Base (8453): 229,404.21 USDC.
- Bank details via Bridge: GBP, USD, EUR, all active, settling to USDC; Capxul's fee 0.50%.
- Barclays Business GBP, sort code 20-45-77, ending 4417 (in Books).
- Rate 1 USDC = £0.7893.

### 8.2 Cast and personas (aligned with `hr-payroll.md`)

| Person | Role | Seat | Hats | Persona use |
|---|---|---|---|---|
| Maya Okafor | Founder and Managing Director | own | Director; Harbourline department | default persona: sees everything a Director and the top holder sees |
| Tom Ashworth | Engineering Lead, co-founder | own | Director; Engineering | a team holder and Director |
| Ruth Calloway | Partner, Northbank Ventures | own | Director | an investor Director |
| Priya Raman | Design Director | own | Design | a team holder |
| Kwame Mensah | Operations and People Lead | own | People, Books, Invoicing; Capxul allowance | officer hats, no department (ROLE_CONFLICT) |
| Nadia Farouk | Office and Finance Manager | own | Operations | pays suppliers |
| Grace Adeyemi | Delivery Lead | own | Delivery; Travel allowance | the swap example |
| Leo Brennan | Growth Lead | own | Growth; Invoicing | |
| Ravi Shah | Delivery Manager | own | none (takes Delivery on 1 Dec) | |
| Hannah Cole | Junior Designer | none | none | an employee without a seat: HR self-service only, money waiting claimed |
| Sam Hollis | Hollis & Reed, accountant | guest | none | an FDE guest |

Seven more seated people wear no hats (Ellis Hart, Amira Haddad, Ben Okoro, Isla Morgan, Josh Pemberton, Chloe Martin,
Freya Lund), which makes 16 seats in use. Ruth Calloway is a Director, not an employee, so Harbourline's 25 people are
its 15 seated staff, Hannah Cole and nine more employees without seats (`hr-payroll.md` owns the full list).

### 8.3 Timeline of native events (for the feed and histories)

| Date | Event |
|---|---|
| 1 May 2025 | Organization set up; Treasury minted; FDE started; equity switched on (co-founders: Maya 6,000,000, Tom 2,500,000 vesting 4y/1y; pool 1,500,000); Harbourline department and five teams created. Until each lead joined, Maya wore that team's hat herself |
| 14 May 2025 | Business verification approved (GBP, USD, EUR); bank details opened |
| 2 Jun 2025 | Kwame joins; the People hat moves from Maya to Kwame by Board batch, so Maya can hold the Harbourline department |
| 1 Jul 2025 | @kwame-ops created; Subscriptions allowance assigned to it |
| 1 Sep 2025 | Tom seated as Director; threshold 1 → 2 |
| 6 to 31 Oct 2025 | Pre-seed SAFE: 450,000 USDC from four investors |
| 19 Jan 2026 | Growth's holder swapped: Maya out, Leo Brennan in |
| 2 Feb 2026 | Sofia Lindqvist's pay agreement from Engineering starts |
| 3 Mar 2026 | Nadia Farouk joins and takes the Operations hat from Maya |
| 31 Mar 2026 | Daniel Price leaves; his 40,000 options return to the pool |
| 14 Jul 2026 | 750 USDC from Growth to a mistyped email; taken back next day |
| 15 Jul to 20 Aug 2026 | Seed round, 1,800,000 USDC; SAFEs convert; equity handed to the shareholders' vote; Ruth elected Director (vt_0003) |
| 28 Oct 2026 | Fieldwork Catering payout returned by the bank; refund back in the Treasury |
| 31 Oct 2026 | October payroll: 23 payments, Hannah's into money waiting |
| 1 Nov 2026 | 10 seats bought (100 USDC) |
| 2 Nov 2026 | 2,400 USDC to jules.marchetti@proton.me waits in escrow |
| 4 Nov 2026 | Hannah claims her pay |
| 6 Nov 2026 | Vote vt_0005 opens (pool top-up) |
| 8 to 9 Nov 2026 | Proposals sp_0194 and sp_0193 opened; Brightfield payout quoted |

### 8.4 Identifiers

Illustrative formats: Payment `payment_` + ULID (`payments/data.ts`); approval `approval_` + ULID; proposal `sp_` +
number (`org proposal get`'s `sp_…`); department `dep_…` or its key (`engineering`); round `rd_…`; vote `vt_…`;
request `req_…`; agent `agent_…`; bank deposit and account ids at the data step's choice (`bdep_…`, `bacc_…`); FDE turn
`turn_…`. Chain payment ids and document hashes are 32-byte hex; transactions 32-byte hex; blocks around 53,100,000 in
November 2026 (Base, two-second blocks since mid-2023).

---

## 9. Points for the later steps

### 9.1 The word "head" in commands

`command-surface.md` books the document family and the Frappe-site commands as `org head …`, and `aaron.one-product`
forbids anyone to see "head". `accounting.md` 2.4 rule 2 drops the word (`org doc …`, the spelling in the "Before the
tree" column). This page follows it for the one place it needs the family (the Barclays card). The critique step should
record it for Aaron as a gap in the book: the booked spelling contradicts a ruling.

### 9.2 One company Safe, not two

`accounting.md` gives Harbourline a "Reserve Safe · USDC" beside the Treasury. The book gives an Organization exactly
one company Safe (`organizations.safe_address`, `organizations/data.ts:71`; `authority.md` lines 47-64: money leaves it
by Board batch or Budgets). Budgets are not Safes. The data step should fold the Reserve into the Treasury (229,404.21
USDC, as here), or make the second account the Treasury's EURC (a second Safe account per token, `book-accounts.role`,
"one per company Safe and asset").

### 9.3 Cast names differ between the research pages

`accounting.md` 5.9 names "Priya Natarajan (wearing the Head of Engineering hat)"; `hr-payroll.md` names Priya Raman,
Design Director, and Tom Ashworth wearing Engineering. This page follows `hr-payroll.md`. `hr-payroll.md` also says
"Seat (yes, one of ten)": since 1 November Harbourline has twenty (the seats bill in `accounting.md` 5.6). And it gives
Kwame People and Books; this page adds Invoicing, which `request issue --org` needs. The data step owns the final
cast.

### 9.4 Reserved and available

3.1 and 3.7 must agree on what "available" means. The book's `balance` returns `balance` and `available`; the data step
should define available as balance less dated budget reservations on the Treasury (22,051.00 USDC here: 207,353.21
available), and show quoted, unsigned payouts as "about to leave", not reserved.

### 9.5 A team under a department: `--parent`

`org department create`'s frozen flags (`--token`, `--budget`, `--holder`, `--note`) have no parent. The target book
adds one: `CreateDepartmentInput.parent` (`budgets/shapes.ts:24-36`) and the refusal "`--token` is given with
`--parent`" (`budgets/operations.ts:168`). The mock-up shows `--parent <department>` for a team. A team takes its
parent's token and period, so the form hides the token when a parent is chosen.

### 9.6 Screens with no command

The book serves four screens through no command of their own:

- **Home** and **Approvals** (the "needs you" list): `responsibilities.summaries` makes them web-app flows over other
  concepts' reads (`shared/decisions.ts:1710-1726`). The mock-up shows the commands of each row instead. A list of
  approvals waiting for a person (`approval list`) is a gap if Aaron wants everything to be a command
  (`aaron.sdk-reaches-everything`).
- **Notices**: email only; `dev mail notices` exists on the devnet alone.
- **Bank payouts list**: payouts are read through `payment list`; there is no `bank payouts` list. The "Resend the
  money-waiting email" action has no command either.

Each is a question for the critique step, not something the mock-up invents a command for. Where the mock-up needs a
line, it shows the nearest booked command and labels the gap "no command yet".

### 9.7 What the mock-up must never contradict here

- Nobody signs for anyone: every write ends at the asker's own approval or a Board proposal (2.5).
- A department's money is acted on by whoever wears its hat now: every "who may" line names the hat, not the person
  who started it (3.7, 3.8, 4.3).
- Money waiting has no expiry; the sender (for a budget, its current holders, or the Board) can take it back until
  it is claimed; taking it back does not restore the budget's room (3.8).
- The FDE acts only as its asker and hands over what needs a signature; it holds no hats of its own while hosted
  (6.4, 6.5).
- Ten seats to start, one agent per seat, plus the company's own agent; a seat costs 10 USDC once and the FDE 20 USDC a
  month (6.1, 6.4).
- Fiat comes in through Bridge as USDC in the Treasury, and goes out through Bridge from USDC; the ordinary bank
  account is recorded and reconciled in Books (3.10 to 3.12).
- Every on-chain payment shows its proof: what the document hash commits to (3.5, 3.6).
- It is fictional sample data. The shell says so once.

# The general escrow

Aaron's ruling `aaron.escrow-general` (8 November 2026): "You deploy the escrow contract counterfactually. The owner
of that escrow contract is the address of the undeployed owner. They can claim that money whenever they want. As an
escape hatch, the sender can always claim the money back until the claimer has claimed it. This is a generalizable
escrow, because we're also going to use it for other things, but it needs to have those properties. We don't need to
change the budgets. We need to change the escrow."

Three other rulings shape it:

- `aaron.departments`: a budget belongs to a department, and people are swapped in and out of the department by its
  hat. So the sender of a budget's payment is the department: whoever wears the budget's hat when the money is taken
  back.
- `aaron.money-waiting`: the recipient gets a money-waiting email.
- `aaron.budget-pay-unclaimed`: a budget spend and a dated payment may go to someone with no account.

Aaron also accepted open question 1: when a budget payment is taken back, the budget's room for that period is not
restored.

This page sets out:

- the contract, its terms and its functions;
- what changes from v4 and what stays;
- its properties, as invariants the evals check;
- each money path through it;
- where it is built and deployed;
- what other concepts must change to match.

The records are:

- `contract_escrow` and `contract_escrow_factory` in `books/target/shared/external.ts`;
- decisions `payments.general-escrow`, `payments.claim-escrow-fit`, `payments.claim-escrow-routes`,
  `payments.escrow-on-funding`, `payments.department-authority` and `payments.escrow-contract-build` in
  `books/target/payments/decisions.ts`;
- `budgets.claim-escrows` in `books/target/budgets/decisions.ts`;
- `accounts.collect-any-time` in `books/target/accounts/decisions.ts`, the owner's later collection, spelled
  `payment claim` by `aaron.payment-claim`, and `payments.claim-command` in `books/target/payments/decisions.ts`,
  which books `payment claim` over accounts' rpc `accounts.setup.collect`;
- the six `payments.escrow-*` invariants in `books/target/payments/data.ts`.

The sources, all read only, are in `/home/user/factory`:

- `packages/contracts/v4/src/money/Escrow.sol`, `EscrowFactory.sol` and `Budgets.sol`;
- `packages/contracts/v4/src/companies-house/CompaniesHouseClaimer.sol`;
- `packages/contracts/v4/src/equity/Exits.sol`;
- `docs/planning/protocol-v4/spec/escrow.md` and `spec/exits.md`;
- the old system's invoice escrows, `packages/backend/src/requests/rules/escrows.ts` and
  `packages/protocol/src/evm/escrows-v4.ts`.

The old backend never used a claim escrow. Only v4's Exits did, for exit payouts a token refused.

## The contract

One contract per escrow, deployed by `EscrowFactory` at the CREATE2 address of its terms and a salt. Its terms are
immutable and public. It holds one payment of `amount` of `token` for its owner.

### Terms

| Term | What it is |
|---|---|
| `owner` | Who collects: the recipient's account, which may not exist yet. For a mailbox with no account, the personal Safe `CompaniesHouseClaimer.safeAddressFor` derives from Companies House, the tier's namespace and the mailbox. The only address `collect` or `payout` pays. |
| `sender` | Where the money came from. The only address `refund` pays, whoever calls it. |
| `authority`, `authorityKey` | Zero, or a contract with the view `authorised(uint256 key, address who) returns (bool)`. A caller it admits for the key may refund for the sender. v4 Budgets has exactly this view, so a department's escrow names Budgets and the budget id. |
| `bootstrapOwner` | Zero, or an address the owner must no longer list among its owners before it can collect. For an email's Safe it is Companies House. |
| `token`, `amount`, `jobNonce`, `kind`, `documentHash` | The one payment to the owner, through Payments, with the escrow as its executor. |
| `condition` | `0` amount-reached: the owner's claim stands in the terms, and anyone pays it out once the escrow holds the amount (an invoice). `1` owner-collects: the owner collects when it chooses. |
| `ownerTakesSurplus` | A collection's surplus (tokens beyond `amount`) goes to the owner, not back to the sender. |

The factory's init code binds every term and the factory's Payments. So an address names exactly one set of terms,
and a second `deploy` there can only be the same escrow.

### Functions

| Function | Who | What it does |
|---|---|---|
| `EscrowFactory.predictAddress(terms, salt)` | anyone, a view | The escrow's address before it exists: where the money is sent. |
| `EscrowFactory.predictPaymentId(terms, salt)` | anyone, a view | The payment id its one payment to the owner will carry, known before anyone signs. |
| `EscrowFactory.deploy(terms, salt)` | anyone | Deploys the escrow at its address, or returns the one there. It moves no money, and may come before or after the funding. |
| `collect()` | the owner, owner-collects only | Once the owner can act, the escrow is open and it holds `amount`: pays exactly `amount` to the owner through Payments, and the surplus to the sender (to the owner with `ownerTakesSurplus`). State `Paid`. |
| `payout()` | anyone, amount-reached only | Once it holds `amount`: the same payment to the owner, the surplus to the sender. State `Paid`. |
| `refund()` | the sender, or a caller the authority admits for its key at the call | While open, the whole balance goes to the sender and the state becomes `Refunded`. An owner-collects escrow can be refunded until it is collected, even after the owner can act. An amount-reached one only while it is short of the amount. Once closed, it returns any later deposit to the sender and changes no state. |
| `canRefund(who)` | anyone, a view | Whether `who` may refund now, read the way `refund` reads it. |
| `state()` | anyone, a view | `Open`, `Paid` or `Refunded`. |

"The owner can act" means:

- the owner is the caller;
- where `bootstrapOwner` is set, the owner has code and answers `isOwner(bootstrapOwner)` with exactly `false`.

Any other answer (no code, a revert, a short or long answer, a word other than 0) reads as "cannot act yet". This is
v4's D11, kept and made a term. The contract also keeps `conditionMet()`, its view of this; the book does not record
it, because nothing in Capxul calls it.

The authority's answer is read the same way, failing closed. A revert, a short or long answer, or any word other than
1 refuses the caller. The sender can always refund itself, so the Board stays the backstop for a department's escrow.

### Events

| Event | When |
|---|---|
| `EscrowDeployed(escrow, owner, sender, paymentId, salt)` | The factory deployed it. This makes it, and the money already in it, known to indexing. |
| `EscrowCreated(owner, sender, paymentId, token, amount, kind, documentHash, condition, authority, authorityKey)` | Its terms, from its constructor. |
| `EscrowPaid(owner, sender, paymentId, amount)` | Collected or paid out, beside the PaymentSent with the same id. |
| `EscrowRefunded(sender, by, paymentId, amount, state)` | Taken back by `by` (state `Refunded`), or a later deposit returned (state unchanged). |

### What changes from v4, and what stays

Changes:

1. **Roles named for what they do.** v4's `ownerSafe` (the payer, where a refund goes) is `sender`, and `payeeSafe`
   is `owner`, as the ruling uses the word.
2. **The authority term.** Who may refund was one address. Now it is the sender or whoever a view given as a term
   admits. This is what lets a department's escrow follow its hat without changing Budgets.
3. **A refund pays the sender, whoever calls.** In v4 only the owner Safe could call, and it paid itself.
4. **The bootstrap owner is a term.** v4's factory bound Companies House into every claim escrow, and its check needs
   the owner to answer `isOwner`. So an owner without code (a plain account), or a contract with no `isOwner`, could
   never collect. A Safe that Companies House never owned could, since it answers `false`. The factory keeps v4's
   constructor (Payments and the chain's Companies House) and its `bootstrapOwner()` view. A terms builder reads the
   view to fill the term, and the escrow checks only its own term.
5. **`ownerTakesSurplus` replaces the exit-claim lookup.** v4's escrow asked its owner `isExitClaimEscrow` and checked
   kind 8, an Exits-only path inside a general contract. Exits now sets the term, and reads Companies House for its
   `bootstrapOwner` term from the factory it already holds, so its initializer and the Installer do not change.
6. **`canRefund` and `by` on EscrowRefunded.** Capxul can check a caller before building anything, and every take-back
   names who did it, as the departments ruling needs.

Stays:

- CREATE2 over the terms and Payments, so the address is known first (S3);
- an idempotent `deploy` that anyone may send;
- predicted payment ids;
- exactly one payment of `amount` through Payments, with the escrow as executor for owner-collects, so its
  PaymentSent settles a Payment;
- D11's fail-closed ownership check;
- D12 (refund until collected, even after the owner can act);
- no expiry;
- S1, S2 and S7 (no invoice refund once the amount is held);
- later deposits returned to the sender;
- the reentrancy guard and exact token transfers;
- the factory's constructor arguments, so the deploy manifest does not change.

Not changed: Budgets, Payments, CompaniesHouseClaimer, Agreements, Roles and every other contract. The only other
contract line that changes is Exits' terms builder, because it constructs the escrow's terms.

## Its properties, as invariants the evals check

Each property is checked twice:

- **On the contract**, by the Foundry trees and invariant handler in `packages/contracts`
  (`payments.escrow-contract-build`).
- **On the devnet**, by the book's evals. The `inv:` evals are derived from the invariant records in
  `books/target/payments/data.ts`. The `acc:`, `ref:`, `trn:` and `wfl:` evals come from the records each path
  touches.

| # | Property | Contract check | Book evals |
|---|---|---|---|
| G1 | **Counterfactual.** `predictAddress` is the address `deploy` returns. A second deploy returns the same escrow. Changing any term or the salt changes the address. | factory trees `deploy`, `predictAddress`, `predictPaymentId`; S3 | `inv:payments.escrow-counterfactual` |
| G2 | **Fundable first.** Money sent to the address before `deploy` is the escrow's once it is deployed. Deploying moves nothing. A failed deploy strands nothing. | tree `deploy` (funded before) | `inv:payments.escrow-counterfactual`; `wfl:payments.lifecycle.payment/wake/escrowed` and `/wake/deployed` |
| G3 | **Two ways out.** The token leaves only to the owner (`collect` or `payout`, plus a surplus with `ownerTakesSurplus`) or to the sender (`refund`, or a surplus). | invariant handler: every transfer's recipient is the owner or the sender (S4) | `inv:payments.escrow-two-ways-out` |
| G4 | **The owner collects at any time.** While open and holding `amount`, the owner's `collect` succeeds once it can act, with no deadline. Any other caller is refused (`NotOwner`). | tree `collect`; no expiry leaf | `inv:payments.escrow-owner-any-time`; `acc:payment.claim/1` |
| G5 | **Can act, failing closed.** With a bootstrap owner set, `collect` reverts until the owner has code and answers `isOwner(bootstrapOwner)` with exactly `false`. | `collect` leaves for D11: no code, revert, 64 bytes, a word of 2 | `inv:payments.escrow-owner-any-time` |
| G6 | **The sender takes it back until it is collected.** While an owner-collects escrow is open, `refund` by the sender, or by a caller the authority admits at that block, pays the sender the whole balance. That includes after the owner can act. Any other caller, or an authority that reverts or answers malformed, is refused. | tree `refund` (D12 leaf; authority true, false, revert, 64 bytes, a word of 2) | `inv:payments.escrow-sender-until-collected`; `ref:payment.cancel/ROLE_PERMISSION_DENIED`; `trn:payment.cancel` |
| G7 | **One end.** At most one of `collect`, `payout` and the first state-changing `refund` succeeds. After `Paid` or `Refunded`, `collect` and `payout` revert, and `refund` moves only later deposits. | S1 | `inv:payments.escrow-two-ways-out`; `acc:payment.claim/3`; `acc:payment.cancel/1`; `ref:payment.cancel/WRONG_STATE` |
| G8 | **Empty after every call.** Each of `collect`, `payout` and `refund` leaves the escrow none of its token. | S2 | |
| G9 | **A department's escrow follows its hat.** With authority Budgets and a budget id, a caller other than the sender may refund exactly when `Budgets.authorised(budgetId, caller)` holds at that block. A holder taken out of the hat is refused at once and the next wearer admitted, with no Capxul write in between. The money goes to the company Safe. | fork test against v4 Budgets and Hats | `inv:payments.escrow-department-now`; `acc:payment.retry/3` (the same rule for a retry) |
| G10 | **Budgets is unchanged.** A budget's claim escrow is funded by `Budgets.spend`, or by `Budgets.schedule` paid by `execute`, to its address. Its refund leaves every budget's spent and `leftOf` as they were. The money's return shows only in the company Safe's balance. | fork test: `leftOf` before and after a refund | `inv:payments.escrow-budgets-unchanged` |
| G11 | **The invoice keeps its claim.** An amount-reached escrow pays out to its owner, by anyone, once it holds the amount, and refuses `refund` from then on. | S7; tree `payout` | the requests evals of checkout (`request.issue`, `request.cancel`) |

`trn:payment.escrow` checks that a claim escrow's Payment reaches `escrowed` only on its funding's PaymentSent.

## Each money path through it

Every payment to a mailbox with no live Safe is a claim escrow (route `claim_escrow`), now or dated. Its terms always
have:

- owner: the mailbox's derived Safe;
- condition: owner-collects;
- bootstrap owner: Companies House;
- salt and job nonce: the Payment's;
- `ownerTakesSurplus`: false.

The Payment keeps:

- `escrow_address`;
- `payee_mailbox`, for the email;
- `funding_payment_id`, the id of the PaymentSent that pays the address;
- `chain_payment_id`, the collection's id, which settles it.

| Path | Sender, authority | Funding (who signs) | Deploy | Taken back by |
|---|---|---|---|---|
| Personal payment, now (`payment send` to a mailbox) | the payer's Safe, none | one operation from the payer's Safe: `approve`, `Payments.send` to the address, `EscrowFactory.deploy` | in the funding operation | the payer: `payment cancel`, an approval of `refund()` from their Safe |
| Personal payment, dated | the payer's Safe, none | the same operation, signed now and sent on its day | in it | before the day: the void of the held operation; after: as above |
| Board payment, now (`--as-directors`) | the company Safe, none | a Board batch: `approve`, `Payments.send` (executor the company Safe), `EscrowFactory.deploy` | in the batch | the Board: a proposal of `refund()` |
| Board payment, dated | the company Safe; Budgets and the top budget it is scheduled on: the one with the most left that no member holds (the install's own, whose hat is the Board's top hat, or one the Board keeps without a holder) | a Board proposal of `Budgets.schedule` to the address; on the day the executor key sends `Budgets.execute` | the Payment's process, with the escrow relayer key, as soon as the execute's receipt is in | before the day: a Board proposal of `Budgets.cancel`; after: a Board proposal of `refund()` |
| A department's, team's or allowance's spend (`payment send --org`, `org department pay`) | the company Safe; Budgets and the funding budget | one approval from the wearer's own Safe: `Budgets.spend(id, address, …)`, `EscrowFactory.deploy` | in the approval | whoever `Budgets.authorised` admits on that budget now (an approval of `refund()` from their own Safe), or the Board |
| A budget's dated payment | the company Safe; Budgets and the budget | an approval of `Budgets.schedule` to the address; on the day `Budgets.execute` | the Payment's process, with the escrow relayer key, as soon as the execute's receipt is in | before the day: `Budgets.cancel` by any wearer now, or the Board; after: `refund()` as above |
| Payroll's new hire (`payroll.runs.pay`, through the door) | the company Safe; Budgets and the run's budget | the run's one approval: `Budgets.spend` per new-hire item to its address, plus the deploys | in the approval | as a department's |
| A request's invoice escrow (checkout, requests) | the payer's email Safe, none; condition amount-reached, owner the issuer's Safe | the outside payer, from any wallet or by card or bank | the request's process, with the escrow relayer key, then `payout()` | the payer's email Safe, only while short of the amount |
| v4 Exits' unclaimed exit payout (equity) | Exits, none; `ownerTakesSurplus` true, owner the shareholder | the Board's settlement batch | Exits' `settle` | Exits (its `claim` and `redirectClaim`) |

What happens next, on every Capxul payment route:

1. **Escrowed.** The funding's PaymentSent (`funding_payment_id`) is indexed. The Payment's process drives `escrow`,
   and admits the mailbox to the beta in the same transaction (`accounts.admit`). Notices sends the money-waiting
   email and its reminders, from the `escrow` transition. Every funder deploys the escrow in the funding's own batch,
   except for a budget's dated payment, whose funding the executor key sends: the process deploys that one with the
   relayer key as soon as the execute's receipt is in, with no wait (`payments.escrow-on-funding`). Until EscrowCreated
   is indexed, setup and `payment claim` cannot find the escrow, so the deploy never waits. The funding's
   PaymentSent settles nothing and births no Payment (`payments.settlement.observe`), and books posts nothing while
   the money waits.
2. **Collected at sign-up.** The person sets up their Safe. Companies House's claim role makes their signer its only
   owner. Then `accounts.setup.personal-safe` reads indexing's open owner-collects escrows whose owner is the Safe and
   that hold their amount. It opens one approval from the Safe calling `collect()` on each. The collection's
   PaymentSent (sender the escrow, recipient the Safe) settles the Payment for both sides, and books records it then.
3. **Collected later.** An escrow that opens after setup (a dated payment paid after the person signed up), or one
   the person declined or left at setup, is claimed whenever they choose with `payment claim`
   (`aaron.payment-claim`; `accounts.collect-any-time`, `payments.claim-command`). It reads the same escrows and
   opens the same approval, through accounts' rpc `accounts.setup.collect`.
4. **Taken back.** `payment cancel` prepares the refund by route (`payments.changes.cancel`). It reads `canRefund`.
   While the escrow has no code it reads the same rule from the terms: the caller is the sender, or `Budgets.authorised`
   admits it for a budget's. So a caller who may not is ROLE_PERMISSION_DENIED before anything is built. If the
   funding reached the address before the deploy, the batch deploys first. EscrowRefunded with state `Refunded` drives
   `cancel` (outcome refunded). Notices tells the recipient. A budget's money is back in the company Safe, and its
   room for the period stays spent.
5. **A race.** A refund racing a collection is decided by the chain: exactly one of the two lands (G7).

## Where it is built, and when

`payments.escrow-contract-build` (a decision for the goal prompt):

- **Where.** `packages/contracts` in this repository holds Protocol v4's Solidity sources, taken at a pinned commit of
  the v4 package as the chain layer the book records. It carries only this change: `Escrow`, `EscrowFactory`,
  `IEscrow` and `IEscrowFactory`, with their spec, trees and Foundry tests, and Exits' terms builder. v4 is not the
  old system that the never-port rule means: it is the protocol the target is written against (P9). The old
  TypeScript product stays a reference only.
- **When.** It lands with the spine at B3, before the pilots. A claim escrow is a route of `payment send`, a pilot,
  and payments' prepare and the SDK's address prediction need the escrow's ABI and creation code.
- **Its exit check.** The trees and the invariant suite above (G1 to G11) pass, and `forge build` gives the creation
  code the SDK's address prediction uses.
- **Deployments.**
  - The devnet's `up` deploys the package, and the regenerated address book records the factory's devnet address on
    `contract_escrow_factory`.
  - B5's new staging deploys it fresh on Base Sepolia (`environments.staging`). Aaron accepted open question 16, a
    new staging on a fresh deployment, "with the changed escrow".

## What other concepts must change to match

These records were outside the escrow pass's folders. The commands pass's build applied each one (8 November
2026), except the rulings file, which is its owner's: `payments.claim-escrow-routes`, `budgets.claim-escrows` and
`payments.claim-escrow-fit` still sit in SUPERSEDED there, though they now carry out `aaron.escrow-general`.

- **Indexing.**
  - The `escrows` table and its indexes take the new roles: `owner` (who collects) and `sender` (where a refund goes),
    for v4's `payee_safe` and `owner_safe`.
  - It adds `authority` and `authority_key`, and renames the condition literals to `amount_reached` and
    `owner_collects`.
  - `EscrowCreated`, `EscrowPaid` and `EscrowRefunded` have new arguments (`by` on the refund).
  - Nothing changes for balances: `transfers` holds every Transfer of an admitted asset whoever receives it, so
    `safe-balances` counts money sent to an escrow's address before EscrowDeployed made it known.
- **Notices.**
  - The money-waiting email follows `escrow`, which now fires on the funding's PaymentSent, not EscrowCreated.
  - A mailbox whose person already has an account is told to run `capxul payment claim` (it still names `capxul
    account collect` until notices applies `aaron.payment-claim`).
  - The payer's notices about a department's escrow go to the budget's current wearers.
- **Requests.** The invoice escrow's terms use the new roles: sender the payer's email Safe, owner the issuer's or the
  company Safe, condition amount-reached, no authority, no bootstrap owner. `payout()` is unchanged.
- **Books.** The "open escrows" report reads indexing's escrows by `sender`.
- **Devnet.**
  - A world `person-ready-money-waiting`: a set-up person with an escrow still uncollected.
  - A world for a department's escrow whose holder is swapped before the refund.
  - The text of `person-with-money-waiting` ("her Safe owns") reads "her Safe sent".
- **Payroll.** Its text says the budget's current wearers or the Board take a new hire's escrow back.
- **Equity.** Exits builds the new terms and sets `ownerTakesSurplus`.
- **The command grammar page.** `docs/design/new-commands.md` lists the booked `payment claim` (payments,
  `client.payments.claim`, `--json` and `--timeout-seconds`, no `--request-key`), spelled as Aaron ruled on 8
  November, night (`aaron.payment-claim`); the world pass renamed `account collect` to it, book first.
- **Shared and the goal prompt.** `packages/contracts` joins `system.layout` and B3. `component_chain` and the devnet
  name it as the source of the v4 deployment. The rulings file moves the rewritten records from SUPERSEDED to
  CARRIES_OUT.

## Left open

- **The trust root.** Companies House's claim role chooses which signer an email's Safe goes to. That is accepted for
  the beta (`aaron.claim-trust`).
- **A frozen agent.** An agent that sent a payment cannot take its escrow back while it is frozen. The recipient can
  still collect.
- **Which commands.** Answered: Aaron spelled the recipient's command `payment claim` (`aaron.payment-claim`), and
  the sender's take-back stays `payment cancel`. `accounts.collect-any-time` now chooses it, and payments books it
  (`payments.claim-command`): its noun is the money's (G2, G10), its flow `client.payments.claim` calls accounts'
  rpc, and `claim` reads as taking up what is held for you (G3). It still takes no payment id, since a waiting
  Payment has no payee tenant (G5), and keeps every claim, refusal and world of `account collect`.

# Authority: who may do what, as the v4 chain enforces it

Aaron's ruling `aaron.departments` (8 November 2026): "There's a concept of departments. Look at the v4 contract
properly. There seems to be a misunderstanding with who can do what. The whole purpose of the departments is that
budgets belong to departments, and you can swap people in and out of departments."

This page sets out the authority model the v4 contracts enforce, read from the contracts themselves:

- the company Safe and the Board;
- departments and teams, which are budgets with hats;
- the officer hats;
- Seats;
- agents and the FDE.

A table then gives who may take each money action and which check on the chain allows it. The last section lists
every place the target book contradicts the model, with the record id, the fix and the folder that owns it. The
shared decision `rules.department-authority` (in `blueprint/shared/decisions.ts`) records the rule in one place.
This page is the reasoning behind it.

The sources, all read only:

- `/home/user/factory/packages/contracts/v4/src`:
  - `money/Budgets.sol`: `authorised`, `_requireManager`, `createChildBudget`, `setHat`, `spend`, `schedule`,
    `cancel` and `execute`;
  - `money/Agreements.sol`, `money/Escrow.sol`, `money/Payments.sol` and `libraries/PayoutBatch.sol`;
  - `authority/InstallerMoney.sol`, `agents/AgentOwner.sol` and the Hats and Hats Signer Gate interfaces.
- The beta contract `packages/contracts/src/PayrollDepartments.sol`.
- The v4 spec, `docs/planning/protocol-v4/spec/{budgets,agreements,board,installer,escrow}.md`.

The audit covered every operation's `who` (215), every rpc's `who` (252), every refusal that names
ROLE_PERMISSION_DENIED (141), ROLE_CONFLICT (4), BELOW_THRESHOLD, RESERVED_MATTER or SEAT_LIMIT_REACHED, and about
a hundred decisions. Those decisions cover hats, officers, departments, budgets, approvals, payroll, projects, the
CRM, seats and the FDE. The operations beyond the 215 were not yet booked when this was written, so their packs'
authority lines were read instead: `organizations.commands`, `organizations.buy-seats`, `projects.permissions` and
`contacts.crm-permission`.

## The rule in one line

**Money moves by the chain's checks, and those checks ask which hat the calling Safe wears now, never who a person
is.** A department is a budget with a hat. Whoever wears that hat, or the hat of any budget above it, acts for the
department's money. The company Safe, and so the Board, acts for every budget in its tree. A person goes in or out of
a department when the hat is minted to their Safe or taken from it. Everything the department set running stays the
department's: agreements, dated payments, escrows and child budgets. The next person to wear the hat acts on it.

## The pieces on chain

### The company Safe and the Board

- **The Gate.** The company Safe's only module and guard is Hats Signer Gate v2. Its owners are the Directors'
  personal Safes. A Safe transaction (a "Board batch", which Capxul calls a Board proposal) runs only with the
  threshold of valid Director-hat wearers' approvals. Each Director approves by `approveHash` from their own Safe,
  then anyone executes. The Gate refuses owner, threshold, module and guard changes and every call into the Safe
  itself (`CannotCallSafe`).
- **Roles.** Zodiac Roles is a module on the Gate, never on the Safe. Its one member is Budgets, which holds the
  payout role: it may only `approve` Payments and call `Payments.send`, within a per-token allowance. That allowance
  is the payout ceiling.
- **Two ways out.** The company's money leaves the Safe in exactly two ways: a Board batch, or Budgets through the
  payout role.
- **The Board never spends from a budget.** `Budgets.authorised` admits the company Safe on every budget it owns
  (`b.safe == who`). But a spend started inside a Safe transaction is refused by the Gate (no module call may re-enter
  a running Safe transaction). So the Board pays by its own batch (`approve` and `Payments.send` from the Safe), not
  through a budget (`payments.board-rpc`). The Board *can* call `schedule`, `cancel`, `createChildBudget`,
  `setAmount`, `setHat`, `close`, `reopen` and every Agreements holder function on any budget of its tree, because
  none of them pays out inside the call.

### The two hat trees

Read from `InstallerMoney.sol` and `spec/board.md`:

```text
Shareholders' tree                               Board's tree
top hat: founder's Safe, later the Governor      top hat: the company Safe
└── Director hat (the Gate's signer hat)         ├── Books, Invoicing, People (officer hats)
                                                 ├── each department's office hat (a top budget, or a child of the company budget)
                                                 │     └── each team's office hat, under its department's
                                                 └── each allowance's hat
```

- **Who administers a hat.** A hat's admins are the wearers of every hat above it in its tree (Hats Protocol). So
  the company Safe administers every hat in the Board's tree, and a department's office holder administers every team
  hat under theirs.
- **Who seats Directors.** The Director hat sits in the other tree, so only the Shareholders' top-hat wearer seats or
  removes Directors and sets the threshold. That is the founder's Safe until the equity handover, then the Governor.
- **Eligibility and toggle.** The Installer makes the company Safe the eligibility and toggle of every officer hat.
  Ruling a wearer ineligible (`setHatWearerStatus(hat, safe, false, true)`) burns their token and leaves them
  eligible to be given it again.

### Departments and teams

- **What a department is.** A department is a budget in the company Safe's tree with its own office hat. The Board
  can make it a top budget (`createTopBudget`) or a child of the company's top budget (`createChildBudget`). The
  company's top budget is made at the install, under the Board's top hat. A team is a child budget whose office hat
  sits under its department's office hat. An allowance is a child budget whose hat sits under the Board's top hat:
  its wearers change only by Board batch, while its amount follows its parent.
- **`authorised(id, who)`.** It is true for the budget's Safe, and for a wearer, in good standing, of the hat of the
  budget or of any budget above it (up to eight levels). Agreements never reads Hats: it asks Budgets the same
  question.
- **Changing a budget is for the office above.** `setAmount`, `setHat`, `close` and `reopen` need the Safe for a top
  budget, and `authorised(parent)` for a child. A wearer never raises, re-hats or reopens their own budget through
  their own hat alone (spec: "A wearer never raises their own budget through their own hat alone").
- **Using a budget is for its own office.** `spend`, `schedule`, `cancel`, `createChildBudget` (under it) and
  Agreements' `offer`, `withdrawOffer`, `changeRate`, `cancelChange`, `pause`, `resume` and `end` all need
  `authorised(budget)`.
- **Two trees, two kinds of authority.** Money authority follows the *budget* tree, through ancestors' hats. Power
  over who wears a hat follows the *hat* tree, through admins. The book keeps the two aligned: a team's hat sits under
  its department's hat, and an allowance's hat under the Board's top hat. So a department head may spend from an
  allowance under their department, but cannot change who wears it.

### The officer hats

Books, Invoicing and People are hats in the Board's tree, minted to the founder at setup and granted or revoked only
by Board batch. **No contract reads them.** They authorise nothing on chain: Capxul's own guards read them, from
indexing's wearers or `isWearerOfHat` live, to decide who may change Capxul's records:

- **Books:** the chart, assets and annotations, and an Organization's bank details, alongside a Director.
- **Invoicing:** requests, services, bank matches and an Organization's keys.
- **People:** invitations and seats, the contact book and CRM, payroll's HR records, and projects.

An officer hat is not a department. It holds no money unless the Board also makes it some budget's hat, which no
record does.

### Seats

A Seat is Capxul's membership, off chain: one per Party per Organization, at most ten people plus one agent each and
the Organization's own agent (`aaron.seats`, `organizations.agent-cover`).

- **What a Seat gives.** It gives reads and the right to ask Capxul to prepare something. It gives no authority on
  chain. Every write guard first asks for a current Seat, then for the hat.
- **A hat without a Seat.** A Safe with a hat and no Seat (a hat minted at the Safe outside Capxul) can still act on
  chain. Capxul refuses to prepare it, and Capxul's reads must still show it as a wearer (`budgets.departments.list`
  does: "named by their Seat's email where they have one").
- **Where Seats end.** A person's Seat never ends (`organizations.members-are-seats`), so people leave a department,
  not the Organization.

### Agents and the FDE

- **An agent's Safe.** An agent's Safe is made by `AgentOwner.create(signer, owner)`. Its one signer is the agent's
  key, and its owner is a person's Safe or an Organization's Safe. Only the owner can freeze, unfreeze, swap the key,
  sweep or remove it. The agent's key can never change its own Safe.
- **An agent's hats.** An agent's Safe wears hats like any Safe. Budgets cannot tell it from a person's, so its
  authority is whatever its hats give. Because the owner can swap in a key of their own, a hat given to a person's
  agent is in effect held by that person too. To take an agent out of a department, take the hat from its Safe:
  freezing it does not.
- **A removed agent's hats.** A removed agent's Safe keeps its hats until someone takes them back. Nobody can sign
  for it, but each one still fills a place on its hat.
- **The FDE.** The FDE is the Organization's own agent: AgentOwner's owner is the company Safe, so every change to it
  is a Board proposal (`agents.org-owned`). Under `aaron.fde-hosted` Capxul runs it, as a durable agent with sandboxes,
  and Capxul's runtime holds its key. It is never a Director (`board.no-agent-directors`), and the Board can freeze,
  re-key or remove it at any time.
- **The hosted FDE acts as its asker** (`aaron.fde-anyone`; `organizations.fde-for-the-asker`,
  `rules.fde-acts-for-asker`). Any member, or a guest the People hat or a Director names (`org fde guest add`), may
  ask it. Each ask mints an act-for token, which the host hands the FDE's CLI for that turn alone, and every tenant
  guard resolves a call that carries it to the ask's asker: their Seat and hats for a member, their Party alone for a
  guest. A call with no live token is refused, so the hosted FDE never acts as itself, and the hats the Board grants
  its own Safe go unused while Capxul hosts it (`agents.fde-authority`, `agents.fde-people-hat`). Every signature it
  prepares is the asker's to make, from their own Safe (it hands the approval over), and a command that previews is
  the asker's own to answer, so its rpc refuses the FDE's call. On the head, the document family runs as the asker's
  own head User (`organizations.doc-authority`). Only a self-run own agent (`agent create --org`) acts with its own
  Safe's hats.

### Payees and escrows

- **Agreements.** `Agreements.accept` and `collect` answer only the payee's Safe. An Organization payee therefore
  accepts and collects by Board batch.
- **The current Escrow.** Today `Escrow.collect` answers only the payee Safe once it is claimed, and `refund` only
  the owner Safe.
- **The general escrow.** Aaron's ruling `aaron.escrow-general` makes a general escrow: the recipient's future account
  claims, the sender reclaims until then, and Budgets does not change. For a budget payment the sender is the
  department, so the general escrow must let *whoever `Budgets.authorised` admits on the funding budget at the time of
  the reclaim* take it back, with the money returning to the company Safe (see contradiction 1).

## Swapping people in and out of a department

| What | Who may, on chain | The check |
|---|---|---|
| Put someone into a department (a top department, or one under the company budget) | The Board | `Hats.mintHat` needs a hat admin: the Board's top hat, worn by the company Safe |
| Take someone out of such a department | The Board | `Hats.setHatWearerStatus(hat, safe, false, true)`, from the hat's eligibility (the company Safe) |
| Put someone into a team | The department's office holder (their own Safe), anyone above, or the Board | `mintHat` by an admin: a wearer of any hat above the team's |
| Take someone out of a team | The department's office holder by `transferHat` to a Safe that does not wear it yet, or the Board by `setHatWearerStatus` | Only the eligibility (the company Safe) can rule a wearer out. An admin can only move the token (contradiction 3) |
| Hand a whole department to another hat | The office above: the Board for a top budget, `authorised(parent)` for a child | `Budgets.setHat`. Not booked, and not needed while holders are swapped by mint and burn |
| Leave on their own | The wearer | `Hats.renounceHat`. Not booked |

What a swap does to what the department set running:

| Running thing | After the old holder leaves and a new one joins |
|---|---|
| An open offer or a running agreement | Unchanged. Pay keeps accruing and the payee keeps collecting. Withdrawing, changing the rate, pausing, resuming and ending move at once to the new wearer, and the old one is refused (`NotAuthorised`). |
| A pending dated payment | Unchanged. Anyone executes it on its day. Cancelling moves to the new wearer. |
| A spend or offer the old holder prepared and has not signed | The sponsorship simulation refuses it with ROLE_PERMISSION_DENIED (`integrations.sponsor-refusals`). If the hat is lost after sponsorship, the operation reverts. Nothing moves either way. |
| A team under the department | Its budget and hat stay. The new holder administers the team's hat and acts on its money. |
| A claim escrow the department funded | It must be the new holder's to take back (contradiction 1). |
| The payout ceiling, the budget's amount and its room | Unchanged: they belong to the budget, not to a person. |

Being *paid* by a department is a different membership. A Frappe HR Employee's `department` is the budget that pays
them (`payroll/data.ts`, `employees`). Being paid from a department gives no authority over it. Moving an employee
changes which budget pays them, and moving a hat changes who acts for the budget.

## Who may take each money action, and why the chain allows it

"Above" means the wearer of the hat of any budget above, in good standing. "Board" means a Board batch: a Director
proposes, and the threshold of Directors approves from their own Safes.

| Money action | Who may | The chain's check | How Capxul carries it |
|---|---|---|---|
| Pay from your own Safe | You (a person, or an agent from its own Safe) | You own the Safe; `Payments.send` pulls from `msg.sender` | An approval from your Safe |
| Pay from the company Safe now | The Board | Gate threshold of valid Director-hat signatures | `payments.commands.propose`, a Board proposal |
| Spend from a budget now | Its hat's wearers, anyone above | `Budgets.spend`: `authorised(id)`, room, open path, then Roles' payout ceiling | An approval from the spender's Safe (`payments.commands.prepare`, `payroll.runs.pay`, `banking.payouts.quote`, `requests.inbox.pay`) |
| Schedule a dated payment from a budget | Its hat's wearers, anyone above, the Board | `Budgets.schedule`: `authorised(id)`, reserves room | An approval, or a Board proposal for a Board payment |
| Cancel a budget's dated payment | Its hat's wearers *now*, anyone above, or the Board; whoever scheduled it only while they still wear the hat (`payment.cancel`'s who) | `Budgets.cancel`: `authorised(budget)` | An approval or a Board proposal (`payments.changes.cancel`) |
| Execute a dated payment on its day | Anyone | `Budgets.execute`: due, pending | Payments' own process |
| Create a team or allowance under a budget | The parent's wearers, anyone above, the Board | `createChildBudget`: `authorised(parent)`, room | An approval, or a Board proposal (`budgets.departments.create`) |
| Create a top budget or department | The Board | `createTopBudget`: `msg.sender` is the Safe | A Board proposal, with the ceiling grown (`Installer.buildSetCeiling`) |
| Change a budget's amount, close it, reopen it, change its hat | Top: the Board. Child: the parent's wearers, anyone above, the Board. Never its own wearers through its own hat | `_requireManager` | An approval or a Board proposal (`budgets.tree.*`) |
| Set, freeze or unfreeze a token's payout ceiling, or add a token | The Board | Roles' owner is the Safe | A Board proposal (`budgets.ceilings.*`) |
| Offer, withdraw, change, pause, resume or end an agreement | The budget's wearers *now*, anyone above. The Board may too, but Capxul does not prepare that (`payroll.holder-writes`) | `Agreements`: `Budgets.authorised(agreement's budget)` at the call. No self-offer | An approval (`payroll.holders.*`) |
| Accept or collect an agreement | The payee's Safe. For an Organization payee, the Board | `msg.sender == payee` | An approval, or a Board proposal (`payroll.payees.*`) |
| Settle a budget's agreements | Anyone | `Agreements.settle` moves no money | |
| Collect a claim escrow | The recipient's claimed Safe | `Escrow.collect`: `msg.sender == payeeSafe`, Companies House no longer an owner | The recipient's collection approval |
| Take back a personal claim escrow | The payer's Safe | `Escrow.refund`: `msg.sender == ownerSafe` | An approval |
| Take back a Board claim escrow | The Board | The owner is the company Safe | A Board proposal |
| Take back a budget's claim escrow | The budget's wearers *now*, anyone above, the Board. The money goes to the company Safe and the room is not restored | The general escrow's `refund`: its authority term is Budgets with the budget id, so `Budgets.authorised(budgetId, caller)` at the call (`payments.general-escrow`) | An approval, or a Board proposal |
| Grant or revoke an officer hat | The Board | The Safe is admin and eligibility | A Board proposal (`board.officers.*`) |
| Put someone in or out of a department's office | As in the swap table above | Hats admin and eligibility | `budgets.offices.*` |
| Seat or remove a Director, set the threshold | The Shareholders' top-hat wearer: the founder's Safe, then the Governor | Hats admin of the Director hat, and the Gate's owner hat | An approval from the founder's Safe (`board.directors.*`) |
| Remove a lapsed signer | Anyone | `HatsSignerGate.removeSigner` | `board.directors.refresh` |
| Create, freeze, re-key, sweep or remove a person's agent | Its owner, the person | AgentOwner `onlyAgentOwner` | An approval |
| The same for an Organization's agent (the FDE) | The Board | AgentOwner's owner is the company Safe | A Board proposal (`agents.org-owned`) |
| Buy seats | A People-hat wearer, from a budget whose hat (or one above) their Safe wears now | `Budgets.spend` by the spender, plus Capxul's People-hat guard | `org seats buy`, an approval (`organizations.buy-seats`, accepted) |
| Pay for the hosted FDE (`FDE_HOSTING_PRICE`, 20 USDC a month) | A person whom Budgets admits on the budget now; never an agent, so never the FDE, and never the Board (its payment is its own batch) | `Budgets.spend` by the payer | `org fde pay`, an approval (`payments.fde-hosting-purchase`, `organizations.fde-hosting`, accepted) |

## Capxul's own checks, which the chain does not make

These are stricter than the chain. They are not contradictions, but each one must be stated as Capxul's rule, not
the chain's:

- **A current Seat.** Every write needs a current Seat first. A hat wearer with no Seat is refused by Capxul and still
  admitted by the chain.
- **The officer hats.** Books, Invoicing and People are Capxul guards read from the chain. The chain never checks them.
- **ROLE_CONFLICT.** A department's or team's office never goes to a People-hat wearer
  (`budgets.role-conflict-people-hat`, `board.people-hat-role-conflict`). This keeps the frozen separation of duties.
  - The chain does not enforce it: a Board batch at the Safe outside Capxul can mint both.
  - On v4 the People hat cannot grant money authority (allowances and offices are minted by the Board or by an office
    above). The conflict therefore guards a product rule, not a chain power.
  - Its sharpest consequence is unstated (contradiction 9). The setup mints the People hat to the founder, so a
    founder cannot hold any department or team office until the People hat is revoked. A solo founder spends only
    through an allowance or as the Board, and offers pay only from an allowance.
- **Holder writes are approvals.** Holder writes are always approvals from the holder's own Safe, never Board
  proposals (`payroll.holder-writes`), though the chain would admit the company Safe.
- **No agent Directors.** An agent is never a Director (`board.no-agent-directors`). The chain cannot tell an agent's
  Safe from a person's, so Capxul checks the Seat's kind.
- **The hosted FDE as its asker.** The act-for token and the asker it resolves to are Capxul's own check
  (`rules.fde-acts-for-asker`). On chain the asker's own Safe signs whatever the FDE prepares, so the chain's check is
  the asker's hats, as for any of their own calls.
- **The head's permissions.** The document family is judged by the head's own roles for the member's User, which
  Capxul brings to what the member's hats give at each call (`organizations.doc-authority`). Money never goes through
  the head (`organizations.doc-reach`).

## Where the book contradicts the model

Each row names the record, what it says, what the chain does, the fix, and the folder that owns the fix. The
audit changed nothing; the commands pass applied every fix, as "Where each fix landed" below records.

| # | Record(s) | The book says | The chain, and the rulings | Fix | Owner |
|---|---|---|---|---|---|
| 1 | `payments.claim-escrow-routes`, `budgets.claim-escrows`, rpcs `payments.commands.prepare` and `payments.commands.propose` (about), `payments.changes.cancel` (about), operation `payment.cancel` (who) | A budget's claim escrow is funded and taken back through new Budgets calls (`spendToClaim`, `scheduleToClaim`, `refundClaim`), which also return the room. `payment.cancel`'s who gives "a claim escrow the company Safe owns" to the Board alone. | `aaron.escrow-general`: Budgets does not change, the escrow does. `aaron.departments`: a budget payment is the department's, so whoever wears its hat when it is taken back may take it back. Today's `Escrow.refund` answers one owner address, which would make it the Board's alone (the company Safe) or one person's (the spender's Safe). Both are wrong. | The general escrow's sender, for a budget payment, is the budget. Its terms bind the Budgets address and the budget id. `reclaim` is allowed when `Budgets.authorised(budgetId, caller)` holds at the call, and pays `budgetOf(budgetId).safe`, the company Safe. It is funded by an ordinary `Budgets.spend` or `schedule` to the escrow's counterfactual address. No room returns (Aaron's answer to open question 1). For a personal or Board escrow the sender is a plain address: the payer's Safe or the company Safe. `payment.cancel`'s who reads: "For a budget's claim escrow, whoever wears the budget's hat or one above it now, or the Board". | payments (and the escrow contract in shared/external.ts by the escrow pass); budgets for `budgets.claim-escrows` |
| 2 | rpc `payments.commands.propose` (about), operation `payment.cancel` and rpc `payments.changes.cancel` (who) | A Board's dated payment is "one `Budgets.schedule` on the open top budget in the asset with the most left", and cancelling it needs a Director. | That top budget may be a department, a top budget with its own office hat. `Budgets.cancel` then admits that department's office holders too, so the Board's payment would be cancellable by the department, and reserved against its room without its knowing. | Schedule a Board payment on the company's own top budget, the one under the Board's top hat that only the company Safe wears. Or, if a department pays, name it (`--from`) and say its holders may cancel it. | payments |
| 3 | rpcs `budgets.offices.remove-holder` and `budgets.departments.create` | A team holder is removed by `Hats.transferHat(hat, holderSafe, companySafe)`. The new office hat's eligibility, toggle and mutability are not stated, where the allowance hats already state them (`budgets/allowances.ts:57`). | Hats refuses a transfer to a Safe that already wears the hat (`AlreadyWearingHat`). The team's second removal therefore fails, and the company Safe shows as a holder. `transferHat` and `changeHatMaxSupply` need a mutable hat. An office hat whose eligibility is a person's Safe would leave that person able to rule wearers out after they leave the department. | Every office hat (department, team, allowance) is created with eligibility and toggle the company Safe and `mutable` true, never a person's Safe, so the office outlives its holder. A team removal by its parent office holder transfers to the company Safe only while the Safe does not wear the hat. Otherwise it is a Board proposal of `setHatWearerStatus`. An eligibility module that admits the parent hat's wearers would let the head do it alone, but it changes the v4 wiring and is a question for Aaron. | budgets |
| 4 | operations `org.department.create`, `org.department.budget.set`, `org.department.close`, `org.department.reopen`, `org.department.holder.add`, `org.department.holder.remove`, `org.allowance.create`, `org.allowance.change`, `org.allowance.assign`, `org.allowance.revoke`, `org.allowance.replace`, `org.department.ceiling.set`, `org.department.ceiling.freeze` and `org.department.ceiling.unfreeze` (who) | "A Director of the Organization" for all of them (the pre-v4 text). `org allowance replace`: "A member who can manage people". | The office above a budget acts on a child without the Board. Only top budgets, ceilings and hats under the Board's top hat are the Board's. Their own refusals and rpcs already say so (`budgets.signer-rule`). | Take `who` from the designed block, as payments does (`designedWho` in `payments/operations.ts`). For example: "For a top budget, the Board. For a child, the office holder of the parent budget or of any budget above it", and "Nobody" for replace. Word `org.allowance.change`'s refusal for a top budget whose hat is the Board's top hat, not for every top budget. | budgets |
| 5 | operations `bank.pay` (who) and `inbox.pay` (who) | "a member with a spending allowance in the funding asset". "paying under a spending allowance they hold". | Authority is the budget's hat, not a person's allowance. Their rpcs already say so. | The designed who: "For an Organization, the wearer of the budget's hat or above" (`bank.pay`), and "The payer. For an Organization, the wearer of the budget's hat or of a budget above it" (`inbox.pay`). | banking; requests |
| 6 | rpcs `budgets.offices.add-holder` and `remove-holder` (about: "named by email"), the holders of `budgets.departments.create`, the flows of `org allowance assign` and `org allowance revoke` | A holder is named by email only. | An agent's Safe can wear an office or allowance hat. `agents.fde-authority` lets the Board grant the FDE an allowance, and payroll admits agent holders. With email only, an agent already seated can never be swapped into or out of a department. | A member is an email or an agent's `@handle`, as `board.agent-officer-hats` already did for officer hats. | budgets |
| 7 | rpc `board.proposals.approve` (who) | "A Director of the Organization (an agent Director signs with its own key)". | `board.no-agent-directors`: no agent is ever a Director. | Drop the parenthesis. | board |
| 8 | `board.people-hat-role-conflict` (its chain test) against `budgets.role-conflict-people-hat` and `budgets.invitation-allowance-offers` | A budget is an office when it is a top budget, or when its hat's admin is its parent budget's hat. | A new allowance goes "under the one open top budget in that asset", which in a fresh company is the install's budget under the Board's top hat. The allowance's hat admin is then its parent's hat, so board reads it as an office and refuses a People-hat grant to its wearer, while budgets allows allowance wearers the People hat. | Make the kind readable on chain by both: budgets writes it into the hat's `details` (`office:` or `allowance:`), and board reads it from indexing's chain-hats. Or both use one rule that tells the install's company budget apart. | board; budgets |
| 9 | `budgets.role-conflict-people-hat`, `board.people-hat-role-conflict`, workflow `organizations.setups.set-up` | The setup mints the People hat to the founder, and a People-hat wearer may hold no department or team office. | Not a chain contradiction, but under the ruling it decides who can be swapped in, and its consequence is unstated. A founder can never hold a department while wearing the People hat. A solo founder spends only through an allowance or as the Board, and offers agreements only from an allowance. | State it in a decision and in the founder's journey: revoke the People hat first, or use an allowance. If the frozen ROLE_CONFLICT cannot be kept any other way, the decision says "For Aaron". | budgets; organizations |
| 10 | `dependencies.of-payroll` | "board: an agreement on a top budget is offered or changed by Board proposal". | A top budget's office holders offer and change from their own Safes (`Agreements`: `authorised`), as `payroll.holder-writes` books. | "board: an Organization payee's acceptance and collection are Board proposals: the payee is the company Safe". | shared (decisions.ts) |
| 11 | `notices.recipients`, `notices.money-waiting-reminders`, `notices/payroll.ts` (`offerer` from `offered_by`), `notices/banking.ts` (`created_by`) | An Organization's notice goes to its Directors. An accepted agreement tells the person who offered it. A payout tells the person who made it. Money left uncollected tells "the payer". | A department's money is acted on by whoever wears its hat now. The person who offered or sent may have been swapped out, and the current holders, who must act, are not told. | An Organization notice about a budget's money also goes to the budget's current hat wearers, read when it is sent: notices reads indexing's wearers, or the source row names the budget. The person who acted is told only while they still wear the hat. | notices |
| 12 | `SIGNER_RULE` in `budgets/departments.ts` (used by the create and tree writes) | "Nobody acts on their own budget." | Wearers spend, schedule, offer and open teams on their own budget. What they cannot do is change its amount, hat or open state. | "Nobody changes their own budget's amount, hat or open state through its own hat." | budgets |
| 13 | rpcs `agents.changes.freeze`, `unfreeze`, `rotate`, `sweep`, `remove` and `get` (who) | "a Director of the Organization that owns it". | AgentOwner answers only its owner, the company Safe. It is a Board proposal, as `agents.org-owned` says, and one Director cannot act alone unless the threshold is one. | "a Director proposes it, and the Board's approval acts". | agents |
| 14 | `organizations.members-are-seats` (AgentRemoved ends the Seat), `board.agent-officer-hats` | Removing an agent ends its Seat. | Its Safe keeps its officer, office and allowance hats. Nobody can sign for it, yet each still fills a place on its hat and lists it as a holder. | On AgentRemoved, budgets and board propose taking its hats back, once, as `budgets.invitation-grants-return` does for an ended invitation. | board; budgets |
| 15 | `organizations.fde-at-start-up` (superseded), `notices.head-and-fde` ("its key is on the founder's machine"), workflow `organizations.setups.set-up` (the FDE key recorded at `begin`) | The FDE's key is made on the founder's machine and never reaches Capxul. | `aaron.fde-hosted`: Capxul hosts the FDE on a durable runtime, and its key is the runtime's. Authority is unchanged: the company Safe owns it, the Board grants its hats, and it is never a Director. | Book the key as made and held by Capxul's hosted runtime. The install batch still calls `AgentOwner.create(runtime key, company Safe)`. The FDE never pays its own hosting. `FDE_HOSTING_PRICE` is paid from a budget by whoever wears its hat, or by the Board. | organizations; agents; notices |
| 16 | `organizations.buy-seats` (accepted) | "pays from a budget they hold". | A budget is held by whoever wears its hat now. With contradiction 9, a People-hat wearer holds no office, so seats are bought from an allowance, or by the Board. | "from a budget whose hat, or one above it, their Safe wears now", with that consequence stated. | payments (books `org seats buy`); organizations |
| 17 | rpc `payments.changes.retry` (about) | "a caller who no longer holds the authority the first send needed". | Any current wearer of the budget's hat, or one above, may retry a budget payment, whoever sent it first. | "a caller Budgets does not authorise on the budget now". | payments |

### Where each fix landed (commands pass, 8 November 2026)

| # | Applied in |
|---|---|
| 1 | The general escrow (`payments.general-escrow`, `contract_escrow` in `shared/external.ts`): a budget's escrow names Budgets and the budget id as its authority; `payments.claim-escrow-routes`, `budgets.claim-escrows`, `payments.department-authority`, rpcs `payments.commands.prepare\|propose` and `payments.changes.cancel`, and `payment.cancel`'s who. No room is restored and Budgets does not change. |
| 2 | `payments.department-authority` and rpc `payments.commands.propose`: a Board dated payment goes on the open top budget with the most left among those no member holds (the install's, or one the Board keeps with no holder); a department pays by `--from`, and its wearers may then cancel it. |
| 3 | rpcs `budgets.departments.create` (office hats `office:<key>`, eligibility and toggle the company Safe, mutable) and `budgets.offices.remove-holder` (`transferHat` only while the company Safe does not wear the hat, else the Board's `setHatWearerStatus`; the company Safe's place is never listed). The eligibility module is not asked of Aaron: the Board fallback keeps v4's wiring. |
| 4 | `budgets/operations.ts`: every listed operation's who is its designed (v4) who, or the same rule where the frozen record has none (`designedWho`); `org.allowance.change`'s refusal names only a parent whose hat is the Board's top hat. |
| 5 | `bank.pay` and `inbox.pay` take their designed who. |
| 6 | rpcs `budgets.offices.add-holder\|remove-holder`, `budgets.departments.create` and `budgets.allowances.create`, and the budgets shapes: an email or an agent's @handle. |
| 7 | rpc `board.proposals.approve`: "a person, never an agent". |
| 8 | `board.people-hat-role-conflict` and rpc `board.officers.grant`: the kind is read from the hat's details (`office:` or `allowance:`), which budgets writes into every hat it creates. |
| 9 | `organizations.founder-people-hat`, and the `run_company` journey's about. |
| 10 | `dependencies.of-payroll` (board: an Organization payee's acceptance and collection). |
| 11 | `notices.recipients` (chosen `directors-and-wearers`; notices now depends on indexing for hat-wearers), the agreement-accepted, payout and payer notices, and the money-uncollected and money-taken-back texts. |
| 12 | `SIGNER_RULE` in `budgets/departments.ts`: "No wearer changes their own budget's amount, hat or state." |
| 13 | `agents.who-acts` and the agents change rpcs' who. |
| 14 | `budgets.removed-agent-hats`: workflow `budgets.agents.return-hats` proposes a removed agent's hats back once. |
| 15 | `organizations.fde-at-start-up` (rewritten), the setup's `host-fde` step and the `fde-host` integration, `notices.head-and-fde` and `notices.organizations.fde-ready`, and `agents.fde`. |
| 16 | `organizations.buy-seats`, `payments.seat-authority` and `org.seats.buy`'s who. |
| 17 | rpc `payments.changes.retry`: any current wearer, and for a seat purchase a People-hat person, for a hosting payment a person. |

What the book already gets right, so nobody rewrites it:

- `budgets.signer-rule`, `budgets.chain-is-the-record`, `budgets.no-door` and every `budgets.*` rpc's who.
- `payroll.holders.*` ("authority is read from the chain, never from a Capxul row"), `payroll.hr-authority`
  ("paying is the budget's") and `payroll.runs.pay`.
- The who of `payments.commands.prepare`, `payment.send`, `payment.retry`, `payment.reschedule` and
  `org.department.pay`.
- `banking.payouts.quote`, `banking.manage-authority` ("A payout itself is authorized by the budget's hat on chain")
  and `requests.invoicing-hat`.
- `board.officers.*`, `board.director-commands`, `board.top-hat-refusals` and `agents.org-owned`.
- `integrations.sponsor-refusals`: Budgets' `NotAuthorised` is ROLE_PERMISSION_DENIED, so a hat lost before signing
  ends the approval.

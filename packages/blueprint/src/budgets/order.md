# The build order of the domain `budgets`

Where each operation of this domain comes in the order to build the blueprint in, and what it needs: the parts of a
world, listed in [order.md](../../order.md), and the starting worlds, listed in [claims.md](../../claims.md). "#" is
the operation's step in that order; operations may share a step when they can be built at the same time.

A budget is the chain's (packages/contracts, `src/money/Budgets.sol`): an amount of one asset per calendar period,
inside its parent's, and a hat whose wearers may spend from it and from every budget below it. The chain is the only
gate on spending, so every figure these operations answer is read from the chain, never kept; Core keeps only a
budget's name and the creation it proposed. Founding already makes each company's top budget, of the Books hat,
1,000,000 USDC a month (decisions.md, 49). A budget's Cost Center on the company's site comes later, in another unit:
nothing here touches a site.

Creating one is a Directors' proposal, as an officer change is (decisions.md, 48): a company Safe transaction its
Directors approve with their own Safes, carried by Core's relayer. Its batch makes a hat for the budget under the
company's tree, mints it to the holder's personal Safe, and calls `Budgets.createChildBudget(parent, amount, hat)`,
which the company Safe may call for any of its budgets. The chain gives a child its parent's asset and period, so
neither is asked. The room in the parent is read from the chain when the creation is proposed (`ExceedsParent`); the
chain checks it again when the transaction runs, so two creations proposed together that do not both fit leave the
second one's last signature refused with `TransactionReverted`.

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 15 | `org.budget.list` | chain, database | `founded` | Reads the budgets founding made for the company Safe; every other operation here is checked through it. |
| 15 | `org.budget.show` | chain, database | `founded` | The same reads, for one budget. |
| 16 | `org.budget.create` | chain, database, signing | `founded` | Proposes to the Directors as `org.member.grant` does, and lands through `approval.sign`, whose landing of a `budget_creation` it adds. |

# The order to build the blueprint in

The twelve operations, in the order they can be built. An operation comes after everything its scenarios need: the
parts of a world it touches, and the operations that make its starting worlds. The starting worlds are declared in
`src/starting-points/points.ts` and listed with their steps in [the generated index](../generated/index.md).

The parts of a world, as `packages/world` builds it (roadmap step 1.3):

- **registry**: the platform's table of world names, owners and expiries.
- **stack**: the world's Alchemy deploy: its door, its Core, its containers.
- **database**: the world's Neon branch: the app's data, the record and the index.
- **chain**: the world's Anvil, loaded from the seeded chain state, saved to R2.
- **index**: Ponder, indexing the chain into the world's database.
- **signing**: the cast's test keys, the bundler and the paymaster that carry a signature to the chain.
- **site**: a company's Frappe site on a bench, reached through the door (roadmap step 1.4).
- **clock**: the world's time, followed by the chain and every site.

Each of today's domains has its own table below, one row per operation, with the parts of a world it needs (above)
and the starting worlds its journeys need. "#" is the operation's step in this order, from 1 (`world.create`) to 12
(`world.snapshot.restore`) for the thin line's twelve; operations may share a step when they can be built at the same
time. This page is written by hand until each verb declares what it needs and the page is generated from them.

## What can be built at the same time

Steps 1 to 4 need no company and can be built while step 1.4 (a company's site through the door) is under way.
Steps 5 to 7 need the chain, the index and signing but no site. Steps 8 to 10 need a site. Steps 11 and 12 need
every part, because a snapshot holds them all.

## Making the starting worlds

Each starting world is made through the door by the operations above. `fresh` to `paid` are made once per change to
the code and saved as template snapshots in a kept template world, and a scenario gets the one it needs restored into
a fresh private world; `quota-full`, `with-snapshot` and `restored` are made by their steps for each scenario
(`StartingWorld.made`, decisions.md 39). Whoever makes a world keeps its facts for the scenarios (decisions.md 38).
Until `world.snapshot.restore` exists (step 12), a scenario's starting world is made from `nothing` by running the
steps, which is slower but needs nothing more.

## The domain `organizations`

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 5 | `org.create` | database, chain, index, signing | `fresh` | The first operation inside a world. Its third claim needs `approval.sign`. |
| 7 | `org.member.grant` | database, chain, index, signing | `founded`, `office-holder` | Needs a founded company and `approval.sign` to execute its proposal. |

## The domain `people`

A member's Seat is off the chain and off the site. It is no hat, no Safe owner and no site user: the founding members
of `founded` (sam and pat) have none of them, `org.member.grant` adds a hat, and only a hat brings a site user
(decisions.md, 49 and 50). In infrastructure, ADR-0040 rules the same: "Inviting someone creates a Seat, not an
on-chain role", and an invitation with no grant "has no configure, grant or cleanup command" (its organizations
README, Invitations). So these five need only the world's database, Core's store of the company's board and
members, and the cast.

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 13 | `org.member.list` | database | `founded` | Reads the board and members `org.create` stored; every other operation here is checked through it. |
| 13 | `invitation.send` | database | `founded` | Needs a founded company, whose founder invites; writes only Core's database. |
| 14 | `invitation.list` | database | `founded` | Reads what `invitation.send` wrote, by the caller's email in the cast. |
| 14 | `invitation.decline` | database | `founded` | Ends what `invitation.send` wrote. |
| 14 | `invitation.accept` | database | `founded` | Adds the invitee to the members `org.member.grant` reads, so a member who joined by invitation can be granted a permission. |

## The domain `board`

### Who changes a Board, and how it reaches the chain

A Director is a signer of the company Safe. `deployMoney` (packages/contracts, `InstallerMoney._shareholdersTree`)
creates the Director hat under the Shareholders' top hat, with the founder's personal Safe as its eligibility and
toggle, mints it to every founding Director's Safe with one seat each, and hands the Shareholders' top hat to the
founder's Safe. The Signer Gate (`_gateInit`) takes the Director hat as its signer hat and the Shareholders' top hat
as its owner hat, with `ABSOLUTE` threshold `min = target =` the founding threshold (Core's `org.create`), and is the
company Safe's module and guard.

So the Board cannot change itself. The Gate refuses every company Safe transaction that calls the Safe
(`CannotCallSafe`), so `addOwnerWithThreshold` and `changeThreshold` are out; `Hats.mintHat` of the Director hat is
its admin's, the Shareholders' top hat; `setThresholdConfig` is the Gate's owner hat's, the same hat. Every change
to the Board is one UserOperation of the founder's own Safe, which `org.director.add` and `org.threshold.set`
prepare with one approval, the founder's, as `org.create` prepares the setup (decisions.md 48): its digest is the
Safe4337Module's operation hash and `approval.sign` sends it through the world's bundler at the first signature.

- **Seat a Director** (`org.director.add`): `Hats.changeHatMaxSupply(directorHat, supply + 1)` when every seat is
  worn, `Hats.mintHat(directorHat, memberSafe)`, then `HatsSignerGate.claimSignerFor(directorHat, memberSafe)`, which
  makes the Safe an owner of the company Safe. The threshold stays what the Gate computes for the new number of
  owners: with `min = target = t`, still `t`.
- **Set the threshold** (`org.threshold.set`): `HatsSignerGate.setThresholdConfig({ ABSOLUTE, n, n })`, which
  rewrites the company Safe's threshold. A threshold of 0 or more than the Directors would make the Gate refuse every
  transaction (`ThresholdTooLow`), so both are refused before anything is proposed.

The same design is main's, frozen and designed (main's `blueprint/board/operations.ts`, `org.board.director.add`
and `org.board.threshold`: "It is never a Board proposal: the Signer Gate refuses every owner change the Safe
makes"). Old Acme s1.15 added an Owner by a company Safe proposal (`addOwnerWithThreshold`), which a company under a
Signer Gate refuses. Once shares are issued the Shareholders' top hat goes to the Governor and a change to the Board
becomes a shareholders' vote; that comes with equity.

**What the site is told.** A Director has a user on the company's site with the Director's hat, `admin`
(Core's `SITE_HATS.director`): the setup's landing queues a `grant` of it for each founding Director, which is why
`founded` has users for dana and eli. A seat that lands queues the same `grant` for the new Director, so the new
Director's user reaches the site.

**What the Board is in Core.** `org.member.grant` asks one approval per Director at the Board's threshold, from
Core's `app.organizations` (`directors`, `threshold`), and `org.member.list` lists the Directors from it. A seat or a
threshold that lands updates them, so a later proposal asks the new Director and needs the new threshold.

**Not here yet.** Removing a Director (`Hats.setHatWearerStatus(directorHat, safe, false, false)`, then
`HatsSignerGate.removeSigner(safe)`, refused when the threshold would exceed the Directors left) and replacing one;
on the site, a `revoke` the Capxul app does not take yet (`capxul/hats.py` has `apply_hat_revoked`).

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 15 | `org.director.list` | database, chain | `founded` | Reads the company Safe's owners and threshold and the world's cast; every other operation here is checked through it. |
| 15 | `org.director.add` | database, chain, index, signing, site | `founded` | Needs a founded company, `approval.sign` to send the founder's UserOperation, and the site to take the new Director's user. |
| 16 | `org.threshold.set` | database, chain, index, signing | `founded` | Its journey raises the threshold of a Board `org.director.add` grew, then has `org.member.grant` and `approval.sign` honour it. |

## The domain `budgets`

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

## The domain `documents`

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 8 | `doc.create` | database, site | `office-holder`, `payment-drafted` | The first operation on a company's site: needs roadmap step 1.4 and a member with a site user. |
| 9 | `doc.submit` | database, index, signing, site | `office-holder`, `payment-drafted`, `payment-held` | Needs documents to submit; a held payment opens a sponsored approval. |

## The domain `approvals`

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 6 | `approval.sign` | chain, index, signing | `founded`, `payment-held` | Needed to finish a founding; without it no later starting world can be made. |

## The domain `reports`

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 10 | `report.run` | site | `paid` | Its claims compare the books with the chain after a payment, so it needs everything before it. |

## The domain `world`

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 1 | `world.create` | registry, stack, database, chain, index, clock, the cast | `nothing`, `quota-full` | Nothing else can run without a world. It is `packages/world`'s create with an Rpc in front. |
| 2 | `world.show` | registry, database | `nothing`, `founded`, `restored` | A read of what create wrote. The first claim needs `restored` and waits for step 12's operation. |
| 4 | `world.clock.warp` | chain, clock, site when there is one | `founded` | The chain half can be built on `fresh`; its thin line claim needs a company's site and waits for step 1.4. |
| 11 | `world.snapshot.save` | registry, database, chain, site, clock | `fresh`, `paid`, `with-snapshot` | Copies a whole world: a branch of its database, its chain state and its sites. |
| 12 | `world.snapshot.restore` | everything `world.create` needs, and a snapshot | `with-snapshot` | Makes a world from a snapshot, so it needs create and save. |
| 13 | `world.list` | registry | `quota-full` | A read of the registry's rows of the caller's worlds and the platform's rows of their snapshots. After the thin line: an operator's inventory. |
| 13 | `world.snapshot.list` | registry, database | `quota-full` | A read of the platform's rows of a world's snapshots and of the branches that hang from each. Needs `world.snapshot.save` and, for its second claim, `world.snapshot.restore`. |
| 14 | `world.snapshot.delete` | registry, database, chain | `quota-full` | Removes what a save made: the snapshot's branch, its chain state and its row. Needs `world.snapshot.list` to show what it removed and `world.snapshot.restore` for its refusal. |

## The domain `record`

| # | Operation | Parts it needs | Starting worlds its scenarios need | Why here |
|---|---|---|---|---|
| 3 | `record.export` | database | `fresh`, `paid`, `restored` | Reads the record, which every operation after it writes. Built early so every later scenario can read the record. |

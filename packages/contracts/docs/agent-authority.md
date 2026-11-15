# How an agent's authority to spend flows

How the contracts on `master` decide what an agent may spend, with where each check lives. "The proof" below is the
18-step proof that ran on `main` (`bin/prove-core.sh`, removed from this line). The invoice ledger, agreed with Aaron on
15 November 2026, changes step 3: `Budgets` will take an invoice instead of a document hash and job nonce. This page
describes the contracts as they are until that lands.

An agent has no spending authority of its own. It is a Safe (created by `AgentOwner.create`, `src/agents/AgentOwner.sol:181`) whose
one signer is the agent's key; what lets it spend is a **hat** its Safe wears, exactly like a person's. The chain of calls, with
where each check lives:

1. **The key signs a Safe transaction** whose target is `Budgets.spend`, and anyone submits `agentSafe.execTransaction` (the agent's
   key itself in the proof). For a sponsored user operation it would instead go through the Safe 4337 module (see below).
2. **The guards run first.** `AgentOwner` is the agent Safe's transaction guard and module guard (`AgentOwner.sol:265`,
   `:289`; set in `create`, `:198-199`). They refuse a call to the agent's own Safe or any delegatecall (`_requireNotSelfCall`,
   `:338`), and any module call while the agent is frozen or removed, so the key can never change its Safe's owners, modules or guard.
3. **`Budgets.spend(id, recipient, amount, kind, documentHash, jobNonce)`** (`src/money/Budgets.sol:206`) sees `msg.sender` = the agent's
   Safe and calls `_requireAuthorised` -> `authorised(id, who)` (`:373`): `Hats.isWearerOfHat(agentSafe, budget.hat)` and
   `isInGoodStanding`, walking up the budget tree (a wearer of a parent budget's hat also passes). **This is the only place the agent's
   authority is decided.** Then the budget's own limits: `OverBudget` if `amount` exceeds what is left this period (`:220`), a
   non-zero document hash and job nonce.
4. **The hat was granted by the Board.** The Board top hat is worn by the company Safe (`InstallerMoney._boardTree`,
   `src/authority/InstallerMoney.sol:130`; officer hats are its direct children with the company Safe as admin), so granting is a
   company Safe transaction, `Hats.mintHat(hat, agentSafe)`, which the Directors approve and the Signer Gate lets through.
5. **Budgets pays from the company Safe, not from the agent.** `_pay` (`Budgets.sol:497`) calls the company's Zodiac Roles
   `execTransactionWithRole(MultiSendCallOnly, ..., payoutRoleKey, true)`. Budgets is the **only member of the payout role**
   (`InstallerMoney._payoutRole`, `:204`: `assignRoles(budgets, [PAYOUT_ROLE_KEY], [true])`), and the role is scoped to exactly
   `token.approve(Payments, _)` and `Payments.send` (`PayoutScope.approveScope`, `sendScope`), with a Roles **allowance** per token
   (the ceiling) as a backstop under the budget's own check.
6. **Roles sends through the Signer Gate** (`setTarget(gate)`, `:205`), which is a Safe module and guard of the company Safe, so the
   company Safe executes the approve and `Payments.send(item)` with the document hash, the Safe as executor.

So the Zodiac role never names the agent: the role's member is `Budgets`, and Budgets asks Hats who may call it. A hat is the
agent's authority, a budget its limit, the role and its allowance the backstop, and `AgentOwner` the leash (freeze, key swap,
sweep, remove, all callable only by the owner Safe). Removing the hat (`Hats` status or burn) or freezing the agent stops it; the
Board cannot be bypassed because only the company Safe administers the officer hats. In the proof, an agent whose Safe wears no hat
is refused with `NotAuthorised`, and after the grant it pays.

**Does a real agent payment need the bundler and paymaster (alto)?** Not to move money. The agent's key can sign a plain Safe
transaction and any account can send it and pay the gas: that is what the proof does, on a chain with no bundler. alto and a
paymaster are needed only for what the old product did on top: the agent submitting **ERC-4337 user operations** through the Safe 4337
module (`0x75cf...c226`, enabled on the agent's Safe by `create`) so that Capxul's paymaster sponsors the gas and the agent's key holds
no ETH. That needs a bundler (alto), an entry point at `0x0000000071727De2...` (it is in the pin) and a paymaster, none added here. The
module guard still applies to those operations (`checkModuleTransaction`). One open point: nothing on chain limits *which* budget an agent may
use beyond the hat on that budget, so an agent should wear the hat of exactly the budgets it should draw on.

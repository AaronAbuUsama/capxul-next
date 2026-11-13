# @capxul/contracts: Capxul Protocol v4

The 15 v4 contracts, their tests, and a seeded chain state so they run with no network. Where it lives follows decision
`system.layout` (`packages/contracts`, "the v4 Solidity"); the old repository called it `packages/contracts/v4`, and this
package is that folder, flattened into the package root.

## Source

`Xelmar-tech/infrastructure`, branch `integration/factory`, commit **62e49471019d19f13536dde264cfd05c3dd5fedb**, folder
`packages/contracts/v4`, brought with `git archive` (nothing was checked out there or changed). No contract logic was changed.

**Brought:** `src/` (50 files, 9,666 lines: Companies House claimer and minter, Payments, Budgets, Agreements, EscrowFactory
and Escrow, the Installer, AgentOwner, and the equity contracts, which stay because the Installer and the tests depend on
them), `test/` (hermetic, fuzz, invariant, symbolic, exhaustive, fork and scenario tests, with their mocks and utilities),
`scenarios/` (read by the scenario tests), `certora/` and `halmos.toml` (the verification specs, not wired to a runner here),
`deploy/manifest.json` (the 15 contracts Companies House deploys, in order), `foundry.toml`.

**Changed, none of it contract logic:** `foundry.toml` points at `lib/` here (the old file pointed at pnpm's node_modules and a
sibling `../lib`); a `[profile.fork]` was added; `@beta/` now maps to `test/beta/`, which holds `CapxulPaymentsV3.sol` and
`CapxulEscrow.sol` copied from the old `packages/contracts/src`, because two differential fuzz tests compare v4 against them.
`deploy/devnet.json` (Companies House's Directors and the devnet tier) is a trimmed copy of the old tool's `devnet.json`.

**Left behind, and why:** the beta contracts other than those two (not v4); `deployments/devnet.json` of the old repository (its
addresses belong to the old build, see below; this package writes its own); `docs/planning/protocol-v4` (2.8 MB of plans and
specs that the test comments cite, such as `spec/installer.md`; read them at the source commit); `scripts/` (tool installers
and the old coverage and Halmos checkers, which need the old workspace); the ABI exports (`out/` is built, not committed).

## Dependencies

Vendored in `lib/`, so a build needs no network and no `node_modules`: `lib/forge-std` (v1.9.7, src only, as the old repository
vendored it) and `lib/openzeppelin` (contracts and contracts-upgradeable 5.6.1, the `.sol` files only). To rebuild
`lib/openzeppelin` from npm, checking each tarball against its published SHA-1, run `bash bin/vendor-deps.sh`. Solc 0.8.28 (Foundry
downloads it once). No git submodules.

## Commands

From the repository root: `pnpm --filter @capxul/contracts test` (hermetic, 965 tests) and `pnpm --filter @capxul/contracts fork`
(the fork and scenario tests from the seeded state, 67 tests). They are not part of the ladder in `AGENTS.md`: they need
Foundry, a build is about 100 s and the fork run needs a chain. From this folder: `forge build`, `forge test`, `FOUNDRY_PROFILE=full forge test`
(adds fuzz, invariant, symbolic and exhaustive tests; slow).

## The seeded chain state (`state/`)

| File | What | Used by |
|---|---|---|
| `pin.genesis.json` | An Anvil `--init` genesis whose head is Base Sepolia block 47,893,251 and which holds the 25 third-party contracts (Safe 1.5.0 and 1.4.1 libraries, Hats, Hats Signer Gate, Roles, ModuleProxyFactory, USDC, ...) with the storage the tests touch: 10 non-zero slots | `bin/chain-up.sh pin`, the `fork` script |
| `core.json` | That state plus Companies House and the 15 v4 contracts deployed (an `anvil_dumpState`), head at block 47,893,259 | `bin/chain-up.sh` (default) |
| `CHECKSUMS` | SHA-256 of both | rebuild check |

`bin/chain-up.sh [core|pin]` starts Anvil from a state on `CHAIN_PORT` (default 18545), chain id 84532, reading the state and
never writing it; `bin/chain-down.sh` stops it. Both files were built on `main` by `bin/seed-state.sh`, which drove
`packages/devnet`; neither is on this line, so the state cannot be rebuilt here yet. A change to a contract makes
`core.json` stale: it holds their compiled code. `deployments/devnet.json` is the deployment record (addresses, salts, constructor arguments, code hashes).

Anvil's own test accounts have EIP-7702 delegations on the live chain, so the pin skips them and funds the nine test accounts
fresh. Time moves with `evm_setNextBlockTimestamp` and `evm_increaseTime`, as on any Anvil.

## The proof

The 18-step proof (`bin/prove-core.sh`) ran `packages/devnet`'s `prove` through `@capxul/sdk`. Both packages stay on
`main`, so the script was removed from this line. The thin line's scenarios will take its place.

## How an agent's authority to spend flows

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

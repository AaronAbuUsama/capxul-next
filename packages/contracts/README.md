# @capxul/contracts: Capxul Protocol v4

The 15 v4 contracts, their Foundry tests, and the seeded chain state they run from with no network. They were brought
from the old repository with no change to contract logic.

## What TypeScript imports

`src/door.ts` exports two modules that `pnpm generate` (`packages/generate`) writes and nobody edits: `Abi`, the
compiled ABI of each contract and interface off-chain code uses, and `Seeded`, the seeded chain's addresses, tiers and
last block. The outside contracts a world's chain holds are declared as Solidity interfaces in
`src/interfaces/external`. The ones only off-chain code reads (`IEntryPoint`, `ISafe4337Module`, `IHatsEvents`,
`ISafeState`) are in files no deployed contract imports. A change to an imported file changes the importing
contract's metadata, so its code and its address.

## Commands

From the repository root:

- `pnpm --filter @capxul/contracts test`: the hermetic tests.
- `pnpm --filter @capxul/contracts fork`: the fork and scenario tests, from the seeded state.
- `pnpm seed`: rebuild the seeded state. `pnpm seed:check` fails the gate when it is stale.

From this folder: `forge build`, `forge test`, and `FOUNDRY_PROFILE=full forge test`, which adds the slow fuzz,
invariant, symbolic and exhaustive tests. Foundry's tests are not in the gate: they need Foundry, a build takes about
100 s, and the fork run needs a chain. The gate builds the contracts only.

## Where to read more

| To | Read |
|---|---|
| start the seeded chain, see what it holds, rebuild it | [docs/seeded-chain.md](docs/seeded-chain.md) |
| see how an agent's authority to spend flows through the contracts | [docs/agent-authority.md](docs/agent-authority.md) |
| know where the contracts came from, what changed and what was left behind, and the vendored libraries | [docs/provenance.md](docs/provenance.md) |

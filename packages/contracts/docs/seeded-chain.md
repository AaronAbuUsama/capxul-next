# Run the seeded chain, and rebuild it

The chain state a world starts from, without a network: how to start it, what it holds, and how `pnpm seed` rebuilds it.

## What `state/` holds

| File | What | Used by |
|---|---|---|
| `pin.genesis.json` | An Anvil `--init` genesis whose head is Base Sepolia block 47,893,251 and which holds the 25 third-party contracts (Safe 1.5.0 and 1.4.1 libraries, Hats, Hats Signer Gate, Roles, ModuleProxyFactory, USDC, ...) with the storage the tests touch: 10 non-zero slots | `bin/chain-up.sh pin`, the `fork` script |
| `core.json` | That state plus Companies House and the 15 v4 contracts deployed (an `anvil_dumpState`), head at block 47,893,259 | `bin/chain-up.sh` (default) |
| `CHECKSUMS` | SHA-256 of both | rebuild check |

`bin/chain-up.sh [core|pin]` starts Anvil from a state on `CHAIN_PORT` (default 18545), chain id 84532, reading the state and
never writing it; `bin/chain-down.sh` stops it. `deployments/devnet.json` is the deployment record (addresses, salts, constructor
arguments, code hashes).

`core.json`, `deployments/devnet.json` and `CHECKSUMS` are rebuilt by one command from the repository root, `pnpm seed`
(`packages/generate`, `src/seed.ts`; offline, about a second once the contracts are built): Anvil starts from `pin.genesis.json`,
the deployment's eight transactions are sent at fixed block times with fixed fees and anvil's public test keys, and the state is
dumped. `pnpm seed:check`, in the gate (`pnpm check`) and CI, fails when the rebuild differs from what is committed. A change to a contract
makes `core.json` stale (it holds their compiled code), so the check fails until `pnpm seed` is run and its output committed.
`pin.genesis.json` itself is not rebuilt here: it was built on `main` by `bin/seed-state.sh` from Base Sepolia (stages 1 and 2
need the network), and that script stays on `main`.

The rebuild's `core.json` was first made with Anvil 1.9.0. It matches the one built on `main` in every block, transaction, hash,
account and storage slot; the only change is the dump's format: Anvil 1.9.0 writes each block's empty `withdrawals` as `[]`
where the file built on `main` had `null` (18 bytes over 9 blocks).

Anvil's own test accounts have EIP-7702 delegations on the live chain, so the pin skips them and funds the nine test accounts
fresh. Time moves with `evm_setNextBlockTimestamp` and `evm_increaseTime`, as on any Anvil.

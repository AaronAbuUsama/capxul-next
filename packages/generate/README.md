# @capxul/generate

`pnpm generate` writes every file derived from another fact's owner, so nothing is typed twice (AGENTS.md, "Who owns
each fact"; roadmap step 3.1). Each generated file says so in its first line and is never edited: change its owner and
generate again. `pnpm generate:check`, in CI's `check` job, fails when generating again changes any file.

| Output | Its owner | Imported by |
|---|---|---|
| `packages/contracts/generated/abi.ts`: one `as const` ABI per contract or interface listed in `src/sources.ts` | The compiled contracts (`forge build`'s `out/`), outside contracts declared as interfaces in `packages/contracts/src/interfaces/external` | The blueprint (`Chain`'s logs and reads), Core (`src/chain/abi.ts`), the indexer (`abis.ts`), packages/world |
| `packages/contracts/generated/seeded.ts`: the seeded chain's addresses, tiers, last block and anvil's first account | `packages/contracts/deployments/devnet.json` and `state/core.json` | Core (`src/chain/seeded.ts`), packages/world (`src/chain/contracts.ts`, `faucet.ts`) |
| `packages/frappe-app/capxul/generated/site.py`: the site's names the Capxul app shares with the blueprint | `packages/blueprint/src/common/site.ts` | The Capxul app (`canon.py`, `clock.py`, `hooks.py`, `setup.py`) |
| `packages/blueprint/src/generated/*.ts`: the blueprint's indexes (each domain's hub, `domains`, the refusals, the approval subjects, `Values`, the promises) | The thing folders, `packages/blueprint/src/things/`, read by `@capxul/blueprint-tools`' `layoutOf`, and today's domains, `BLUEPRINT` in `src/sources.ts` | The blueprint's door, `src/index.ts` |

The blueprint's indexes are written from the files' text, before anything imports the blueprint, so a verb added or
removed is picked up even while the indexes on disk are stale. A verb file no domain of `BLUEPRINT` lists, or a
listed verb with no file, stops the run.

`packages/contracts`' door (`src/door.ts`) exports the two TypeScript modules as `Abi` and `Seeded`.

`pnpm generate` builds the contracts first (`pnpm contracts:build`, which is `forge build --skip test --skip script`:
the deployed contracts, the interfaces and the test mocks, about 20 s from nothing, then cached), so it needs Foundry:
CI's `check` job and the agents' cloud environment install it (v1.9.0). It then runs `src/main.ts`, which writes each
file whose text changed. No generated file is formatted after: each is written in its final form, so
`pnpm generate:check` (`src/main.ts --check`) compares them in memory, writes nothing, and names each stale file.

A new outside contract that off-chain code calls is declared as an interface in
`packages/contracts/src/interfaces/external`, in a new file that no deployed contract imports (a change to a file a
deployed contract imports changes its metadata, so its code and its CREATE2 address), and listed in `src/sources.ts`.

Files under a `generated/` folder are exempt from the 300-line limit of `pnpm shape`.

## The seeded chain state: `pnpm seed` (roadmap step 3.2)

`pnpm seed` rebuilds the state every world's chain starts from, `packages/contracts/state/core.json`, from its owners:
the compiled contracts (`out/`), `deploy/manifest.json` (the 15 contracts, their salts and constructor arguments),
`deploy/devnet.json` (Companies House's Directors, threshold and tiers) and the pinned third-party state
`state/pin.genesis.json`. It also writes `deployments/devnet.json` (the deployment record) and `state/CHECKSUMS`, then
runs `pnpm generate`, since `generated/seeded.ts` is derived from the record and the seed. `pnpm seed:check` rebuilds
the same way, writes nothing in the repository, and fails naming each file that differs (its rebuilt copy is left in a
temporary folder to compare); it is in `pnpm check` and in CI's `check` job after `pnpm generate:check`, and takes about
a second once the contracts are built. Both need Foundry (anvil) and no network.

`src/seed.ts`, the entry, starts anvil from the pin (chain id 84532) on a free local port and sends eight transactions,
one per block, all from anvil's account 0: (1) the Safe proxy factory creates Companies House, (2) the
ModuleProxyFactory makes its Roles module, (3-6) Companies House creates the manifest's contracts through CreateCall's
CREATE2, four to a Safe transaction, (7) it wires Budgets to Agreements, (8) it enables Roles and scopes each tier's
claim and company roles. It then dumps the state (`anvil_dumpState`, gunzipped) and reads each contract's runtime code
hash for the record. The pure parts are in `src/seed/`: `plan.ts` (addresses and init codes), `steps.ts` (the eight
transactions, block times and fees), `safe.ts` (Safe transaction hashes, signatures, MultiSend), `record.ts`.

The rebuild is the same bytes every run because nothing in it is left to chance: each block's time is set
(`evm_setNextBlockTimestamp`, at fixed offsets from the pin's head, `BLOCK_TIMES`), each transaction's nonce, gas
(anvil's estimate, itself deterministic), fee cap (1.2 times the block's base fee plus a one-gwei tip, `maxFeePerGas`)
and type (EIP-1559) are fixed, and every signature is RFC 6979 over a fixed hash with anvil's public test keys (derived
from Foundry's `test test ... junk` mnemonic, `TEST_MNEMONIC`; no other key is ever used). anvil derives each block's
`prevrandao` from the block, not at random.

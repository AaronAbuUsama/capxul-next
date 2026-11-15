# @capxul/generate

`pnpm generate` writes every file derived from another fact's owner, so nothing is typed twice (AGENTS.md, "Who owns
each fact"; roadmap step 3.1). Each generated file says so in its first line and is never edited: change its owner and
generate again. `pnpm generate:check`, in CI's `check` job, fails when generating again changes any file.

| Output | Its owner | Imported by |
|---|---|---|
| `packages/contracts/generated/abi.ts`: one `as const` ABI per contract or interface listed in `src/sources.ts` | The compiled contracts (`forge build`'s `out/`), outside contracts declared as interfaces in `packages/contracts/src/interfaces/external` | The blueprint (`Chain`'s logs and reads), Core (`src/chain/abi.ts`), the indexer (`abis.ts`), packages/world |
| `packages/contracts/generated/seeded.ts`: the seeded chain's addresses, tiers, last block and anvil's first account | `packages/contracts/deployments/devnet.json` and `state/core.json` | Core (`src/chain/seeded.ts`), packages/world (`src/chain/contracts.ts`, `faucet.ts`) |
| `packages/frappe-app/capxul/generated/site.py`: the site's names the Capxul app shares with the blueprint | `packages/blueprint/src/documents/site.ts` | The Capxul app (`canon.py`, `clock.py`, `hooks.py`, `setup.py`) |

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

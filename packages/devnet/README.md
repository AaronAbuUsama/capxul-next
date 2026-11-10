# @capxul/devnet

The local chain's tools: deploy and verify the v4 contracts, run the proof, and build the seeded state. Modules:

| Module | What |
|---|---|
| `chain` | the one port to a chain (viem) |
| `test-keys` | Anvil's published test keys, by role |
| `protocol` | Companies House, its Roles roles, and the 15 contracts deployed through it (the small version of the old `packages/tools` `companies-house apply` and `protocol deploy|verify`) |
| `proof` | the company-life proof that `packages/contracts/bin/prove-core.sh` runs |
| `chain-state` | builds the seeded state's pin from what a recording run touched |

`src/main.ts` is the composition root and the only place that reads the environment, files and argv, and prints:
`deploy`, `verify`, `prove`, `seed-pin`. Run with `node --experimental-strip-types`. Anvil's published test keys only. `pnpm devnet:test`
runs the module tests (12).

# @capxul/devnet

The local chain's tools: deploy and verify the v4 contracts, run the proof, and build the seeded state. Modules:

| Module | What |
|---|---|
| `chain` | the one port to a chain (viem) |
| `test-keys` | Anvil's published test keys, by role |
| `protocol` | Companies House, its Roles roles, and the 15 contracts deployed through it (the small version of the old `packages/tools` `companies-house apply` and `protocol deploy|verify`) |
| `company` | a company's life on the real v4 contracts as functions: born under Companies House with its authority installed, departments, hats, budgets, and a wearer's payment with a document hash, refusals named in the blueprint's words. What the test sites' Core calls in place of the stand-in chain (plan task `m2-contracts-under-sites`); its test runs against the seeded chain when `DEVNET_RPC` is set |
| `proof` | the company-life proof that `packages/contracts/bin/prove-core.sh` runs |
| `chain-state` | builds the seeded state's pin from what a recording run touched |

`src/main.ts` is the composition root and the only place that reads the environment, files and argv, and prints:
`deploy`, `verify`, `prove`, `seed-pin`. Run with `node --experimental-strip-types`. Anvil's published test keys only. `pnpm devnet:test`
runs the module tests. `cloud/` makes a Claude cloud container able to run all of this (see its README).

# chain-state

Builds the seeded chain state's pin: an Anvil `--init` genesis whose head is Base Sepolia block 47,893,251 and which holds
only the third-party contracts (and their touched storage) that the fork tests and the deployment use. A recording run with
the network says what was touched (the forge fork cache, an Anvil fork's state dump); `readPinned` reads exactly those at
the block; `genesisOf` writes the genesis. `bin/seed-state.sh` in `packages/contracts` runs the whole recipe.

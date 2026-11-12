# devnet/cloud

How a Claude cloud container runs the product stack with no Mac: the seeded v4 chain, the contracts' proof, and the
spike's Frappe test sites with their end-to-end script. Found and first used on 11 November 2026
(`docs/mission/reassessment-2026-11-11.md`).

```bash
source packages/devnet/cloud/setup.sh
pnpm contracts:prove                                   # forge build (slow with solc-js), then the 18 steps
FOUNDRY_SOLC=$CAPXUL_SOLC_0824 spikes/skeleton/run.sh <slug>   # the spike's stand-in contracts pin solc 0.8.24
```

| File | What |
|---|---|
| `setup.sh` | Installs Foundry from npm, solc-js 0.8.28 and 0.8.24 behind `solc-js.cjs`, starts Docker, and exports `PATH`, `FOUNDRY_SOLC` and `COMPOSE_FILE` |
| `solc-js.cjs` | A native-looking `solc` for forge: answers `--version`, and compiles forge's standard-JSON job in chunks, one process each, because solc-js runs out of wasm memory on 500 files at once. Source ids are renumbered, so source maps (traces, coverage) are approximate; bytecode is the compiler's own |
| `amp` | A stand-in for `amp orb service start/stop/logs`, which the slice-zero supervisor uses to run Anvil, Ponder, Core, Alto, the site service and the ingress; each runs detached, with its pid and log under `var/amp-shim` |
| `compose.cloud.yml` | An override for `spikes/skeleton/frappe/compose.yml`: the bench shares the host network so it can reach the agent proxy, trusts the proxy's CA, and reaches MariaDB and Redis on published local ports |

The first forge build of `packages/contracts` takes much longer than with native solc; later builds use forge's cache.
The first Frappe bench build takes about five minutes here.

## Slice zero in a cloud container

```bash
source packages/devnet/cloud/setup.sh && source packages/devnet/orb/env.sh && unset COMPOSE_FILE COMPOSE_PROJECT_NAME
CAPXUL_BUILD_CA=/root/.ccr/ca-bundle.crt packages/bench-image/bin/build.sh capxul-bench:orb   # about 8 minutes cold
(cd packages/contracts && forge build src test/mocks/MockERC20.sol test/mocks/MockPaymaster.sol --offline)
node --experimental-strip-types packages/cli/src/main.ts world init s1 --config var/worlds/s1.json      # at a committed tree
node --experimental-strip-types packages/cli/src/main.ts world create --config var/worlds/s1.json       # about 70 s
node --experimental-strip-types packages/cli/src/main.ts world run slice-zero --config var/worlds/s1.json --json
```

A world is tied to the commit it was created at: after a new commit, create a new world.

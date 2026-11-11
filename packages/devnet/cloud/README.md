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
| `compose.cloud.yml` | An override for `spikes/skeleton/frappe/compose.yml`: the bench shares the host network so it can reach the agent proxy, trusts the proxy's CA, and reaches MariaDB and Redis on published local ports |

The first forge build of `packages/contracts` takes much longer than with native solc; later builds use forge's cache.
The first Frappe bench build takes about five minutes here.

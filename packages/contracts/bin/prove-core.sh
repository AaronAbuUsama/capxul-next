#!/usr/bin/env bash
# The proof of Capxul Core, from the seeded state and keys only (no browser, no outside service, no network): starts the
# chain with the v4 contracts already deployed, runs the company's life against it, prints PASS or FAIL per step, stops
# the chain. Exit status is 0 only when every step passed.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$(cd ../.. && pwd)"
[ -d out/Installer.sol ] || forge build >/dev/null
bin/chain-up.sh core
trap 'bin/chain-down.sh' EXIT
node --experimental-strip-types --no-warnings "$root/packages/devnet/src/main.ts" prove \
  --rpc "http://127.0.0.1:${CHAIN_PORT:-18545}" --deployments deployments/devnet.json

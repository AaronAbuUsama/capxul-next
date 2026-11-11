#!/usr/bin/env bash
# Runs the fork and scenario tests from the seeded state: an Anvil serves Base Sepolia's pinned block 47,893,251 from
# state/pin.genesis.json, forge forks that, and nothing leaves the machine. forge's RPC cache is off, so no earlier
# network run can stand in for the state. Extra arguments go to forge test (for example --match-test).
set -euo pipefail
cd "$(dirname "$0")/.."
port="${CHAIN_PORT:-18545}"
bin/chain-up.sh pin
trap 'bin/chain-down.sh' EXIT
BASE_SEPOLIA_FORK_URL="http://127.0.0.1:$port" FOUNDRY_PROFILE=fork forge test --no-storage-caching "$@"

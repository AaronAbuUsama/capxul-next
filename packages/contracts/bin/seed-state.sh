#!/usr/bin/env bash
# Rebuilds the seeded chain state (state/pin.genesis.json and state/core.json) from Base Sepolia at the pinned block.
# NEEDS THE NETWORK for stages 1 and 2 only; stage 3 and everything after run offline. Run it when the contracts change
# (core.json holds their compiled code) or the pin moves. Prints the checksums to commit in state/CHECKSUMS.
#
#   1. record: an Anvil fork at the pin runs the deployment and the proof, and the forge fork and scenario tests run once
#              against the real endpoint; both leave a list of the accounts and storage slots they touched.
#   2. pin:    those touched contracts are read at the pin and written as an Anvil genesis whose head is the pin block.
#   3. core:   an Anvil started from that genesis (no network) is given the v4 deployment, and its state is dumped.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$(cd ../.. && pwd)"
port="${CHAIN_PORT:-18545}"
upstream="${BASE_SEPOLIA_FORK_URL:-https://sepolia.base.org}"
block=47893251
rec=".chain/recordings"
main="node --experimental-strip-types --no-warnings $root/packages/devnet/src/main.ts"
mkdir -p "$rec" state
forge build >/dev/null

echo "== 1. record (network)"
anvil --fork-url "$upstream" --fork-block-number "$block" --port "$port" --silent >"$rec/anvil-fork.log" 2>&1 &
fork=$!
trap 'kill $fork 2>/dev/null || true; bin/chain-down.sh >/dev/null' EXIT
for _ in $(seq 1 100); do cast chain-id --rpc-url "http://127.0.0.1:$port" >/dev/null 2>&1 && break; sleep 0.3; done
$main deploy --rpc "http://127.0.0.1:$port" --out "$rec/fork-deployments.json" >/dev/null
$main prove --rpc "http://127.0.0.1:$port" --deployments "$rec/fork-deployments.json" >/dev/null
cast rpc anvil_dumpState --rpc-url "http://127.0.0.1:$port" | tr -d '"' | sed 's/^0x//' | xxd -r -p | gunzip >"$rec/fork-dump.json"
kill $fork; wait $fork 2>/dev/null || true
# A throwaway HOME gives forge an empty RPC cache, so the cache that results holds exactly what the tests touched.
scratch_home="$(mktemp -d)"
HOME="$scratch_home" FOUNDRY_PROFILE=fork forge test >"$rec/forge-fork.log" 2>&1 || { tail -5 "$rec/forge-fork.log"; exit 1; }
zstd -dc "$scratch_home/.foundry/cache/rpc/base-sepolia/$block" >"$rec/forge-cache.json"
rm -rf "$scratch_home"

echo "== 2. pin (network)"
$main seed-pin --upstream "$upstream" --block "$block" --forge-cache "$rec/forge-cache.json" --anvil-dump "$rec/fork-dump.json" --out state/pin.genesis.json

echo "== 3. core (offline)"
bin/chain-up.sh pin
$main deploy --rpc "http://127.0.0.1:$port" --out deployments/devnet.json
cast rpc anvil_dumpState --rpc-url "http://127.0.0.1:$port" | tr -d '"' | sed 's/^0x//' | xxd -r -p | gunzip >state/core.json
bin/chain-down.sh
trap - EXIT
(cd state && shasum -a 256 pin.genesis.json core.json | tee CHECKSUMS)
echo "state rebuilt: commit state/ and deployments/devnet.json"

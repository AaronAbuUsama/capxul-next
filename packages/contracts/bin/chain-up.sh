#!/usr/bin/env bash
# Starts a local Anvil from the committed state, with no network. The port is CHAIN_PORT (default 18545, so it never
# meets the spike's 8545). Chain id 84532, as Base Sepolia.
#   bin/chain-up.sh        core: the v4 contracts deployed on the pinned third-party state (state/core.json)
#   bin/chain-up.sh pin    pin: only the third-party contracts, head at block 47,893,251 (state/pin.genesis.json);
#                          what the fork tests fork. Stop it with bin/chain-down.sh.
# The state is only read: nothing is written back, so a restart is always the seeded state.
set -euo pipefail
cd "$(dirname "$0")/.."
port="${CHAIN_PORT:-18545}"
mode="${1:-core}"
mkdir -p .chain
if [ -f ".chain/anvil-$port.pid" ] && kill -0 "$(cat ".chain/anvil-$port.pid")" 2>/dev/null; then
  echo "a chain is already running on port $port (pid $(cat ".chain/anvil-$port.pid")); run bin/chain-down.sh first" >&2
  exit 1
fi
case "$mode" in
  core) state=(--load-state state/core.json) ;;
  pin) state=(--init state/pin.genesis.json) ;;
  *) echo "usage: bin/chain-up.sh [core|pin]" >&2; exit 2 ;;
esac
anvil --port "$port" --chain-id 84532 --silent "${state[@]}" >".chain/anvil-$port.log" 2>&1 &
echo $! >".chain/anvil-$port.pid"
for _ in $(seq 1 50); do
  if cast chain-id --rpc-url "http://127.0.0.1:$port" >/dev/null 2>&1; then
    echo "chain ($mode) up on http://127.0.0.1:$port, block $(cast block-number --rpc-url "http://127.0.0.1:$port")"
    exit 0
  fi
  sleep 0.2
done
echo "the chain did not come up; see .chain/anvil-$port.log" >&2
exit 1

#!/usr/bin/env bash
# Start anvil in the background (if not already up) on the real v4 contracts, deploy the world's test token (if not
# already deployed on this chain), and write the addresses to $STATE_DIR/deployment.json. Safe to re-run.
set -euo pipefail
CORE="$(cd "$(dirname "$0")/.." && pwd)"
export STATE_DIR="${STATE_DIR:-$CORE/state}"
PORT="${ANVIL_PORT:-8545}"
export RPC_URL="${RPC_URL:-http://127.0.0.1:$PORT}"
export DEPLOYMENT_FILE="${DEPLOYMENT_FILE:-$STATE_DIR/deployment.json}"
mkdir -p "$STATE_DIR"

rpc() { curl -s -m 3 -X POST -H 'content-type: application/json' --data "$1" "$RPC_URL"; }

if rpc '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q '"result"'; then
  echo "anvil already running at $RPC_URL"
else
  echo "starting anvil on port $PORT"
  # a new world starts from packages/contracts' seeded state (Companies House and the 15 v4
  # contracts already deployed, chain id 84532); after that, the world's own state file
  [ -f "$STATE_DIR/anvil-state.json" ] || cp "$CORE/../../../packages/contracts/state/core.json" "$STATE_DIR/anvil-state.json"
  # Keep blocks and historical state across a clean stop for Ponder and recovery.
  if [ "${AMP_ORB:-}" = 1 ]; then
    printf -v command 'exec anvil --port %q --chain-id 84532 --state %q --preserve-historical-states' "$PORT" "$STATE_DIR/anvil-state.json"
    amp orb service start "capxul-chain-${CAPXUL_WORLD:-main}" --cwd "$CORE" --port "$PORT" --command "$command"
  else
    nohup anvil --port "$PORT" --chain-id 84532 --state "$STATE_DIR/anvil-state.json" --preserve-historical-states >"$STATE_DIR/anvil.log" 2>&1 &
    echo $! >"$STATE_DIR/anvil.pid"
  fi
  for _ in $(seq 1 50); do
    rpc '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q '"result"' && break
    sleep 0.2
  done
  rpc '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q '"result"' || { echo "anvil did not start, see $STATE_DIR/anvil.log" >&2; exit 1; }
fi

has_code() { rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$1\",\"latest\"]}" | grep -vq '"result":"0x"'; }

# the contracts are in the state; only the world's test token is deployed
if [ -f "$DEPLOYMENT_FILE" ] && [ "$(node -p "require('$DEPLOYMENT_FILE').mode")" = v4 ] && has_code "$(node -p "require('$DEPLOYMENT_FILE').usdc")"; then
  echo "v4 world already set up (see $DEPLOYMENT_FILE)"
else
  rm -f "$STATE_DIR"/outbox.json "$STATE_DIR"/cursor.json "$STATE_DIR"/approvals.json "$STATE_DIR"/v4-orgs.json
  (cd "$CORE" && node --experimental-strip-types --no-warnings src/deploy-v4.ts)
fi
# The selected indexer admits only trees from this Installer. Upgrade retained manifests
# without redeploying their test token or discarding a world's registry.
node --input-type=module - "$DEPLOYMENT_FILE" "$CORE/../../../packages/contracts/deployments/devnet.json" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const [file, seedFile] = process.argv.slice(2);
const deployment = JSON.parse(readFileSync(file, "utf8"));
if (!deployment.installer) {
  deployment.installer = JSON.parse(readFileSync(seedFile, "utf8")).contracts.Installer.address;
  writeFileSync(file, JSON.stringify(deployment, null, 2));
}
JS

#!/usr/bin/env bash
# Start anvil in the background (if not already up), build + deploy the STAND-IN contracts (if not already
# deployed on this chain), and write the addresses to $STATE_DIR/deployment.json. Safe to re-run.
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
  # --state keeps the chain across a clean stop (down.sh sends SIGTERM, anvil dumps state on exit)
  nohup anvil --port "$PORT" --state "$STATE_DIR/anvil-state.json" >"$STATE_DIR/anvil.log" 2>&1 &
  echo $! >"$STATE_DIR/anvil.pid"
  for _ in $(seq 1 50); do
    rpc '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q '"result"' && break
    sleep 0.2
  done
  rpc '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q '"result"' || { echo "anvil did not start, see $STATE_DIR/anvil.log" >&2; exit 1; }
fi

has_code() { rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$1\",\"latest\"]}" | grep -vq '"result":"0x"'; }

if [ -f "$DEPLOYMENT_FILE" ]; then
  PAY="$(node -p "require('$DEPLOYMENT_FILE').payments")"
  if has_code "$PAY"; then echo "contracts already deployed (see $DEPLOYMENT_FILE)"; exit 0; fi
  echo "deployment.json is stale (chain was reset): redeploying and clearing Core's chain-derived state"
  rm -f "$STATE_DIR"/outbox.json "$STATE_DIR"/cursor.json "$STATE_DIR"/approvals.json
fi

(cd "$CORE" && forge build --silent >/dev/null)
(cd "$CORE" && node --experimental-strip-types --no-warnings src/deploy.ts)

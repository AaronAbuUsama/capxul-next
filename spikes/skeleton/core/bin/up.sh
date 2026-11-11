#!/usr/bin/env bash
# Start anvil + contracts + the Core stub in the background. Safe to re-run.
set -euo pipefail
CORE="$(cd "$(dirname "$0")/.." && pwd)"
export STATE_DIR="${STATE_DIR:-$CORE/state}"
PORT="${CORE_PORT:-8787}"
"$CORE/bin/chain-up.sh"
if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then echo "Core stub already running on :$PORT"; exit 0; fi
export RPC_URL="${RPC_URL:-http://127.0.0.1:${ANVIL_PORT:-8545}}"
cd "$CORE"
nohup node --experimental-strip-types --no-warnings src/main.ts serve >>"$STATE_DIR/core.log" 2>&1 &
echo $! >"$STATE_DIR/core.pid"
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && { echo "Core stub up on :$PORT (log: $STATE_DIR/core.log)"; exit 0; }; sleep 0.2; done
echo "Core stub did not start, see $STATE_DIR/core.log" >&2; exit 1

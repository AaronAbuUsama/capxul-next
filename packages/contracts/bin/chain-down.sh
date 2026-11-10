#!/usr/bin/env bash
# Stops the Anvil that bin/chain-up.sh started on CHAIN_PORT (default 18545).
set -euo pipefail
cd "$(dirname "$0")/.."
port="${CHAIN_PORT:-18545}"
pidfile=".chain/anvil-$port.pid"
if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
  kill "$(cat "$pidfile")"
  echo "chain on port $port stopped"
fi
rm -f "$pidfile"

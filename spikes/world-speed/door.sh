#!/usr/bin/env bash
# One request to a packages/world world's door, without printing its token: ./door.sh <world> <METHOD> <path> [body]
# e.g. ./door.sh wsb2 GET /index/status    ./door.sh wsb2 POST /rpc '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}'
# The door's address is read once per world into .door-<world> (ignored by git, mode 600).
set -euo pipefail
cd "$(dirname "$0")"
world="$1" method="$2" path="$3" body="${4:-}"
cache=".door-$world"
if [ ! -s "$cache" ]; then
  (umask 077; ../../packages/world/run.sh show "$world" --reveal 2>/dev/null |
    python3 -c "import json,sys; print(json.load(sys.stdin)['rpcUrl'].rsplit('/rpc',1)[0])" >"$cache")
fi
base="$(cat "$cache")"
if [ -n "$body" ]; then
  curl -sS --max-time 300 -X "$method" -H 'content-type: application/json' --data-binary "$body" "$base$path"
else
  curl -sS --max-time 300 -X "$method" "$base$path"
fi

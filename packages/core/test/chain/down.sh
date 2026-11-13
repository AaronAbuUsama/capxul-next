#!/usr/bin/env bash
# Removes what up.sh made: its Anvil, its alto and its Postgres.
repo=$(cd "$(dirname "$0")/../../../.." && pwd)
[ -f "$repo/var/chainops-anvil.pid" ] && kill "$(cat "$repo/var/chainops-anvil.pid")" 2>/dev/null
rm -f "$repo/var/chainops-anvil.pid"
docker rm -f chainops-alto chainops-pg >/dev/null 2>&1
exit 0

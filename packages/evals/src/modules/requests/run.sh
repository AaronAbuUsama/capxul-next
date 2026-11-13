#!/usr/bin/env bash
set -euo pipefail
name=REQUESTS.component-pg
if [[ ${1:-} == --list ]]; then printf '%s\tcheck\n' "$name"; exit 0; fi
root=$(git rev-parse --show-toplevel)
start=$EPOCHREALTIME
result=pass
node --experimental-strip-types --no-warnings --test --test-concurrency=1 "$root/packages/backend/test/requests.pg.ts" || result=fail
elapsed=$(awk -v start="$start" -v end="$EPOCHREALTIME" 'BEGIN {printf "%.0f", (end-start)*1000}')
printf '@check\t%s\t%s\t%s\tReal PG component controls only; payment reader is injected, no selected-stack acceptance\n' "$name" "$result" "$elapsed"
[[ $result == pass ]]

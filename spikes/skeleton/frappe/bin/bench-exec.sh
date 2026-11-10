#!/usr/bin/env bash
# bench-exec.sh <site name or slug> <dotted.function> ['<python kwargs literal>']   runs it on the site, as bench does; prints its return value (last stdout line).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
site="${1%.localhost}.localhost"
inbench "bench --site $site execute $2 ${3:+--kwargs '$3'}" 2>/dev/null | tail -1

#!/usr/bin/env bash
# add-app.sh <app> <git url> <branch>: put an app on the bench (once per bench, not per site). Idempotent.
# `bench get-app` rewrites sites/apps.txt without `capxul` (it is a mounted directory, not a git checkout), so put it back.
set -euo pipefail
app="$1"; url="$2"; branch="$3"
. "$(dirname "$0")/lib.sh"
t0=$(date +%s)
if inbench "test -d apps/$app"; then echo "app $app is already on the bench" >&2
else inbench "bench get-app $app --branch $branch $url" >&2; fi
inbench "grep -qx capxul sites/apps.txt || printf '\ncapxul\n' >> sites/apps.txt; sed -i '/^\$/d' sites/apps.txt"
echo "added $app ($branch) to the bench in $(( $(date +%s) - t0 )) s" >&2

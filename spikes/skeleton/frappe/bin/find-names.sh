#!/usr/bin/env bash
# find-names.sh <slug> [admin email] [member email]
# Signs in as an admin-hat person and a member-hat person and lists every place the site still shows "Frappe" or "ERPNext" to a
# person (see find_names.py). Gives the member the `member` hat for the crawl and takes it away again if it was not theirs.
# Last line: FOUND shown=<n> internal=<n>
set -uo pipefail
slug="$1"; admin="${2:-hannah@acme.test}"; member="${3:-jonas@acme.test}"
HERE="$(cd "$(dirname "$0")" && pwd)"; CORE="node --experimental-strip-types --no-warnings $HERE/../../core/src/main.ts"
. "$HERE/lib.sh"
granted=0
roles="$(inbench "bench --site $slug.localhost execute capxul.features.roles_of --kwargs '{\"user\":\"$member\"}'" 2>/dev/null | tail -1)"
if ! grep -q Employee <<<"$roles"; then
  $CORE hat grant "$slug" member "$member" >/dev/null 2>&1 && granted=1
  for _ in $(seq 1 40); do roles="$(inbench "bench --site $slug.localhost execute capxul.features.roles_of --kwargs '{\"user\":\"$member\"}'" 2>/dev/null | tail -1)"; grep -q Employee <<<"$roles" && break; sleep 0.5; done
fi
python3 "$HERE/find_names.py" "$slug" "$admin" "$member"; rc=$?
[ "$granted" = 1 ] && $CORE hat revoke "$slug" member "$member" >/dev/null 2>&1
exit $rc

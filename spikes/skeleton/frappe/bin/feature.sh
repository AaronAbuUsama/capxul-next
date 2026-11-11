#!/usr/bin/env bash
# feature.sh <slug> list | on <feature> | off <feature>     (the stand-in for the site service)
# Last stdout line: {"site":"acme.localhost","features":{"accounts":"on",...}}. Refused: exit 3, the reason on stderr.
# On installs what is missing on that site (an app, its setup); off never deletes anything (see capxul/features.py).
set -euo pipefail
slug="$1"; action="$2"; feature="${3:-}"
. "$(dirname "$0")/lib.sh"
site="${SITE_NAME:-$slug.localhost}"
t0=$(date +%s); step() { echo "[$(( $(date +%s) - t0 ))s] $*" >&2; }
inbench "test -d sites/$site" || { echo "no site $site" >&2; exit 2; }
# `bench execute` prints the return value as the last line of stdout
run() { inbench "bench --site $site execute $1 ${2:+--kwargs '$2'}" 2>/dev/null | tail -1; }
emit() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(json.dumps({"site":sys.argv[2],"features":d.get("features",d)}))' "$1" "$site"; }
case "$action" in
  list) emit "$(run capxul.features.status)" ;;
  on|off)
    [ -n "$feature" ] || { echo "usage: feature.sh <slug> on|off <feature>" >&2; exit 2; }
    flag=$([ "$action" = on ] && echo True || echo False)
    pre="$(run capxul.features.precheck "{\"feature\":\"$feature\",\"on\":$flag}")"
    ok="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("ok"))' "$pre")"
    if [ "$ok" != True ]; then python3 -c 'import json,sys; print(json.loads(sys.argv[1])["reason"])' "$pre" >&2; exit 3; fi
    if [ "$action" = on ]; then
      app="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("app") or "")' "$pre")"
      has_app() { inbench "bench --site $site list-apps" 2>/dev/null | awk '{print $1}' | grep -x "$1" >/dev/null; }
      if [ -n "$app" ] && ! has_app "$app"; then
        step "installing $app on $site"; inbench "bench --site $site install-app $app" >&2 || true
        has_app "$app" || { echo "installing $app failed" >&2; exit 4; }
        [ "$app" = crm ] && run capxul.setup.configure_crm >/dev/null
        [ "$app" = frappe_whatsapp ] && inbench "bench --site $site execute crm.api.whatsapp.add_roles" >&2 || true
        run capxul.brand.apply >/dev/null   # the new app's strings say Capxul too
      fi
    fi
    step "switching $feature $action"
    out="$(run capxul.features.switch "{\"feature\":\"$feature\",\"on\":$flag,\"trace_id\":\"${TRACE_ID:-}\"}")"
    step "done"
    emit "$out" ;;
  *) echo "usage: feature.sh <slug> list | on <feature> | off <feature>" >&2; exit 2 ;;
esac

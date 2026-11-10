#!/usr/bin/env bash
# new-site-from-template.sh <slug> "<company name>" <safe address> <admin email>: the same contract as new-site.sh (last stdout line is the JSON),
# made by restoring the company template and then putting this company's name, Safe and sign-in settings in (capxul.setup.configure_site).
set -euo pipefail
slug="$1"; company="$2"; safe="$3"; admin="$4"
. "$(dirname "$0")/lib.sh"
site="${SITE_NAME:-$slug.localhost}"; tpl="${TEMPLATE_DIR:-$(cd "$(dirname "$0")" && pwd)/../../core/state/templates/site}"
# the site is already there (org create is idempotent): never restore over it; continue the way new-site.sh does
if inbench "test -d sites/$site"; then exec "$(dirname "$0")/new-site.sh" "$@"; fi
t0=$(date +%s); step() { echo "[$(( $(date +%s) - t0 ))s] $*" >&2; }
step "restoring the template into $site"
"$(dirname "$0")/site-restore.sh" "$site" "$tpl" >&2
inbench "bench --site $site set-config host_name 'http://$site:8000'" >&2
step "configuring company, Safe bank account, sign-in key, settings"
kwargs="$(python3 -c 'import json,sys; k=["slug","company_name","safe_address","admin_email","core_url","secret"]; print(json.dumps(dict(zip(k,sys.argv[1:]))))' \
  "$slug" "$company" "$safe" "$admin" "${CAPXUL_CORE_URL:-http://host.docker.internal:8787}" "$SECRET")"
inbench "bench --site $site execute capxul.setup.configure_site --kwargs '$kwargs'" >&2
inbench "bench --site $site execute capxul.clock.join_world --kwargs '{\"world\": \"${CAPXUL_WORLD:-main}\"}'" >&2
inbench "bench --site $site execute frappe.utils.scheduler.enable_scheduler" >&2
step "done"
printf '{"site":"%s","url":"http://%s:8000"}\n' "$site" "$site"

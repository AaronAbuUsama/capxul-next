#!/usr/bin/env bash
# new-site.sh <slug> "<company name>" <safe address> <admin email>
# Creates <slug>.localhost with ERPNext, HRMS and capxul; wizard, Company, Safe bank account, sign-in key,
# settings. Safe to re-run. Progress goes to stderr; the last stdout line is the JSON the contract wants.
set -euo pipefail
slug="$1"; company="$2"; safe="$3"; admin="$4"
. "$(dirname "$0")/lib.sh"
site="${SITE_NAME:-$slug.localhost}"
t0=$(date +%s); step() { echo "[$(( $(date +%s) - t0 ))s] $*" >&2; }

if ! inbench "test -d sites/$site" ; then
  step "creating site $site"
  inbench "bench new-site $site --db-root-password 123 --admin-password '$ADMIN_PASSWORD' --mariadb-user-host-login-scope='%'" >&2
else
  step "site $site exists; continuing"
fi
installed="$(inbench "bench --site $site list-apps" 2>/dev/null || true)"
for app in erpnext hrms crm capxul; do   # crm = Frappe CRM, on by default (bin/add-app.sh put it on the bench)
  if ! grep -q "^$app" <<<"$installed"; then step "installing $app"; inbench "bench --site $site install-app $app" >&2; fi
done
inbench "bench --site $site set-config host_name 'http://$site:8000'" >&2
step "configuring company, Safe bank account, sign-in key, settings"
kwargs="$(python3 -c 'import json,sys; k=["slug","company_name","safe_address","admin_email","core_url","secret"]; print(json.dumps(dict(zip(k,sys.argv[1:]))))' \
  "$slug" "$company" "$safe" "$admin" "${CAPXUL_CORE_URL:-http://host.docker.internal:8787}" "$SECRET")"
inbench "bench --site $site execute capxul.setup.configure_site --kwargs '$kwargs'" >&2
inbench "bench --site $site execute capxul.clock.join_world --kwargs '{\"world\": \"${CAPXUL_WORLD:-main}\"}'" >&2
step "done"
printf '{"site":"%s","url":"http://%s:8000"}\n' "$site" "$site"

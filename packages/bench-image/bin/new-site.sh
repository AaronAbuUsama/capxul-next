#!/usr/bin/env bash
# new-site.sh <site> ["<company name>"]: create a site on the running bench with every app Capxul supports (sites.features-reachability),
# runs the setup wizard for its one Company (as the site service does before configuring a company; capxul's
# migrate hooks need a site that has been set up), safe to re-run. Uses the site-admin container, the only one with the database root password. Prints the site's apps.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
site="$1"; company="${2:-Check Company}"
admin bash -c '
  set -e; site="$1"; company="$2"; scheme="$3"
  if [ ! -d "sites/$site" ]; then
    bench new-site "$site" --mariadb-user-host-login-scope="%" \
      --db-root-password "$MARIADB_ROOT_PASSWORD" --admin-password "$CAPXUL_ADMIN_PASSWORD"
  fi
  have="$(bench --site "$site" list-apps --format json)"
  for app in $(cat sites/apps.txt); do
    grep -q "\"$app\"" <<<"$have" || bench --site "$site" install-app "$app"
  done
  kw="$(python3 -c "import json,sys; print(json.dumps(dict(company_name=sys.argv[1], currency=\"USD\", country=\"United Kingdom\")))" "$company")"
  bench --site "$site" execute capxul.setup.run_wizard --kwargs "$kw" >&2
  bench --site "$site" migrate >&2                 # every hook that runs on an image roll (names, privacy) runs now
  bench --site "$site" enable-scheduler >&2
  bench --site "$site" set-config host_name "$scheme://$site" >&2
  bench --site "$site" list-apps --format json
' _ "$site" "$company" "${CAPXUL_SITE_SCHEME:-http}"

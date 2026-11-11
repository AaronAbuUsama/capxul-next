#!/usr/bin/env bash
# site-restore.sh <site> <backup dir>: make the site if it does not exist, then restore bench's backup into it (database, files), keeping the
# backup's encryption key (the passwords stored in the database are encrypted with it). Does NOT rewrite names: see capxul.world.rewrite.
set -euo pipefail
site="$1"; dir="$2"; . "$(dirname "$0")/lib.sh"
t0=$(date +%s); step() { echo "[$(( $(date +%s) - t0 ))s] $*" >&2; }
inbench "rm -rf /tmp/rs-$site && mkdir -p /tmp/rs-$site"
(cd "$FRAPPE_DIR" && docker compose cp "$dir/." "bench:/tmp/rs-$site") >&2
if ! inbench "test -d sites/$site"; then
  # the fast way to an empty site: its database, its user and a site_config.json, and nothing else (bench new-site would also install the
  # framework's schema, about 25 s, which the restore then replaces). Falls back to bench new-site if this does not work.
  step "making the empty site $site"
  d="_$(printf %s "$site" | shasum | cut -c1-16)"; pw="$(openssl rand -hex 8)"
  if inbench "mariadb -h mariadb -uroot -p123 -e \"CREATE DATABASE IF NOT EXISTS \\\`$d\\\`; CREATE USER IF NOT EXISTS '$d'@'%' IDENTIFIED BY '$pw'; ALTER USER '$d'@'%' IDENTIFIED BY '$pw'; GRANT ALL ON \\\`$d\\\`.* TO '$d'@'%'; FLUSH PRIVILEGES;\" && mkdir -p sites/$site/private/backups sites/$site/private/files sites/$site/public/files sites/$site/locks sites/$site/logs && printf '{\"db_name\": \"$d\", \"db_password\": \"$pw\"}' > sites/$site/site_config.json" >&2; then :; else
    step "the fast way failed; using bench new-site"; inbench "rm -rf sites/$site"
    inbench "bench new-site $site --db-root-password 123 --admin-password '$ADMIN_PASSWORD' --mariadb-user-host-login-scope='%' --no-mariadb-socket" >&2
  fi
fi
db=$(inbench "ls /tmp/rs-$site/*-database.sql.gz | head -1" | tr -d '\r'); pub=$(inbench "ls /tmp/rs-$site/*-files.tar 2>/dev/null | grep -v private | head -1" | tr -d '\r' || true); prv=$(inbench "ls /tmp/rs-$site/*-private-files.tar 2>/dev/null | head -1" | tr -d '\r' || true)
step "restoring the database and files"
inbench "bench --site $site --force restore $db --db-root-password 123 ${pub:+--with-public-files $pub} ${prv:+--with-private-files $prv}" >&2
key=$(inbench "python3 -c \"import json,glob; print(json.load(open(glob.glob('/tmp/rs-$site/*site_config_backup.json')[0])).get('encryption_key',''))\"" | tr -d '\r')
[ -n "$key" ] && inbench "bench --site $site set-config encryption_key '$key'" >&2
inbench "bench --site $site clear-cache; rm -rf /tmp/rs-$site" >&2
step "done"

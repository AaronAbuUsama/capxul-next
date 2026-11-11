#!/usr/bin/env bash
# env.sh <dir>: make a bench secrets folder (mariadb.env, bench.env), mode 0700/0600, with fresh random values.
# Refuses to overwrite a file that exists: secrets are made once and kept (the install-script pattern of compose.md).
set -euo pipefail
D="$1"; umask 077; mkdir -p "$D"; chmod 700 "$D"
rnd() { python3 -c 'import secrets; print(secrets.token_urlsafe(24))'; }
[ -e "$D/mariadb.env" ] || printf 'MARIADB_ROOT_PASSWORD=%s\n' "$(rnd)" > "$D/mariadb.env"
[ -e "$D/bench.env" ] || printf 'CAPXUL_ADMIN_PASSWORD=%s\n' "$(rnd)" > "$D/bench.env"
chmod 600 "$D"/*.env
echo "secrets in $D"

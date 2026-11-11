#!/usr/bin/env bash
# env.sh <dir>: make a bench secrets folder (mariadb.env, bench.env), mode 0700/0600, with fresh random values.
# Refuses to overwrite a file that exists and is not empty: secrets are made once and kept (the install-script pattern of compose.md).
set -euo pipefail
D="$1"; umask 077; mkdir -p "$D"; chmod 700 "$D"
rnd() { python3 -c 'import secrets; print(secrets.token_urlsafe(24))'; }
# an empty file (a write cut short, say by a full disk) counts as missing; a new file is written whole, then renamed
put() { [ -s "$D/$1" ] && return; printf '%s=%s\n' "$2" "$(rnd)" > "$D/.$1.tmp"; mv -f "$D/.$1.tmp" "$D/$1"; }
put mariadb.env MARIADB_ROOT_PASSWORD
put bench.env CAPXUL_ADMIN_PASSWORD
chmod 600 "$D"/*.env
echo "secrets in $D"

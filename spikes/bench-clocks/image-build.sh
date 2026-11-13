#!/usr/bin/env bash
# Runs inside the image build (Containerfile): `init <url> <tag> <commit>` makes the bench, `erpnext <url> <commit>`
# adds ERPNext at its pinned commit, `app` installs the capxul app. No assets are built: the checks use the API only.
set -euo pipefail
if [ -s /run/secrets/build_ca ]; then
  export SSL_CERT_FILE=/run/secrets/build_ca REQUESTS_CA_BUNDLE=/run/secrets/build_ca CURL_CA_BUNDLE=/run/secrets/build_ca \
         NODE_EXTRA_CA_CERTS=/run/secrets/build_ca GIT_SSL_CAINFO=/run/secrets/build_ca PIP_CERT=/run/secrets/build_ca UV_NATIVE_TLS=1
fi
export PATH="$HOME/.local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null
B=/home/frappe/frappe-bench
case "$1" in
  init)
    bench init --frappe-path "$2" --frappe-branch "$3" --no-procfile --no-backups --skip-redis-config-generation --skip-assets "$B"
    got="$(git -C "$B/apps/frappe" rev-parse HEAD)"
    [ "$got" = "$4" ] || { echo "PIN MISMATCH: frappe is $got, pinned $4" >&2; exit 1; }
    rm -rf "$HOME/.cache"
    ;;
  erpnext)
    cd "$B"
    git init -q apps/erpnext
    git -C apps/erpnext fetch -q --depth 1 "$2" "$3"
    git -C apps/erpnext -c advice.detachedHead=false checkout -q FETCH_HEAD
    [ "$(git -C apps/erpnext rev-parse HEAD)" = "$3" ] || { echo "PIN MISMATCH: erpnext" >&2; exit 1; }
    uv pip install --quiet --python env/bin/python -e apps/erpnext
    rm -rf apps/erpnext/.git "$HOME/.cache"
    ;;
  app)
    cd "$B"
    find apps/capxul -name '__pycache__' -prune -exec rm -rf {} +
    uv pip install --quiet --python env/bin/python -e apps/capxul
    printf '%s\n' frappe erpnext capxul > sites/apps.txt
    echo '{}' > sites/common_site_config.json
    ;;
esac

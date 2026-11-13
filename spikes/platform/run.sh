#!/usr/bin/env bash
# Runs an alchemy command, or a Bun entry file, for the platform rehearsal. Nothing secret is printed.
# The Cloudflare key is never here: the session's network proxy adds it to requests for api.cloudflare.com, so the
# variable below only needs to be present. CI=true stops Alchemy from caching the state store's token on disk.
# Usage: ./run.sh deploy --stage pr-r1 --yes          (the platform, alchemy.run.ts)
#        ./run.sh deploy -c world.run.ts --stage pr-acme --yes   (a world on it)
#        ./run.sh bun src/run-drift.ts pr-r1
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
cd "$HERE"
cf() { curl -sS --max-time 20 "https://api.cloudflare.com/client/v4/$1"; }
export CI=true CLOUDFLARE_API_TOKEN=proxy-injected
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(cf 'accounts?per_page=5' | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")}"
export PLATFORM_ZONE_NAME="${PLATFORM_ZONE_NAME:-abuusama.dev}" PLATFORM_DOMAIN="${PLATFORM_DOMAIN:-worlds.abuusama.dev}"
export PLATFORM_ZONE_ID="${PLATFORM_ZONE_ID:-$(cf "zones?name=$PLATFORM_ZONE_NAME" | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")}"
# The platform's host. Unset: this machine's engine. Another machine: PLATFORM_DOCKER_HOST=ssh://deploy@<host>.
export PLATFORM_DOCKER_HOST="${PLATFORM_DOCKER_HOST:-unix:///var/run/docker.sock}"

# The bench's pins, from their one owner.
LOCK="$ROOT/packages/bench-image/apps.lock.json"
pin() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {"d": d}))' "$LOCK" "$1"; }
export PIN_BUILD_IMAGE="$(pin 'd["base"]["build"]')" PIN_FRAPPE_URL="$(pin 'd["frappe"]["url"]')" \
  PIN_FRAPPE_TAG="$(pin 'd["frappe"]["tag"]')" PIN_FRAPPE_COMMIT="$(pin 'd["frappe"]["commit"]')" \
  PIN_ERPNEXT_URL="$(pin 'd["apps"][0]["url"]')" PIN_ERPNEXT_COMMIT="$(pin 'd["apps"][0]["commit"]')"
export PLATFORM_FRAPPE_APP_DIR="$ROOT/packages/frappe-app"

# Behind a TLS-inspecting proxy the image build needs the proxy and its CA (a certificate, not a secret).
if [ -n "${HTTPS_PROXY:-}" ]; then export PLATFORM_BUILD_PROXY="$HTTPS_PROXY"; fi
CA="${CAPXUL_BUILD_CA:-/root/.ccr/ca-bundle.crt}"
if [ -n "${PLATFORM_BUILD_PROXY:-}" ] && [ -s "$CA" ]; then export PLATFORM_BUILD_CA="$CA"; fi

# The door's signing key: made once per checkout, kept out of git (var/ is ignored), never printed.
mkdir -p "$ROOT/var/platform"
KEY="$ROOT/var/platform/door.key"
[ -s "$KEY" ] || (umask 077; python3 -c "import secrets; print(secrets.token_hex(32))" >"$KEY")
export PLATFORM_DOOR_KEY="$(cat "$KEY")"

if [ "${1:-}" = "bun" ]; then shift; exec bun "$@"; fi
exec bun node_modules/alchemy/bin/cli.js "$@"

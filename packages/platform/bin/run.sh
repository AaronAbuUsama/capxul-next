#!/usr/bin/env bash
# Runs an alchemy command, or a Bun entry file, for the platform, with its settings. Nothing secret is printed.
#   bin/run.sh deploy --stage pr-x1 --yes                    the platform (alchemy.run.ts)
#   bin/run.sh deploy -c host.run.ts --stage staging --yes   the bench host on AWS (CI only)
#   bin/run.sh bun src/run-drift.ts pr-x1 [record.json]      the drift check: 0 clean, 2 drifted, 1 failed
#   bin/run.sh bun src/run-mint.ts pr-x1 acme 1 <expires> <file>
#
# Keys: in CI, CLOUDFLARE_API_TOKEN (and, with PLATFORM_HOST=aws, the AWS role's session) come from the job. In an
# agent's container the network proxy adds the Cloudflare key to requests for api.cloudflare.com, so the variable only
# needs to be present. CI=true stops Alchemy from asking questions and from caching the state store's token on disk.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
cd "$HERE"
cf() { curl -sS --fail-with-body --max-time 20 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/$1"; }
first() { python3 -c "import json,sys; r=json.load(sys.stdin)['result']; print(r[0]['id'] if r else '')"; }
export CI=true CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-proxy-injected}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(cf 'accounts?per_page=5' | first)}"
export PLATFORM_ZONE_NAME="${PLATFORM_ZONE_NAME:-abuusama.dev}" PLATFORM_DOMAIN="${PLATFORM_DOMAIN:-worlds.abuusama.dev}"
export PLATFORM_ZONE_ID="${PLATFORM_ZONE_ID:-$(cf "zones?name=$PLATFORM_ZONE_NAME" | first)}"
[ -n "$CLOUDFLARE_ACCOUNT_ID" ] && [ -n "$PLATFORM_ZONE_ID" ] || { echo "run.sh: no Cloudflare account or zone $PLATFORM_ZONE_NAME" >&2; exit 1; }

# The machine. standin: a Docker engine this machine reaches (PLATFORM_DOCKER_HOST, default its own). aws: the bench
# host, through the SSM forward bin/forward.sh opens on this machine's loopback.
export PLATFORM_HOST="${PLATFORM_HOST:-standin}"
if [ "$PLATFORM_HOST" = aws ]; then
  ENDPOINT="tcp://127.0.0.1:${PLATFORM_FORWARD_PORT:-23750}"
else
  export PLATFORM_DOCKER_HOST="${PLATFORM_DOCKER_HOST:-unix:///var/run/docker.sock}"; ENDPOINT="$PLATFORM_DOCKER_HOST"
fi

# The bench's pins, from their one owner.
LOCK="$ROOT/packages/bench-image/apps.lock.json"
pin() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {"d": d}))' "$LOCK" "$1"; }
PIN_BUILD_IMAGE="$(pin 'd["base"]["build"]')"; PIN_FRAPPE_URL="$(pin 'd["frappe"]["url"]')"
PIN_FRAPPE_TAG="$(pin 'd["frappe"]["tag"]')"; PIN_FRAPPE_COMMIT="$(pin 'd["frappe"]["commit"]')"
PIN_ERPNEXT_URL="$(pin 'd["apps"][0]["url"]')"; PIN_ERPNEXT_COMMIT="$(pin 'd["apps"][0]["commit"]')"
PIN_HRMS_URL="$(pin 'd["apps"][1]["url"]')"; PIN_HRMS_COMMIT="$(pin 'd["apps"][1]["commit"]')"
export PIN_BUILD_IMAGE PIN_FRAPPE_URL PIN_FRAPPE_TAG PIN_FRAPPE_COMMIT PIN_ERPNEXT_URL PIN_ERPNEXT_COMMIT PIN_HRMS_URL PIN_HRMS_COMMIT
export PLATFORM_FRAPPE_APP_DIR="$ROOT/packages/frappe-app"

# Behind a TLS-inspecting proxy the image build needs the proxy and its CA (a certificate, not a secret). On AWS the
# build runs on the bench host, which has plain egress, so neither is passed there.
if [ -n "${HTTPS_PROXY:-}" ] && [ "$PLATFORM_HOST" = standin ]; then export PLATFORM_BUILD_PROXY="$HTTPS_PROXY"; fi
CA="${CAPXUL_BUILD_CA:-/root/.ccr/ca-bundle.crt}"
if [ -n "${PLATFORM_BUILD_PROXY:-}" ] && [ -s "$CA" ]; then export PLATFORM_BUILD_CA="$CA"; fi

# The stage: --stage <s> for alchemy, the first argument for an entry file, or PLATFORM_STAGE.
STAGE="${PLATFORM_STAGE:-}"
prev=""; for a in "$@"; do [ "$prev" = --stage ] && STAGE="$a"; prev="$a"; done
if [ "${1:-}" = bun ] && [ -z "$STAGE" ]; then STAGE="${3:-}"; fi

# The stage's Docker context, exactly as src/host.ts declares it: it lives in ~/.docker, not in the shared state, so a
# fresh machine (every CI run) makes it before alchemy or the drift check reads it. Other entries do not need it.
NEEDS_CONTEXT=yes
if [ "${1:-}" = bun ] && [ "${2:-}" != src/run-drift.ts ]; then NEEDS_CONTEXT=no; fi
if [ "${1:-}" = state ]; then NEEDS_CONTEXT=no; fi
if [ -n "$STAGE" ] && [ "$NEEDS_CONTEXT" = yes ]; then
  CTX="cx-platform-$STAGE" DESC="Capxul platform, stage $STAGE"
  if ! docker context inspect "$CTX" >/dev/null 2>&1; then
    docker context create "$CTX" --description "$DESC" --docker "host=$ENDPOINT" >/dev/null 2>&1
  fi
fi

if [ "${1:-}" = bun ]; then shift; exec bun "$@"; fi
exec bun node_modules/alchemy/bin/cli.js "$@"

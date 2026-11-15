#!/usr/bin/env bash
# Runs the world command from an agent's container: ./run.sh create demo --owner me --lifetime "2 hours"
# The real keys are never here: the session's network proxy adds them to requests for the Cloudflare and Neon API
# hosts, so the variables below only need to be present. CI=true stops Alchemy from asking questions and from
# caching the state store's token on disk.
#   ./run.sh <world command...>     the world command line (src/cli/main.ts)
#   ./run.sh alchemy <args...>      an alchemy command for this stack that only reads: state list, drift, plan
set -euo pipefail
cd "$(dirname "$0")"
export CI=true
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-proxy-injected}" NEON_API_KEY="${NEON_API_KEY:-proxy-injected}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(curl -sS --max-time 20 'https://api.cloudflare.com/client/v4/accounts?per_page=5' | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")}"
export NEON_ORG_ID="${NEON_ORG_ID:-$(curl -sS --max-time 20 https://console.neon.tech/api/v2/users/me/organizations | python3 -c "import json,sys; print(json.load(sys.stdin)['organizations'][0]['id'])")}"
if [ "${1:-}" = "alchemy" ]; then shift; exec bun node_modules/alchemy/bin/cli.js "$@"; fi
exec bun src/cli/main.ts "$@"

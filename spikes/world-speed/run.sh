#!/usr/bin/env bash
# Runs an alchemy command for the hub from an agent's container: WS_MODE=fleet ./run.sh deploy --stage ws-fleet --yes
# The real keys are never here: the session's network proxy adds them to requests for the Cloudflare and Neon API
# hosts, so the variables below only need to be present. The hub's token is made once per checkout, kept in .env.hub
# (ignored by git), and never printed.
set -euo pipefail
cd "$(dirname "$0")"
export CI=true CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-proxy-injected}" NEON_API_KEY="${NEON_API_KEY:-proxy-injected}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(curl -sS --max-time 20 'https://api.cloudflare.com/client/v4/accounts?per_page=5' | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")}"
[ -f .env.hub ] || (umask 077; python3 -c "import secrets; print(secrets.token_hex(16))" >.env.hub)
export WS_HUB_TOKEN="$(cat .env.hub)"
exec bun node_modules/alchemy/bin/cli.js "$@"

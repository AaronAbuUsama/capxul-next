#!/usr/bin/env bash
# Runs an alchemy command for the containers spike from an agent's container.
# The real keys are never here: the session's network proxy adds them to requests for the two API hosts,
# so the variables below only need to be present. Usage: ./run.sh deploy --stage ct-w1 --yes
# Building a container image needs a Docker daemon; in an agent's container start one first (`dockerd &`).
set -euo pipefail
cd "$(dirname "$0")"
export CI=true CLOUDFLARE_API_TOKEN=proxy-injected NEON_API_KEY=proxy-injected
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(curl -sS --max-time 20 'https://api.cloudflare.com/client/v4/accounts?per_page=5' | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")}"
export NEON_ORG_ID="${NEON_ORG_ID:-$(curl -sS --max-time 20 https://console.neon.tech/api/v2/users/me/organizations | python3 -c "import json,sys; print(json.load(sys.stdin)['organizations'][0]['id'])")}"
# The door's token: made once per checkout, kept out of git, and never printed.
[ -f .env.door ] || (umask 077; python3 -c "import secrets; print(secrets.token_hex(16))" >.env.door)
export CT_DOOR_TOKEN="$(cat .env.door)"
exec bun node_modules/alchemy/bin/cli.js "$@"

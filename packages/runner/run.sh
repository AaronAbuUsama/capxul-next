#!/usr/bin/env bash
# Runs the runner from an agent's container, under Bun. The real keys are never here: the session's network proxy
# adds them to requests for the Cloudflare and Neon API hosts, so the two key variables only need to be present.
#
#   ./run.sh door                 call every blueprint operation once through a fresh Core stage
#   ./run.sh scenarios [name...]  run the registered scenarios (or those named), each in its own fresh stage
#   ./run.sh alchemy <args...>    an alchemy command for the CapxulCore stack, e.g. alchemy state list. Never nuke.
set -euo pipefail
cd "$(dirname "$0")"
export CI=true CLOUDFLARE_API_TOKEN=proxy-injected NEON_API_KEY=proxy-injected
export WORLD_OWNER="${WORLD_OWNER:-runner}"
# A fresh pair of door tokens for this run's stages: Core reads them at deploy, the runner's SDK sends them. They are
# test credentials of short-lived stages, never printed.
token() { python3 -c "import secrets; print(secrets.token_hex(24))"; }
export CAPXUL_DOOR_TOKEN="${CAPXUL_DOOR_TOKEN:-$(token)}" CAPXUL_PLATFORM_TOKEN="${CAPXUL_PLATFORM_TOKEN:-$(token)}"
account() { curl -sS --max-time 20 "$1" | python3 -c "$2"; }
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(account 'https://api.cloudflare.com/client/v4/accounts?per_page=5' "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")}"
export NEON_ORG_ID="${NEON_ORG_ID:-$(account https://console.neon.tech/api/v2/users/me/organizations "import json,sys; print(json.load(sys.stdin)['organizations'][0]['id'])")}"
case "${1:-}" in
  alchemy) shift; exec bun node_modules/alchemy/bin/cli.js "$@" ;;
  door|scenarios) exec bun src/main.ts "$@" ;;
  *) echo "usage: ./run.sh door | scenarios [name...] | alchemy <args...>" >&2; exit 2 ;;
esac

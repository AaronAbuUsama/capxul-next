#!/usr/bin/env bash
# Runs an alchemy command, or a Bun entry file, for the state spike from an agent's container.
# The real key is never here: the session's network proxy adds it to requests for api.cloudflare.com, so the
# variables below only need to be present. CI=true also stops Alchemy from caching the state store's token on disk.
# Usage: ./run.sh deploy --stage st-a --yes      ./run.sh bun src/run-sweep.ts
set -euo pipefail
cd "${SPIKE_DIR:-$(dirname "$0")}"
export CI=true CLOUDFLARE_API_TOKEN=proxy-injected
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(curl -sS --max-time 20 'https://api.cloudflare.com/client/v4/accounts?per_page=5' | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")}"
if [ "${1:-}" = "bun" ]; then shift; exec bun "$@"; fi
exec bun node_modules/alchemy/bin/cli.js "$@"

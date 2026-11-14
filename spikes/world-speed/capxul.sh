#!/usr/bin/env bash
# The Capxul command line (packages/cli) against the platform this machine serves (`world platform serve --port 8790`,
# signed in by WORLD_OWNER=spike with the token in .env.platform), and against a world's Core when CAPXUL_DOOR_URL
# and CAPXUL_DOOR_TOKEN are set. ./capxul.sh world show --world wsr
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export CAPXUL_PLATFORM_URL="${CAPXUL_PLATFORM_URL:-http://127.0.0.1:8790/platform}" CAPXUL_PLATFORM_TOKEN="$(cat "$here/.env.platform")"
cd "$here/../../packages/cli"
exec node --experimental-strip-types --no-warnings src/bin.ts "$@"

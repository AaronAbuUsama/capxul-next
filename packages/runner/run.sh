#!/usr/bin/env bash
# Runs the runner from an agent's container, under Bun. The real keys are never here: the session's network proxy
# adds them to requests for the Cloudflare and Neon API hosts, so the two key variables only need to be present.
#
#   ./run.sh door                 call every blueprint operation once through a fresh Core stage
#   ./run.sh door --world=<name>  the same, through the Core of a world `world create` made (packages/world)
#   ./run.sh chain --world=<name> the chain operations' journey through that world's Core (src/chain-journey.ts)
#   ./run.sh scenarios [--one-stage] [--expect=pass|not-implemented] [name...]
#                                 run the registered journeys (or those named): in private worlds, one world per journey;
#                                 or, with --expect=not-implemented, each in its own fresh stage of Core deployed with its
#                                 empty handlers (or all in one, --one-stage), and write their summary
#   ./run.sh scenarios --core=local [name...]
#                                 the same in private worlds, with every world's Core run here in workerd next to a
#                                 stand-in bench (WORLD_BENCH=<platform stage>): a rehearsal, labelled so in every record
#   ./run.sh alchemy <args...>    an alchemy command for the CapxulCore stack, e.g. alchemy state list. Never nuke.
set -euo pipefail
cd "$(dirname "$0")"
export CI=true CLOUDFLARE_API_TOKEN=proxy-injected NEON_API_KEY=proxy-injected
export WORLD_OWNER="${WORLD_OWNER:-runner}"
# A fresh pair of door tokens for this run's stages: Core reads them at deploy, the runner's SDK sends them. They are
# test credentials of short-lived stages, never printed.
token() { python3 -c "import secrets; print(secrets.token_hex(24))"; }
export CAPXUL_DOOR_TOKEN="${CAPXUL_DOOR_TOKEN:-$(token)}" CAPXUL_PLATFORM_TOKEN="${CAPXUL_PLATFORM_TOKEN:-$(token)}"
# The second operator's token (decisions.md, 37): the starting world `nothing` promises a second operator.
export CAPXUL_SECOND_PLATFORM_TOKEN="${CAPXUL_SECOND_PLATFORM_TOKEN:-$(token)}"
# The second operator's name: Core reads it at deploy beside the token, so the platform accepts the second operator.
export WORLD_SECOND_OWNER="${WORLD_SECOND_OWNER:-runner-2}"
account() { curl -sS --max-time 20 "$1" | python3 -c "$2"; }
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(account 'https://api.cloudflare.com/client/v4/accounts?per_page=5' "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")}"
export NEON_ORG_ID="${NEON_ORG_ID:-$(account https://console.neon.tech/api/v2/users/me/organizations "import json,sys; print(json.load(sys.stdin)['organizations'][0]['id'])")}"
# A local Core (--core=local) is served by the workerd Alchemy's local runtime pins.
export CAPXUL_WORKERD="${CAPXUL_WORKERD:-$(bun -e 'import w from "workerd"; console.log(w)')}"
# The disk guard: a run in private worlds with a bench fills the disk with sites and their backups; stop before it is
# full (RUNNER_MIN_FREE_GB, default 4).
free_gb() { df -Pk . | awk 'NR==2 { print int($4 / 1048576) }'; }
if [ "${1:-}" = scenarios ] || [ "${1:-}" = starting-worlds ]; then
  [ "$(free_gb)" -ge "${RUNNER_MIN_FREE_GB:-4}" ] || { echo "run.sh: only $(free_gb) GB free; at least ${RUNNER_MIN_FREE_GB:-4} needed" >&2; exit 2; }
fi
# A run that expects Core's empty handlers deploys its stages in Core's empty-handler mode (packages/core,
# src/empty-handlers.ts): every operation answers NotImplemented, whatever is built.
for arg in "$@"; do [ "$arg" = --expect=not-implemented ] && export CAPXUL_HANDLERS=empty; done
case "${1:-}" in
  alchemy) shift; exec bun node_modules/alchemy/bin/cli.js "$@" ;;
  door|chain|scenarios|starting-worlds) exec bun src/main.ts "$@" ;;
  *) echo "usage: ./run.sh door | scenarios [--one-stage] [--expect=pass|not-implemented] [name...] | alchemy <args...>" >&2; exit 2 ;;
esac

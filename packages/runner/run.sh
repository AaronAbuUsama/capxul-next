#!/usr/bin/env bash
# Runs the runner under Bun. In an agent's container the real keys are never here: the session's network proxy adds
# them to requests for the Cloudflare and Neon API hosts, so the two key variables only need to be present. In CI the
# job sets them to its real keys, which are kept as they are.
#
#   ./run.sh door                 call every blueprint operation once through a fresh Core stage
#   ./run.sh door --world=<name>  the same, through the Core of a world `world create` made (packages/world)
#   ./run.sh chain --world=<name> the chain operations' journey through that world's Core (src/chain-journey.ts)
#   ./run.sh scenarios [--one-stage] [--expect=pass|not-implemented] [name...]
#                                 run the registered journeys (or those named): in one world on the run's fleet hub
#                                 (WORLD_HUB, a fresh one by default, brought up and taken down), reset before each;
#                                 or, with --expect=not-implemented, each in its own fresh stage of Core deployed with its
#                                 empty handlers (or all in one, --one-stage), and write their summary
#   ./run.sh scenarios --via=cli [name...]
#                                 the same, every operation a journey calls made through the command line (packages/cli):
#                                 the `capxul` command that makes the call, run in this process (RUNNER_VIA=cli too)
#   ./run.sh scenarios --core=local [name...]
#                                 the same, with every world's Core run here in workerd next to a stand-in bench
#                                 (WORLD_BENCH=<platform stage>, or WORLD_BENCH=local with POOL_SECRETS for
#                                 packages/platform's bin/pool-bench.sh bench): a rehearsal, labelled so in every record
#   ./run.sh shared               make the shared world WORLD_SHARED (default `shared`) on its own hub, or renew it
#   ./run.sh scenarios --shared [name...]
#                                 the journeys on that shared world: each from its template snapshots, restored into a
#                                 world of the run; the shared world is never reset (src/shared/)
#   ./run.sh alchemy <args...>    an alchemy command for the CapxulCore stack, e.g. alchemy state list. Never nuke.
set -euo pipefail
cd "$(dirname "$0")"
export CI=true
# The code's revision, on every span this process exports (packages/platform, src/telemetry.ts).
export CODE_REVISION="${CODE_REVISION:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-proxy-injected}" NEON_API_KEY="${NEON_API_KEY:-proxy-injected}"
# The shared world (src/shared/) has an owner of its own, `staging`, and a hub of its own, `shared`.
shared=false
for arg in "$@"; do [ "$arg" = --shared ] && shared=true; done
[ "${1:-}" = shared ] && shared=true
if [ "$shared" = true ]; then
  export WORLD_OWNER="${WORLD_OWNER:-staging}" WORLD_SECOND_OWNER="${WORLD_SECOND_OWNER:-staging-2}" WORLD_HUB="${WORLD_HUB:-shared}"
fi
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
# A run in private worlds lives on its own fleet hub (src/worlds/hub.ts): a fresh one per run unless WORLD_HUB names
# one; a hub the run brings up it also takes down.
export WORLD_HUB="${WORLD_HUB:-rh-$(python3 -c "import secrets; print(secrets.token_hex(3))")}"
# WORLD_BENCH=<platform stage>: its site door is read from the shared state, `http://<stage>-door.<domain>`, plain HTTP
# through the tunnel (Cloudflare's free certificate covers one level only). In an agent's container the network proxy
# takes only CONNECT tunnels, and Bun sends plain HTTP through a proxy in absolute form, which it refuses: such runs set
# HTTP_PROXY to a small loopback forwarder (not in the repository) that carries each request through a CONNECT tunnel
# to port 80. CI needs nothing of this kind.
# WORLD_BENCH=local: packages/platform's bin/pool-bench.sh bench on this machine, not a platform stage. Its door's
# address and key (from its secrets file, never printed) are handed to packages/world (src/site/Bench.ts).
if [ "${WORLD_BENCH:-}" = local ]; then
  [ -s "${POOL_SECRETS:-}" ] || { echo "run.sh: WORLD_BENCH=local needs POOL_SECRETS, the pool bench's secrets file" >&2; exit 2; }
  export WORLD_BENCH_DOOR="${WORLD_BENCH_DOOR:-http://127.0.0.1:${POOL_DOOR_PORT:-18170}}"
  WORLD_BENCH_KEY="$(sed -n 's/^DOOR_KEY=//p' "$POOL_SECRETS")"; export WORLD_BENCH_KEY
fi
# The disk guard: a run in private worlds with a bench fills the disk with sites and their backups; stop before it is
# full (RUNNER_MIN_FREE_GB, default 4).
free_gb() { df -Pk . | awk 'NR==2 { print int($4 / 1048576) }'; }
if [ "${1:-}" = scenarios ] || [ "${1:-}" = starting-worlds ] || [ "${1:-}" = shared ]; then
  [ "$(free_gb)" -ge "${RUNNER_MIN_FREE_GB:-4}" ] || { echo "run.sh: only $(free_gb) GB free; at least ${RUNNER_MIN_FREE_GB:-4} needed" >&2; exit 2; }
fi
# A run that expects Core's empty handlers deploys its stages in Core's empty-handler mode (packages/core,
# src/empty-handlers.ts): every operation answers NotImplemented, whatever is built.
for arg in "$@"; do [ "$arg" = --expect=not-implemented ] && export CAPXUL_HANDLERS=empty; done
case "${1:-}" in
  alchemy) shift; exec bun node_modules/alchemy/bin/cli.js "$@" ;;
  door|chain|scenarios|starting-worlds|shared) exec bun src/main.ts "$@" ;;
  *) echo "usage: ./run.sh door | scenarios [--one-stage] [--expect=pass|not-implemented] [--shared] [--via=sdk|cli] [name...] | shared | alchemy <args...>" >&2; exit 2 ;;
esac

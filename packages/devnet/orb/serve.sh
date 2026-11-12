#!/usr/bin/env bash
# Amp supervises this foreground Compose session; no detached agent or loop host.
set -euo pipefail
. "$(dirname "$0")/env.sh"
cd "$ORB_ROOT"
sudo systemctl start docker
cleanup() {
  docker compose stop
  amp orb service stop capxul-chain-main
}
trap cleanup EXIT
# Only the real v4 chain, never the historical JSON-file Core server. The selected
# backend/indexer processes have their own startup and readiness contract.
spikes/skeleton/core/bin/chain-up.sh
docker compose up

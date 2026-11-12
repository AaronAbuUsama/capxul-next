#!/usr/bin/env bash
# Source this before direct eval/CLI commands; no credentials are fetched or persisted.
ORB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"
export COMPOSE_FILE="$ORB_ROOT/packages/devnet/orb/compose.yaml"
export COMPOSE_PROJECT_NAME=capxul-skeleton
# Dev-only migration authority. Core creates its restricted runtime role and supplies DATABASE_URL;
# never silently run the application with this admin connection instead.
export PG_ADMIN_URL=postgres://capxul_admin:capxul-local-admin@127.0.0.1:5432/capxul
export DATABASE_URL=postgres://capxul_core:capxul-local-core@127.0.0.1:5432/capxul
export WORKER_DATABASE_URL=postgres://capxul_worker:capxul-local-worker@127.0.0.1:5432/capxul
export PONDER_DATABASE_URL=postgres://capxul_ponder:capxul-local-ponder@127.0.0.1:5432/capxul
source "$ORB_ROOT/spikes/skeleton/.env" # committed, public local signing fixture
export CAPXUL_SECRET="$SKELETON_SECRET"
export CAPXUL_WORLD=main
export RPC_URL=http://127.0.0.1:8545
export CHAIN_ID=84532
export DEPLOYMENT_FILE="$ORB_ROOT/spikes/skeleton/core/state/deployment.json"
export ENTRY_POINT_ADDRESS=0x0000000071727De22E5E9d8BAf0edAc6f37da032
export CORE_URL=http://127.0.0.1:8787
export PONDER_URL=http://127.0.0.1:42069
export FRAPPE_URL=http://127.0.0.1:8000
export FRAPPE_SOCKET_URL=http://127.0.0.1:9000
export FINALITY_DEPTH=0 # Anvil acceptance only, never a production default

#!/usr/bin/env bash
# down.sh [--wipe]: stop the bench. --wipe also deletes the local data and secrets (refused unless they are under var/).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
dc --profile admin down --remove-orphans
if [ "${1:-}" = --wipe ]; then
  case "$CAPXUL_VOLUMES" in "$REPO_ROOT"/var/*) ;; *) echo "refusing to wipe $CAPXUL_VOLUMES: not under var/" >&2; exit 1;; esac
  docker run --rm -u 0 -v "$CAPXUL_VOLUMES:/v" -v "$CAPXUL_ENV_DIR:/e" alpine:3.20 sh -c 'rm -rf /v/* /e/*'
  echo "wiped $CAPXUL_VOLUMES and $CAPXUL_ENV_DIR"
fi

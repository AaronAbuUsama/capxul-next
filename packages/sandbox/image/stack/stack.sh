#!/usr/bin/env bash
# Starts Capxul's stack inside a stack box, from a lane checked out in it: the spike's Frappe sites (bench, MariaDB,
# Redis) through docker compose on the box's network. Safe to re-run. Run it from the lane: packages/sandbox/image/stack/stack.sh up|down|status
# The first `up` in a box with internet builds the bench (10-25 minutes); a box started from a prepared snapshot has it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; lane="$(git -C "$here" rev-parse --show-toplevel)"
export COMPOSE_FILE="compose.yml:$here/compose.box.yml"
frappe="$lane/spikes/skeleton/frappe"
case "${1:-up}" in
  up) docker info >/dev/null 2>&1 || { echo "dockerd is not running in this box" >&2; exit 1; }; "$frappe/bin/up.sh" ;;
  down) (cd "$frappe" && docker compose down) ;;
  status) (cd "$frappe" && docker compose ps) ;;
  *) echo "usage: stack.sh up|down|status" >&2; exit 2 ;;
esac

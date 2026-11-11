#!/usr/bin/env bash
# site-drop.sh <site>: drop a site and its database (no backup kept). Used to remove a world made from a snapshot.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
inbench "bench drop-site $1 --force --no-backup --db-root-password 123" >&2

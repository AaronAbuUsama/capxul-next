#!/usr/bin/env bash
# site-backup.sh <site> <out dir>: bench's own backup (database dump, public and private files, site_config) copied out of the container.
set -euo pipefail
site="$1"; out="$2"; . "$(dirname "$0")/lib.sh"
mkdir -p "$out"
inbench "rm -rf /tmp/bk-$site && bench --site $site backup --with-files --backup-path /tmp/bk-$site >&2"
cd "$FRAPPE_DIR" && docker compose cp "bench:/tmp/bk-$site/." "$out" >&2
inbench "rm -rf /tmp/bk-$site"
ls -1 "$out"

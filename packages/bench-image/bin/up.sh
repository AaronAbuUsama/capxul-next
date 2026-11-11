#!/usr/bin/env bash
# up.sh: start the bench (secrets and data folders made on first run). Returns when the frontend answers.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
[ -e "$CAPXUL_ENV_DIR/mariadb.env" ] || "$BENCH_DIR/bin/env.sh" "$CAPXUL_ENV_DIR"
for d in capxul-sites capxul-bench-logs capxul-mariadb-data capxul-redis-queue-data; do mkdir -p "$CAPXUL_VOLUMES/$d"; done
# the bench runs as uid 1000 (frappe), group 0; MariaDB and Redis set up their own folders
for d in capxul-sites capxul-bench-logs; do
  [ "$(stat -c %u "$CAPXUL_VOLUMES/$d")" = 1000 ] || docker run --rm -u 0 -v "$CAPXUL_VOLUMES/$d:/d" "$CAPXUL_BENCH_IMAGE" chown 1000:0 /d
done
dc up -d --wait --wait-timeout 300
echo "up: http://127.0.0.1:$CAPXUL_BENCH_PORT (the site is picked from the Host header)"

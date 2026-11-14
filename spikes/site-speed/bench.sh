#!/usr/bin/env bash
# A stand-in bench of its own for this spike, from the images packages/platform already built (no build here): the
# same containers src/bench.ts declares (MariaDB, Redis, door, web, worker, scheduler), named cx-sitespeed-*, so the
# platform's own stand-in stages are not touched. The door container runs no door: it is where this spike's
# harness (harness/) runs bench commands, as the door would.
#   ./bench.sh up | down | exec <cmd...> | sql <statement>
set -euo pipefail
P=cx-sitespeed
BENCH_IMAGE=${BENCH_IMAGE:-cx-platform-bench:pr-sr1}
DOOR_IMAGE=${DOOR_IMAGE:-cx-platform-door:pr-sr1}
HERE=$(cd "$(dirname "$0")" && pwd)
SECRETS=${SITESPEED_SECRETS:-/tmp/claude-0/-home-user/28910f0a-64fe-53a4-8a78-7fef9aca3143/scratchpad/sitespeed.env}
B=/home/frappe/frappe-bench
after_config='until grep -q redis_socketio sites/common_site_config.json; do sleep 1; done; exec'
case "${1:-}" in
  up)
    [ -s "$SECRETS" ] || { umask 077; echo "DB_ROOT_PASSWORD=$(openssl rand -hex 24)" > "$SECRETS"; }
    . "$SECRETS"
    docker network create $P >/dev/null
    docker volume create $P-db >/dev/null; docker volume create $P-sites >/dev/null
    docker run -d --name $P-mariadb --network $P --network-alias mariadb -e MARIADB_ROOT_PASSWORD="$DB_ROOT_PASSWORD" \
      -v $P-db:/var/lib/mysql public.ecr.aws/docker/library/mariadb:11.8 \
      --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --skip-character-set-client-handshake >/dev/null
    docker run -d --name $P-redis --network $P --network-alias redis public.ecr.aws/docker/library/redis:7.4-alpine >/dev/null
    until docker exec $P-mariadb healthcheck.sh --connect --innodb_initialized 2>/dev/null; do sleep 1; done
    docker run -d --name $P-door --network $P --network-alias door -e DB_ROOT_PASSWORD="$DB_ROOT_PASSWORD" \
      -v $P-sites:$B/sites -v "$HERE/harness:/opt/spike:ro" "$DOOR_IMAGE" bash -c \
      "cp apps.txt sites/apps.txt && bench set-config -g db_host mariadb && bench set-config -g redis_cache redis://redis:6379/0 && bench set-config -g redis_queue redis://redis:6379/1 && bench set-config -g redis_socketio redis://redis:6379/2 && bench set-config -gp developer_mode 0 && exec sleep infinity" >/dev/null
    docker run -d --name $P-web --network $P --network-alias web -v $P-sites:$B/sites "$BENCH_IMAGE" bash -c \
      "$after_config $B/env/bin/gunicorn --chdir=$B/sites --bind=0.0.0.0:8000 --workers=2 --threads=4 --worker-class=gthread --worker-tmp-dir=/dev/shm --timeout=120 --preload --access-logfile=- frappe.app:application" >/dev/null
    docker run -d --name $P-worker --network $P -v $P-sites:$B/sites "$BENCH_IMAGE" bash -c "$after_config bench worker --queue short,default,long" >/dev/null
    docker run -d --name $P-scheduler --network $P -v $P-sites:$B/sites "$BENCH_IMAGE" bash -c "$after_config bench schedule" >/dev/null
    docker ps --filter name=$P --format '{{.Names}} {{.Status}}'
    ;;
  down)
    docker rm -f $P-scheduler $P-worker $P-web $P-door $P-redis $P-mariadb 2>/dev/null || true
    docker volume rm $P-db $P-sites 2>/dev/null || true
    docker network rm $P 2>/dev/null || true
    rm -f "$SECRETS"
    ;;
  exec) shift; docker exec -i -w $B $P-door "$@" ;;
  sql) shift; . "$SECRETS"; docker exec -i -e MYSQL_PWD="$DB_ROOT_PASSWORD" $P-mariadb mariadb -uroot -N -e "$*" ;;
  *) echo "usage: $0 up|down|exec|sql" >&2; exit 64 ;;
esac

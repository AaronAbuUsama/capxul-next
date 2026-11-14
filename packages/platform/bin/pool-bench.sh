#!/usr/bin/env bash
# A local bench for proving the site pool (roadmap step 1.17), from the images the platform already built (nothing is
# built here): the containers src/bench.ts declares, with src/mariadb.ts's settings, named cx-sitepool-*, so no
# platform stage is touched. The door runs this checkout's door/ and every bench process this checkout's capxul app
# (both mounted read-only; the app is installed editable in the image), so what is proven is the code here.
#   bin/pool-bench.sh up | down | sql <statement> | logs
# The door listens on 127.0.0.1:$POOL_DOOR_PORT (default 18170). Its key and the database's root password are made at
# `up` and kept in $POOL_SECRETS (mode 600, outside the repository), never printed.
set -euo pipefail
P=cx-sitepool
BENCH_IMAGE=${BENCH_IMAGE:-cx-platform-bench:pr-sr1}
DOOR_IMAGE=${DOOR_IMAGE:-cx-platform-door:pr-sr1}
HERE=$(cd "$(dirname "$0")/.." && pwd)
APP=$(cd "$HERE/../frappe-app/capxul" && pwd)
SECRETS=${POOL_SECRETS:?POOL_SECRETS names a file outside the repository for the bench key and password}
PORT=${POOL_DOOR_PORT:-18170}
DOMAIN=${POOL_DOMAIN:-pool.test}
B=/home/frappe/frappe-bench
after_config='until grep -q redis_socketio sites/common_site_config.json; do sleep 1; done; exec'
mounts=(-v "$P-sites:$B/sites" -v "$APP:$B/apps/capxul/capxul:ro")
mariadb_flags() {
  # src/mariadb.ts's MARIADB_COMMAND, read from its one owner.
  node --experimental-strip-types --no-warnings -e \
    'import("'"$HERE"'/src/mariadb.ts").then((m) => console.log(m.MARIADB_COMMAND.join("\n")))'
}
case "${1:-}" in
  up)
    [ -s "$SECRETS" ] || { umask 077; printf 'DB_ROOT_PASSWORD=%s\nDOOR_KEY=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > "$SECRETS"; }
    . "$SECRETS"
    mapfile -t flags < <(mariadb_flags)
    docker network create $P >/dev/null
    docker volume create $P-db >/dev/null; docker volume create $P-sites >/dev/null
    docker run -d --name $P-mariadb --network $P --network-alias mariadb -e MARIADB_ROOT_PASSWORD="$DB_ROOT_PASSWORD" \
      -v $P-db:/var/lib/mysql public.ecr.aws/docker/library/mariadb:11.8 "${flags[@]}" >/dev/null
    docker run -d --name $P-redis --network $P --network-alias redis public.ecr.aws/docker/library/redis:7.4-alpine >/dev/null
    until docker exec $P-mariadb healthcheck.sh --connect --innodb_initialized 2>/dev/null; do sleep 1; done
    docker run -d --name $P-door --network $P --network-alias door -p "127.0.0.1:$PORT:8100" \
      -e DB_ROOT_PASSWORD="$DB_ROOT_PASSWORD" -e DOOR_KEY="$DOOR_KEY" -e PLATFORM_DOMAIN="$DOMAIN" \
      -e WEB_URL=http://web:8000 -e DOOR_POOL_SIZE="${DOOR_POOL_SIZE:-2}" \
      "${mounts[@]}" -v "$HERE/door:/opt/door:ro" "$DOOR_IMAGE" bash -c \
      "cp apps.txt sites/apps.txt && bench set-config -g db_host mariadb && bench set-config -g redis_cache redis://redis:6379/0 && bench set-config -g redis_queue redis://redis:6379/1 && bench set-config -g redis_socketio redis://redis:6379/2 && bench set-config -gp developer_mode 0 && exec env/bin/python -u /opt/door/door.py" >/dev/null
    docker run -d --name $P-web --network $P --network-alias web "${mounts[@]}" "$BENCH_IMAGE" bash -c \
      "$after_config $B/env/bin/gunicorn --chdir=$B/sites --bind=0.0.0.0:8000 --workers=2 --threads=4 --worker-class=gthread --worker-tmp-dir=/dev/shm --timeout=120 --preload --access-logfile=- frappe.app:application" >/dev/null
    docker run -d --name $P-worker --network $P "${mounts[@]}" "$BENCH_IMAGE" bash -c "$after_config bench worker --queue short,default,long" >/dev/null
    docker run -d --name $P-scheduler --network $P "${mounts[@]}" "$BENCH_IMAGE" bash -c "$after_config bench schedule" >/dev/null
    until curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do sleep 1; done
    docker ps --filter name=$P --format '{{.Names}} {{.Status}}'
    ;;
  restart-door) docker restart $P-door >/dev/null; until curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do sleep 1; done ;;
  down)
    docker rm -f $P-scheduler $P-worker $P-web $P-door $P-redis $P-mariadb 2>/dev/null || true
    docker volume rm $P-db $P-sites 2>/dev/null || true
    docker network rm $P 2>/dev/null || true
    rm -f "$SECRETS"
    ;;
  sql) shift; . "$SECRETS"; docker exec -i -e MYSQL_PWD="$DB_ROOT_PASSWORD" $P-mariadb mariadb -uroot -N -e "$*" ;;
  logs) docker logs --tail "${2:-80}" $P-door 2>&1 ;;
  *) echo "usage: $0 up|down|restart-door|sql|logs" >&2; exit 64 ;;
esac

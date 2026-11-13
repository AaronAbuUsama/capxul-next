#!/usr/bin/env bash
# run.sh [all | up | sites | checks | stats | down]: one bench, three sites in two worlds, each world at its own clock.
# `all` builds the image, starts the bench, creates the sites, runs every check (checks.sh), measures memory and removes
# everything it started. Nothing here touches a cloud account. The transcript goes to var/bench-clocks/run.log.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

up() {
  say "start the bench: MariaDB, Redis, web (gunicorn), worker, scheduler"
  dc up -d
  web_ready
  dc ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
}

new_site() {   # new_site <site> <world>: the steps of packages/bench-image/bin/new-site.sh, then the site joins its world
  local site="$1" world="$2" t0=$SECONDS
  b new-site "$site" --mariadb-user-host-login-scope="%" --db-root-password 123 --admin-password admin >/dev/null
  b --site "$site" install-app erpnext >/dev/null
  b --site "$site" install-app capxul >/dev/null
  b --site "$site" execute capxul.setup.run_wizard --kwargs '{"company_name":"Clock Co","currency":"USD","country":"United Kingdom"}' >/dev/null
  b --site "$site" migrate >/dev/null
  b --site "$site" enable-scheduler >/dev/null
  echo "joined world: $(capxul "$site" clock.join_world "{\"world\":\"$world\"}")"
  echo "site $site (world $world) created in $((SECONDS - t0)) s; capxul_world in its site_config.json: $(dc exec -T web python3 -c \
    'import json,sys; print(json.load(open(f"sites/{sys.argv[1]}/site_config.json")).get("capxul_world"))' "$site")"
}

sites() {
  say "1. one bench, three sites: two in world alpha, one in world beta"
  for s in "${ALPHA_SITES[@]}"; do new_site "$s" alpha; done
  for s in "${BETA_SITES[@]}"; do new_site "$s" beta; done
  echo "sites on the bench: $(dc exec -T web bash -c 'ls -d sites/*.localhost | xargs -n1 basename | tr "\n" " "')"
  echo "databases on the one MariaDB: $(dc exec -T mariadb mariadb -uroot -p123 -N -e 'select count(*) from information_schema.schemata where schema_name like "\_%"')"
}

stats() {
  say "7. memory of the bench with three sites (docker stats), after 60 more requests so the web process is warm"
  "$HERE/checks.sh" mixed >/dev/null
  docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' $(dc ps -q) | python3 -c '
import sys
unit, total = {"KiB": 1 / 1024, "MiB": 1, "GiB": 1024}, 0
for line in sys.stdin:   # one sample: name, used, "/", limit, cpu
    name, used, _, _, cpu = line.split()
    total += float(used[:-3]) * unit[used[-3:]]
    print(f"{name:26} {used:>10}  cpu {cpu}")
print(f"total: {total:.0f} MiB")'
}

down() {
  say "remove everything this run started"
  dc down --volumes --remove-orphans
  docker image rm bench-clocks:spike >/dev/null 2>&1 || true
  echo "containers of this project left: $(docker ps -a --filter label=com.docker.compose.project=bench-clocks -q | wc -l)"
  echo "volumes of this project left: $(docker volume ls --filter label=com.docker.compose.project=bench-clocks -q | wc -l)"
  echo "networks of this project left: $(docker network ls --filter label=com.docker.compose.project=bench-clocks -q | wc -l)"
}

all() {
  local t0=$SECONDS
  trap down EXIT
  "$HERE/build.sh"
  up; sites
  "$HERE/checks.sh" all
  stats
  say "total wall time: $((SECONDS - t0)) s (image build included)"
}

mkdir -p "$ROOT/var/bench-clocks"
case "${1:-all}" in
  all) all 2>&1 | tee "$ROOT/var/bench-clocks/run.log" ;;
  up | sites | stats | down) "$1" ;;
  checks) shift; "$HERE/checks.sh" "${@:-all}" ;;
  *) echo "usage: run.sh [all | up | sites | checks [step] | stats | down]" >&2; exit 2 ;;
esac

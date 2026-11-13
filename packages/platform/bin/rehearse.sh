#!/usr/bin/env bash
# rehearse.sh: the platform from nothing to nothing on a stand-in host (PLATFORM_HOST=standin, by default this machine's
# Docker engine), with no tunnel (PLATFORM_EDGE=none): an agent's container may not create one. Deploy the platform,
# deploy it again with no change, make a world's site with the world's token, break the platform by hand three ways and
# catch it, repair it, then destroy everything and show nothing is left. Each step writes its transcript to
# records/rehearsal/, and records/rehearsal/summary.json holds every step's duration, exit code and the exit code it
# should have. The destroy runs even when a step fails or the run is interrupted (roadmap, world lifecycle rule 1).
# Nothing secret is printed: tokens appear only as 8-digit prints, the door key never.
#   bin/rehearse.sh [stage]      (default pr-p1)
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; cd "$HERE" || exit 1
REC="$HERE/records/rehearsal"; VAR="$HERE/../../var/platform"; mkdir -p "$REC" "$VAR/tokens"; : >"$VAR/steps.jsonl"
# Declared timeouts (rule 6), in seconds.
T_DEPLOY=1800 T_SITE=900 T_DRIFT=300 T_DESTROY=900
export PLATFORM_STAGE="${1:-pr-p1}" PLATFORM_HOST=standin PLATFORM_EDGE=none
WORLD=acme QUOTA=1
NOW=$(date +%s); EXPIRES=$((NOW + 3 * 3600))
DOOR=http://127.0.0.1:${PLATFORM_DOOR_LOCAL_PORT:-18100} SITE="$WORLD-r1.${PLATFORM_DOMAIN:-worlds.abuusama.dev}"
CTX="cx-platform-$PLATFORM_STAGE" C="cx-platform-$PLATFORM_STAGE"

say() { printf '\n== %s (%s)\n' "$*" "$(date -u +%H:%M:%SZ)"; }
# timed <name> <timeout> <cmd...>: runs a command, prints its lines, records its duration and exit code, and the exit
# code the step should have (WANT, default 0: a drift check on a broken platform should exit 2).
timed() {
  local name="$1" limit="$2"; shift 2
  local t0; t0=$(date +%s.%N)
  ( "$@" ) </dev/null & local pid=$!
  ( sleep "$limit"; kill -TERM "$pid" ) 2>/dev/null & local dog=$!
  wait "$pid"; local code=$?
  pkill -P "$dog" 2>/dev/null; kill "$dog" 2>/dev/null; wait "$dog" 2>/dev/null
  local s; s=$(python3 -c "import sys; print(round(float(sys.argv[2]) - float(sys.argv[1]), 1))" "$t0" "$(date +%s.%N)")
  echo "-- $name: exit $code (want ${WANT:-0}) in $s s"
  printf '{"step":"%s","exit":%d,"want":%d,"seconds":%s}\n' "$name" "$code" "${WANT:-0}" "$s" >>"$VAR/steps.jsonl"
  return $code
}
alc() { bin/run.sh "$@" 2>&1 | grep -E 'INFO: (Plan|Done|Failed|\[)|ERROR' | grep -v '] noop$'; return "${PIPESTATUS[0]}"; }
door() { local path="$1"; shift; curl -sS --max-time "$T_SITE" "$@" "$DOOR$path"; echo; }
bearer() { echo "Authorization: Bearer $(cat "$VAR/tokens/$1.token")"; }
web() { docker --context "$CTX" exec "$C-web" curl -sS -H "Host: $1" "http://127.0.0.1:8000$2"; echo; }
inventory() {
  echo "containers: $(docker ps -a --filter name="$C-" --format '{{.Names}}={{.State}}' | sort | tr '\n' ' ')"
  echo "volumes: $(docker volume ls -q --filter name="$C-" | tr '\n' ' ')"
  echo "networks: $(docker network ls -q --filter name="$C" | wc -l)  images: $(docker images -q "cx-platform-*:$PLATFORM_STAGE" | wc -l)  context: $(docker context ls -q | grep -c "^$CTX$")"
}
mint() { bin/run.sh bun src/run-mint.ts "$PLATFORM_STAGE" "$@" 2>&1 | grep '^minted:'; }

destroy_all() {
  say "5. destroy the platform"
  timed "destroy" "$T_DESTROY" alc destroy --stage "$PLATFORM_STAGE" --yes
  docker context rm -f "$CTX" >/dev/null 2>&1 && echo "removed the Docker context $CTX (bin/run.sh makes it; it is not in the state)"
  say "5. what is left"
  inventory
  echo "the shared state: $(bin/run.sh bun src/run-inventory.ts "$PLATFORM_STAGE" 2>/dev/null | tr '\n' ' ')"
  bin/zone.sh
  python3 - "$VAR/steps.jsonl" "$REC/summary.json" "$PLATFORM_STAGE" <<'EOF'
import json, sys
steps = [json.loads(l) for l in open(sys.argv[1])]
ok = all(s["exit"] == s["want"] for s in steps)
json.dump({"stage": sys.argv[3], "host": "standin", "edge": "none", "outcome": "passed" if ok else "failed",
           "steps": steps}, open(sys.argv[2], "w"), indent=2)
print("outcome:", "passed" if ok else "failed")
EOF
}

step0() {
  say "0. the zone before anything is created"
  bin/zone.sh
}
step1() {
  say "1. deploy the platform $PLATFORM_STAGE (stack CapxulPlatform) on the stand-in host"
  timed "deploy" "$T_DEPLOY" alc deploy --stage "$PLATFORM_STAGE" --yes || return 1
  inventory
  say "1. wait until the door answers (it writes the bench's config first)"
  timed "door ready" 180 bash -c "until curl -sf $DOOR/health; do sleep 1; done"; echo
  say "1. deploy again with no change"
  timed "deploy, no change" "$T_DEPLOY" alc deploy --stage "$PLATFORM_STAGE" --yes
}
step2() {
  say "2. mint world $WORLD's site token from the door key in the shared state (quota $QUOTA), and others"
  mint "$WORLD" "$QUOTA" "$EXPIRES" "$VAR/tokens/$WORLD.token"
  mint globex 1 "$EXPIRES" "$VAR/tokens/globex.token"
  mint "$WORLD" 5 "$((NOW - 60))" "$VAR/tokens/expired.token"
  python3 -c "import sys; t=open(sys.argv[1]).read(); open(sys.argv[2],'w').write(t.replace('.1.', '.9.', 1))" \
    "$VAR/tokens/$WORLD.token" "$VAR/tokens/forged.token"
  say "2. the door refuses before any work"
  echo "no token:             $(door /sites -X POST -d '{"label":"r1"}')"
  echo "quota raised by hand: $(door /sites -X POST -H "$(bearer forged)" -d '{"label":"r1"}')"
  echo "expired token:        $(door /sites -X POST -H "$(bearer expired)" -d '{"label":"r1"}')"
  echo "bad label:            $(door /sites -X POST -H "$(bearer "$WORLD")" -d '{"label":"../globex-r1"}')"
  say "2. create the site $SITE with world $WORLD's token"
  timed "site creation" "$T_SITE" door /sites -X POST -H "$(bearer "$WORLD")" -d '{"label":"r1","company":"Acme Rehearsal"}'
  echo "second site, quota 1: $(door /sites -X POST -H "$(bearer "$WORLD")" -d '{"label":"r2"}')"
  echo "world $WORLD sees:     $(door /world -H "$(bearer "$WORLD")")"
  echo "world globex sees:    $(door /world -H "$(bearer globex)")"
  say "2. set world $WORLD's clock (frozen at 2027-03-31 10:00 UTC) and read it from the site"
  door /clock -X POST -H "$(bearer "$WORLD")" -d '{"frozen_at_ms":1806487200000}'
  echo "host time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "web, Host $SITE (plain HTTP to the bench's web process; no tunnel here):"
  web "$SITE" /api/method/capxul.clock.now
  echo "web, Host $SITE, Frappe's ping: $(web "$SITE" /api/method/ping)"
}
. "$HERE/bin/rehearse-drift.sh"

trap destroy_all EXIT
step0 2>&1 | tee "$REC/00-zone-before.txt"
step1 2>&1 | tee "$REC/01-deploy.txt"
step2 2>&1 | tee "$REC/02-site.txt"
step3 2>&1 | tee "$REC/03-drift.txt"
trap - EXIT
destroy_all 2>&1 | tee "$REC/04-destroy.txt"

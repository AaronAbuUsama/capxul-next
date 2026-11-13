#!/usr/bin/env bash
# checks.sh [all | clocks | read | docs | move | jobs | scheduler | fresh_web]: the proof, on the bench run.sh started.
# Every time is set with the app's own functions (capxul.clock.write_world, rewind_jobs) through `bench execute`.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
A1="${ALPHA_SITES[0]}"; A2="${ALPHA_SITES[1]}"; B1="${BETA_SITES[0]}"

clocks() {
  say "2. world alpha frozen at 2027-03-31 10:00:00 UTC; world beta running on from 2026-06-15 12:00:00 UTC"
  echo "alpha written from $A1: $(set_frozen "$A1" alpha "2027-03-31 10:00:00")"
  echo "beta  written from $B1: $(set_running "$B1" beta "2026-06-15 12:00:00")"
  echo "the bench's one clock file: $(dc exec -T web cat sites/capxul-world-clocks.json)"
}

readings() {   # every site, read in a bench command and in the web process
  for s in "${SITES[@]}"; do echo "bench  $(probe "$s" show)"; done
  for s in "${SITES[@]}"; do
    echo "web    $s $(http "$s" /api/method/capxul.clock.now | python3 -c 'import json,sys; m=json.load(sys.stdin)["message"]
print(json.dumps({k: m[k][:19] for k in ("world", "world_local", "nowdate", "host_utc")}))')"
  done
}

mixed() {   # 20 loops at once, each asking the three sites in turn: 60 requests over 2 gunicorn workers of 4 threads
  dc exec -T web bash -c 'for i in $(seq 1 20); do (for s in "$@"; do curl -s -H "Host: $s" http://127.0.0.1:8000/api/method/capxul.clock.now; echo; done) > /tmp/mix.$i & done
    wait; cat /tmp/mix.*; rm -f /tmp/mix.*' _ "${SITES[@]}" | python3 -c '
import collections, json, sys
c = collections.Counter()
for line in sys.stdin:
    if line.strip():
        m = json.loads(line)["message"]
        c[(m["world"], m["nowdate"])] += 1
for (world, day), n in sorted(c.items()):
    print(f"web    {n} answers from world {world} read {day}")'
  dc logs --no-log-prefix web 2>/dev/null | python3 -c '
import collections, re, sys
c = collections.Counter(re.findall(r"ACCESS pid=<(\d+)> host=(\S+) GET /api/method/capxul.clock.now 200", sys.stdin.read()))
for (pid, host), n in sorted(c.items()):
    print(f"web    gunicorn worker process {pid} answered {host} {n} times since the web process started")'
}

read_step() {
  say "3. each site reads its world's time: in a bench process and in the web process (the host's real time beside it)"
  readings
  for s in "${SITES[@]}"; do echo "bench  $s frappe.utils.nowdate: $(b --site "$s" execute frappe.utils.nowdate | tr -d '\r\n')"; done
  mixed
  echo "a plain Python process on the bench (frappe.init, frappe.connect, then the reading), not started by the bench CLI:"
  for s in "${SITES[@]}"; do echo "plain  $(plain "$s" show)"; done
}

keyprint() {   # the first 8 hex digits of the SHA-256 of the site's encryption key (never the key), or "none"
  dc exec -T web python3 -c 'import hashlib,json,sys; k=json.load(open(f"sites/{sys.argv[1]}/site_config.json")).get("encryption_key")
print(hashlib.sha256(k.encode()).hexdigest()[:8] if k else "none")' "$1"
}
new_token() { probe "$1" api_keys | field token; }   # a fresh API secret for Administrator, made by a bench command
post_todo() {   # post_todo <site> <token>: POST /api/resource/ToDo to the web process
  http "$1" /api/resource/ToDo -X POST -H "Authorization: token $2" -H 'Content-Type: application/json' \
    -d '{"description":"bench-clocks http"}' | python3 -c 'import json,sys; raw=sys.stdin.read(); d=json.loads(raw).get("data")
print(json.dumps({"via": "POST /api/resource/ToDo", "todo": d["name"], "creation": d["creation"][:19], "modified": d["modified"][:19]}) if d else "REFUSED " + raw[:150])'
}

docs() {
  say "4. a document created on each site carries its world's time in creation"
  for s in "${SITES[@]}"; do echo "bench  $(probe "$s" make_doc)"; done
  for s in "${SITES[@]}"; do
    k0="$(keyprint "$s")"; tok="$(new_token "$s")"; k1="$(keyprint "$s")"; r="$(post_todo "$s" "$tok")"; echo "web    $s $r"
    if [[ "$r" == REFUSED* ]]; then   # finding 4 in the README: the web process held an older site_config.json
      echo "web    $s encryption key print: $k0 before the bench command made the site's first secret, $k1 after it, $(keyprint "$s") after the refused request"
      echo "web    $s second attempt: $(post_todo "$s" "$(new_token "$s")")"
    fi
  done
  echo "the same insert from a plain Python process, not started by the bench CLI:"
  for s in "${SITES[@]}"; do echo "plain  $(plain "$s" make_doc '{"label":"plain python"}')"; done
}

move() {
  say "5. alpha moves forward to 2027-04-30 10:00:00 UTC with one write; beta is not written"
  echo "clock file before: $(dc exec -T web cat sites/capxul-world-clocks.json)"
  echo "alpha written from $A2: $(set_frozen "$A2" alpha "2027-04-30 10:00:00")"
  readings
}

jobs() {
  say "6a. the background worker (one process for all sites), restarted first so its first job meets a fresh process"
  dc restart worker >/dev/null 2>&1; sleep 5
  for i in 1 2; do for s in "$A1" "$B1" "$A2"; do probe "$s" enqueue "{\"tag\":\"round $i\"}"; done; done
  for _ in $(seq 1 30); do
    n=0; for s in "${SITES[@]}"; do n=$((n + $(probe "$s" jobs | wc -l))); done
    [ "$n" -ge 6 ] && break; sleep 2
  done
  for s in "${SITES[@]}"; do probe "$s" jobs | sed 's/^/worker /'; done
}

login() { http "$B1" /api/method/login -c /tmp/jar -X POST -d 'usr=Administrator&pwd=admin' >/dev/null; }
last_login() { b --site "$B1" execute frappe.db.get_value --args '["User","Administrator","last_login"]' | tr -d '\r\n"' | cut -c1-19; }
web_start() {   # web_start <label>: what the first request to a just-started web process reads, on beta (behind the host)
  web_ready; login
  echo "web    $1: sign-in as the first request after the start stamps User.last_login $(last_login) (beta reads $(probe "$B1" show | field now_datetime))"
  mixed >/dev/null; login   # both gunicorn workers have served requests by now: this sign-in is stamped in beta's time
  echo "web    $1: sign-in on the warmed process stamps User.last_login $(last_login); who am I: $(http "$B1" /api/method/frappe.auth.get_logged_user -b /tmp/jar)"
  dc restart web >/dev/null 2>&1; web_ready
  echo "web    $1: first request after a restart, same cookie: $(http "$B1" /api/method/frappe.auth.get_logged_user -b /tmp/jar | cut -c1-200)"
}

fresh_web() {
  say "3b. the web process just after it starts (gunicorn imports no app; capxul is loaded by the first hook Frappe calls)"
  dc up -d --force-recreate web >/dev/null 2>&1
  echo "gunicorn serves frappe.app:application, as packages/bench-image/resources/start-web.sh does:"
  web_start "frappe.app"
  WEB_APP=webentry:application dc up -d --force-recreate web >/dev/null 2>&1
  echo "gunicorn serves webentry:application (probe/webentry.py: import capxul, then frappe.app):"
  web_start "webentry  "
  dc up -d web >/dev/null 2>&1; web_ready   # back to the entry the hosted bench uses today
}

world_change() {
  say "5b. a site changes world (capxul.clock.join_world writes its site_config.json): how soon each process follows"
  mixed >/dev/null   # both gunicorn workers have read every site's config
  echo "$A2 joined: $(capxul "$A2" clock.join_world '{"world":"beta"}')"; t0=$SECONDS
  echo "bench  $(probe "$A2" show)"
  echo "web    $A2 $((SECONDS - t0)) s after the change: $(http "$A2" /api/method/capxul.clock.now | python3 -c 'import json,sys; m=json.load(sys.stdin)["message"]; print(m["world"], m["world_local"][:19])')"
  n=0; while [ "$n" -lt 8 ] && [ $((SECONDS - t0)) -lt 180 ]; do
    if [ "$(http "$A2" /api/method/capxul.clock.now | field world)" = beta ]; then n=$((n + 1)); else n=0; sleep 3; fi
  done
  echo "web    $A2 answers as world beta eight times running $((SECONDS - t0)) s after the change (Frappe keeps site_config.json in a web process for up to 60 s)"
}

case "${1:-all}" in
  all) clocks; read_step; docs; move; jobs; "$HERE/scheduler.sh"; fresh_web; world_change ;;
  clocks | docs | move | jobs | readings | mixed | fresh_web | world_change) "$1" ;;
  read) read_step ;;
  scheduler) "$HERE/scheduler.sh" ;;
  *) echo "usage: checks.sh [all | clocks | read | docs | move | jobs | scheduler | fresh_web]" >&2; exit 2 ;;
esac

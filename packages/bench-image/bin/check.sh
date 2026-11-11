#!/usr/bin/env bash
# check.sh [site]: prove the bench image serves a production site. Starts the bench if needed, creates the site with
# every app, and checks it through the frontend the way a person's browser reaches it. Writes a receipt to
# var/bench-image/check.json and exits 1 if any check fails. Read README.md for what each check stands for.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
SITE="${1:-check.localhost}"
URL="http://127.0.0.1:$CAPXUL_BENCH_PORT"
OUT="$REPO_ROOT/var/bench-image"; mkdir -p "$OUT"; T="$(mktemp -d)"
pass=0; fail=0; results=()
chk() {   # chk <id> <what> <got> <want>
  local ok=false; [ "$3" = "$4" ] && ok=true
  if $ok; then pass=$((pass + 1)); echo "  ok   $1  $2"; else fail=$((fail + 1)); echo "  FAIL $1  $2: got [$3] want [$4]"; fi
  results+=("$(python3 -c 'import json,sys; print(json.dumps(dict(id=sys.argv[1],what=sys.argv[2],got=sys.argv[3],want=sys.argv[4],ok=sys.argv[5]=="true")))' "$1" "$2" "$3" "$4" "$ok")")
}
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 -H "Host: $SITE" "$@"; }
body() { curl -s --max-time 30 -H "Host: $SITE" "$@"; }
jget() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }
t0=$(date +%s)

echo "bench image check: $CAPXUL_BENCH_IMAGE, site $SITE"
"$BENCH_DIR/bin/up.sh" >"$T/up.log" 2>&1; rc=$?; chk up.healthy "every bench service starts and reports healthy" "$rc" 0
[ "$rc" = 0 ] || { tail -20 "$T/up.log"; echo "bench image check: the bench did not come up; nothing else checked (logs: $T)"; exit 1; }
"$BENCH_DIR/bin/new-site.sh" "$SITE" >"$T/apps.json" 2>"$T/site.log"; rc=$?
chk site.created "the site is created with every app, migrated, scheduler on" "$rc" 0
chk site.apps "the site has the six apps, in the image's order" \
  "$(python3 -c 'import json,sys; t=open(sys.argv[1]).read(); i=t.rfind("\n{"); print(" ".join(json.loads(t[i+1:] if i>=0 else t)[sys.argv[2]]))' "$T/apps.json" "$SITE" 2>/dev/null)" "frappe erpnext hrms crm frappe_whatsapp capxul"

# the image holds exactly what apps.lock.json pins
chk image.pins "the image's manifest names the pinned commits" "$(inbench cat capxul-image.json | python3 -c '
import json,sys; m=json.load(sys.stdin); l=json.load(open(sys.argv[1]))
want={"frappe": l["frappe"]["commit"], **{a["name"]: a["commit"] for a in l["apps"]}}
got={a["name"]: a.get("commit") for a in m["apps"] if "commit" in a}
print("same" if got==want and m["base"]==l["base"] else f"{got} vs {want}")' "$BENCH_DIR/apps.lock.json")" same

# production processes: gunicorn and workers, never the development server
procs="$(dc top 2>/dev/null)"
chk proc.gunicorn "the web process is gunicorn" "$(grep -c 'gunicorn.*frappe.app:application' <<<"$procs" | awk '{print ($1>0)?"yes":"no"}')" yes
chk proc.no-dev-server "no development server runs (bench start, bench serve, werkzeug)" "$(grep -cE 'bench (start|serve)|werkzeug' <<<"$procs")" 0
chk proc.workers "the short and long workers and the scheduler run" "$(for s in queue-short queue-long scheduler; do dc ps --status running -q "$s" | grep -q . && echo -n 1; done)" 111
chk proc.dev-mode-off "developer mode is off for the site" "$(inbench bash -c 'cd sites && ../env/bin/python -c "import frappe,sys; frappe.init(site=sys.argv[1], sites_path=\".\"); print(int(frappe.conf.developer_mode or 0))" "$1"' _ "$SITE" 2>/dev/null | tail -1)" 0

# through the frontend, as a browser reaches it: the site is picked from the Host header
chk http.ping "ping answers through nginx" "$(body "$URL/api/method/ping" | jget "d['message']")" pong
chk http.unknown-site "an unknown host is not served another company's site" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -H 'Host: nobody.localhost' "$URL/api/method/ping")" 404
pw="$(sed -n 's/^CAPXUL_ADMIN_PASSWORD=//p' "$CAPXUL_ENV_DIR/bench.env")"
chk http.login "Administrator signs in with the generated password" \
  "$(curl -s -c "$T/jar" --max-time 30 -H "Host: $SITE" -H 'Content-Type: application/json' -d "{\"usr\":\"Administrator\",\"pwd\":\"$pw\"}" "$URL/api/method/login" | jget "d['message']")" "Logged In"
chk http.wrong-password "a wrong password is refused" "$(code -H 'Content-Type: application/json' -d '{"usr":"Administrator","pwd":"wrong"}' "$URL/api/method/login")" 401
chk http.desk "the desk loads for the signed-in person" "$(code -b "$T/jar" "$URL/desk")" 200
css="$(body -b "$T/jar" "$URL/desk" | grep -oE '/assets/frappe/dist/css/desk\.bundle\.[A-Z0-9]+\.css' | head -1)"
chk http.assets "the desk's built stylesheet is served from the image's assets" "$( [ -n "$css" ] && code "$URL$css" || echo none)" 200
chk http.capxul-asset "the capxul app's own script is served" "$(code "$URL/assets/capxul/js/payment_entry.js")" 200
chk http.crm "the CRM's front end is served" "$(code -b "$T/jar" "$URL/crm")" 200
chk http.capxul-api "a capxul method answers as the signed-in person" "$(body -b "$T/jar" "$URL/api/method/capxul.features.status" | jget "d['message']['features']['crm']")" on
chk http.socketio "the socket server answers its handshake through nginx" \
  "$(body -b "$T/jar" -H "Origin: http://$SITE" "$URL/socket.io/?EIO=4&transport=polling" | grep -c '"sid"')" 1

# background work: a job on each queue is run by a worker and returns
jobs="$(inbench bash -c 'cd sites && ../env/bin/python - "$1"' _ "$SITE" <<'PY' 2>/dev/null | tail -1
import sys, time, frappe
frappe.init(site=sys.argv[1], sites_path="."); frappe.connect()
out = []
for q in ("short", "long"):
    job = frappe.enqueue("frappe.ping", queue=q)
    for _ in range(60):
        if job.get_status(refresh=True) in ("finished", "failed"): break
        time.sleep(1)
    out.append(f"{q}={job.get_status().value}:{job.return_value()}")
print(" ".join(out))
PY
)"
chk jobs.run "a job on the short and on the long queue runs and returns" "$jobs" "short=finished:pong long=finished:pong"
chk sched.on "the scheduler is enabled for the site" "$(inbench bench --site "$SITE" scheduler status 2>/dev/null | grep -ci 'is enabled')" 1

# nothing reports outward (sites.privacy), read from the site after the migration ran its hooks
chk privacy.nothing-outward "telemetry, update check, CRM first-run screen and enrichment are all off" \
  "$(inbench bench --site "$SITE" execute capxul.privacy.status 2>/dev/null | tail -1 | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sum(int(v) for v in d.values() if isinstance(v,(int,bool))))' 2>/dev/null)" 0

# a restart keeps the site and relinks the assets (the volume does not hide the image's assets)
dc restart >/dev/null 2>&1; dc up -d --wait --wait-timeout 300 >/dev/null 2>&1
chk restart.site-kept "after a restart the site still answers and its assets are still served" \
  "$(body "$URL/api/method/ping" | jget "d['message']") $( [ -n "$css" ] && code "$URL$css")" "pong 200"

secs=$(( $(date +%s) - t0 ))
printf '%s\n' "${results[@]}" | python3 -c '
import json,sys; r=[json.loads(l) for l in sys.stdin if l.strip()]
img=sys.argv[3]; json.dump(dict(schema="capxul-bench-check/1", image=img, image_id=sys.argv[4], site=sys.argv[1], seconds=int(sys.argv[2]),
  passed=sum(x["ok"] for x in r), failed=sum(not x["ok"] for x in r), checks=r), open(sys.argv[5],"w"), indent=2)' \
  "$SITE" "$secs" "$CAPXUL_BENCH_IMAGE" "$(docker image inspect --format '{{.Id}}' "$CAPXUL_BENCH_IMAGE" 2>/dev/null)" "$OUT/check.json"
echo "bench image check: $pass passed, $fail failed in ${secs}s (receipt: var/bench-image/check.json)"
[ "$fail" = 0 ] || { echo "logs: $T"; exit 1; }
rm -rf "$T"

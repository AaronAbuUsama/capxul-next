#!/usr/bin/env bash
# Shared by run.sh and checks.sh: the compose project, a bench command, a probe reading and an HTTP call to the web process.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALPHA_SITES=(alpha1.localhost alpha2.localhost); BETA_SITES=(beta1.localhost)
SITES=("${ALPHA_SITES[@]}" "${BETA_SITES[@]}")
export BENCH_PROJECT="${BENCH_PROJECT:-bench-clocks}" BENCH_IMAGE="${BENCH_IMAGE:-bench-clocks:spike}"   # another name keeps runs apart
dc() { docker compose -p "$BENCH_PROJECT" -f "$HERE/compose.yaml" "$@"; }
b() { dc exec -T web bench "$@"; }                       # a bench command (its own process) on the shared bench
web_ready() { for _ in $(seq 1 90); do dc exec -T web bash -c 'exec 3<>/dev/tcp/127.0.0.1/8000' 2>/dev/null && return 0; sleep 1; done; }   # listening; no request is made
say() { printf '\n== %s\n' "$*"; }
ms() { python3 -c 'import sys,datetime as d; print(int(d.datetime.fromisoformat(sys.argv[1]).replace(tzinfo=d.timezone.utc).timestamp()*1000))' "$1"; }
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
# probe <site> <function> [kwargs json]: probe/clockprobe.py's function through `bench execute`, printing its PROBE lines.
# (`bench execute` resolves dotted names only inside installed apps, so the function is given as an expression.)
probe() {
  local site="$1" fn="$2" kw="${3:-}"
  b --site "$site" execute "__import__('clockprobe').$fn" ${kw:+--kwargs "$kw"} | tr '\r' '\n' | sed -n 's/^PROBE://p'
}
# plain <site> <function> [kwargs json]: the same function in a plain Python process on the bench (frappe.init,
# frappe.connect, the call), one the bench CLI did not start
plain() {
  local site="$1" fn="$2"; shift 2
  dc exec -T -w /home/frappe/frappe-bench/sites web ../env/bin/python -W ignore /probe/clockprobe.py "$site" "$fn" "$@" | sed -n 's/^PROBE://p'
}
# capxul <site> <function> <kwargs json>: one of the app's own bench-execute functions; prints its CAPXUL_RESULT
capxul() { b --site "$1" execute "capxul.$2" --kwargs "$3" | tr '\r' '\n' | sed -n 's/^CAPXUL_RESULT://p'; }
# http <site> <path> [curl args]: the web process (gunicorn), the site picked from the Host header as nginx would pass it
http() { local site="$1" path="$2"; shift 2; dc exec -T web curl -sS -H "Host: $site" "$@" "http://127.0.0.1:8000$path"; }
# field <key>: read one key of a JSON object on stdin (also inside Frappe's {"message": ..} or {"data": ..} envelope)
field() { python3 -c 'import json,sys; d=json.load(sys.stdin); d=d.get("message", d.get("data", d)); print(d[sys.argv[1]])' "$1"; }
set_frozen() { capxul "$1" clock.write_world "{\"world\":\"$2\",\"offset_ms\":0,\"frozen_at_ms\":$(ms "$3")}"; }   # site world "YYYY-MM-DD HH:MM:SS" (UTC)
set_running() { capxul "$1" clock.write_world "{\"world\":\"$2\",\"offset_ms\":$(( $(ms "$3") - $(now_ms) ))}"; }  # runs on from that UTC instant
keyprint() {   # the first 8 hex digits of the SHA-256 of the site's encryption key (never the key), or "none"
  dc exec -T web python3 -c 'import hashlib,json,sys; k=json.load(open(f"sites/{sys.argv[1]}/site_config.json")).get("encryption_key")
print(hashlib.sha256(k.encode()).hexdigest()[:8] if k else "none")' "$1"
}

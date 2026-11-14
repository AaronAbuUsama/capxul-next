#!/usr/bin/env bash
# Runs prove.py against the site door on a stand-in bench that is as busy as the staging bench was when four `world`
# runs ran at once (14 November 2026): one FAST slot, and each claim's join JOIN_SECONDS long. Three times: the door
# before jobs (the commit OLD names, default origin/master) asked as packages/world asked before; this checkout's
# door asked with `Prefer: respond-async`; and this checkout's door asked without it, as an old client asks. Then
# client.ts.txt (packages/world's own client) against both doors. Times are a tenth of the bench's: EDGE_S, 10 s,
# stands for Cloudflare's 100 s, DOOR_JOB_WAIT_S, 2 s, for the door's 20 s. The door is the real door/door.py; `bench`
# is ../backup-async/bench-stand-in.sh; the bench's Python, pymysql, redis and rq are stand-ins (no MariaDB, no Redis).
# Records: old-door.json, new-door.json, old-client.json, client.json and the doors' logs. Nothing outside a temporary
# folder is touched; no key is printed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
door_dir="$(cd "$here/../../door" && pwd)"
world="$(cd "$here/../../../world" && pwd)"
edge="${EDGE_S:-10}" join="${JOIN_SECONDS:-4}"
work="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$work" "$world/capacity-proof.ts"' EXIT
python3 -c "import secrets; print(secrets.token_hex(32))" >"$work/key"
mkdir -p "$work/path" "$work/old"
cp "$here/../backup-async/bench-stand-in.sh" "$work/path/bench"
git -C "$door_dir" archive "${OLD:-origin/master}" -- . | tar -x -C "$work/old"
stand_ins="$here/stand-in:$here/../templates/stand-in"

serve() { # <door folder> <port> <log>
  local bench="$work/bench-$2"
  mkdir -p "$bench/sites" "$bench/env/bin" "$bench/apps/capxul/capxul" "$bench/apps/frappe/frappe"
  cp "$here/stand-in/python" "$bench/env/bin/python"
  echo '{"redis_cache": "redis://cache:6379", "redis_queue": "redis://queue:6379"}' >"$bench/sites/common_site_config.json"
  echo "x = 1" >"$bench/apps/capxul/capxul/stand_in.py"
  echo '__version__ = "16.54.0"' >"$bench/apps/frappe/frappe/__init__.py"
  (cd "$bench" && DOOR_PORT="$2" DOOR_KEY="$(cat "$work/key")" DB_ROOT_PASSWORD=stand-in PLATFORM_DOMAIN=pool.test \
    FRAPPE_BENCH="$bench" DOOR_FAST_SLOTS=1 DOOR_JOB_WAIT_S=2 JOIN_SECONDS="$join" PYTHONPATH="$stand_ins" \
    PATH="$work/path:$PATH" exec python3 "$1/door.py" >"$3" 2>&1) &
  for _ in $(seq 50); do curl -fsS "http://127.0.0.1:$2/health" >/dev/null 2>&1 && return; sleep 0.2; done
  echo "door on $2 did not start" >&2; cat "$3" >&2; exit 1
}

serve "$work/old" 18191 "$work/old.log"
python3 "$here/prove.py" http://127.0.0.1:18191 "$work/key" old "$edge" "$here/old-door.json"
serve "$door_dir" 18192 "$work/new.log"
python3 "$here/prove.py" http://127.0.0.1:18192 "$work/key" new "$edge" "$here/new-door.json"
python3 "$here/prove.py" http://127.0.0.1:18192 "$work/key" old-client "$edge" "$here/old-client.json"
cp "$here/client.ts.txt" "$world/capacity-proof.ts"
(cd "$world" && WORLD_BENCH=local WORLD_BENCH_DOOR=http://127.0.0.1:18192 WORLD_BENCH_KEY="$(cat "$work/key")" \
  node --experimental-strip-types --no-warnings capacity-proof.ts http://127.0.0.1:18192 http://127.0.0.1:18191 \
  >"$here/client.json")
cp "$work/old.log" "$here/old-door.log"; cp "$work/new.log" "$here/new-door.log"

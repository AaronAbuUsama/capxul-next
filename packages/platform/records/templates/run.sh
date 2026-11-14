#!/usr/bin/env bash
# Runs prove.py against the site door on a stand-in bench, once with the door before "Bench templates never change"
# (the commit named by OLD, default origin/slice/templates) and once with this checkout's, then client.ts.txt (packages/
# world's own client) against this checkout's. The door is the real door/door.py; `bench` is
# ../backup-async/bench-stand-in.sh, the bench's Python is stand-in/python, pymysql is stand-in/pymysql (no MariaDB).
# Records: old-door.json, new-door.json, client.json. Nothing outside a temporary folder is touched; no key is printed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
door_dir="$(cd "$here/../../door" && pwd)"
work="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$work"' EXIT
python3 -c "import secrets; print(secrets.token_hex(32))" >"$work/key"
mkdir -p "$work/path" "$work/old"
cp "$here/../backup-async/bench-stand-in.sh" "$work/path/bench"
git -C "$door_dir" archive "${OLD:-origin/slice/templates}" -- . | tar -x -C "$work/old"

serve() { # <door folder> <port> <log>
  local bench="$work/bench-$2"
  mkdir -p "$bench/sites" "$bench/env/bin" "$bench/apps/capxul/capxul" "$bench/apps/frappe/frappe"
  cp "$here/stand-in/python" "$bench/env/bin/python"
  echo "x = 1" >"$bench/apps/capxul/capxul/stand_in.py"
  echo '__version__ = "16.54.0"' >"$bench/apps/frappe/frappe/__init__.py"
  (cd "$bench" && DOOR_PORT="$2" DOOR_KEY="$(cat "$work/key")" DB_ROOT_PASSWORD=stand-in PLATFORM_DOMAIN=pool.test \
    FRAPPE_BENCH="$bench" DOOR_TEMPLATE_MIN_IDLE_S=2 PYTHONPATH="$here/stand-in" PATH="$work/path:$PATH" \
    exec python3 "$1/door.py" >"$3" 2>&1) &
  for _ in $(seq 50); do curl -fsS "http://127.0.0.1:$2/health" >/dev/null 2>&1 && return; sleep 0.2; done
  echo "door on $2 did not start" >&2; cat "$3" >&2; exit 1
}

serve "$work/old" 18181 "$work/old.log"
python3 "$here/prove.py" http://127.0.0.1:18181 "$work/key" old "$here/old-door.json"
serve "$door_dir" 18182 "$work/new.log"
python3 "$here/prove.py" http://127.0.0.1:18182 "$work/key" new "$here/new-door.json"
cp "$here/client.ts.txt" "$here/../../../world/client-proof.ts"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$work" "$here/../../../world/client-proof.ts"' EXIT
(cd "$here/../../../world" && WORLD_BENCH=local WORLD_BENCH_DOOR=http://127.0.0.1:18182 \
  WORLD_BENCH_KEY="$(cat "$work/key")" WORLD_TEMPLATE_IDLE="2 seconds" \
  node --experimental-strip-types --no-warnings client-proof.ts >"$here/client.json")
cp "$work/old.log" "$here/old-door.log"; cp "$work/new.log" "$here/new-door.log"

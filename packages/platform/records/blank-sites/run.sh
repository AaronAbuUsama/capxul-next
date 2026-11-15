#!/usr/bin/env bash
# Runs prove.py against the site door on a stand-in bench, four companies at once each time: the door before blank
# sites (the commit OLD names, default origin/master), then this checkout's warm (blank made, pool of 4), with a pool of
# 2, and cold (asked as it starts). The door is the real door/door.py; `bench` is bench-stand-in.sh; the bench's Python
# and pymysql are stand-in/ (no MariaDB). Every bench time is the real bench's a tenth (SCALE). Records: old-door.json,
# warm.json, pool2.json, cold.json and the doors' logs. Nothing outside a temporary folder is touched; no key is printed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
door_dir="$(cd "$here/../../door" && pwd)"
work="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$work"' EXIT
python3 -c "import secrets; print(secrets.token_hex(32))" >"$work/key"
mkdir -p "$work/path" "$work/old" "$work/cpu"
cp "$here/bench-stand-in.sh" "$work/path/bench"
git -C "$door_dir" archive "${OLD:-origin/master}" -- . | tar -x -C "$work/old"
export SCALE="${SCALE:-0.1}" CPU_DIR="$work/cpu"

serve() { # <door folder> <port> <log> [env...]
  local folder="$1" port="$2" log="$3" bench="$work/bench-$2"
  shift 3
  mkdir -p "$bench/sites" "$bench/env/bin" "$bench/apps/capxul/capxul" "$bench/apps/frappe/frappe"
  cp "$here/stand-in/python" "$bench/env/bin/python"
  echo "x = 1" >"$bench/apps/capxul/capxul/stand_in.py"
  echo '__version__ = "16.54.0"' >"$bench/apps/frappe/frappe/__init__.py"
  (cd "$bench" && exec env DOOR_PORT="$port" DOOR_KEY="$(cat "$work/key")" DB_ROOT_PASSWORD=stand-in \
    PLATFORM_DOMAIN=pool.test FRAPPE_BENCH="$bench" PYTHONPATH="$here/stand-in" PATH="$work/path:$PATH" "$@" \
    python3 "$folder/door.py" >"$log" 2>&1) &
  for _ in $(seq 50); do curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 && return; sleep 0.1; done
  echo "door on $port did not start" >&2; cat "$log" >&2; exit 1
}

serve "$work/old" 18201 "$work/old.log"
python3 "$here/prove.py" http://127.0.0.1:18201 "$work/key" old "$here/old-door.json"
serve "$door_dir" 18202 "$work/warm.log"
python3 "$here/prove.py" http://127.0.0.1:18202 "$work/key" warm "$here/warm.json"
serve "$door_dir" 18203 "$work/pool2.log" DOOR_BLANK_POOL_SIZE=2
python3 "$here/prove.py" http://127.0.0.1:18203 "$work/key" pool2 "$here/pool2.json"
serve "$door_dir" 18204 "$work/cold.log"
python3 "$here/prove.py" http://127.0.0.1:18204 "$work/key" cold "$here/cold.json"
for each in old warm pool2 cold; do cp "$work/$each.log" "$here/$each-door.log"; done

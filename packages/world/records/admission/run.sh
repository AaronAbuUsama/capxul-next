#!/usr/bin/env bash
# The admission proof (src/lifecycle/claim.ts, `admit`): two processes at once, each admitting WORLDS worlds to one
# hub that admits CAPACITY, on a real Postgres 16 (this machine's, in a temporary folder) behind a stand-in of Neon's
# SQL endpoint (endpoint.mjs.txt). The registry starts as the deployed one is, without the hub column, so the first
# claim also proves it is added. A monitor counts the hub's rows every 50 ms the whole time. Records: a.json, b.json
# (each process's admissions and waits), monitor.json (the most rows the hub ever held) and summary.json. Nothing
# outside the temporary folder is touched; no cloud is reached.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
world="$(cd "$here/../.." && pwd)"
repo="$(cd "$world/../.." && pwd)"
pgbin="${PGBIN:-/usr/lib/postgresql/16/bin}"
worlds="${WORLDS:-10}" capacity="${CAPACITY:-4}" hold="${HOLD_MS:-400}" sql_port="${SQL_PORT:-18190}" pg_port=55433
work="$(mktemp -d)"
chmod 755 "$work"
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
pg_module="$(dirname "$(ls -d "$repo"/node_modules/.pnpm/pg@*/node_modules/pg | head -1)")"
cleanup() {
  kill $(jobs -p) 2>/dev/null || true
  as_pg "$pgbin/pg_ctl -D $work/data stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$work" "$world/admit-proof.ts" "$pg_module/admission-endpoint.mjs"
}
trap cleanup EXIT
[ "$(id -u)" = 0 ] && chown postgres "$work"
as_pg "$pgbin/initdb -D $work/data -A trust -U postgres" >/dev/null
as_pg "$pgbin/pg_ctl -D $work/data -o '-p $pg_port -k $work' -l $work/pg.log start" >/dev/null
psql=(psql -h "$work" -p "$pg_port" -U postgres -qtA)
for _ in $(seq 50); do "${psql[@]}" -c "select 1" >/dev/null 2>&1 && break; sleep 0.2; done
"${psql[@]}" -c "create database admission"
# The registry as platform up made it before hubs had capacity (src/lifecycle/claim.ts before this change).
"${psql[@]}" -d admission -c "create table worlds (name text primary key, owner text not null, expires_at timestamptz not null, holder text not null, claimed_at timestamptz not null default now())"

cp "$here/endpoint.mjs.txt" "$pg_module/admission-endpoint.mjs"
node "$pg_module/admission-endpoint.mjs" "postgresql://postgres@localhost:$pg_port/admission?host=$work" "$sql_port" &
for _ in $(seq 50); do curl -fsS -o /dev/null -X POST -d '{"query":"select 1","params":[]}' "http://127.0.0.1:$sql_port/sql" && break; sleep 0.2; done

# The monitor: the most rows the hub held at any reading, and how many readings, until the processes end.
( max=0 n=0
  while [ ! -e "$work/done" ]; do
    held="$("${psql[@]}" -d admission -c "select count(*) from worlds where hub = 'proof-hub'" 2>/dev/null || echo 0)"
    [ -n "$held" ] && [ "$held" -gt "$max" ] && max="$held"
    n=$((n + 1)); sleep 0.05
  done
  printf '{"hub": "proof-hub", "capacity": %s, "readings": %s, "mostHeld": %s}\n' "$capacity" "$n" "$max" >"$here/monitor.json"
) &
monitor=$!

cp "$here/admit.ts.txt" "$world/admit-proof.ts"
cd "$world"
node --experimental-strip-types --no-warnings admit-proof.ts a "$sql_port" "$worlds" "$capacity" "$hold" >"$work/a.out" &
a=$!
node --experimental-strip-types --no-warnings admit-proof.ts b "$sql_port" "$worlds" "$capacity" "$hold" >"$work/b.out" &
b=$!
wait "$a" "$b"
touch "$work/done"
wait "$monitor"
left="$("${psql[@]}" -d admission -c "select count(*) from worlds")"
columns="$("${psql[@]}" -d admission -c "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name = 'worlds'")"
# Each process's output is its log (each wait for room is one line), then its record.
python3 - "$work" "$here" "$left" "$columns" <<'PY'
import json, sys
work, here, left, columns = sys.argv[1:]
summary = {"processes": {}, "rowsLeft": int(left), "registryColumnsAfter": columns.split(",")}
for who in "ab":
    lines = open(f"{work}/{who}.out").read().splitlines()
    at = next(n for n, line in enumerate(lines) if line.startswith("{"))
    record = json.loads("\n".join(lines[at:]))
    record["waitsLogged"] = sum("waiting for room" in line for line in lines[:at])
    json.dump(record, open(f"{here}/{who}.json", "w"), indent=1)
    waits = [one["waitedMs"] for one in record["admitted"]]
    summary["processes"][who] = {"admitted": len(waits), "waitedMs": waits, "waitsLogged": record["waitsLogged"],
                                 "quota": record["quota"]}
summary["monitor"] = json.load(open(f"{here}/monitor.json"))
json.dump(summary, open(f"{here}/summary.json", "w"), indent=1)
print(json.dumps(summary, indent=1))
PY

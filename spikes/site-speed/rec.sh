#!/usr/bin/env bash
# Runs one harness script in the bench's door container and keeps what it prints as a record:
#   ./rec.sh <record-name> <script.py> [args...]   ->  records/<record-name>.json
set -euo pipefail
cd "$(dirname "$0")"
name=$1; shift
script=$1; shift
out=records/$name.json
started=$(date -u +%FT%TZ)
docker exec -i -w /opt/spike cx-sitespeed-door /home/frappe/frappe-bench/env/bin/python -u "$script" "$@" > "$out.tmp"
python3 - "$out.tmp" "$out" "$started" "$script" "$*" <<'PY'
import json, sys, subprocess
tmp, out, started, script, args = sys.argv[1:]
rec = json.load(open(tmp))
rec = {"record": out.split("/")[-1][:-5], "started_utc": started, "script": f"harness/{script}", "args": args,
       "machine": {"cpus": int(subprocess.check_output(["nproc"]).strip()),
                   "mem_gib": round(int(open("/proc/meminfo").readline().split()[1]) / 1048576, 1),
                   "bench_image": "cx-platform-bench:pr-sr1 (Frappe 16.54.0, ERPNext, HRMS, capxul)"},
       **rec}
json.dump(rec, open(out, "w"), indent=1)
PY
rm -f "$out.tmp"
python3 -c "import json,sys; r=json.load(open('$out')); print(json.dumps({k:v for k,v in r.items() if k not in ('machine',)}, indent=None)[:3000])"

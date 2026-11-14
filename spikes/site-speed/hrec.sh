#!/usr/bin/env bash
# rec.sh for a script that runs on the host (capacity.py, clone_ts.py): keeps what it prints as records/<name>.json.
#   ./hrec.sh <record-name> <script> [args...]
set -euo pipefail
cd "$(dirname "$0")"
name=$1; shift
started=$(date -u +%FT%TZ)
"./$1" "${@:2}" > "records/$name.json.tmp"
python3 - "records/$name.json.tmp" "records/$name.json" "$started" "$*" <<'PY'
import json, sys, subprocess
tmp, out, started, cmd = sys.argv[1:]
rec = {"record": out.split("/")[-1][:-5], "started_utc": started, "script": cmd.split()[0], "args": " ".join(cmd.split()[1:]),
       "machine": {"cpus": int(subprocess.check_output(["nproc"]).strip()),
                   "mem_gib": round(int(open("/proc/meminfo").readline().split()[1]) / 1048576, 1),
                   "bench_image": "cx-platform-bench:pr-sr1 (Frappe 16.54.0, ERPNext, HRMS, capxul)"},
       **json.load(open(tmp))}
json.dump(rec, open(out, "w"), indent=1)
PY
rm -f "records/$name.json.tmp"
python3 -c "import json; r=json.load(open('records/$name.json')); r.pop('machine'); print(json.dumps(r)[:2500])"

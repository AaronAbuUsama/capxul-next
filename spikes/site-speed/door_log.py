#!/usr/bin/env python3
"""Reads (only) the site door's own log on the platform's stand-in stage the earlier --core=local runs used
(`cx-platform-pr-sr1-door`), and summarises every site it made from nothing and every site it restored from a
snapshot, step by step, as the door itself timed them (packages/platform/door/sites.py and snapshots.py).
    ./door_log.py [container]   prints a JSON record"""
import json
import re
import statistics
import subprocess
import sys

container = sys.argv[1] if len(sys.argv) > 1 else "cx-platform-pr-sr1-door"
log = subprocess.run(["docker", "logs", container], capture_output=True, text=True)
lines = (log.stdout + log.stderr).splitlines()
step = re.compile(r"^door: (\S+) (.+?) (\d+) ms$")
sites, removed = {}, []
for line in lines:
    m = step.match(line)
    if m:
        site, name, ms = m.group(1), m.group(2), int(m.group(3))
        if name == "removed in":
            removed.append(ms)
        else:
            sites.setdefault(site, {})[name] = ms
    elif m := re.match(r"^door: (\S+) removed in (\d+) ms$", line):
        removed.append(int(m.group(2)))
built = [s for s in sites.values() if "install erpnext" in s]
restored = [s for s in sites.values() if "new-site from backup" in s]


def summary(group):
    names = list(dict.fromkeys(n for s in group for n in s))
    out = {n: {"median_ms": round(statistics.median([s[n] for s in group if n in s])),
               "min_ms": min(s[n] for s in group if n in s), "max_ms": max(s[n] for s in group if n in s)} for n in names}
    totals = [sum(s.values()) for s in group if all(n in s for n in names)]
    return {"count": len(group), "complete": len(totals), "steps": out,
            "total_median_ms": round(statistics.median(totals)) if totals else None,
            "total_min_ms": min(totals) if totals else None, "total_max_ms": max(totals) if totals else None}


print(json.dumps({"question": "the door's own timings on stage pr-sr1 (earlier --core=local runs, read from its log)",
                  "container": container, "log_lines": len(lines), "made_from_nothing": summary(built),
                  "restored_from_snapshot": summary(restored),
                  "removed": {"count": len(removed), "median_ms": round(statistics.median(removed)) if removed else None}},
                 indent=1))

#!/usr/bin/env python3
"""Q6: what one bench holds. Runs on the host and reads each bench container's own cgroup (v1 here): CPU time
(cpuacct.usage) and memory (memory.stat rss, without page cache), so another process on the machine is not counted.
    ./capacity.py idle <seconds>                     the bench left alone: CPU and memory per container
    ./capacity.py active <rounds> <site> [<site>...] ops.py's calls (doc.create, doc.submit, report.run) on every
                                                     site at once, one client each: CPU per call, latency, memory
    ./capacity.py sizes                              disk per site: MariaDB's files and the sites folder
Prints a JSON record."""
import json
import subprocess
import sys
import time

BENCH = ["mariadb", "redis", "web", "worker", "scheduler"]


def cid(name):
    return subprocess.check_output(["docker", "inspect", "-f", "{{.Id}}", f"cx-sitespeed-{name}"], text=True).strip()


IDS = {n: cid(n) for n in BENCH}


def sample():
    out = {}
    for n, i in IDS.items():
        cpu = int(open(f"/sys/fs/cgroup/cpuacct/docker/{i}/cpuacct.usage").read())
        stat = dict(l.split() for l in open(f"/sys/fs/cgroup/memory/docker/{i}/memory.stat"))
        out[n] = {"cpu_ns": cpu, "rss_mib": round(int(stat["total_rss"]) / 1048576, 1),
                  "cache_mib": round(int(stat["total_cache"]) / 1048576, 1)}
    return out


def sites():
    names = subprocess.check_output(["docker", "exec", "cx-sitespeed-door", "bash", "-c",
                                     "cd sites && ls -d *.sitespeed.test"], text=True).split()
    return names


def delta(a, b, seconds):
    return {n: {"cpu_s": round((b[n]["cpu_ns"] - a[n]["cpu_ns"]) / 1e9, 2),
                "cpu_pct_of_one_cpu": round((b[n]["cpu_ns"] - a[n]["cpu_ns"]) / 1e9 / seconds * 100, 2),
                "rss_mib": b[n]["rss_mib"], "cache_mib": b[n]["cache_mib"]} for n in BENCH}


mode = sys.argv[1]
if mode == "idle":
    seconds = int(sys.argv[2])
    n = len(sites())
    a, t0 = sample(), time.monotonic()
    time.sleep(seconds)
    b, s = sample(), time.monotonic() - t0
    d = delta(a, b, s)
    total = sum(v["cpu_s"] for v in d.values())
    print(json.dumps({"question": "Q6 idle bench", "sites": n, "seconds": round(s, 1), "containers": d,
                      "cpu_s_total": round(total, 2), "cpu_pct_of_one_cpu_total": round(total / s * 100, 2),
                      "rss_mib_total": round(sum(v["rss_mib"] for v in d.values()), 1)}, indent=1))
elif mode == "active":
    rounds, targets = int(sys.argv[2]), sys.argv[3:]
    a, t0 = sample(), time.monotonic()
    procs = [subprocess.Popen(["docker", "exec", "-w", "/opt/spike", "cx-sitespeed-door", "/home/frappe/frappe-bench/env/bin/python",
                               "ops.py", t, str(rounds)], stdout=subprocess.PIPE, text=True) for t in targets]
    results = [json.loads(p.communicate()[0]) for p in procs]
    b, s = sample(), time.monotonic() - t0
    d = delta(a, b, s)
    calls = sum(3 * r["rounds"] for r in results)
    total = sum(v["cpu_s"] for v in d.values())
    lat = {k: sorted(x for r in results for x in r["raw_ms"][k]) for k in ("doc.create", "doc.submit", "report.run")}
    print(json.dumps({"question": "Q6 active sites", "sites_active": len(targets), "rounds_per_site": rounds,
                      "calls": calls, "seconds": round(s, 1), "calls_per_s": round(calls / s, 1),
                      "cpu_s_total": round(total, 2), "cpu_ms_per_call": round(total / calls * 1000, 1),
                      "latency_ms": {k: {"median": v[len(v) // 2], "p90": v[int(len(v) * 0.9)], "max": v[-1]} for k, v in lat.items()},
                      "containers": d}, indent=1))
elif mode == "sizes":
    per = subprocess.check_output(["docker", "exec", "cx-sitespeed-mariadb", "bash", "-c",
                                   "cd /var/lib/mysql && du -sm _* | sort -n"], text=True).split("\n")
    total = subprocess.check_output(["docker", "exec", "cx-sitespeed-mariadb", "du", "-sm", "/var/lib/mysql"], text=True).split()[0]
    folder = subprocess.check_output(["docker", "exec", "cx-sitespeed-door", "du", "-sm", "--exclude=.spike-*",
                                      "/home/frappe/frappe-bench/sites"], text=True).split()[0]
    dbs = [int(l.split()[0]) for l in per if l.strip()]
    print(json.dumps({"question": "Q6 disk per site", "sites": len(sites()), "databases": len(dbs),
                      "db_mib_each": {"min": dbs[0], "median": dbs[len(dbs) // 2], "max": dbs[-1]},
                      "mariadb_datadir_mib": int(total), "sites_folder_mib": int(folder)}, indent=1))

"""The site pool's proof (roadmap step 1.17), on the local bench bin/pool-bench.sh starts from the platform's images:

1. a template world builds Northwind's site from nothing through the door (POST /sites) and runs starting world
   `founded`'s company setup on it, as Core tells a site;
2. that site becomes template `founded` (POST /templates) and the door fills its pool;
3. four worlds claim their company site from it (POST /world/claim): three at once (two from the pool, one cloned
   while the pool is empty), then one alone once the pool is full again;
4. each site answers the three site operations (doc.create, doc.submit, report.run) through the door;
5. with the bench's scheduler and worker stopped (the world paused, as step 1.16 pauses it), each world is saved to
   a point (POST /world/save) and its state read over HTTP;
6. each is then changed (documents, a file, its clock, a job queued), reset in place
   (POST /world/reset; two one at a time, two at once) and read again over HTTP: it must equal the saved state;
7. one world is changed and reset a second time; then every world, the template and their databases are removed.

Each part is timed, by the door and by this client, and kept in records/site-pool/: one JSON file a part and
pool.proof.json, whose outcome is `passed` only when every check held.
    POOL_SECRETS=<file> python3 proof/prove.py [records/site-pool]
"""

import json
import os
import subprocess
import sys
import threading
import time

from client import World, bench_exec, company_setup, digest, ms_since, operations, state, upload

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "records", "site-pool")
FROZEN, MOVED = 1798000000000, 1799000000000  # 2026-12-23 and 2027-01-03, UTC: each world's clock, then a change
checks, summary = [], {}


def check(name, held, detail=None):
    checks.append({"check": name, "held": bool(held), **({"detail": detail} if detail is not None else {})})
    print(("ok   " if held else "FAIL ") + name, flush=True)


def keep(name, record):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{name}.json"), "w") as f:
        json.dump({"record": name, "at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **record}, f, indent=1)


def at_once(fn, items):
    """fn(item) for every item, each in its own thread, started together; answers their results in order."""
    out = [None] * len(items)

    def one(i, item):
        out[i] = fn(item)

    threads = [threading.Thread(target=one, args=(i, item)) for i, item in enumerate(items)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


def machine():
    images = subprocess.run(["docker", "inspect", "-f", "{{.Config.Image}}", "cx-sitepool-door", "cx-sitepool-web",
                             "cx-sitepool-mariadb"], capture_output=True, text=True).stdout.split()
    with open("/proc/meminfo") as f:
        mem = round(int(f.readline().split()[1]) / 1048576, 1)
    return {"where": "a local stand-in bench in a Claude cloud container (bin/pool-bench.sh), not the AWS bench host",
            "cpus": os.cpu_count(), "mem_gib": mem, "images": images,
            "shared": "other agents' work and containers ran on the same machine"}


def source():
    tpl = World("tpl-founded", 1)
    site = tpl.site("northwind")
    t0 = time.monotonic()
    asked, _ = tpl.ok("POST", "/sites", {"label": "northwind", "company": "Northwind Ltd", "api_key": tpl.key,
                                         "api_secret": tpl.secret})
    while asked["state"] == "creating":
        time.sleep(3)
        asked, _ = tpl.ok("GET", f"/sites/{site}")
    built_ms = ms_since(t0)
    check("the template world's site was built from nothing", asked["state"] == "ready", asked.get("error"))
    setup = company_setup(tpl, site, "northwind")
    keep("01-template-source", {"world": tpl.name, "site": site, "built_ms": built_ms, "door_ms": asked["ms"],
                                "door_steps": asked["steps"], "company_setup": setup})
    return tpl, site


def template(tpl, site):
    made, ms = tpl.ok("POST", "/templates", {"template": "founded", "site": site})
    t0 = time.monotonic()
    while True:
        listed, _ = tpl.ok("GET", "/templates")
        ready = listed["templates"][0]["sites"][0]["pool_ready"]
        if ready >= listed["pool_size"] or ms_since(t0) > 120000:
            break
        time.sleep(1)
    check("template founded made and its pool filled", ready >= listed["pool_size"], ready)
    keep("02-template", {"made": made, "client_ms": ms, "pool_full_after_ms": ms_since(t0), "templates": listed})
    summary["template_ms"] = made["ms"]
    summary["refill_ms"] = [r["ms"] for r in listed["refills"]]


def claim(world):
    answer, ms = world.ok("POST", "/world/claim", {"template": "founded", "api_key": world.key,
                                                   "api_secret": world.secret, "clock": {"frozen_at_ms": FROZEN}})
    one = answer["sites"][0]
    return {"world": world.name, "client_ms": ms, "door_ms": one["ms"], "how": one["claimed_from"].get("how"),
            "state": one["state"], "steps": one["steps"], "error": one["error"]}


def claims(worlds):
    first = at_once(claim, worlds[:3])
    t0 = time.monotonic()
    tpl = worlds[0]
    while tpl.ok("GET", "/templates")[0]["templates"][0]["sites"][0]["pool_ready"] < 2 and ms_since(t0) < 120000:
        time.sleep(1)
    alone = claim(worlds[3])
    every = first + [alone]
    check("every world's site claimed and ready", all(c["state"] == "ready" for c in every),
          [c["error"] for c in every if c["error"]])
    check("three claims at once: two from the pool, one cloned", sorted(c["how"] for c in first) == ["clone", "pool", "pool"],
          [c["how"] for c in first])
    check("a claim alone from a full pool", alone["how"] == "pool", alone["how"])
    keep("03-claim", {"at_once": first, "alone_after_refill": alone})
    summary["claim_ms"] = {c["world"]: {"door": c["door_ms"], "client": c["client_ms"], "how": c["how"]} for c in every}


def ops(worlds):
    out = {}
    for w in worlds:
        calls, rows = operations(w, w.site("northwind"), 3)
        out[w.name] = {"calls_ms": calls, "general_ledger_rows": rows}
    check("every claimed site answers doc.create, doc.submit and report.run", len(out) == len(worlds))
    keep("04-operations", {"through": "the door, as each site's own API user (Core's route)", "sites": out})
    summary["operations_ms"] = {k: v["calls_ms"] for k, v in out.items()}


def save(worlds):
    saved, before = {}, {}
    for w in worlds:
        before[w.name] = state(w, w.site("northwind"))
        answer, ms = w.ok("POST", "/world/save", {"point": "p1"})
        saved[w.name] = {"client_ms": ms, "door_ms": answer["ms"], "steps": answer["sites"][0]["steps"],
                         "state_digest": digest(before[w.name])}
    keep("05-save", {"point": "p1", "worlds": saved})
    summary["save_ms"] = {k: v["door_ms"] for k, v in saved.items()}
    return before


def change(w, rounds=3):
    site = w.site("northwind")
    operations(w, site, rounds, "after the save")
    upload(w, site, "after-save.txt", "made after the save")
    w.ok("POST", "/clock", {"frozen_at_ms": MOVED})
    bench_exec("bash", "-c", f"cd sites && ../env/bin/python -c 'import frappe; frappe.init(site=\"{site}\", "
               "sites_path=\".\"); frappe.connect(); frappe.enqueue(\"frappe.ping\"); frappe.db.commit()'")
    return state(w, site)


def reset(w, before, changed):
    site = w.site("northwind")
    answer, ms = w.ok("POST", "/world/reset", {"point": "p1"})
    after = state(w, site)
    on_disk = bench_exec("bash", "-c", f"ls sites/{site}/private/files").split()
    steps = answer["sites"][0]["steps"]
    return {"world": w.name, "client_ms": ms, "door_ms": answer["ms"], "site_ms": answer["sites"][0]["ms"],
            "clock_ms": answer["clock"]["ms"], "steps": steps, "changed_before_reset": digest(changed) != digest(before),
            "equal_after_reset": digest(after) == digest(before), "saved_digest": digest(before),
            "after_digest": digest(after), "clock_after": after["clock"], "files_on_disk_after": on_disk,
            "jobs_removed": steps[2]["jobs_removed"], "differs": differs(before, after)}


def differs(before, after):
    """Each part of the state that differs, with the rows only one side holds."""
    out = {}
    for k in before:
        if before[k] != after[k]:
            if isinstance(before[k], list):
                b, a = [json.dumps(x, sort_keys=True) for x in before[k]], [json.dumps(x, sort_keys=True) for x in after[k]]
                out[k] = {"saved_only": [x for x in b if x not in a], "after_only": [x for x in a if x not in b]}
            else:
                out[k] = {"saved": before[k], "after": after[k]}
    return out


def resets(worlds, before):
    changed = {w.name: change(w) for w in worlds}
    alone = [reset(w, before[w.name], changed[w.name]) for w in worlds[:2]]
    together = at_once(lambda w: reset(w, before[w.name], changed[w.name]), worlds[2:])
    every = alone + together
    check("each world's state changed after the save", all(r["changed_before_reset"] for r in every))
    check("each site reset in place equals its saved point over HTTP", all(r["equal_after_reset"] for r in every),
          {r["world"]: r["differs"] for r in every if r["differs"]})
    check("the file made after the save is gone", all("after-save.txt" not in r["files_on_disk_after"] for r in every))
    check("the job queued after the save was removed", all(r["jobs_removed"] >= 1 for r in every),
          [r["jobs_removed"] for r in every])
    check("each world's clock is back at the saved instant", all(r["clock_after"]["nowdate"] == "2026-12-23"
                                                                 for r in every))
    keep("06-reset", {"one_at_a_time": alone, "two_at_once": together})
    summary["reset_ms"] = {r["world"]: {"door": r["door_ms"], "site": r["site_ms"]} for r in every}


def again(w, before):
    changed = change(w, 5)
    second = reset(w, before[w.name], changed)
    check("a second change and reset of one world equals the same point", second["equal_after_reset"], second["differs"])
    keep("07-reset-again", second)
    summary["second_reset_ms"] = second["door_ms"]


def cleanup(tpl, worlds):
    gone = {w.name: w.ok("DELETE", "/world")[0]["removed"] for w in [tpl] + worlds}
    dropped, _ = tpl.ok("DELETE", "/templates/founded")
    left = bench_exec("bash", "-c", "ls -A sites | grep -v -e '^apps' -e '^common_site_config.json$' "
                      "-e '^assets$' -e '^capxul-world-clocks' -e '^.capxul-door$' || true").split()
    databases = bench_exec("bash", "-c", 'MYSQL_PWD="$DB_ROOT_PASSWORD" mariadb -h mariadb -uroot -N -e "show databases"')
    extra = [d for d in databases.split() if d not in ("information_schema", "mysql", "performance_schema", "sys")]
    check("every site, point, template and pool copy removed", not left and not extra, {"folders": left, "dbs": extra})
    keep("08-cleanup", {"removed": gone, "template": dropped, "site_folders_left": left, "databases_left": extra})


def main():
    t0 = time.monotonic()
    tpl, site = source()
    template(tpl, site)
    worlds = [World(f"w{i}", 1) for i in range(1, 5)]
    claims(worlds)
    ops(worlds)
    # The world is paused while it is saved and reset (step 1.16 pauses it): no background job writes to its sites.
    # The scheduler and the worker are stopped, so a job queued after the save waits in Redis for the reset to remove.
    bench = ["cx-sitepool-scheduler", "cx-sitepool-worker"]
    subprocess.run(["docker", "stop", *bench], check=True, capture_output=True)
    try:
        before = save(worlds)
        resets(worlds, before)
        again(worlds[0], before)
    finally:
        subprocess.run(["docker", "start", *bench], capture_output=True)
    cleanup(tpl, worlds)
    passed = all(c["held"] for c in checks)
    keep("pool.proof", {"outcome": "passed" if passed else "failed", "step": "1.17", "machine": machine(),
                        "total_ms": ms_since(t0), "summary": summary, "checks": checks})
    print("outcome:", "passed" if passed else "failed")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()

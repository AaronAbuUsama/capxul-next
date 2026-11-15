"""Proof on a stand-in bench: four companies made at once (`POST /sites`, then `GET /sites/<site>` until ready), with
the door before blank sites and with this one. Usage: prove.py <door-url> <key-file> <mode> <out.json>.

  old    the door before: each site made from nothing, one at a time across the bench (BENCH_LOCK)
  warm   this door once its blank is made and its pool full (DOOR_BLANK_POOL_SIZE, 4): each a pooled copy, configured
  pool2  this door with a pool of 2: two pooled copies, two copied from the blank on their way
  cold   this door asked the moment it starts, its blank not made yet: the companies wait for it, then copy it

Each company is its own world's (wa to wd), as four `world` runs at once each make their company (Northwind) when
`org.create` lands. The bench's times are the real bench's times a tenth (run.sh): see bench-stand-in.sh and stand-in/.
The time to ready is measured here, from the POST to the first poll that reads `ready`, polled every 0.25 s."""
import hashlib, hmac, json, sys, threading, time, urllib.request

DOOR, KEY, MODE, OUT = sys.argv[1], open(sys.argv[2]).read().strip().encode(), sys.argv[3], sys.argv[4]
began = time.monotonic()
record = {"mode": MODE, "door": DOOR, "companies": {}}
lock = threading.Lock()


def ms_since(t0):
    return round((time.monotonic() - t0) * 1000)


def token(world, quota=1):
    body = f"v1.{world}.{quota}.{int(time.time()) + 3600}"
    return f"{body}.{hmac.new(KEY, body.encode(), hashlib.sha256).hexdigest()}"


def request(method, path, world, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"X-Capxul-Site-Token": token(world), "Content-Type": "application/json"}
    req = urllib.request.Request(DOOR + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def warm_up():
    """Waits until the blank is whole and its pool full; answers how long that took from the door's start."""
    while True:
        _, listed = request("GET", "/templates", "warmup")
        blank = listed.get("blank") or {}
        ready = [s["pool_ready"] for t in listed.get("templates", []) if t["template"] == blank.get("template")
                 for s in t["sites"]]
        if blank.get("usable") and ready and ready[0] >= listed["blank_pool_size"]:
            return {"ms_from_door_start": ms_since(began), "blank": {k: blank.get(k) for k in ("template", "made_ms",
                                                                                                "steps")},
                    "pool_ready": ready[0]}
        time.sleep(0.25)


def company(world):
    site, t0 = f"northwind-{world}.pool.test", time.monotonic()
    status, asked = request("POST", "/sites", world, {"label": "northwind", "company": "Northwind Trading",
                                                      "api_key": "a" * 16, "api_secret": "b" * 32})
    answered = ms_since(t0)
    while True:
        _, state = request("GET", f"/sites/{site}", world)
        if state.get("state") != "creating":
            break
        time.sleep(0.25)
    with lock:
        record["companies"][world] = {"post_status": status, "post_ms": answered, "time_to_ready_ms": ms_since(t0),
                                      "state": state.get("state"), "made_from": state.get("made_from"),
                                      "door_ms": state.get("ms"), "steps": state.get("steps"),
                                      "error": state.get("error")}
    print(MODE, world, state.get("state"), ms_since(t0), "ms", flush=True)


if MODE in ("warm", "pool2"):
    record["warm_up"] = warm_up()
threads = [threading.Thread(target=company, args=(w,)) for w in ("wa", "wb", "wc", "wd")]
t_all = time.monotonic()
for each in threads:
    each.start()
for each in threads:
    each.join()
whole = ms_since(t_all)
for world in record["companies"]:
    request("DELETE", "/world", world)
times = sorted(c["time_to_ready_ms"] for c in record["companies"].values())
record["verdict"] = {"every_company_ready": all(c["state"] == "ready" for c in record["companies"].values()),
                     "time_to_ready_ms": times, "slowest_ms": times[-1], "mean_ms": round(sum(times) / len(times)),
                     "all_four_ms": whole,
                     "how": sorted(str((c["made_from"] or {}).get("how", "nothing")) for c in record["companies"].values())}
with open(OUT, "w") as f:
    json.dump(record, f, indent=1)
print(json.dumps(record["verdict"]))

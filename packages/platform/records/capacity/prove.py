"""Proof on a stand-in bench: four runs at once never wait on one request past Cloudflare's edge limit once the door
runs long calls as jobs (door/jobs.py). Usage: prove.py <door-url> <key-file> <mode> <edge-s> <out.json>.

Each run does at the door what a CI run's one world does with its company site (packages/world, src/site): its site
made from nothing, kept as a bench template, saved to a point, removed (a reset to `fresh`), claimed back from the
template (a reset to `payment-drafted`), saved again, reset in place, its clock set, and its world's sites removed.
The four start 0.3 s apart, as four `world` runs did on 14 November 2026, and go on together once every site is
ready. run.sh makes the bench busy as it was then:
one FAST slot (DOOR_FAST_SLOTS=1) for four runs, and each claim's join JOIN_SECONDS long, so the claims, saves and
resets queue behind one another.

  old         the door before jobs, asked as packages/world asked before: each call answers when its work is done
  new         this checkout's door, asked with `Prefer: respond-async`: each call answers within DOOR_JOB_WAIT_S, 202
              while it runs, and is polled at `GET /world/jobs/<job>` until it ends
  old-client  this checkout's door asked without the header, as a client from before jobs asks: answered when done

Every request's time is measured here; `edge_s` is Cloudflare's 100 s limit, scaled as the bench's times are."""
import hashlib, hmac, json, sys, threading, time, urllib.request

DOOR, KEY, MODE, EDGE_S, OUT = sys.argv[1], open(sys.argv[2]).read().strip().encode(), sys.argv[3], float(sys.argv[4]), \
    sys.argv[5]
PREFER = MODE == "new"
cred = {"api_key": "a" * 16, "api_secret": "b" * 32}
record = {"mode": MODE, "door": DOOR, "edge_s": EDGE_S, "runs": {}}
lock = threading.Lock()
began = time.monotonic()


def token(world, quota=3):
    body = f"v1.{world}.{quota}.{int(time.time()) + 3600}"
    return f"{body}.{hmac.new(KEY, body.encode(), hashlib.sha256).hexdigest()}"


def request(method, path, world, body=None, prefer=False):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"X-Capxul-Site-Token": token(world), "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = "respond-async"
    req = urllib.request.Request(DOOR + path, data=data, method=method, headers=headers)
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            status, answer = r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        status, answer = e.code, json.loads(e.read() or b"{}")
    return status, answer, round((time.monotonic() - t0) * 1000)


def call(steps, name, method, path, world, body=None):
    """One call, followed to its end when the door answers 202; every request it took is recorded."""
    t0, requests = time.monotonic(), []
    status, answer, ms = request(method, path, world, body, PREFER)
    requests.append(ms)
    while status == 202 and "job" in answer:
        status, answer, ms = request("GET", f"/world/jobs/{answer['job']}", world)
        requests.append(ms)
    steps.append({"step": name, "status": status, "ms": round((time.monotonic() - t0) * 1000), "requests_ms": requests,
                  "refused": answer.get("refused") if isinstance(answer, dict) else None})
    return status, answer


def run(world):
    steps, site = [], f"northwind-{world}.pool.test"
    template, at = f"payment-drafted-3f9a0c1d-{world}", round((time.monotonic() - began) * 1000)
    status, _ = call(steps, "make its site from nothing (POST /sites)", "POST", "/sites", world,
                     {"label": "northwind", "company": "Northwind Trading", **cred})
    t0, polls = time.monotonic(), []
    while True:
        _, answer, ms = request("GET", f"/sites/{site}", world)
        polls.append(ms)
        if answer.get("state") != "creating":
            break
        time.sleep(0.3)
    steps.append({"step": "until it is ready (GET /sites/<site>)", "ms": round((time.monotonic() - t0) * 1000),
                  "requests_ms": [max(polls)], "polls": len(polls)})
    # The four runs' resets come together, as the four runs' journeys did once their starting worlds were made.
    together.wait()
    call(steps, "keep it as a template (POST /templates)", "POST", "/templates", world, {"template": template,
                                                                                       "site": site})
    call(steps, "save a point (POST /world/save)", "POST", "/world/save", world, {"point": "p1"})
    call(steps, "reset to fresh: remove its site (DELETE /sites/<site>)", "DELETE", f"/sites/{site}", world)
    call(steps, "reset to payment-drafted: claim (POST /world/claim)", "POST", "/world/claim", world,
         {"template": template, **cred, "clock": {"offset_ms": 0}})
    call(steps, "save the point again (POST /world/save)", "POST", "/world/save", world, {"point": "p1"})
    call(steps, "reset in place (POST /world/reset)", "POST", "/world/reset", world, {"point": "p1"})
    call(steps, "set its clock (POST /clock)", "POST", "/clock", world, {"offset_ms": 0})
    call(steps, "take it down (DELETE /world)", "DELETE", "/world", world)
    longest = max(ms for s in steps for ms in s.get("requests_ms", [s["ms"]]))
    with lock:
        record["runs"][world] = {"started_at_ms": at, "steps": steps, "longest_request_ms": longest,
                                 "every_call_ended_well": all(s.get("status", 200) < 300 for s in steps)}
    print(world, "done; longest request", longest, "ms", flush=True)


worlds = ["wa", "wb", "wc", "wd"] if MODE != "old-client" else ["we"]
together = threading.Barrier(len(worlds))
threads = [threading.Thread(target=run, args=(w,)) for w in worlds]
for each in threads:
    each.start()
    time.sleep(0.3)
for each in threads:
    each.join()
longest = max(r["longest_request_ms"] for r in record["runs"].values())
over = sorted({s["step"] for r in record["runs"].values() for s in r["steps"]
               if any(ms > EDGE_S * 1000 for ms in s.get("requests_ms", []))})
record["verdict"] = {"longest_request_ms": longest, "edge_ms": EDGE_S * 1000, "within_the_edge": longest < EDGE_S * 1000,
                     "calls_whose_request_outlasted_the_edge (a 524 through Cloudflare)": over,
                     "every_call_ended_well": all(r["every_call_ended_well"] for r in record["runs"].values()),
                     "whole_ms": round((time.monotonic() - began) * 1000)}
with open(OUT, "w") as f:
    json.dump(record, f, indent=1)
print(json.dumps(record["verdict"], indent=1))

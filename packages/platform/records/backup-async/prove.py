"""Proof on a stand-in bench: while another world's site is made from nothing (the bench lock held 130 s), a world's
backup, its save through packages/world's client, and the removal of a ready site each answer the request in well under
Cloudflare's 100 s. Usage: prove.py <door-url> <key-file> <label> <out.json>. Times are measured here.

The door was door/door.py of this change (and, for old-door.json, of the commit before it) run as
`python3 door/door.py` with DOOR_PORT, DOOR_KEY (the key file), DB_ROOT_PASSWORD, PLATFORM_DOMAIN=pool.test,
FRAPPE_BENCH (an empty folder holding sites/ and an env/bin/python that exits 0), PYTHONPATH naming a stand-in
pymysql that refuses to connect, and PATH starting with a folder holding bench-stand-in.sh as `bench`. save.ts.txt,
saved beside this file as save.ts with packages/world's node_modules reachable, is packages/world's own backUp."""
import hashlib, hmac, json, os, subprocess, sys, time, urllib.request

DOOR, KEY, LABEL, OUT = sys.argv[1], open(sys.argv[2]).read().strip().encode(), sys.argv[3], sys.argv[4]
HERE = os.path.dirname(os.path.abspath(__file__))
TOKENS = f"{HERE}/tokens"
os.makedirs(TOKENS, exist_ok=True)


def token(world, quota=2):
    body = f"v1.{world}.{quota}.{int(time.time()) + 3600}"
    return f"{body}.{hmac.new(KEY, body.encode(), hashlib.sha256).hexdigest()}"


def call(method, path, world, body=None, timeout=400):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(DOOR + path, data=data, method=method,
                                 headers={"X-Capxul-Site-Token": token(world), "Content-Type": "application/json"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, answer = r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        status, answer = e.code, json.loads(e.read() or b"{}")
    return status, answer, round((time.monotonic() - t0) * 1000)


def ready(world, site):
    while call("GET", f"/sites/{site}", world)[1].get("state") == "creating":
        time.sleep(0.5)


cred = {"api_key": "a" * 16, "api_secret": "b" * 32}
w1, w2, w3 = f"pa{LABEL}", f"pb{LABEL}", f"pc{LABEL}"
record = {"label": LABEL, "door": DOOR, "steps": []}
step = lambda name, **kw: (record["steps"].append({"step": name, **kw}), print(name, kw, flush=True))

for world in (w1, w3):
    s, a, ms = call("POST", "/sites", world, {"label": "northwind", "company": "Northwind", **cred})
    ready(world, a["site"])
    step(f"{world}: site made (stand-in, 1 s)", status=s, ms=ms)
s, a, ms = call("POST", "/sites", w2, {"label": "slow", "company": "Other", **cred})
step(f"{w2}: another world's site asked, made from nothing for 130 s under the bench lock", status=s, ms=ms)
time.sleep(2)
t_slow = time.monotonic()

import threading


def removal():
    s, a, ms = call("DELETE", f"/sites/northwind-{w3}.pool.test", w3)
    step("DELETE /sites/<ready site> while the bench is busy", status=s, ms=ms, answer=a)


def backup():
    s, a, ms = call("POST", "/world/backup", w1, {"snapshot": "founded"})
    step("POST /world/backup {founded} while the bench is busy: the request alone", status=s, ms=ms, answer=a)


def save():
    env = {**os.environ, "DOOR_URL": DOOR, "TOKEN_FILE": f"{TOKENS}/{w1}", "SNAPSHOT": "payment-drafted"}
    with open(env["TOKEN_FILE"], "w") as f:
        f.write(token(w1))
    t0 = time.monotonic()
    out = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", f"{HERE}/save.ts"], env=env,
                         cwd=HERE, capture_output=True, text=True, timeout=900)
    step("world.site.save's backUp through the door (POST /world/backup, then GET until saved)",
         exit=out.returncode, ms=round((time.monotonic() - t0) * 1000), out=out.stdout.strip()[-400:],
         err=out.stderr.strip()[-600:])


workers = [threading.Thread(target=f) for f in (removal, backup, save)]
for w in workers:
    w.start()
    time.sleep(0.3)
for w in workers:
    w.join()
s, a, ms = call("GET", "/world/backup/payment-drafted", w1)
step("GET /world/backup/payment-drafted afterwards", status=s, ms=ms, answer=a)
record["slowSiteHeldTheBenchForMs"] = round((time.monotonic() - t_slow) * 1000)
for world in (w1, w2, w3):
    call("DELETE", "/world", world)
with open(OUT, "w") as f:
    json.dump(record, f, indent=1)

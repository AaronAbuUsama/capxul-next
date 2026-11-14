"""Proof on a stand-in bench: two runs at once share one bench's templates without breaking each other (decision "Bench
templates never change", 14 November 2026). Usage: prove.py <door-url> <key-file> <old|new> <out.json>.

Each run does at the door what the runner's run in one world does with its one world's company site (packages/runner,
src/worlds): its site made from nothing, then kept as a bench template once the starting world is saved; removed by a
reset to `fresh`; claimed back from the template by a reset to `payment-drafted`; and, in `old`, the template dropped at
the run's end. Run B starts while run A is going, as two CI `world` runs at once would:

  old  the template is named after the starting world, `payment-drafted`, as the door and the runner had it: B's keep
       replaces A's template, so A claims a copy of B's site (B's company facts in A's world), A's end drops it, and
       B's claim finds none: "the bench keeps no template payment-drafted to claim them from"
  new  the template is named `<starting world>-<code>-<world>` (packages/world, src/site/Templates.ts) and never
       dropped by a run: each run claims its own. Then: the door never changes a template that exists (a second make
       of a name, at once or after, makes nothing); the sweep keeps what was used lately and removes what was not

run.sh starts door/door.py (this checkout's for `new`, the commit before it for `old`) on a stand-in bench and runs
this against it. Times are measured here; the stand-in's site takes 1 s to make, a copy of a database nothing."""
import hashlib, hmac, json, sys, threading, time, urllib.request

DOOR, KEY, MODE, OUT = sys.argv[1], open(sys.argv[2]).read().strip().encode(), sys.argv[3], sys.argv[4]
CODE = "3f9a0c1d"  # what the runner fingerprints its code as; any 8 hex digits for this proof
cred = {"api_key": "a" * 16, "api_secret": "b" * 32}
record = {"mode": MODE, "door": DOOR, "steps": []}
began = time.monotonic()
lock = threading.Lock()


def step(who, name, **kw):
    with lock:
        record["steps"].append({"at_ms": round((time.monotonic() - began) * 1000), "who": who, "step": name, **kw})
        print(who, name, kw, flush=True)


def token(world, quota=2):
    body = f"v1.{world}.{quota}.{int(time.time()) + 3600}"
    return f"{body}.{hmac.new(KEY, body.encode(), hashlib.sha256).hexdigest()}"


def call(method, path, world, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(DOOR + path, data=data, method=method,
                                 headers={"X-Capxul-Site-Token": token(world), "Content-Type": "application/json"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            status, answer = r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        status, answer = e.code, json.loads(e.read() or b"{}")
    return status, answer, round((time.monotonic() - t0) * 1000)


def template_of(world):
    return "payment-drafted" if MODE == "old" else f"payment-drafted-{CODE}-{world}"


def made_by(template):
    listed = call("GET", "/templates", "wa")[1]["templates"]
    return next((t["sites"][0]["made_by"] for t in listed if t["template"] == template), None)


kept_by_b, a_ended = threading.Event(), threading.Event()


def run(world, me):
    site = f"northwind-{world}.pool.test"
    s, a, ms = call("POST", "/sites", world, {"label": "northwind", "company": "Northwind Trading", **cred})
    while call("GET", f"/sites/{site}", world)[1].get("state") == "creating":
        time.sleep(0.2)
    step(me, "founded: its site made from nothing (POST /sites, then until ready)", status=s)
    if me == "B":
        time.sleep(0.5)
    s, a, ms = call("POST", "/templates", world, {"template": template_of(world), "site": site})
    step(me, f"payment-drafted saved: its site kept as template {template_of(world)}", status=s, ms=ms,
         made=a.get("made", "the door before says nothing"), made_by=made_by(template_of(world)))
    if me == "B":
        kept_by_b.set()
    s, a, ms = call("DELETE", f"/sites/{site}", world)
    step(me, "reset to fresh: its site removed", status=s, ms=ms)
    if me == "A":
        kept_by_b.wait(30)
    else:
        a_ended.wait(30)
    template = template_of(world)
    holder = made_by(template)
    s, a, ms = call("POST", "/world/claim", world, {"template": template, **cred})
    claimed = (a.get("sites") or [{}])[0]
    step(me, f"reset to payment-drafted: its site claimed from {template}", status=s, ms=ms,
         refused=a.get("refused"), state=claimed.get("state"), copy_of_world=holder,
         its_own_company_facts=holder == world if s == 200 else None)
    if me == "A":
        if MODE == "old":
            s, a, ms = call("DELETE", f"/templates/{template}", world)
            step(me, f"the run's end: template {template} dropped", status=s, ms=ms)
        else:
            step(me, f"the run's end: template {template} left for the sweep")
        a_ended.set()


runs = [threading.Thread(target=run, args=("wa", "A")), threading.Thread(target=run, args=("wb", "B"))]
for each in runs:
    each.start()
    time.sleep(0.4)
for each in runs:
    each.join()

if MODE == "new":
    same = "payment-drafted-3f9a0c1d-wc"
    s, a, ms = call("POST", "/sites", "wc", {"label": "northwind", "company": "Northwind Trading", **cred})
    while call("GET", f"/sites/northwind-wc.pool.test", "wc")[1].get("state") == "creating":
        time.sleep(0.2)
    answers = []
    makes = [threading.Thread(target=lambda: answers.append(
        call("POST", "/templates", "wc", {"template": same, "site": "northwind-wc.pool.test"}))) for _ in range(2)]
    for each in makes:
        each.start()
    for each in makes:
        each.join()
    step("C", f"two makes of template {same} at once", made=sorted(a.get("made") for _, a, _ in answers),
         statuses=[s for s, _, _ in answers], same_database=len({a["sites"][0]["db"] for _, a, _ in answers}) == 1)
    s, a, ms = call("POST", "/templates", "wb", {"template": same, "site": "northwind-wb.pool.test"})
    step("B", f"another world asks for template {same} with its own site", status=s, made=a.get("made"),
         made_by=(a.get("sites") or [{}])[0].get("made_by"), refused=a.get("refused"))
    s, a, ms = call("POST", "/templates/sweep", "wa", {"idle_s": 1})
    step("sweep", "idle_s under the door's floor (2 s for this proof, an hour by default)", status=s,
         refused=a.get("refused"))
    s, a, ms = call("POST", "/templates/sweep", "wa", {"idle_s": 30})
    step("sweep", "idle over 30 s: every template was used within it", status=s,
         removed=[t["template"] for t in a["removed"]], kept=[t["template"] for t in a["kept"]], busy=a["busy"])
    time.sleep(3.2)
    call("DELETE", "/world", "wc")
    s, a, ms = call("POST", "/world/claim", "wc", {"template": same, **cred})
    step("C", f"claims from {same} again: it is used", status=s)
    s, a, ms = call("POST", "/templates/sweep", "wa", {"idle_s": 3, "dry_run": True})
    step("sweep", "dry run, idle over 3 s", removed=[t["template"] for t in a["removed"]],
         kept=[t["template"] for t in a["kept"]])
    s, a, ms = call("POST", "/templates/sweep", "wa", {"idle_s": 3})
    step("sweep", "idle over 3 s: the two runs' templates go, the one just claimed from stays", status=s,
         removed=[t["template"] for t in a["removed"]], kept=[t["template"] for t in a["kept"]], ms=ms)
    time.sleep(3.2)
    s, a, ms = call("POST", "/templates/sweep", "wa", {"idle_s": 3})
    step("sweep", "idle over 3 s, 3 s later", status=s, removed=[t["template"] for t in a["removed"]],
         kept=[t["template"] for t in a["kept"]])
    s, a, ms = call("GET", "/health", "wa")
    record["health"] = a

for world in ("wa", "wb", "wc"):
    call("DELETE", "/world", world)
record["templatesLeft"] = [t["template"] for t in call("GET", "/templates", "wa")[1]["templates"]]
with open(OUT, "w") as f:
    json.dump(record, f, indent=1)

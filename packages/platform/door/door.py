"""The site door of the shared bench: the only way a world gets, uses and gives back a company site, with a token
scoped to that world.

A world's token is minted when the world is created (src/token.ts) and reads `v1.<world>.<quota>.<expires>.<sig>`:
the world's name (the blueprint's WorldName), how many sites it may hold, when the token stops working (Unix
seconds, real time) and an HMAC-SHA256 over the rest under the door's key, which only the platform holds. The door
checks, in order:

1. the signature (so a world cannot widen its own claims), then the expiry;
2. the site's name: it must be `<label>-<world>.<domain>` (roadmap, "Test addresses": `<company>-<world>`), so a world
   names sites only in its own namespace, and a label has no dash, so the name says whose it is;
3. that the site is the token's world's, for every call about one site: a second world's token is refused;
4. for a new site, the quota: the sites the door's registry holds for this world, being made ones included.

The site's world is taken from the token, never from the request. Nothing revokes a token before it expires; a new
door key revokes every token. A token with quota 0 still reads and removes its world's sites: the sweeper mints one
for a world that has expired.

The token travels in `X-Capxul-Site-Token` (or `Authorization: Bearer`, except on a call to a site, where
`Authorization` is the site's own credential).

POST   /sites {"label", "company", "api_key", "api_secret"}   starts making the site (about 100 s) and answers 202:
       the site joins the token's world and gets its own API user, `capxul-core@service.invalid`, with the roles in
       CORE_ROLES and the key and secret the world sent. Never the bench's Administrator.
GET    /sites/<site>                  the site's state: creating, ready or failed, with each step's time
DELETE /sites/<site>                  removes the site: its database, its user and its folder
DELETE /world                         removes every site of the token's world
GET    /world                         the token's claims and the world's sites
ANY    /sites/<site>/api/...          a call to the site's own REST API, as the user `Authorization: token k:s` names;
                                      cookies are dropped, and any other kind of credential is refused
POST   /clock {"frozen_at_ms": n} or {"offset_ms": n}   sets the world's clock, through one of its sites
GET    /health
"""

import glob
import hashlib
import hmac
import http.client
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

KEY = os.environ["DOOR_KEY"].encode()
DB_ROOT = os.environ["DB_ROOT_PASSWORD"]
DOMAIN = os.environ["PLATFORM_DOMAIN"]
PORT = int(os.environ.get("DOOR_PORT", "8100"))
WEB = urlsplit(os.environ.get("WEB_URL", "http://web:8000"))
BENCH = "/home/frappe/frappe-bench"
REGISTRY = f"{BENCH}/sites/.capxul-door"
# The blueprint's WorldName (packages/blueprint/src/values.ts), which src/token.ts checks too.
WORLD = r"[a-z][a-z0-9-]{0,13}[a-z0-9]"
TOKEN = re.compile(rf"^v1\.({WORLD})\.([0-9]{{1,3}})\.([0-9]{{10}})\.([0-9a-f]{{64}})$")
LABEL = re.compile(r"^[a-z0-9]{1,12}$")
SECRET = re.compile(r"^[A-Za-z0-9]{10,64}$")
SITE_CALL = re.compile(r"^/sites/([a-z0-9.-]+)(/api/.*)$")
CORE_USER = "capxul-core@service.invalid"
CORE_ROLES = ["Accounts User", "Purchase User", "Sales User"]
FORWARDED = ("Authorization", "Content-Type", "Accept", "X-Capxul-Trace", "Traceparent")

# One lock for the registry (so two requests cannot both pass a quota) and one for the bench (one site is made or
# removed at a time: each is a minute of the machine's CPU).
REGISTRY_LOCK = threading.Lock()
BENCH_LOCK = threading.Lock()


class Refused(Exception):
    def __init__(self, status, code, detail=""):
        super().__init__(code)
        self.status, self.code, self.detail = status, code, detail


def claims(headers, site_call=False):
    given = headers.get("X-Capxul-Site-Token")
    if not given and not site_call:
        bearer = headers.get("Authorization") or ""
        given = bearer[len("Bearer "):] if bearer.startswith("Bearer ") else None
    if not given:
        raise Refused(401, "token-missing")
    m = TOKEN.match(given.strip())
    if not m:
        raise Refused(401, "token-malformed")
    world, quota, expires, sig = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
    body = f"v1.{world}.{quota}.{expires}"
    if not hmac.compare_digest(hmac.new(KEY, body.encode(), hashlib.sha256).hexdigest(), sig):
        raise Refused(403, "token-signature-invalid")
    if time.time() >= expires:
        raise Refused(403, "token-expired", f"expired at {expires}")
    return {"world": world, "quota": quota, "expires": expires}


# The registry: one file per site the door has made or is making, on the sites volume, so it survives a restart.

def entry_path(site):
    return f"{REGISTRY}/{site}.json"


def read_entry(site):
    try:
        with open(entry_path(site)) as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def write_entry(entry):
    os.makedirs(REGISTRY, exist_ok=True)
    tmp = f"{entry_path(entry['site'])}.tmp"
    with open(tmp, "w") as f:
        json.dump(entry, f)
    os.replace(tmp, entry_path(entry["site"]))


def update_entry(site, **changes):
    with REGISTRY_LOCK:
        entry = read_entry(site) or {"site": site}
        entry.update(changes)
        write_entry(entry)
        return entry


def entries_of(world):
    found = []
    for path in sorted(glob.glob(f"{REGISTRY}/*.json")):
        with open(path) as f:
            entry = json.load(f)
        if entry.get("world") == world:
            found.append(entry)
    return found


def site_of(c, site):
    """The token's world's site, or a refusal: a site of another world is refused as if it were not there to see."""
    entry = read_entry(site)
    if entry is None or entry.get("world") != c["world"]:
        raise Refused(403, "site-not-in-world", f"{site} is not a site of world {c['world']}")
    return entry


def public(entry):
    return {k: entry.get(k) for k in ("site", "world", "company", "state", "ms", "steps", "error")}


def bench(*args, env=None):
    t0 = time.monotonic()
    out = subprocess.run(["bench", *args], cwd=BENCH, capture_output=True, text=True, timeout=900, env=env)
    if out.returncode != 0:
        raise Refused(500, "bench-failed", f"bench {args[:3]}: {(out.stderr or out.stdout)[-600:]}")
    return out.stdout, round((time.monotonic() - t0) * 1000)


# The site's own API user, made by a plain Python process of the bench (capxul/boot.py arms the world's clock in it).
# The key and secret reach it through its environment, never its arguments.
CORE_USER_SCRIPT = """
import os, frappe
frappe.init(site=os.environ["SITE"], sites_path=".")
frappe.connect()
user = frappe.new_doc("User")
user.update({"email": os.environ["CORE_USER"], "first_name": "Capxul Core", "user_type": "System User",
             "send_welcome_email": 0, "enabled": 1})
for role in os.environ["CORE_ROLES"].split(","):
    user.append("roles", {"role": role})
user.api_key = os.environ["CORE_KEY"]
user.api_secret = os.environ["CORE_SECRET"]
user.insert(ignore_permissions=True)
frappe.db.commit()
print(user.name)
"""


def make_core_user(site, key, secret):
    t0 = time.monotonic()
    env = {**os.environ, "SITE": site, "CORE_USER": CORE_USER, "CORE_ROLES": ",".join(CORE_ROLES),
           "CORE_KEY": key, "CORE_SECRET": secret}
    out = subprocess.run([f"{BENCH}/env/bin/python", "-c", CORE_USER_SCRIPT], cwd=f"{BENCH}/sites",
                         capture_output=True, text=True, timeout=300, env=env)
    if out.returncode != 0:
        raise Refused(500, "bench-failed", f"core user: {(out.stderr or out.stdout)[-600:]}")
    return round((time.monotonic() - t0) * 1000)


def build(site, world, company, key, secret):
    wizard = {"company_name": company, "currency": "USD", "country": "United Kingdom"}
    plan = [
        ("new-site", ["new-site", site, "--mariadb-user-host-login-scope=%", "--db-root-password", DB_ROOT,
                      "--admin-password", secrets.token_hex(16)]),
        ("install erpnext", ["--site", site, "install-app", "erpnext"]),
        ("install capxul", ["--site", site, "install-app", "capxul"]),
        ("setup wizard", ["--site", site, "execute", "capxul.setup.run_wizard", "--kwargs", json.dumps(wizard)]),
        ("migrate", ["--site", site, "migrate"]),
        ("enable scheduler", ["--site", site, "enable-scheduler"]),
        ("join world", ["--site", site, "execute", "capxul.clock.join_world", "--kwargs", json.dumps({"world": world})]),
    ]
    steps, t0 = [], time.monotonic()
    with BENCH_LOCK:
        try:
            for name, args in plan:
                if (read_entry(site) or {}).get("state") != "creating":
                    return
                _, ms = bench(*args)
                steps.append({"step": name, "ms": ms})
                update_entry(site, steps=steps)
                print(f"door: {site} {name} {ms} ms", flush=True)
            steps.append({"step": "core user", "ms": make_core_user(site, key, secret)})
            update_entry(site, state="ready", steps=steps, ms=round((time.monotonic() - t0) * 1000))
            print(f"door: {site} ready", flush=True)
        except Exception as e:  # noqa: BLE001 -- a site that could not be made says why; nothing else is told
            detail = e.detail if isinstance(e, Refused) else repr(e)
            update_entry(site, state="failed", steps=steps, error=detail[-600:])
            print(f"door: {site} failed: {detail[-300:]}", flush=True)


def create_site(c, body):
    label, company = body.get("label", ""), body.get("company", "")
    key, secret = body.get("api_key", ""), body.get("api_secret", "")
    if not LABEL.match(label):
        raise Refused(400, "site-label-invalid", "1 to 12 of a-z and 0-9")
    if not company or len(company) > 140:
        raise Refused(400, "company-invalid", "1 to 140 characters")
    if not SECRET.match(key) or not SECRET.match(secret):
        raise Refused(400, "credential-invalid", "api_key and api_secret: 10 to 64 letters and digits")
    site = f"{label}-{c['world']}.{DOMAIN}"
    with REGISTRY_LOCK:
        held = entries_of(c["world"])
        if len(held) >= c["quota"]:
            names = [e["site"] for e in held]
            raise Refused(403, "site-quota-reached", f"world {c['world']} holds {len(held)} of {c['quota']}: {names}")
        if read_entry(site) is not None or os.path.exists(f"{BENCH}/sites/{site}"):
            raise Refused(409, "site-exists", site)
        entry = {"site": site, "world": c["world"], "company": company, "state": "creating", "steps": [],
                 "ms": None, "error": None, "asked_at": int(time.time())}
        write_entry(entry)
    threading.Thread(target=build, args=(site, c["world"], company, key, secret), daemon=True).start()
    return public(entry)


def drop_database(site):
    """What a half-made site may leave in MariaDB when `drop-site` cannot run: its database and its user."""
    try:
        with open(f"{BENCH}/sites/{site}/site_config.json") as f:
            conf = json.load(f)
    except (FileNotFoundError, ValueError):
        return
    name = conf.get("db_name")
    if not name or not re.match(r"^[A-Za-z0-9_]+$", name):
        return
    user = conf.get("db_user") or name
    sql = f"DROP DATABASE IF EXISTS `{name}`; DROP USER IF EXISTS '{user}'@'%'; DROP USER IF EXISTS '{user}'@'localhost';"
    subprocess.run(["mariadb", "-h", "mariadb", "-uroot", f"-p{DB_ROOT}", "-e", sql], capture_output=True, timeout=60)


def remove_site(site):
    update_entry(site, state="removing")
    t0 = time.monotonic()
    with BENCH_LOCK:
        if os.path.exists(f"{BENCH}/sites/{site}"):
            archive = tempfile.mkdtemp(prefix="dropped-", dir=f"{BENCH}/sites/.capxul-door")
            try:
                bench("drop-site", site, "--db-root-password", DB_ROOT, "--no-backup", "--force",
                      "--archived-sites-path", archive)
            except Refused:
                drop_database(site)
            shutil.rmtree(archive, ignore_errors=True)
            shutil.rmtree(f"{BENCH}/sites/{site}", ignore_errors=True)
        with REGISTRY_LOCK:
            if os.path.exists(entry_path(site)):
                os.remove(entry_path(site))
    ms = round((time.monotonic() - t0) * 1000)
    print(f"door: {site} removed in {ms} ms", flush=True)
    return {"site": site, "removed": True, "ms": ms}


def set_clock(c, body):
    held = [e["site"] for e in entries_of(c["world"]) if e.get("state") == "ready"]
    if not held:
        raise Refused(409, "world-has-no-site")
    kwargs = {"world": c["world"], "offset_ms": int(body.get("offset_ms", 0))}
    if "frozen_at_ms" in body:
        kwargs["frozen_at_ms"] = int(body["frozen_at_ms"])
    out, ms = bench("--site", held[0], "execute", "capxul.clock.write_world", "--kwargs", json.dumps(kwargs))
    return {"world": c["world"], "via": held[0], "ms": ms, "result": out.strip()[-300:]}


class Door(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def answer(self, status, payload, content_type="application/json"):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def site_call(self, method, site, rest):
        c = claims(self.headers, site_call=True)
        entry = site_of(c, site)
        if entry.get("state") != "ready":
            raise Refused(503, f"site-{entry.get('state')}", site)
        credential = self.headers.get("Authorization") or ""
        if not credential.startswith("token "):
            raise Refused(401, "site-credential-missing", "Authorization: token <key>:<secret>, the site's own user")
        headers = {h: self.headers[h] for h in FORWARDED if self.headers.get(h)}
        headers["Host"] = site
        connection = http.client.HTTPConnection(WEB.hostname, WEB.port or 80, timeout=120)
        try:
            connection.request(method, rest, body=self.body() or None, headers=headers)
            response = connection.getresponse()
            data = response.read()
            return self.answer(response.status, data, response.getheader("Content-Type") or "application/json")
        finally:
            connection.close()

    def handle_one(self, method):
        route = (method, self.path)
        try:
            if route == ("GET", "/health"):
                return self.answer(200, {"ok": True})
            m = SITE_CALL.match(self.path)
            if m:
                return self.site_call(method, m.group(1), m.group(2))
            c = claims(self.headers)
            if route == ("GET", "/world"):
                return self.answer(200, {**c, "sites": [public(e) for e in entries_of(c["world"])]})
            if route == ("DELETE", "/world"):
                gone = [remove_site(e["site"]) for e in entries_of(c["world"])]
                return self.answer(200, {"world": c["world"], "removed": gone})
            if method in ("GET", "DELETE") and self.path.startswith("/sites/"):
                entry = site_of(c, self.path[len("/sites/"):])
                return self.answer(200, public(entry) if method == "GET" else remove_site(entry["site"]))
            body = json.loads(self.body() or b"{}")
            if route == ("POST", "/sites"):
                return self.answer(202, create_site(c, body))
            if route == ("POST", "/clock"):
                return self.answer(200, set_clock(c, body))
            raise Refused(404, "no-such-route")
        except Refused as r:
            print(f"door: refused {method} {self.path.split('/api/')[0]} {r.code} {r.detail[:200]}", flush=True)
            return self.answer(r.status, {"refused": r.code, "detail": r.detail})

    def do_GET(self):
        self.handle_one("GET")

    def do_POST(self):
        self.handle_one("POST")

    def do_PUT(self):
        self.handle_one("PUT")

    def do_DELETE(self):
        self.handle_one("DELETE")

    def log_message(self, fmt, *args):
        print("door:", (fmt % args).split("?")[0], flush=True)


if __name__ == "__main__":
    # A site left `creating` by a door that stopped half-way is not being made any more.
    for path in glob.glob(f"{REGISTRY}/*.json"):
        with open(path) as f:
            stale = json.load(f)
        if stale.get("state") in ("creating", "removing"):
            update_entry(stale["site"], state="failed", error="the door restarted while it was being made or removed")
    print(f"door: serving on {PORT} for {DOMAIN}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Door).serve_forever()

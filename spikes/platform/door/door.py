"""The site door of the shared bench: the only way a world gets a company site, with a token scoped to that world.

A world's token is minted when the world is created (src/token.ts) and reads `v1.<world>.<quota>.<expires>.<sig>`:
the world's name, how many sites it may hold, when the token stops working (Unix seconds, real time) and an
HMAC-SHA256 over the rest under the door's key, which only the platform holds. The door checks, in order:

1. the signature (so a world cannot widen its own claims), then the expiry;
2. the site's name: it must be `<world>-<label>.<domain>`, so a world names sites only in its own namespace;
3. the quota: the sites on the bench whose `capxul_world` is this world, counted from their site_config.json;
4. that the site does not exist yet.

The site's world is taken from the token, never from the request. The door serves one request at a time, so two
requests cannot both pass the quota. Nothing revokes a token before it expires; a new door key revokes every token.

POST /sites {"label": "r1"}           creates the site and joins it to the token's world (about 100 s)
POST /clock {"frozen_at_ms": n} or {"offset_ms": n}   sets the world's clock, through one of its sites
GET  /world                           the token's claims and the world's sites
GET  /health
"""

import glob
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

KEY = os.environ["DOOR_KEY"].encode()
DB_ROOT = os.environ["DB_ROOT_PASSWORD"]
DOMAIN = os.environ["PLATFORM_DOMAIN"]
PORT = int(os.environ.get("DOOR_PORT", "8100"))
BENCH = "/home/frappe/frappe-bench"
TOKEN = re.compile(r"^v1\.([a-z][a-z0-9]{1,15})\.([0-9]{1,3})\.([0-9]{10})\.([0-9a-f]{64})$")
LABEL = re.compile(r"^[a-z0-9]{1,12}$")


class Refused(Exception):
    def __init__(self, status, code, detail=""):
        super().__init__(code)
        self.status, self.code, self.detail = status, code, detail


def claims(header):
    if not header or not header.startswith("Bearer "):
        raise Refused(401, "token-missing")
    m = TOKEN.match(header[len("Bearer "):].strip())
    if not m:
        raise Refused(401, "token-malformed")
    world, quota, expires, sig = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
    body = f"v1.{world}.{quota}.{expires}"
    if not hmac.compare_digest(hmac.new(KEY, body.encode(), hashlib.sha256).hexdigest(), sig):
        raise Refused(403, "token-signature-invalid")
    if time.time() >= expires:
        raise Refused(403, "token-expired", f"expired at {expires}")
    return {"world": world, "quota": quota, "expires": expires}


def sites_of(world):
    found = []
    for path in sorted(glob.glob(f"{BENCH}/sites/*/site_config.json")):
        with open(path) as f:
            if json.load(f).get("capxul_world") == world:
                found.append(os.path.basename(os.path.dirname(path)))
    return found


def bench(*args):
    t0 = time.monotonic()
    out = subprocess.run(["bench", *args], cwd=BENCH, capture_output=True, text=True, timeout=900)
    if out.returncode != 0:
        raise Refused(500, "bench-failed", f"bench {args[:3]}: {(out.stderr or out.stdout)[-600:]}")
    return out.stdout, round((time.monotonic() - t0) * 1000)


def create_site(c, body):
    label = body.get("label", "")
    if not LABEL.match(label):
        raise Refused(400, "site-label-invalid", "1 to 12 of a-z and 0-9")
    site = f"{c['world']}-{label}.{DOMAIN}"
    held = sites_of(c["world"])
    if len(held) >= c["quota"]:
        raise Refused(403, "site-quota-reached", f"world {c['world']} holds {len(held)} of {c['quota']}: {held}")
    if os.path.exists(f"{BENCH}/sites/{site}"):
        raise Refused(409, "site-exists", site)
    wizard = {"company_name": body.get("company", "Rehearsal Co"), "currency": "USD", "country": "United Kingdom"}
    steps, t0 = [], time.monotonic()
    for name, args in [
        ("new-site", ["new-site", site, "--mariadb-user-host-login-scope=%", "--db-root-password", DB_ROOT,
                      "--admin-password", secrets.token_hex(16)]),
        ("install erpnext", ["--site", site, "install-app", "erpnext"]),
        ("install capxul", ["--site", site, "install-app", "capxul"]),
        ("setup wizard", ["--site", site, "execute", "capxul.setup.run_wizard", "--kwargs", json.dumps(wizard)]),
        ("migrate", ["--site", site, "migrate"]),
        ("enable scheduler", ["--site", site, "enable-scheduler"]),
        ("join world", ["--site", site, "execute", "capxul.clock.join_world", "--kwargs",
                        json.dumps({"world": c["world"]})]),
    ]:
        _, ms = bench(*args)
        steps.append({"step": name, "ms": ms})
        print(f"door: {site} {name} {ms} ms", flush=True)
    return {"site": site, "world": c["world"], "ms": round((time.monotonic() - t0) * 1000), "steps": steps}


def set_clock(c, body):
    held = sites_of(c["world"])
    if not held:
        raise Refused(409, "world-has-no-site")
    kwargs = {"world": c["world"], "offset_ms": int(body.get("offset_ms", 0))}
    if "frozen_at_ms" in body:
        kwargs["frozen_at_ms"] = int(body["frozen_at_ms"])
    out, ms = bench("--site", held[0], "execute", "capxul.clock.write_world", "--kwargs", json.dumps(kwargs))
    return {"world": c["world"], "via": held[0], "ms": ms, "result": out.strip()[-300:]}


class Door(BaseHTTPRequestHandler):
    def answer(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_one(self, route):
        try:
            if route == ("GET", "/health"):
                return self.answer(200, {"ok": True})
            c = claims(self.headers.get("Authorization"))
            if route == ("GET", "/world"):
                return self.answer(200, {**c, "sites": sites_of(c["world"])})
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            if route == ("POST", "/sites"):
                return self.answer(201, create_site(c, body))
            if route == ("POST", "/clock"):
                return self.answer(200, set_clock(c, body))
            raise Refused(404, "no-such-route")
        except Refused as r:
            print(f"door: refused {route} {r.code} {r.detail[:200]}", flush=True)
            return self.answer(r.status, {"refused": r.code, "detail": r.detail})

    def do_GET(self):
        self.handle_one(("GET", self.path))

    def do_POST(self):
        self.handle_one(("POST", self.path))

    def log_message(self, fmt, *args):
        print("door:", fmt % args, flush=True)


if __name__ == "__main__":
    print(f"door: serving on {PORT} for {DOMAIN}", flush=True)
    HTTPServer(("0.0.0.0", PORT), Door).serve_forever()

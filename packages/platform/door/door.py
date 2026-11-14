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
POST   /world/backup {"snapshot"}     starts saving every site of the world under the snapshot's name and answers 202,
                                      `saving` (snapshots.py); it waits for the bench's other commands, off the request
GET    /world/backup/<snapshot>       that backup: `saving`, `saved` with each site, or `failed` with why
POST   /world/restore {"snapshot", "api_key", "api_secret", "clock"}   with the source world's token in
       `X-Capxul-Source-Token`: starts restoring every site that world saved as the snapshot into the token's world,
       each under its own label, and answers 202; each is then a site of this world like any other
POST   /templates {"template", "site"} or {"template", "snapshot"}   makes (or replaces) a starting world's template
       from a ready site of the token's world, or from a snapshot it saved, and fills its pool (pool.py)
GET    /templates                     every template, its sites and how many ready copies each has
DELETE /templates/<template>          removes a template and its pool
POST   /world/claim {"template", "api_key", "api_secret", "clock"?, "browser_core_url"?}   gives the token's world a
       ready copy of every site of the template, each `<label>-<world>.<domain>`, and answers when they are ready
       (about 1.1 s a site; about 4 s with the pool empty) (claim.py)
POST   /world/save {"point"}          saves every site of the world to a point, in MariaDB (points.py)
POST   /world/reset {"point"}         resets every site the point saved, in place, and the world's clock entry
GET    /world/points                  the world's points
DELETE /world/points/<point>          removes a point
GET    /health
"""

import glob
import hashlib
import hmac
import http.client
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import points
import pool
from claim import claim_world
from snapshots import backup_state, backup_world, remove_backups, restore_world
from sites import (BENCH, DB_ROOT, DOMAIN, FORWARDED, KEY, LABEL, PORT, REGISTRY, REGISTRY_LOCK, SECRET, SITE_CALL, TOKEN, WEB,
                   Refused,
                   bench, build, entries_of, entry_path, public, read_entry, remove_site, site_of, update_entry,
                   write_entry)


def claims(headers, site_call=False, header="X-Capxul-Site-Token"):
    given = headers.get(header)
    if not given and not site_call and header == "X-Capxul-Site-Token":
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


def set_clock(c, body):
    held = [e["site"] for e in entries_of(c["world"]) if e.get("state") == "ready"]
    if not held:
        raise Refused(409, "world-has-no-site")
    kwargs = {"world": c["world"], "offset_ms": int(body.get("offset_ms", 0))}
    if "frozen_at_ms" in body:
        kwargs["frozen_at_ms"] = int(body["frozen_at_ms"])
    out, ms = bench("--site", held[0], "execute", "capxul.clock.write_world", "--kwargs", json.dumps(kwargs))
    return {"world": c["world"], "via": held[0], "ms": ms, "result": out.strip()[-300:]}


FAST_ROUTES = {
    ("POST", "/templates"): pool.make_template,
    ("POST", "/world/claim"): claim_world,
    ("POST", "/world/save"): points.save_world,
    ("POST", "/world/reset"): points.reset_world,
}


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
                remove_backups(c["world"])
                points.drop_world_points(c["world"])
                return self.answer(200, {"world": c["world"], "removed": gone})
            if method in ("GET", "DELETE") and self.path.startswith("/sites/"):
                entry = site_of(c, self.path[len("/sites/"):])
                if method == "GET":
                    return self.answer(200, public(entry))
                points.drop_world_points(c["world"], entry["site"])
                return self.answer(200, remove_site(entry["site"]))
            if route == ("GET", "/templates"):
                return self.answer(200, pool.list_templates())
            if method == "DELETE" and self.path.startswith("/templates/"):
                return self.answer(200, pool.drop_template(self.path[len("/templates/"):]))
            if method == "GET" and self.path.startswith("/world/backup/"):
                return self.answer(200, backup_state(c, self.path[len("/world/backup/"):]))
            if route == ("GET", "/world/points"):
                return self.answer(200, points.list_points(c))
            if method == "DELETE" and self.path.startswith("/world/points/"):
                return self.answer(200, points.drop_point(c, self.path[len("/world/points/"):]))
            body = json.loads(self.body() or b"{}")
            if route == ("POST", "/sites"):
                return self.answer(202, create_site(c, body))
            if route == ("POST", "/clock"):
                return self.answer(200, set_clock(c, body))
            if route == ("POST", "/world/backup"):
                return self.answer(202, backup_world(c, body))
            if route == ("POST", "/world/restore"):
                source = claims(self.headers, header="X-Capxul-Source-Token")
                return self.answer(202, restore_world(c, source, body))
            if route in FAST_ROUTES:
                return self.answer(200, FAST_ROUTES[route](c, body))
            raise Refused(404, "no-such-route")
        except Refused as r:
            print(f"door: refused {method} {self.path.split('/api/')[0]} {r.code} {r.detail[:200]}", flush=True)
            return self.answer(r.status, {"refused": r.code, "detail": r.detail})
        except Exception as e:  # noqa: BLE001 -- an unforeseen failure answers 500 with its kind, never a secret
            detail = repr(e)[-300:].replace(DB_ROOT, "<root>")
            print(f"door: failed {method} {self.path.split('/api/')[0]} {detail}", flush=True)
            return self.answer(500, {"refused": "door-failed", "detail": detail})

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
    pool.tidy()
    print(f"door: serving on {PORT} for {DOMAIN}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Door).serve_forever()

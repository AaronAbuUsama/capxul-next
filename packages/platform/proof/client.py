"""What the site pool's proof (prove.py) shares: a world's token minted with the local bench's door key, calls to the
door as a world (Core's own route to a site included), the three site operations, and the state of a site read over
HTTP. Runs on the host, with Python's standard library only, against bin/pool-bench.sh's door. Nothing secret is
printed or kept: the door key and each world's API credential stay in memory.
"""

import hashlib
import hmac
import json
import os
import secrets
import subprocess
import time
import urllib.error
import urllib.request

DOOR = f"http://127.0.0.1:{os.environ.get('POOL_DOOR_PORT', '18170')}"
DOMAIN = os.environ.get("POOL_DOMAIN", "pool.test")


def _door_key():
    with open(os.environ["POOL_SECRETS"]) as f:
        return dict(line.strip().split("=", 1) for line in f if "=" in line)["DOOR_KEY"].encode()


def ms_since(t0):
    return round((time.monotonic() - t0) * 1000)


class World:
    """A world as the door knows it: its name, its token and the API credential its sites' user is given."""

    def __init__(self, name, quota=2):
        self.name = name
        body = f"v1.{name}.{quota}.{int(time.time()) + 4 * 3600}"
        self.token = body + "." + hmac.new(_door_key(), body.encode(), hashlib.sha256).hexdigest()
        self.key, self.secret = secrets.token_hex(8), secrets.token_hex(16)

    def site(self, label):
        return f"{label}-{self.name}.{DOMAIN}"

    def door(self, method, path, body=None, credential=False, timeout=900):
        """One call to the door; answers (status, parsed body, client ms)."""
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{DOOR}{path}", data=data, method=method)
        req.add_header("X-Capxul-Site-Token", self.token)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if credential:
            req.add_header("Authorization", f"token {self.key}:{self.secret}")
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        ms = ms_since(t0)
        try:
            parsed = json.loads(raw or b"null")
        except ValueError:
            parsed = raw[:300].decode(errors="replace")
        return status, parsed, ms

    def ok(self, method, path, body=None, credential=False):
        status, parsed, ms = self.door(method, path, body, credential)
        if status >= 300:
            raise RuntimeError(f"{method} {path.split('?')[0]}: {status} {str(parsed)[:400]}")
        return parsed, ms

    def api(self, site, method, path, body=None):
        """A call to the site's own REST API through the door, as its API user (Core's route)."""
        return self.ok(method, f"/sites/{site}{path}", body, credential=True)


def q(text):
    return urllib.request.quote(text, safe="")


def company_setup(world, site, org):
    """What Core tells a company's site when its setup lands (capxul/core_company.py), as in starting world
    `founded`: the company and its Safe, the hats of dana, eli and sam, and dana's capital."""
    safe = "0x" + secrets.token_hex(20)
    steps = []
    _, ms = world.api(site, "POST", "/api/method/capxul.core_company.configure",
                      {"org": org, "company_name": "Northwind Ltd", "safe_address": safe})
    steps.append({"step": "configure", "ms": ms})
    for email, name, hat in (("dana@cast.test", "Dana", "admin"), ("eli@cast.test", "Eli", "admin"),
                             ("sam@cast.test", "Sam", "member")):
        _, ms = world.api(site, "POST", "/api/method/capxul.core_company.grant",
                          {"org": org, "email": email, "name": name, "hat": hat})
        steps.append({"step": f"grant {hat} to {name}", "ms": ms})
    _, ms = world.api(site, "POST", "/api/method/capxul.core_company.capital", {
        "org": org, "tx_hash": "0x" + secrets.token_hex(32), "amount": "1000",
        "block_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "founder_email": "dana@cast.test",
        "founder_name": "Dana", "to": safe})
    steps.append({"step": "capital", "ms": ms})
    return steps


def operations(world, site, rounds=1, remark="ops"):
    """doc.create, doc.submit and report.run as Core makes them: a Journal Entry made, submitted, the General Ledger."""
    company = world.api(site, "GET", "/api/resource/Company?limit=1")[0]["data"][0]["name"]

    def account(field, value):
        f = q(json.dumps([["company", "=", company], [field, "=", value], ["is_group", "=", 0]]))
        return world.api(site, "GET", f"/api/resource/Account?filters={f}&limit=1")[0]["data"][0]["name"]

    cash, income = account("account_type", "Cash"), account("root_type", "Income")
    calls = {"doc.create": [], "doc.submit": [], "report.run": []}
    for i in range(rounds):
        made, ms = world.api(site, "POST", "/api/resource/Journal%20Entry", {
            "company": company, "posting_date": world_date(world, site), "user_remark": f"{remark} {i}",
            "accounts": [{"account": cash, "debit_in_account_currency": 5},
                         {"account": income, "credit_in_account_currency": 5}]})
        calls["doc.create"].append(ms)
        _, ms = world.api(site, "POST", "/api/method/frappe.client.submit", {"doc": made["data"]})
        calls["doc.submit"].append(ms)
        report, ms = world.api(site, "POST", "/api/method/frappe.desk.query_report.run", {
            "report_name": "General Ledger", "ignore_prepared_report": True,
            "filters": {"company": company, "from_date": "2020-01-01", "to_date": "2030-12-31",
                        "group_by": "Group by Voucher (Consolidated)"}})
        calls["report.run"].append(ms)
    return calls, len(report["message"]["result"])


def world_date(world, site):
    return world.api(site, "GET", "/api/method/capxul.clock.now")[0]["message"]["nowdate"]


def state(world, site):
    """What a site holds, read over HTTP as its API user: what the operations and the setup made, and its clock."""
    def names(doctype, fields):
        f = q(json.dumps(fields))
        return world.api(site, "GET", f"/api/resource/{q(doctype)}?fields={f}&limit_page_length=0&order_by=name%20asc")[0]["data"]

    clock = world.api(site, "GET", "/api/method/capxul.clock.now")[0]["message"]
    return {
        "journal_entries": names("Journal Entry", ["name", "docstatus", "total_debit", "user_remark"]),
        "gl_entries": names("GL Entry", ["name", "account", "debit", "credit", "is_cancelled"]),
        "accounts": len(names("Account", ["name"])),
        "files": names("File", ["name", "file_url", "is_private"]),
        "company": names("Company", ["name", "company_name"]),
        "clock": {k: clock[k] for k in ("world", "world_local", "nowdate")},
    }


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:16]


def upload(world, site, name, text):
    """A private file through Frappe's upload, as the API user (multipart, standard library only)."""
    boundary = secrets.token_hex(8)
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"is_private\"\r\n\r\n1\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
            f"Content-Type: text/plain\r\n\r\n{text}\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(f"{DOOR}/sites/{site}/api/method/upload_file", data=body, method="POST")
    req.add_header("X-Capxul-Site-Token", world.token)
    req.add_header("Authorization", f"token {world.key}:{world.secret}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["message"]["file_url"]


def bench_exec(*args):
    """A command in the local bench's door container (to set up a condition the proof then checks)."""
    out = subprocess.run(["docker", "exec", "-w", "/home/frappe/frappe-bench", "cx-sitepool-door", *args],
                         capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        raise RuntimeError(f"bench exec {args[:3]}: {(out.stderr or out.stdout)[-300:]}")
    return out.stdout

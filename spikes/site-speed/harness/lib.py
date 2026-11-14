"""What every harness script shares. Runs inside the spike's door container (bench.sh), as the door would."""
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.request

BENCH = "/home/frappe/frappe-bench"
DB_ROOT = os.environ["DB_ROOT_PASSWORD"]
WEB = "http://web:8000"


def now_ms():
    return round(time.monotonic() * 1000)


def bench(*args, timeout=1800):
    t0 = time.monotonic()
    out = subprocess.run(["bench", *args], cwd=BENCH, capture_output=True, text=True, timeout=timeout)
    if out.returncode != 0:
        said = (out.stderr or out.stdout)[-800:].replace(DB_ROOT, "<root>")
        raise RuntimeError(f"bench {[a.replace(DB_ROOT, '<root>') for a in args[:4]]}: {said}")
    return out.stdout, round((time.monotonic() - t0) * 1000)


def sql(statement, db=None, timeout=1800):
    """One statement (or several) through the MariaDB client as root; returns rows of tab-separated text."""
    t0 = time.monotonic()
    args = ["mariadb", "-h", "mariadb", "-uroot", "-N", "-B"] + ([db] if db else [])
    out = subprocess.run(args, input=statement, capture_output=True, text=True, timeout=timeout,
                         env={**os.environ, "MYSQL_PWD": DB_ROOT})
    if out.returncode != 0:
        raise RuntimeError(f"sql: {out.stderr[-800:]}")
    return [l.split("\t") for l in out.stdout.splitlines() if l], round((time.monotonic() - t0) * 1000)


def site_config(site):
    with open(f"{BENCH}/sites/{site}/site_config.json") as f:
        return json.load(f)


def write_site_config(site, conf):
    with open(f"{BENCH}/sites/{site}/site_config.json", "w") as f:
        json.dump(conf, f, indent=1)


def py(script, timeout=600, **env):
    """A plain Python process of the bench (capxul/boot.py arms the clock), as the door's core-user step is."""
    t0 = time.monotonic()
    out = subprocess.run([f"{BENCH}/env/bin/python", "-c", script], cwd=f"{BENCH}/sites", capture_output=True,
                         text=True, timeout=timeout, env={**os.environ, **env})
    if out.returncode != 0:
        raise RuntimeError(f"python: {(out.stderr or out.stdout)[-800:]}")
    return out.stdout, round((time.monotonic() - t0) * 1000)


def call(site, method, path, body=None, auth=None, timeout=300):
    """One HTTP call to web with the site's Host, as the door carries Core's calls. Returns (status, json, ms)."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{WEB}{path}", data=data, method=method)
    req.add_header("Host", site)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if auth:
        req.add_header("Authorization", f"token {auth[0]}:{auth[1]}")
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    ms = round((time.monotonic() - t0) * 1000)
    try:
        parsed = json.loads(raw or b"null")
    except ValueError:
        parsed = raw[:300].decode(errors="replace")
    return status, parsed, ms


def ok(site, method, path, body=None, auth=None):
    status, parsed, ms = call(site, method, path, body, auth)
    if status >= 300:
        raise RuntimeError(f"{method} {path} on {site}: {status} {str(parsed)[:600]}")
    return parsed, ms


def credential(site=None):
    """A new API key and secret for a site's API user, kept on the sites volume (never printed or recorded)."""
    key, secret = secrets.token_hex(8), secrets.token_hex(16)
    if site:
        os.makedirs(f"{BENCH}/sites/.spike-creds", exist_ok=True)
        with open(f"{BENCH}/sites/.spike-creds/{site}", "w") as f:
            f.write(f"{key}:{secret}")
    return key, secret


def saved_credential(site):
    with open(f"{BENCH}/sites/.spike-creds/{site}") as f:
        return tuple(f.read().strip().split(":"))


CORE_USER = "capxul-core@service.invalid"
CORE_ROLES = ["Accounts User", "Purchase User", "Sales User"]

# The door's own script (packages/platform/door/sites.py, CORE_USER_SCRIPT), unchanged.
CORE_USER_SCRIPT = """
import os, frappe
frappe.init(site=os.environ["SITE"], sites_path=".")
frappe.connect()
frappe.flags.in_install = "capxul"
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

# The door's restore script (packages/platform/door/snapshots.py, CORE_CREDENTIAL_SCRIPT), unchanged.
CORE_CREDENTIAL_SCRIPT = """
import os, frappe
frappe.init(site=os.environ["SITE"], sites_path=".")
frappe.connect()
user = frappe.get_doc("User", os.environ["CORE_USER"])
user.api_key = os.environ["CORE_KEY"]
user.api_secret = os.environ["CORE_SECRET"]
user.flags.ignore_permissions = True
user.save(ignore_permissions=True)
frappe.db.commit()
print(user.name)
"""


def core_user(site, key, secret):
    return py(CORE_USER_SCRIPT, SITE=site, CORE_USER=CORE_USER, CORE_ROLES=",".join(CORE_ROLES), CORE_KEY=key,
              CORE_SECRET=secret)[1]


def core_credential(site, key, secret):
    return py(CORE_CREDENTIAL_SCRIPT, SITE=site, CORE_USER=CORE_USER, CORE_KEY=key, CORE_SECRET=secret)[1]


def company_setup(site, org, company, auth):
    """What the world tells a new company's site once its setup lands (packages/core src/organizations/site.ts, through
    capxul/core_company.py): the company and its Safe, the hats of the founder, the books keeper and a member, and the
    founder's capital. Each is one HTTP call as the site's own API user."""
    safe = "0x" + secrets.token_hex(20)
    steps = []
    _, ms = ok(site, "POST", "/api/method/capxul.core_company.configure",
               {"org": org, "company_name": company, "safe_address": safe}, auth)
    steps.append({"step": "configure", "ms": ms})
    for email, name, hat in (("dana@cast.test", "Dana", "admin"), ("eli@cast.test", "Eli", "budget-holder"),
                             ("sam@cast.test", "Sam", "member")):
        _, ms = ok(site, "POST", "/api/method/capxul.core_company.grant",
                   {"org": org, "email": email, "name": name, "hat": hat}, auth)
        steps.append({"step": f"grant {hat}", "ms": ms})
    _, ms = ok(site, "POST", "/api/method/capxul.core_company.capital",
               {"org": org, "tx_hash": "0x" + secrets.token_hex(32), "amount": "1000", "block_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "founder_email": "dana@cast.test", "founder_name": "Dana", "to": safe}, auth)
    steps.append({"step": "capital", "ms": ms})
    return steps


def loadavg():
    with open("/proc/loadavg") as f:
        return f.read().split()[:3]


def emit(record):
    json.dump(record, sys.stdout, indent=1)
    sys.stdout.write("\n")

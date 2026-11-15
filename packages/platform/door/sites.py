"""The bench's side of the site door (door.py): the registry of the sites the door has made, making a site, and
removing one. Every name, lock and refusal the two files share is here; door.py is the HTTP door and its checks.
"""

import glob
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlsplit

KEY = os.environ["DOOR_KEY"].encode()
DB_ROOT = os.environ["DB_ROOT_PASSWORD"]
DOMAIN = os.environ["PLATFORM_DOMAIN"]
PORT = int(os.environ.get("DOOR_PORT", "8100"))
WEB = urlsplit(os.environ.get("WEB_URL", "http://web:8000"))
BENCH = os.environ.get("FRAPPE_BENCH", "/home/frappe/frappe-bench")  # another only in the door's unit tests
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

# One lock for the registry (so two requests cannot both pass a quota) and one for the bench's long commands (one
# site is made from nothing, restored from a backup or backed up at a time: each is up to a minute or more of the
# machine's CPU, and each runs off the request's path). A claim, a save, a reset and the removal of a site not being
# made hold their site's own lock and one of FAST's slots (each is MariaDB's work plus at most one Python process),
# so different sites' run at once and none waits behind a long command.
REGISTRY_LOCK = threading.Lock()
BENCH_LOCK = threading.Lock()
FAST = threading.BoundedSemaphore(int(os.environ.get("DOOR_FAST_SLOTS", "4")))
_site_locks, _site_locks_guard = {}, threading.Lock()


def site_lock(site):
    """The lock one site's claim, save, reset and removal each hold, so two never touch the same site at once."""
    with _site_locks_guard:
        return _site_locks.setdefault(site, threading.Lock())


class Refused(Exception):
    def __init__(self, status, code, detail=""):
        super().__init__(code)
        self.status, self.code, self.detail = status, code, detail


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
    keys = ("site", "world", "company", "state", "ms", "steps", "error", "claimed_from", "made_from")
    return {k: entry.get(k) for k in keys}


def bench(*args, env=None):
    t0 = time.monotonic()
    out = subprocess.run(["bench", *args], cwd=BENCH, capture_output=True, text=True, timeout=900, env=env)
    if out.returncode != 0:
        raise Refused(500, "bench-failed", f"bench {args[:3]}: {(out.stderr or out.stdout)[-600:]}")
    return out.stdout, round((time.monotonic() - t0) * 1000)


# The site's own API user, made by a plain Python process of the bench (capxul/boot.py arms the world's clock in it).
# The key and secret reach it through its environment, never its arguments. A person's roles follow hats and are
# locked against hand changes (capxul/locks.py); this one user is made while the site is still being installed, before
# anything is served, as the install's own users are.
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
    """Makes the site from the bench's blank (blank.py) when there is one; otherwise from nothing under BENCH_LOCK, and
    from the blank after all if one was made while this waited for the bench."""
    import blank

    while not blank.make(site, world, company, key, secret):
        with BENCH_LOCK:
            if not blank.usable():
                return _from_nothing(site, world, company, key, secret)


def _from_nothing(site, world, company, key, secret):
    wizard = {"company_name": company, "currency": "USD", "country": "United Kingdom"}
    plan = [
        ("new-site", ["new-site", site, "--mariadb-user-host-login-scope=%", "--db-root-password", DB_ROOT,
                      "--admin-password", secrets.token_hex(16)]),
        ("install erpnext", ["--site", site, "install-app", "erpnext"]),
        ("install hrms", ["--site", site, "install-app", "hrms"]),
        ("install capxul", ["--site", site, "install-app", "capxul"]),
        ("setup wizard", ["--site", site, "execute", "capxul.setup.run_wizard", "--kwargs", json.dumps(wizard)]),
        ("migrate", ["--site", site, "migrate"]),
        ("enable scheduler", ["--site", site, "enable-scheduler"]),
        ("join world", ["--site", site, "execute", "capxul.clock.join_world", "--kwargs", json.dumps({"world": world})]),
    ]
    steps, t0 = [], time.monotonic()
    try:  # BENCH_LOCK is held by build
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


def _removal_locks(entry):
    """What a removal holds. A site the bench is making from nothing or restoring holds BENCH_LOCK until its build sees
    `removing` and stops, so its removal waits for that. Any other site's removal is one `bench drop-site` of that site
    alone: it holds the site's own lock and one of FAST's slots, and never waits behind another world's site being made
    (over two minutes, longer than the 100 s a call may take through Cloudflare's edge)."""
    if entry.get("state") == "creating" and not entry.get("claimed_from") and not entry.get("made_from"):
        return BENCH_LOCK, site_lock(entry["site"])
    return site_lock(entry["site"]), FAST


def remove_site(site):
    first, second = _removal_locks(read_entry(site) or {"site": site})
    update_entry(site, state="removing")
    t0 = time.monotonic()
    with first, second:
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

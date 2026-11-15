"""Blank company sites (14 November 2026): a new company's site is a copy of a blank one, not built from nothing.

The bench keeps one **blank template**, `blank-<app>`, where `<app>` is the bench's app fingerprint (`GET /health`'s
`app`, templates.app_version): a site with ERPNext, HRMS and the capxul app installed and migrated, and no company (the
setup wizard not run). It is a template like a starting world's (templates.py: a database and a folder under the
registry, never served, never changed), made by the door itself, once per app fingerprint, and kept warm in a pool of
BLANK_POOL_SIZE ready copies that pool.py refills in the background, one copy at a time bench-wide.

- **Made when the bench is idle.** At the door's start (and when a company finds none) the blank is made in the
  background once BENCH_LOCK is free, holding it as a site made from nothing does (about two minutes). A blank of
  another fingerprint is removed at the door's start and never copied: its apps are not the bench's.
- **A company's site from it** (`POST /sites`, sites.build): a ready copy taken from the pool (a rename), or, with the
  pool empty, copied from the blank on the request's thread (seconds); then one Python process of the bench that does
  what the from-nothing build does after the apps are installed: the setup wizard with the company, every app's
  `after_migrate` hooks (what the build's `migrate` after the wizard ran; the blank was migrated before), joining the
  world, the site's own API user, the scheduler. The copy gets its own encryption key first when its database holds
  nothing encrypted yet. Core then configures it as before (company, Safe, clock, grants: site-ops deliveries).
- **Never worse.** With no blank of this fingerprint (not made yet, failed, or removed), a company waits for one being
  made, and otherwise is built from nothing, as before.
"""

import base64
import json
import os
import shutil
import subprocess
import threading
import time

import db
import pool
import templates
from sites import (BENCH, BENCH_LOCK, CORE_ROLES, CORE_USER, DB_ROOT, FAST, Refused, bench, drop_database, read_entry,
                   site_lock, update_entry)

LABEL = "blank"
WAIT_S = int(os.environ.get("DOOR_BLANK_WAIT_S", "900"))  # how long a company waits for a blank being made
RETRY_S = int(os.environ.get("DOOR_BLANK_RETRY_S", "1800"))  # after a failed make, before another is tried
IDLE_POLL_S = float(os.environ.get("DOOR_BLANK_IDLE_POLL_S", "2"))
_cond = threading.Condition()
_state = {"making": False, "made_ms": None, "error": None, "failed_at": None, "steps": []}

# The site's company and its world, in one Python process of the bench (capxul/boot.py arms the world's clock in it).
# The key and secret reach it through its environment, never its arguments. Prints its steps as one JSON line.
CONFIGURE_SCRIPT = """
import os, json, time, frappe
steps, t0 = [], [time.monotonic()]
def step(name):
    steps.append({"step": name, "ms": round((time.monotonic() - t0[0]) * 1000)}); t0[0] = time.monotonic()
frappe.init(site=os.environ["SITE"], sites_path="."); frappe.connect(); frappe.set_user("Administrator")
step("frappe started")
from capxul import clock, setup
setup.run_wizard(os.environ["COMPANY"], "USD", "United Kingdom")
step("setup wizard")
frappe.flags.in_migrate = True
for hook in frappe.get_hooks("after_migrate"):
    frappe.get_attr(hook)()
frappe.flags.in_migrate = False
frappe.db.commit()
step("after_migrate hooks")
clock.join_world(os.environ["WORLD"])
step("join world")
frappe.flags.in_install = "capxul"
user = frappe.new_doc("User")
user.update({"email": os.environ["CORE_USER"], "first_name": "Capxul Core", "user_type": "System User",
             "send_welcome_email": 0, "enabled": 1})
for role in os.environ["CORE_ROLES"].split(","):
    user.append("roles", {"role": role})
user.api_key = os.environ["CORE_KEY"]; user.api_secret = os.environ["CORE_SECRET"]
user.insert(ignore_permissions=True)
frappe.flags.in_install = None
frappe.db.commit()
step("core user")
from frappe.utils.scheduler import enable_scheduler
enable_scheduler(); frappe.db.commit(); frappe.clear_cache()
step("enable scheduler")
print(json.dumps(steps))
"""


def name():
    """The blank template of the bench's apps as they are: `blank-<app fingerprint>`."""
    return f"{templates.BLANK}{templates.app_version()}"


def usable():
    """The blank template of this fingerprint, whole (templates.py renames one into place only once whole)."""
    return bool(templates.template_sites(name()))


def state():
    """For `GET /templates`: the blank's name, whether it is whole or being made, and its last make or failure."""
    with _cond:
        return {"template": name(), "usable": usable(), **{k: v for k, v in _state.items()}}


def tidy():
    """At the door's start: blanks of another fingerprint and a blank build a stopped door left are removed, then the
    blank of this fingerprint is made if it is missing."""
    for other in templates.names():
        if other.startswith(templates.BLANK) and other != name():
            templates.drop_template(other)
            print(f"door: blank {other} removed: the bench's apps are now {templates.app_version()}", flush=True)
    for folder in os.listdir(f"{BENCH}/sites") if os.path.isdir(f"{BENCH}/sites") else []:
        if folder.startswith(templates.BLANK) and folder.endswith(".invalid"):
            drop_database(folder)
            shutil.rmtree(f"{BENCH}/sites/{folder}", ignore_errors=True)
    keep_warm()


def keep_warm():
    """Starts making the blank in the background unless it is whole, being made, or failed less than RETRY_S ago."""
    with _cond:
        if usable():
            pool.refill_soon(name())
            return
        if _state["making"] or (_state["failed_at"] and time.time() - _state["failed_at"] < RETRY_S):
            return
        _state["making"] = True
    threading.Thread(target=_make_when_idle, daemon=True).start()


def _make_when_idle():
    blank, made = name(), False
    try:
        while not BENCH_LOCK.acquire(blocking=False):  # the bench's long commands go first: no queue jumped
            time.sleep(IDLE_POLL_S)
        try:
            _make(blank)
            made = True
        finally:
            BENCH_LOCK.release()
    except Exception as e:  # noqa: BLE001 -- a blank that could not be made says why; companies are built from nothing
        detail = e.detail if isinstance(e, Refused) else repr(e)
        with _cond:
            _state.update(error=detail[-600:], failed_at=time.time())
        print(f"door: blank {blank} failed: {detail[-300:]}", flush=True)
    finally:
        with _cond:
            _state["making"] = False
            _cond.notify_all()
    if made:
        pool.refill_soon(blank)


def _make(blank):
    """The blank, made from nothing under BENCH_LOCK in a site folder no request can name (`.invalid`), then moved
    under the registry as the template's one site."""
    site, t0, steps = f"{blank}.invalid", time.monotonic(), []
    making = f"{templates.TEMPLATES}/{blank}{templates.MAKING}"
    templates.remove_making(making)
    plan = [("new-site", ["new-site", site, "--mariadb-user-host-login-scope=%", "--db-root-password", DB_ROOT,
                          "--admin-password", base64.b32encode(os.urandom(20)).decode()]),
            ("install erpnext", ["--site", site, "install-app", "erpnext"]),
            ("install hrms", ["--site", site, "install-app", "hrms"]),
            ("install capxul", ["--site", site, "install-app", "capxul"]),
            ("migrate", ["--site", site, "migrate"])]
    try:
        for step, args in plan:
            _, ms = bench(*args)
            steps.append({"step": step, "ms": ms})
            print(f"door: blank {blank} {step} {ms} ms", flush=True)
        conf = db.site_config(f"{BENCH}/sites/{site}")
        home = f"{making}/{LABEL}"
        os.makedirs(home, exist_ok=True)
        meta = {"template": blank, "label": LABEL, "company": None, "db": conf["db_name"], "made_from": "nothing",
                "made_by": "door", "made_at": int(time.time()), "ms": db.ms_since(t0), "steps": steps}
        templates.write_meta(home, meta)
        os.rename(f"{BENCH}/sites/{site}", f"{home}/site")
        db.drop_user(conf.get("db_user") or conf["db_name"])  # never served: copies get users of their own
        with templates.template_lock(blank):
            os.rename(making, f"{templates.TEMPLATES}/{blank}")
            templates.mark_used(blank)
    except BaseException:
        drop_database(site)
        shutil.rmtree(f"{BENCH}/sites/{site}", ignore_errors=True)
        templates.remove_making(making)
        raise
    with _cond:
        _state.update(made_ms=db.ms_since(t0), steps=steps, error=None, failed_at=None)
    print(f"door: blank {blank} made in {db.ms_since(t0)} ms", flush=True)


def _wait_for_one():
    """Whether a blank of this fingerprint is whole, waiting up to WAIT_S for one being made."""
    keep_warm()
    with _cond:
        _cond.wait_for(lambda: usable() or not _state["making"], timeout=WAIT_S)
    return usable()


def make(site, world, company, key, secret):
    """Makes the company's site from the blank; False, having done nothing, when there is no blank to make it from."""
    blank = name()
    if not _wait_for_one():
        return False
    update_entry(site, made_from={"template": blank})
    steps, t0, dest = [], time.monotonic(), f"{BENCH}/sites/{site}"
    with site_lock(site), FAST:
        if (read_entry(site) or {}).get("state") != "creating":
            return True  # removed while it waited: nothing to make
        try:
            s0 = time.monotonic()
            if pool.take(blank, LABEL, dest):
                how, step = "pool", "blank copy taken from the pool"
            else:
                with templates.template_lock(blank):
                    metas = templates.template_sites(blank)
                    if not metas:
                        update_entry(site, made_from=None)
                        return False
                    pool.copy_site(metas[0]["db"], metas[0]["folder"], dest)
                how, step = "copy", "copied from the blank (pool empty)"
            steps.append({"step": step, "ms": db.ms_since(s0)})
            s0 = time.monotonic()
            steps.append({"step": "own encryption key" if own_key(dest) else "blank's encryption key kept",
                          "ms": db.ms_since(s0)})
            steps.extend(configure(site, world, company, key, secret))
            update_entry(site, state="ready", steps=steps, ms=db.ms_since(t0), made_from={"template": blank, "how": how})
            print(f"door: {site} made from {blank} ({how}) in {db.ms_since(t0)} ms", flush=True)
        except Exception as e:  # noqa: BLE001 -- a site that could not be made says why; DELETE removes it
            detail = e.detail if isinstance(e, Refused) else repr(e)
            update_entry(site, state="failed", steps=steps, error=detail[-600:])
            print(f"door: {site} from {blank} failed: {detail[-300:]}", flush=True)
    pool.refill_soon(blank)
    return True


def own_key(folder):
    """Gives the copy an encryption key of its own when its database holds nothing encrypted with the blank's (a blank
    holds none: its users' passwords are hashed). Answers whether it did."""
    conf = db.site_config(folder)
    rows = db.run([f"select count(*) from {db.q(conf['db_name'])}.`__Auth` where encrypted = 1"])
    if not rows or rows[0][0] != 0:
        return False
    conf["encryption_key"] = base64.urlsafe_b64encode(os.urandom(32)).decode()  # a Fernet key, as Frappe makes one
    db.write_site_config(folder, conf)
    return True


def configure(site, world, company, key, secret):
    """The company's wizard, the apps' after_migrate hooks, the world, the API user and the scheduler: their steps."""
    env = {**os.environ, "SITE": site, "WORLD": world, "COMPANY": company, "CORE_USER": CORE_USER,
           "CORE_ROLES": ",".join(CORE_ROLES), "CORE_KEY": key, "CORE_SECRET": secret}
    out = subprocess.run([f"{BENCH}/env/bin/python", "-c", CONFIGURE_SCRIPT], cwd=f"{BENCH}/sites",
                         capture_output=True, text=True, timeout=600, env=env)
    if out.returncode != 0:
        raise Refused(500, "bench-failed", f"configure: {(out.stderr or out.stdout)[-600:]}")
    return json.loads(out.stdout.strip().splitlines()[-1])

"""The world's clock, for one site, without changing Frappe's source.

How Frappe reads time: `frappe.utils.data.now_datetime()` is the root. `nowdate()`, `today()`, `nowtime()` and `now()` (which stamps
`creation` and `modified` on every document) all call it. The scheduler decides what is due with it too
(`Scheduled Job Type.is_event_due` compares `now_datetime()` with the next cron time after `last_execution`).

What this does (keyed by WORLD, not by bench or site): each site names its world in its own `site_config.json` (`capxul_world`, default `main`), and the
world's clock is one entry in `sites/capxul-world-clocks.json` on the bench: {world: offset_ms}. One write moves every site of that world, and two worlds
on one bench can run at different times (designed and read by the code below; proven only for a world that is not `main` by FINDINGS.md's measurements).
`install()` (run when the app is imported, in every process that loads it) replaces that one function with a wrapper that
adds the site's offset, and replaces every earlier `from frappe.utils import now_datetime` reference too. The offset is read
from that file (cached by its modification time), or from `frappe.local.conf["capxul_clock_override_ms"]` while `advance` is stepping this site
through its stops. World time = host time + offset: a running clock, not frozen.

Not followed (still the host's): see FINDINGS.md "What follows the clock".
"""
import json
import sys
from datetime import datetime, timedelta, timezone

import frappe

OVERRIDE = "capxul_clock_override_ms"
_installed = False
_cache = {"mtime": None, "data": {}}


def _clocks_path():
    import os

    return os.path.join(frappe.local.sites_path, "capxul-world-clocks.json")


def world_of_site():
    return frappe.local.conf.get("capxul_world") or "main"


def read_clocks():
    import os

    p = _clocks_path()
    try:
        m = os.stat(p).st_mtime_ns
    except OSError:
        return {}
    if _cache["mtime"] != m:
        with open(p) as f:
            _cache["data"], _cache["mtime"] = json.load(f), m
    return _cache["data"]


def offset_ms() -> int:
    try:
        o = frappe.local.conf.get(OVERRIDE)
        if o is not None:
            return int(o)
        return int(read_clocks().get(world_of_site()) or 0)
    except Exception:  # no site initialised yet (import time, bench commands without a site)
        return 0


def install():
    global _installed
    if _installed:
        return
    import frappe.utils
    import frappe.utils.data as data

    orig = data.now_datetime
    if getattr(orig, "_capxul", False):
        _installed = True
        return

    def now_datetime():
        off = offset_ms()
        t = orig()
        return t + timedelta(milliseconds=off) if off else t

    now_datetime._capxul = True
    now_datetime._orig = orig
    for mod in list(sys.modules.values()):  # modules that already did `from frappe.utils import now_datetime`
        d = getattr(mod, "__dict__", None)
        if d is not None and d.get("now_datetime") is orig:
            d["now_datetime"] = now_datetime
    _installed = True


# ---- what the CLI calls (bench execute) ------------------------------------------------------------------------------------
def _stamp(trace_id):
    if trace_id:
        frappe.flags.capxul_trace = trace_id


@frappe.whitelist(allow_guest=True)
def now():
    """Also whitelisted (guest): the clock is not a secret and `world clock show` reads it over HTTP."""
    host = datetime.now(timezone.utc)
    w = frappe.utils.now_datetime()
    return {"world": world_of_site(), "offset_ms": offset_ms(), "host_utc": host.isoformat(), "world_local": str(w), "nowdate": frappe.utils.nowdate(),
            "tz": frappe.utils.get_system_timezone()}


def join_world(world):
    """Name the world this site belongs to (done once, when the site is made or restored into a world)."""
    from frappe.installer import update_site_config

    update_site_config("capxul_world", world)
    frappe.local.conf["capxul_world"] = world
    return world


def write_world(world, offset_ms):
    """The one write that moves every site of the world (atomic)."""
    import os

    p = _clocks_path()
    data = dict(read_clocks())
    data[world] = int(offset_ms)
    with open(p + ".tmp", "w") as f:
        json.dump(data, f)
    os.replace(p + ".tmp", p)
    _cache["mtime"] = None
    return data


def rewind_jobs():
    """A world moved BACK must also move every Scheduled Job Type's `last_execution` back to the new now (on this site; a job that never ran falls back to
    its `creation`, which is the host's real time, so it is set too), or no job would ever fall due until the world caught up with the host's own history."""
    frappe.set_user("Administrator")
    w = frappe.utils.now_datetime()
    frappe.db.sql("update `tabScheduled Job Type` set last_execution=%s where last_execution > %s or last_execution is null", (w, w))
    frappe.db.commit()
    return now()


def run_due():
    """Run, inline and now (world time), every scheduled job that is due. One call is one stop."""
    ran = []
    for n in frappe.get_all("Scheduled Job Type", {"stopped": 0}, pluck="name"):
        jt = frappe.get_doc("Scheduled Job Type", n)
        try:
            due = jt.is_event_due()
        except Exception:
            continue
        if due:
            frappe.set_user("Administrator")
            jt.execute()
            ran.append(jt.method)
    return ran


def advance(from_offset_ms, to_offset_ms, step_days=1, trace_id=None):
    """Move THIS site from one offset to another, stopping at every `step_days` midnight on the way and running what is due at each stop (so a
    daily job, a recurring document, runs once per day skipped, not once for the whole jump). The world's file is written by the CLI after every
    site of the world is done."""
    _stamp(trace_id)
    frappe.set_user("Administrator")
    frappe.local.conf[OVERRIDE] = int(from_offset_ms)
    start = frappe.utils.now_datetime()
    host_now = start - timedelta(milliseconds=int(from_offset_ms))
    target = host_now + timedelta(milliseconds=int(to_offset_ms))
    stops, d = [], start.replace(hour=1, minute=0, second=0, microsecond=0)
    while True:
        d += timedelta(days=int(step_days))
        if d >= target:
            break
        stops.append(d)
    stops.append(target)
    log, jobs = [], 0
    # A scheduled job usually hands its work to a worker with frappe.enqueue; the worker would run it later, at whatever time the world has then.
    # While stepping, "enqueue" means "do it now", at this stop's time (the same code, run inline).
    import frappe.utils.background_jobs as bj

    real_enqueue, real_bj = frappe.enqueue, bj.enqueue
    frappe.enqueue = lambda *a, **k: real_enqueue(*a, **{**k, "now": True})
    bj.enqueue = lambda *a, **k: real_bj(*a, **{**k, "now": True})
    try:
        for s in stops:
            frappe.local.conf[OVERRIDE] = int((s - host_now).total_seconds() * 1000)
            ran = run_due()
            jobs += len(ran)
            frappe.db.commit()
            log.append({"stop": str(s), "jobs": len(ran)})
    finally:
        frappe.enqueue, bj.enqueue = real_enqueue, real_bj
        frappe.local.conf.pop(OVERRIDE, None)
    return {"stops": len(stops), "jobs_run": jobs, "log": log}

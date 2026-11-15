"""The world's clock, for one site, without changing Frappe's source.

How Frappe reads time: `frappe.utils.data.now_datetime()` is the root. `nowdate()`, `today()`, `nowtime()` and `now()` (which stamps
`creation` and `modified` on every document) all call it. The scheduler decides what is due with it too
(`Scheduled Job Type.is_event_due` compares `now_datetime()` with the next cron time after `last_execution`).

What this does (keyed by WORLD, not by bench or site): each site names its world in its own `site_config.json` (`capxul_world`, default `main`), and the
world's clock is one entry in `sites/capxul-world-clocks.json` on the bench: a legacy offset or a clock with mode/rate. One write moves every site of that world, and two worlds
on one bench can run at different times (designed and read by the code below; proven only for a world that is not `main` by FINDINGS.md's measurements).
`install()` (run when the app is imported: every process of the bench imports it at start, capxul/boot.py) replaces that one
function with a wrapper, and replaces every earlier `from frappe.utils import now_datetime` reference too. The wrapper works out
the world's UTC instant (`world_ms`) and turns it into the site's local time through the site's time zone, as Frappe does with
the host's instant, so a world reads right on either side of a daylight-saving change. The clock is read from that file (cached
by its modification time), or from `frappe.local.conf["capxul_clock_override_ms"]` while `advance` is stepping this site through
its stops; the site's world from its site_config.json (cached by modification time too, so a web process follows a change of
world at once rather than after Frappe's 60 s). A frozen clock holds an absolute UTC instant; a running clock advances at its saved rate.

Not followed (still the host's): see docs/clock.md, "What still reads the host's time".
"""
import json
import sys
from datetime import datetime, timedelta, timezone

import frappe

from capxul.emit import emit
from capxul.generated.site import DAILY_JOB, DAILY_JOB_TYPE

OVERRIDE = "capxul_clock_override_ms"
_installed = False
_cache = {"mtime": None, "data": {}}


def _clocks_path():
    import os

    return os.path.join(frappe.local.sites_path, "capxul-world-clocks.json")


_site_worlds = {}  # site_config.json path -> (its mtime, the world it names)


def world_of_site():
    """The world the site's own site_config.json names, read from the file (cached by its modification time). A web process
    keeps frappe.local.conf for up to 60 s (Frappe's site_cache), so reading the conf alone would leave a site that changed
    world answering as its old world for a minute; this follows the change on the next reading."""
    import os

    try:
        p = os.path.join(frappe.local.site_path, "site_config.json")
        m = os.stat(p).st_mtime_ns
        seen = _site_worlds.get(p)
        if seen is None or seen[0] != m:
            with open(p) as f:
                seen = _site_worlds[p] = (m, json.load(f).get("capxul_world"))
        return seen[1] or "main"
    except Exception:  # no site path (tests, bench commands without a site) or a file being rewritten: the conf as loaded
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


def _host_ms():
    return datetime.now(timezone.utc).timestamp() * 1000


def world_ms(host_ms):
    """The world's UTC instant (ms since the epoch) when the host's is `host_ms`. Every kind of clock is an instant; the site's
    local time is made from it through the site's time zone (site_time), so a frozen and a running world agree across a
    daylight-saving change."""
    o = frappe.local.conf.get(OVERRIDE)
    if o is not None:
        return host_ms + int(o)
    c = read_clocks().get(world_of_site()) or 0
    if isinstance(c, dict):
        if c.get("frozen_at_ms") is not None:
            return c["frozen_at_ms"]
        return host_ms + c["offset_ms"] + (host_ms - c["host_anchor_ms"]) * (c["rate"] - 1)
    return host_ms + int(c)


def site_time(ms):
    """A UTC instant (ms) as the site's naive local time, as Frappe's own now_datetime() makes it."""
    from zoneinfo import ZoneInfo

    return datetime.fromtimestamp(ms / 1000, ZoneInfo(frappe.utils.get_system_timezone())).replace(tzinfo=None)


def offset_ms() -> int:
    try:
        host = _host_ms()
        return int(world_ms(host) - host)
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
        try:
            host = _host_ms()
            w = world_ms(host)
        except Exception:  # commands may read time before frappe.init(): the host's time
            return orig()
        return orig() if w == host else site_time(w)

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


@emit
def join_world(world):
    """Name the world this site belongs to (done once, when the site is made or restored into a world). The site's
    scheduled jobs are then settled on the world's time (capxul.jobs.settle_jobs): a world behind the host would otherwise find
    every job stamped in its future."""
    from frappe.installer import update_site_config

    update_site_config("capxul_world", world)
    frappe.local.conf["capxul_world"] = world
    from capxul.jobs import settle_jobs

    settle_jobs()
    frappe.db.commit()
    return world



@emit
def write_world(world, offset_ms, frozen_at_ms=None, rate=1):
    """Move every site together. Old two-argument callers still write a running rate-one offset."""
    import fcntl
    import os
    import tempfile

    rate = float(rate)
    if not 1 <= rate <= 60:
        raise ValueError("world clock rate must be 1 to 60")
    p = _clocks_path()
    with open(p + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        _cache["mtime"] = None
        data = dict(read_clocks())
        data[world] = int(offset_ms) if frozen_at_ms is None and rate == 1 else {
            "offset_ms": int(offset_ms), "frozen_at_ms": int(frozen_at_ms) if frozen_at_ms is not None else None,
            "rate": rate, "host_anchor_ms": int(datetime.now(timezone.utc).timestamp() * 1000),
        }
        fd, temp = tempfile.mkstemp(dir=os.path.dirname(p))
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temp, p)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
    _cache["mtime"] = None
    return data


@emit
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


# DAILY_JOB and DAILY_JOB_TYPE, the daily job and the name of its Scheduled Job Type (which a Scheduled Job Log row
# links to and report.run filters by), are the blueprint's (`Site.DAILY_JOB` in packages/blueprint;
# packages/blueprint, src/common/site.ts), imported from capxul/generated/site.py.


def name_daily_job():
    """Names the daily job's Scheduled Job Type `clock.daily`. The pinned Frappe (v16) names a new Scheduled Job Type by a
    random hash, so its log rows link to that hash and a filter by the declared name finds none (rehearsed on a real
    bench, 13 November 2026: a week's warp ran it 7 times, and the Scheduled Job Log filtered by `clock.daily` showed 0).
    Renaming carries the log's links with it; Frappe finds the type by its method afterwards, so it stays named."""
    current = frappe.db.get_value("Scheduled Job Type", {"method": DAILY_JOB}, "name")
    if current and current != DAILY_JOB_TYPE:
        frappe.rename_doc("Scheduled Job Type", current, DAILY_JOB_TYPE, force=True)


def daily():
    """Capxul's daily job: a note on Capxul Settings naming the world day it ran for (world time). A warp's evidence that each day's jobs ran."""
    frappe.get_doc({"doctype": "Comment", "comment_type": "Info", "reference_doctype": "Capxul Settings", "reference_name": "Capxul Settings",
                    "content": f"capxul daily job ran for {frappe.utils.nowdate()}"}).insert(ignore_permissions=True)


def advance_stops(host_ms, from_offset_ms, to_offset_ms, step_days=1):
    """advance's stops: 01:00 site time every `step_days` days after the start, then the target, each as (site time, offset
    from `host_ms`). Counted in the site's own days and turned back into instants, so a stop is at 01:00 on either side of
    a daylight-saving change."""
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(frappe.utils.get_system_timezone())
    target_ms = host_ms + to_offset_ms
    stops, d = [], site_time(host_ms + from_offset_ms).replace(hour=1, minute=0, second=0, microsecond=0)
    while True:
        d += timedelta(days=step_days)
        ms = d.replace(tzinfo=tz).timestamp() * 1000
        if ms >= target_ms:
            break
        stops.append((d, int(ms - host_ms)))
    return stops + [(site_time(target_ms), int(to_offset_ms))]


@emit
def advance(from_offset_ms, to_offset_ms, step_days=1, trace_id=None):
    """Move THIS site from one offset to another, stopping at every `step_days` midnight on the way and running what is due at each stop (so a
    daily job, a recurring document, runs once per day skipped, not once for the whole jump). The world's file is written by the CLI after every
    site of the world is done."""
    _stamp(trace_id)
    frappe.set_user("Administrator")
    frappe.local.conf[OVERRIDE] = int(from_offset_ms)
    stops = advance_stops(_host_ms(), int(from_offset_ms), int(to_offset_ms), int(step_days))
    from frappe.core.doctype.scheduled_job_type.scheduled_job_type import sync_jobs

    frappe.cache.delete_value("app_hooks")  # the hooks are cached: read them fresh, so a job added to them is seen
    sync_jobs()  # a site made before a job was added to the hooks gets it now (a migrate would do the same)
    log, jobs = [], 0
    # A scheduled job usually hands its work to a worker with frappe.enqueue; the worker would run it later, at whatever time the world has then.
    # While stepping, "enqueue" means "do it now", at this stop's time (the same code, run inline).
    import frappe.utils.background_jobs as bj

    real_enqueue, real_bj = frappe.enqueue, bj.enqueue
    frappe.enqueue = lambda *a, **k: real_enqueue(*a, **{**k, "now": True})
    bj.enqueue = lambda *a, **k: real_bj(*a, **{**k, "now": True})
    try:
        for s, off in stops:
            frappe.local.conf[OVERRIDE] = off
            ran = run_due()
            jobs += len(ran)
            frappe.db.commit()
            log.append({"stop": str(s), "jobs": len(ran)})
    finally:
        frappe.enqueue, bj.enqueue = real_enqueue, real_bj
        frappe.local.conf.pop(OVERRIDE, None)
    return {"stops": len(stops), "jobs_run": jobs, "log": log}

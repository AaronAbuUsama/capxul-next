"""Claiming a world's company sites from a template's pool (pool.py), and the one bench process that joins a copy
to its world. door.py checks the token; this does the work and answers when every site is ready (or failed).
"""

import json
import os
import subprocess
import time

import db
import pool
import templates
from sites import (BENCH, CORE_USER, DOMAIN, FAST, REGISTRY_LOCK, SECRET, Refused, entries_of, public, read_entry,
                   site_lock, update_entry, write_entry)

# One Python process of the bench (capxul/boot.py arms the world's clock in it): the site joined to its world, the
# world's clock set when the claim names one, the site's own API user given the world's credential, its scheduler on.
# The functions are called unwrapped from capxul.emit, which prints instead of answering. The key and secret reach it
# through its environment, never its arguments.
JOIN_SCRIPT = """
import os, json, time, frappe
t0 = time.monotonic()
frappe.init(site=os.environ["SITE"], sites_path="."); frappe.connect(); frappe.set_user("Administrator")
from capxul import world, clock
from frappe.utils.scheduler import enable_scheduler
unwrap = lambda f: getattr(f, "__wrapped__", f)
started = round((time.monotonic() - t0) * 1000); t0 = time.monotonic()
unwrap(world.rewrite)(os.environ["WORLD"], os.environ.get("CORE_URL", ""), os.environ.get("BROWSER_CORE_URL", ""),
                      os.environ["SITE"])
c = json.loads(os.environ.get("CLOCK") or "null")
if c is not None:
    unwrap(clock.write_world)(os.environ["WORLD"], int(c.get("offset_ms", 0)), c.get("frozen_at_ms"))
user = frappe.get_doc("User", os.environ["CORE_USER"])
user.api_key = os.environ["CORE_KEY"]; user.api_secret = os.environ["CORE_SECRET"]
user.save(ignore_permissions=True)
enable_scheduler()
frappe.db.commit()
print(json.dumps({"frappe started": started, "joined": round((time.monotonic() - t0) * 1000)}))
"""


def join(site, world, key, secret, clock=None, core_url="", browser_core_url=""):
    """Joins the site in `sites/<site>` to `world`; answers the process's own timings."""
    env = {**os.environ, "SITE": site, "WORLD": world, "CORE_USER": CORE_USER, "CORE_KEY": key, "CORE_SECRET": secret,
           "CLOCK": json.dumps(clock) if clock else "", "CORE_URL": core_url, "BROWSER_CORE_URL": browser_core_url}
    out = subprocess.run([f"{BENCH}/env/bin/python", "-c", JOIN_SCRIPT], cwd=f"{BENCH}/sites", capture_output=True,
                         text=True, timeout=300, env=env)
    if out.returncode != 0:
        raise Refused(500, "bench-failed", f"join: {(out.stderr or out.stdout)[-600:]}")
    return json.loads(out.stdout.strip().splitlines()[-1])


def _clock_of(body):
    clock = body.get("clock")
    if clock is None:
        return None
    if not isinstance(clock, dict) or not ({"offset_ms", "frozen_at_ms"} & set(clock)):
        raise Refused(400, "clock-invalid", '{"frozen_at_ms": n} or {"offset_ms": n}')
    return {k: int(v) for k, v in clock.items() if k in ("offset_ms", "frozen_at_ms")}


def claim_world(c, body):
    """Gives the token's world a ready copy of every site of the template, each under its label."""
    template = templates.worlds_name(body.get("template"))
    key, secret = body.get("api_key", ""), body.get("api_secret", "")
    if not SECRET.match(key) or not SECRET.match(secret):
        raise Refused(400, "credential-invalid", "api_key and api_secret: 10 to 64 letters and digits")
    clock = _clock_of(body)
    pool.touch()  # the door's own refills wait for the run's sites
    # Marked used before any work, so a sweep that has not begun keeps the template (templates.py).
    metas = templates.claimable(template)
    if not metas:
        raise Refused(404, "template-not-found", template)
    t0, claimed = time.monotonic(), []
    with REGISTRY_LOCK:
        held = entries_of(c["world"])
        if len(held) + len(metas) > c["quota"]:
            raise Refused(403, "site-quota-reached", f"world {c['world']} holds {len(held)} of {c['quota']}")
        for meta in metas:
            site = f"{meta['label']}-{c['world']}.{DOMAIN}"
            if read_entry(site) is not None or os.path.exists(f"{BENCH}/sites/{site}"):
                raise Refused(409, "site-exists", site)
        for meta in metas:
            site = f"{meta['label']}-{c['world']}.{DOMAIN}"
            entry = {"site": site, "world": c["world"], "company": meta.get("company"), "state": "creating",
                     "steps": [], "ms": None, "error": None, "asked_at": int(time.time()),
                     "claimed_from": {"template": template, "label": meta["label"]}}
            write_entry(entry)
            claimed.append((site, meta))
    for site, meta in claimed:
        _claim_one(site, c["world"], template, meta, key, secret, clock, body)
    pool.refill_soon(template)
    sites = [public(read_entry(site)) for site, _ in claimed]
    return {"world": c["world"], "template": template, "sites": sites, "ms": db.ms_since(t0)}


def _claim_one(site, world, template, meta, key, secret, clock, body):
    steps, t0 = [], time.monotonic()
    dest = f"{BENCH}/sites/{site}"
    with site_lock(site), FAST:
        try:
            s0 = time.monotonic()
            if pool.take(template, meta["label"], dest):
                steps.append({"step": "pooled copy taken", "ms": db.ms_since(s0)})
                how = "pool"
            else:
                with templates.template_lock(template):
                    pool.copy_site(meta["db"], meta["folder"], dest)
                steps.append({"step": "copied from the template (pool empty)", "ms": db.ms_since(s0)})
                how = "clone"
            s0 = time.monotonic()
            inside = join(site, world, key, secret, clock, body.get("core_url", ""), body.get("browser_core_url", ""))
            steps.append({"step": "joined: world, clock, API user, scheduler (one process)", "ms": db.ms_since(s0),
                          "inside": inside})
            update_entry(site, state="ready", steps=steps, ms=db.ms_since(t0),
                         claimed_from={"template": template, "label": meta["label"], "how": how})
            print(f"door: {site} claimed from {template} ({how}) in {db.ms_since(t0)} ms", flush=True)
        except Exception as e:  # noqa: BLE001 -- a site that could not be claimed says why; DELETE removes it
            detail = e.detail if isinstance(e, Refused) else repr(e)
            update_entry(site, state="failed", steps=steps, error=detail[-600:])
            print(f"door: {site} claim failed: {detail[-300:]}", flush=True)

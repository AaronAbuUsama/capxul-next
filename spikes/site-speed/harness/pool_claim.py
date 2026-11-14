"""Q3b: claiming a pre-made blank site from a pool. A pool member is a site made ahead of time (here: an in-server
copy of a blank template that has every app, the wizard run with a placeholder company, migrate, the scheduler and its
API user: the door's part of Q1). Claiming it for a world:
  1. its folder renamed to the world's site name (a Frappe site is its folder; its database keeps its own name)
  2. in one Python process of the bench: the placeholder company renamed to the world's company
     (frappe.rename_doc, which carries every link), joined to the world (capxul.world.rewrite), the world's clock,
     the API user's new credential, the scheduler on
  3. the company setup the world does (configure, three hats, capital), over HTTP as the API user
    pool_claim.py <pool-site> <new-site> <world> <company> [--label-only]
With --as-template the pool member is a copy of a template world's site (its company and setup already made), so
only steps 1 and 2 without the rename run. With --label-only the company's shown name (company_name) is set and its id stays the placeholder's: no rename_doc."""
import os
import secrets
import sys
import time

from lib import BENCH, CORE_USER, company_setup, credential, emit, loadavg, py

pool, site, world, company = sys.argv[1:5]
before = loadavg()
steps, t0 = [], time.monotonic()
s0 = time.monotonic()
os.rename(f"{BENCH}/sites/{pool}", f"{BENCH}/sites/{site}")
steps.append({"step": "site folder renamed", "ms": round((time.monotonic() - s0) * 1000)})
key, secret = credential(site)
CLAIM = """
import os, time, json, frappe
frappe.init(site=os.environ["SITE"], sites_path="."); frappe.connect(); frappe.set_user("Administrator")
t = {}
s = time.monotonic()
old = frappe.db.get_value("Company", {})
if os.environ.get("AS_TEMPLATE"):
    pass  # a copy of a template world's site: its company is already the template's
elif os.environ.get("LABEL_ONLY"):
    frappe.db.set_value("Company", old, "company_name", os.environ["COMPANY"])  # the shown name; the id stays
else:
    frappe.rename_doc("Company", old, os.environ["COMPANY"], force=True)
frappe.db.commit(); t["company renamed" + (" (company_name only)" if os.environ.get("LABEL_ONLY") else "")] = round((time.monotonic() - s) * 1000); s = time.monotonic()
from capxul import world, clock
unwrap = lambda f: getattr(f, "__wrapped__", f)
unwrap(world.rewrite)(os.environ["WORLD"], "", "", os.environ["SITE"])
unwrap(clock.write_world)(os.environ["WORLD"], 0)
user = frappe.get_doc("User", os.environ["CORE_USER"])
user.api_key = os.environ["CORE_KEY"]; user.api_secret = os.environ["CORE_SECRET"]
user.save(ignore_permissions=True)
from frappe.utils.scheduler import enable_scheduler; enable_scheduler()
frappe.db.commit(); t["joined, clock, credential, scheduler"] = round((time.monotonic() - s) * 1000)
print(json.dumps(t))
"""
s0 = time.monotonic()
out, ms = py(CLAIM, SITE=site, WORLD=world, COMPANY=company, CORE_USER=CORE_USER, CORE_KEY=key, CORE_SECRET=secret,
             LABEL_ONLY="1" if "--label-only" in sys.argv else "", AS_TEMPLATE="1" if "--as-template" in sys.argv else "")
inner = __import__("json").loads(out.strip().splitlines()[-1])
steps.append({"step": "one process: company renamed, joined, clock, credential, scheduler", "ms": ms, "inside": inner})
claim_ms = round((time.monotonic() - t0) * 1000)
for s in ([] if "--as-template" in sys.argv else company_setup(site, "org-" + secrets.token_hex(3), company, (key, secret))):
    steps.append({**s, "phase": "company setup (world, over HTTP)"})
emit({"question": "Q3b claim a pooled site", "label_only": "--label-only" in sys.argv,
      "as_template": "--as-template" in sys.argv, "pool_site": pool, "site": site, "world": world, "steps": steps,
      "claim_ms": claim_ms, "total_ms": round((time.monotonic() - t0) * 1000), "loadavg_before": before,
      "loadavg_after": loadavg()})

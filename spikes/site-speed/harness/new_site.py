"""Q1: a company site from nothing, step by step, as the door makes one (packages/platform/door/sites.py `build`),
then the company setup the world does through the site's own API user (capxul/core_company.py).
    new_site.py <site> <world> <company> [--no-company]   (--no-company: the door's part only, a blank template)"""
import json
import secrets
import sys
import time

from lib import bench, company_setup, core_user, credential, emit, loadavg

site, world, company = sys.argv[1:4]
wizard = {"company_name": company, "currency": "USD", "country": "United Kingdom"}
plan = [
    ("new-site", ["new-site", site, "--mariadb-user-host-login-scope=%", "--db-root-password",
                  __import__("lib").DB_ROOT, "--admin-password", secrets.token_hex(16)]),
    ("install erpnext", ["--site", site, "install-app", "erpnext"]),
    ("install hrms", ["--site", site, "install-app", "hrms"]),
    ("install capxul", ["--site", site, "install-app", "capxul"]),
    ("setup wizard", ["--site", site, "execute", "capxul.setup.run_wizard", "--kwargs", json.dumps(wizard)]),
    ("migrate", ["--site", site, "migrate"]),
    ("enable scheduler", ["--site", site, "enable-scheduler"]),
    ("join world", ["--site", site, "execute", "capxul.clock.join_world", "--kwargs", json.dumps({"world": world})]),
]
before = loadavg()
steps, t0 = [], time.monotonic()
for name, args in plan:
    _, ms = bench(*args)
    steps.append({"step": name, "phase": "door", "ms": ms})
key, secret = credential(site)
steps.append({"step": "core user", "phase": "door", "ms": core_user(site, key, secret)})
door_ms = round((time.monotonic() - t0) * 1000)
if "--no-company" not in sys.argv:
    for s in company_setup(site, "org-" + secrets.token_hex(3), company, (key, secret)):
        steps.append({**s, "phase": "company setup (world, over HTTP)"})
emit({"question": "Q1 new company site from nothing", "site": site, "world": world, "steps": steps,
      "door_ms": door_ms, "total_ms": round((time.monotonic() - t0) * 1000), "loadavg_before": before,
      "loadavg_after": loadavg()})

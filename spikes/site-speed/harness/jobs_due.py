"""Q6's setup: puts every site's scheduled jobs on their normal cadence from now. A site made by the door carries job
types created before the wizard set its time zone, stamped in Frappe's default (Asia/Kolkata, 5 h 30 ahead of
Europe/London), so none falls due for hours (observed here: `creation` 2026-11-14 04:38 on a site made at 23:07 UTC).
The idle measurement needs the scheduler doing its usual work, so last_execution is set to the site's now, as
capxul.clock.rewind_jobs does. Also prints, per site, how many job types were stamped ahead of the site's now.
    jobs_due.py <site> [<site>...]"""
import json
import sys

from lib import emit, py

FIX = """
import os, json, frappe
frappe.init(site=os.environ["SITE"], sites_path="."); frappe.connect()
now = frappe.utils.now_datetime()
ahead = frappe.db.sql("select count(*) from `tabScheduled Job Type` where creation > %s", now)[0][0]
frappe.db.sql("update `tabScheduled Job Type` set last_execution=%s", now)
frappe.db.commit()
print(json.dumps({"site": os.environ["SITE"], "job_types_created_ahead_of_now": ahead}))
"""
emit({"sites": [json.loads(py(FIX, SITE=s)[0].strip().splitlines()[-1]) for s in sys.argv[1:]]})

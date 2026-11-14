"""Q5: where a warp's time goes. Runs capxul.clock.advance for `days` days on a site in one bench process, as
core_api.warp does, with each Scheduled Job Type's execute timed, and prints the jobs by total time and frequency.
    warp_profile.py <site> <days>"""
import json
import sys

from lib import emit, py

site, days = sys.argv[1], int(sys.argv[2])
PROFILE = """
import os, json, time, collections, frappe
frappe.init(site=os.environ["SITE"], sites_path="."); frappe.connect(); frappe.set_user("Administrator")
from capxul import clock
from frappe.core.doctype.scheduled_job_type.scheduled_job_type import ScheduledJobType
spent, count, freq = collections.Counter(), collections.Counter(), {}
real = ScheduledJobType.execute
def timed(self):
    s = time.monotonic()
    try:
        return real(self)
    finally:
        spent[self.method] += time.monotonic() - s; count[self.method] += 1; freq[self.method] = self.frequency
ScheduledJobType.execute = timed
host = clock._host_ms(); off = clock.offset_ms(); days = int(os.environ["DAYS"])
start = clock.site_time(host + off)
frappe.db.sql("update `tabScheduled Job Type` set last_execution=%s where last_execution > %s or last_execution is null", (start, start))
s = time.monotonic()
moved = clock.advance.__wrapped__(off, off + days * 86400000)
total = time.monotonic() - s
frappe.db.rollback()
by_freq = collections.Counter()
for m, t in spent.items():
    by_freq[freq[m]] += t
print(json.dumps({"advance_s": round(total, 2), "stops": moved["stops"], "jobs_run": moved["jobs_run"],
    "job_types": frappe.db.count("Scheduled Job Type", {"stopped": 0}),
    "seconds_by_frequency": {k: round(v, 2) for k, v in by_freq.most_common()},
    "runs_by_frequency": dict(collections.Counter(freq[m] for m in count.elements())),
    "top_jobs": [{"method": m, "frequency": freq[m], "runs": count[m], "s": round(t, 2)} for m, t in spent.most_common(12)]}))
"""
out, ms = py(PROFILE, timeout=3600, SITE=site, DAYS=str(days))
emit({"question": "Q5 where a warp's time goes (one bench process, rolled back)", "site": site, "days": days,
      "process_ms": ms, **json.loads(out.strip().splitlines()[-1])})

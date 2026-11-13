"""The spike's probe: what a process on the shared bench reads as "now". It never imports capxul, so it also shows
whether the process had loaded the app (and so installed the clock wrapper) before the first time was read.

Called two ways (lib.sh): through `bench execute` (probe), and as a plain Python process that the bench CLI did not
start (plain): `cd sites && ../env/bin/python /probe/clockprobe.py <site> <function> [kwargs json]`, which does the
same frappe.init, frappe.connect and call. The worker loads the module from PYTHONPATH (compose.yaml)."""
import json
import os
import sys
from datetime import datetime, timezone

import frappe


def _state():
    import frappe.utils.data as data

    return {"capxul_loaded": "capxul" in sys.modules, "wrapper": bool(getattr(data.now_datetime, "_capxul", False))}


def read():
    """One reading: the site, its world, the site's time and date, and the host's real time beside them."""
    before = _state()
    now = frappe.utils.now_datetime()
    return {"site": frappe.local.site, "world": frappe.local.conf.get("capxul_world"), "now_datetime": str(now)[:19],
            "nowdate": frappe.utils.nowdate(), "host_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "pid": os.getpid(), **before}


def show():
    """One line a script can grep."""
    print("PROBE:" + json.dumps(read()))


def make_doc(label="bench execute"):
    """Insert a ToDo and report the `creation` Frappe stamped on it."""
    frappe.set_user("Administrator")
    d = frappe.get_doc({"doctype": "ToDo", "description": f"bench-clocks {label}"}).insert()
    frappe.db.commit()
    print("PROBE:" + json.dumps({"site": frappe.local.site, "via": label, "todo": d.name, "creation": str(d.creation)[:19]}))


def job(tag):
    """Runs in the background worker. The reading comes first, before any document (and so any capxul hook) is touched."""
    r = read()
    frappe.set_user("Administrator")
    d = frappe.get_doc({"doctype": "ToDo", "description": "bench-clocks job " + json.dumps({"tag": tag, **r})}).insert()
    frappe.db.commit()
    return d.name


def enqueue(tag, queue="short"):
    """Hand `job` to the shared worker (as a function, not a dotted name: Frappe resolves names only inside installed apps)."""
    frappe.enqueue(job, queue=queue, tag=tag)
    print("PROBE:" + json.dumps({"site": frappe.local.site, "enqueued": tag}))


def jobs():
    """What the worker's jobs read on this site, with the `creation` of the ToDo each one wrote."""
    for t in frappe.get_all("ToDo", {"description": ["like", "bench-clocks job %"]}, ["description", "creation"], order_by="name"):
        seen = json.loads(t.description[len("bench-clocks job "):])
        print("PROBE:" + json.dumps({"todo_creation": str(t.creation)[:19], **seen}))


def api_keys():
    """An API key for Administrator, so the checks can create a document over HTTP without a browser session."""
    from frappe.core.doctype.user.user import generate_keys

    frappe.set_user("Administrator")
    secret = generate_keys("Administrator")["api_secret"]
    frappe.db.commit()
    print("PROBE:" + json.dumps({"token": frappe.db.get_value("User", "Administrator", "api_key") + ":" + secret}))


def scheduled():
    """The scheduler's evidence on this site: the daily job's last run and the notes capxul.clock.daily left."""
    row = frappe.db.get_value("Scheduled Job Type", {"method": "capxul.clock.daily"}, ["name", "last_execution", "creation"], as_dict=True) or {}
    notes = frappe.get_all("Comment", {"reference_doctype": "Capxul Settings", "content": ["like", "capxul daily job ran%"]},
                           ["content", "creation"], order_by="creation")
    logs = frappe.get_all("Scheduled Job Log", {"scheduled_job_type": row.get("name")}, ["status", "creation"], order_by="creation")
    print("PROBE:" + json.dumps({"site": frappe.local.site, "last_execution": str(row.get("last_execution"))[:19],
                                 "all_job_logs_on_site": frappe.db.count("Scheduled Job Log"),
                                 "notes": [[n.content, str(n.creation)[:19]] for n in notes],
                                 "logs": [[l.status, str(l.creation)[:19]] for l in logs]}))


if __name__ == "__main__":
    import clockprobe  # the importable module, so a queued `job` is found by the worker under this name

    frappe.init(sys.argv[1])
    frappe.connect()
    try:
        getattr(clockprobe, sys.argv[2])(**(json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}))
    finally:
        frappe.destroy()

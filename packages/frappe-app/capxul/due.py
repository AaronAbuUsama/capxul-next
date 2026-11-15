"""One stop of a warp (capxul.clock.advance): every scheduled job that is due at the world's time, run inline."""
import time

import frappe


def run_due(timed=None):
    """Run, inline and now (world time), every scheduled job that is due. One call is one stop.

    Every running Scheduled Job Type is read in one query and asked `is_event_due` as it stands (that reads only its own
    fields: its frequency or cron, its last run and its creation); one that is due is then loaded afresh, asked again (an
    earlier job of the stop may have run it) and run. Before, every type was loaded on its own at every stop, a query
    for each of a site's hundred or so types, most of them not due. With `timed`, a dict, adds each job's run and its
    milliseconds to `timed[method]` as [runs, ms]."""
    ran = []
    for row in frappe.get_all("Scheduled Job Type", {"stopped": 0}, ["*"]):
        try:
            due = frappe.get_doc({**row, "doctype": "Scheduled Job Type"}).is_event_due()
        except Exception:
            continue
        if not due:
            continue
        jt = frappe.get_doc("Scheduled Job Type", row["name"])
        try:
            if not jt.is_event_due():
                continue
        except Exception:
            continue
        frappe.set_user("Administrator")
        started = time.perf_counter()
        jt.execute()
        if timed is not None:
            spent = timed.setdefault(jt.method, [0, 0.0])
            spent[0] += 1
            spent[1] += (time.perf_counter() - started) * 1000
        ran.append(jt.method)
    return ran

"""A site's Scheduled Job Types and the site's own time."""
import frappe


def settle_jobs():
    """No Scheduled Job Type may be stamped after the site's now. Frappe counts a job's next run from its
    `last_execution`, or from its `creation` if it never ran, so a stamp in the future holds the job back until then.
    Two things put stamps there: install makes the job types before the setup wizard sets the site's time zone, so
    they are stamped in Frappe's default zone (Asia/Kolkata, 5 h 30 min ahead of UTC: spikes/site-speed, "A new site's
    scheduler is idle for 5 h 30 min"); and a site that joins a world behind the host keeps the host's stamps. Every
    stamp ahead of now is brought back to now, so each job falls due on its own cadence from now. Answers how many
    stamps were moved."""
    w = frappe.utils.now_datetime()
    moved = 0
    for field in ("creation", "last_execution"):
        ahead = frappe.db.sql(f"select count(*) from `tabScheduled Job Type` where `{field}` > %s", (w,))[0][0]
        if ahead:
            frappe.db.sql(f"update `tabScheduled Job Type` set `{field}`=%s where `{field}` > %s", (w, w))
            moved += int(ahead)
    return moved

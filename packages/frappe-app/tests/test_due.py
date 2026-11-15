"""One stop of a warp (capxul.due.run_due) runs exactly the jobs the old stop ran, stop after stop, while loading only
the job types that are due. The old stop loaded every running type from the database at every stop and asked it
`is_event_due`; the new one reads them all in one query, asks each as it stands, and loads only those that are due.
Both are run here against the same job types over a fortnight of daily stops, with every cadence a site has."""
from datetime import datetime, timedelta
import importlib.util
import sys
import types
import unittest
from unittest.mock import patch

from test_bench_gaps import APP

CADENCE = {"All": timedelta(minutes=4), "Hourly": timedelta(hours=1), "Hourly Long": timedelta(hours=1),
           "Daily": timedelta(days=1), "Daily Long": timedelta(days=1), "Daily Maintenance": timedelta(days=1),
           "Weekly": timedelta(weeks=1), "Monthly": timedelta(days=30)}


class Site:
    """`tabScheduled Job Type` and the world's time. A job type is due one cadence after its last run (or its
    creation); running it stamps its last run with the time, as Frappe's Scheduled Job Type does."""

    def __init__(self, start):
        self.now = start
        self.rows = {}
        self.loads = 0
        self.ran = []

    def add(self, name, frequency, last_execution, stopped=0, broken=False):
        self.rows[name] = {"name": name, "method": f"app.{name}", "frequency": frequency, "stopped": stopped,
                           "creation": last_execution, "last_execution": last_execution, "broken": broken}

    def frappe(self):
        site = self

        class JobType:
            def __init__(self, row):
                self.__dict__.update(row)

            def is_event_due(self):
                if self.broken:
                    raise ValueError("a cron this Frappe cannot read")
                return (self.last_execution or self.creation) + CADENCE[self.frequency] <= site.now

            def execute(self):
                site.ran.append(self.method)
                site.rows[self.name]["last_execution"] = site.now

        def get_all(doctype, filters=None, fields=None, pluck=None):
            assert doctype == "Scheduled Job Type"
            rows = [dict(r) for r in site.rows.values() if all(r[k] == v for k, v in (filters or {}).items())]
            return [r[pluck] for r in rows] if pluck else rows

        def get_doc(doctype, name=None):
            if isinstance(doctype, dict):
                return JobType({k: v for k, v in doctype.items() if k != "doctype"})
            site.loads += 1
            return JobType(dict(site.rows[name]))

        return types.SimpleNamespace(get_all=get_all, get_doc=get_doc, set_user=lambda user: None)


def old_run_due(frappe):
    """The stop as it was before (capxul/clock.py, run_due, until November 2026)."""
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


def due_module(frappe):
    with patch.dict(sys.modules, {"frappe": frappe}):
        spec = importlib.util.spec_from_file_location("capxul_due_under_test", APP / "capxul" / "due.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


def fortnight(run):
    """A site with a job of every cadence, some run recently and some long ago, one stopped and one whose cron cannot
    be read; then fourteen daily stops at 01:00 and a last one at 09:00. What ran at each stop, and the loads."""
    start = datetime(2026, 11, 13, 9, 0)
    site = Site(start)
    for n, frequency in enumerate(CADENCE):
        site.add(f"{frequency.lower().replace(' ', '_')}", frequency, start - timedelta(hours=n))
        site.add(f"{frequency.lower().replace(' ', '_')}_old", frequency, start - timedelta(days=40))
    site.add("stopped", "Daily", start - timedelta(days=3), stopped=1)
    site.add("broken", "Daily", start - timedelta(days=3), broken=True)
    frappe, stops = site.frappe(), []
    for day in range(1, 15):
        site.now = datetime(2026, 11, 13, 1, 0) + timedelta(days=day)
        stops.append(sorted(run(frappe)))
    site.now = datetime(2026, 11, 27, 9, 0)
    stops.append(sorted(run(frappe)))
    return stops, site.loads, site.rows


class Stop(unittest.TestCase):
    def test_a_stop_runs_the_same_jobs_as_before_and_loads_only_those_due(self):
        before, loads_before, rows_before = fortnight(old_run_due)
        after, loads_after, rows_after = fortnight(lambda frappe: due_module(frappe).run_due())
        self.assertEqual(after, before, "the same jobs at every stop")
        self.assertEqual({n: r["last_execution"] for n, r in rows_after.items()},
                         {n: r["last_execution"] for n, r in rows_before.items()}, "the same last runs after")
        self.assertEqual(sum("app.daily_old" in stop for stop in after), 14, "a daily job once a day")
        self.assertEqual(sum("app.weekly_old" in stop for stop in after), 2, "a weekly job twice in a fortnight")
        self.assertTrue(all("app.stopped" not in stop and "app.broken" not in stop for stop in after))
        self.assertEqual(loads_after, sum(len(stop) for stop in after), "one load for each job run, none for the rest")
        self.assertLess(loads_after, loads_before)

    def test_a_job_an_earlier_job_of_the_stop_ran_is_not_run_twice(self):
        site = Site(datetime(2026, 11, 20, 1, 0))
        site.add("daily", "Daily", datetime(2026, 11, 18, 1, 0))
        frappe = site.frappe()
        read = frappe.get_all("Scheduled Job Type", {"stopped": 0}, ["*"])  # read before the stop's first job ran
        site.rows["daily"]["last_execution"] = site.now  # which then ran this one
        frappe.get_all = lambda *a, **k: read
        self.assertEqual(due_module(frappe).run_due(), [])
        self.assertEqual(site.ran, [])

    def test_a_timed_stop_adds_each_jobs_runs_and_milliseconds(self):
        site = Site(datetime(2026, 11, 20, 1, 0))
        site.add("daily", "Daily", datetime(2026, 11, 18, 1, 0))
        site.add("hourly", "Hourly", datetime(2026, 11, 18, 1, 0))
        module, timed = due_module(site.frappe()), {"app.daily": [3, 12.5]}
        module.run_due(timed)
        self.assertEqual(sorted(timed), ["app.daily", "app.hourly"])
        self.assertEqual(timed["app.daily"][0], 4)
        self.assertGreaterEqual(timed["app.daily"][1], 12.5)
        self.assertEqual(timed["app.hourly"][0], 1)


if __name__ == "__main__":
    unittest.main()

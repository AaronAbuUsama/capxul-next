"""A new site's scheduled jobs fall due on their cadence from the site's now (packages/platform/records/site-speed,
"A new site's scheduler is idle for 5 h 30 min"): install stamps the job types in Frappe's default time zone, Asia/Kolkata, before the setup
wizard sets the site's own, and a site that joins a world behind the host keeps the host's stamps. capxul.jobs'
settle_jobs brings every stamp ahead of the site's now back to now; the wizard and joining a world both run it."""
import contextlib
from datetime import datetime, timedelta
import importlib.util
import io
import sqlite3
import sys
import types
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

from test_bench_gaps import APP, HOST, clock_module, ms, write

FMT = "%Y-%m-%d %H:%M:%S"


class JobTypes:
    """`tabScheduled Job Type` in SQLite, behind frappe.db.sql's `%s` parameters."""

    def __init__(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("create table `tabScheduled Job Type` (method text, frequency text, creation text, last_execution text)")

    def sql(self, query, values=()):
        return self.db.execute(query.replace("%s", "?"), tuple(str(v) for v in values)).fetchall()

    def commit(self):
        self.db.commit()

    def add(self, method, frequency, creation, last_execution=None):
        self.db.execute("insert into `tabScheduled Job Type` values (?, ?, ?, ?)", (method, frequency, creation, last_execution))

    def stamps(self):
        return {m: (c, l) for m, c, l in self.db.execute("select method, creation, last_execution from `tabScheduled Job Type`")}


def next_due(frequency, creation, last_execution):
    """When Frappe next runs a job: one cadence after its last run, or after its creation if it never ran (the
    cron forms of Hourly and Daily: the next whole hour, the next midnight)."""
    since = datetime.strptime(last_execution or creation, FMT)
    if frequency == "Hourly":
        return since.replace(minute=0, second=0) + timedelta(hours=1)
    return since.replace(hour=0, minute=0, second=0) + timedelta(days=1)


@contextlib.contextmanager
def site(tz="Europe/London"):
    with clock_module(tz) as (clock, frappe, utils, directory):
        jobs = JobTypes()
        frappe.db = jobs
        try:
            yield clock, frappe, jobs, directory
        finally:
            jobs.db.close()


def settle():
    """capxul.jobs.settle_jobs, on the fake Frappe of the site under test."""
    return importlib.import_module("capxul.jobs").settle_jobs()


class NewSiteScheduler(unittest.TestCase):
    def test_jobs_stamped_in_kolkata_before_the_wizard_fall_due_on_their_cadence(self):
        with site() as (clock, frappe, jobs, _):
            # Made during install, at the host's 09:00 UTC, read in Asia/Kolkata: 14:30, 5 h 30 min ahead of the site.
            install = datetime.fromtimestamp(HOST["ms"] / 1000, ZoneInfo("Asia/Kolkata")).strftime(FMT)
            self.assertEqual(install, "2026-11-13 14:30:00")
            jobs.add("hourly_job", "Hourly", install)
            jobs.add("daily_job", "Daily", install)
            jobs.add("ran_earlier", "Hourly", "2026-11-12 08:00:00", "2026-11-13 08:00:00")
            now = frappe.utils.now_datetime()
            self.assertEqual(now, datetime(2026, 11, 13, 9))
            self.assertEqual(next_due("Hourly", install, None), datetime(2026, 11, 13, 15), "before: idle until 15:00")

            self.assertEqual(settle(), 2)

            stamps = jobs.stamps()
            self.assertEqual(stamps["hourly_job"], ("2026-11-13 09:00:00", None))
            self.assertEqual(stamps["daily_job"], ("2026-11-13 09:00:00", None))
            self.assertEqual(stamps["ran_earlier"], ("2026-11-12 08:00:00", "2026-11-13 08:00:00"), "a stamp in the past stays")
            self.assertEqual(next_due("Hourly", *stamps["hourly_job"]), datetime(2026, 11, 13, 10))
            self.assertEqual(next_due("Daily", *stamps["daily_job"]), datetime(2026, 11, 14))
            self.assertEqual(settle(), 0, "settling twice moves nothing")

    def test_joining_a_world_behind_the_host_settles_on_the_world_s_time(self):
        with site() as (clock, frappe, jobs, directory):
            jobs.add("hourly_job", "Hourly", "2026-11-13 09:00:00", "2026-11-13 09:00:00")
            installer = types.ModuleType("frappe.installer")
            installer.update_site_config = lambda key, value: None
            behind = ms("2026-10-01T12:00:00") - HOST["ms"]
            write(clock, "late", behind)
            with patch.dict(sys.modules, {"frappe.installer": installer}):
                with contextlib.redirect_stdout(io.StringIO()):
                    clock.join_world("late")
            self.assertEqual(frappe.utils.now_datetime(), datetime(2026, 10, 1, 13), "British Summer Time")
            self.assertEqual(jobs.stamps()["hourly_job"], ("2026-10-01 13:00:00", "2026-10-01 13:00:00"))


class WizardSettlesJobs(unittest.TestCase):
    def test_the_wizard_settles_the_jobs_after_it_sets_the_time_zone(self):
        done = []
        frappe = types.ModuleType("frappe")
        frappe.is_setup_complete = lambda: False
        frappe.db = types.SimpleNamespace(commit=lambda: done.append("commit"))
        wizard = types.ModuleType("frappe.desk.page.setup_wizard.setup_wizard")
        wizard.setup_complete = lambda args: done.append(f"wizard {args['timezone']}") or {"status": "ok"}
        utils = types.ModuleType("frappe.utils")
        utils.getdate, utils.nowdate = (lambda s: datetime.strptime(s, "%Y-%m-%d")), (lambda: "2026-11-13")
        jobs_module = types.ModuleType("capxul.jobs")
        jobs_module.settle_jobs = lambda: done.append("settle")
        custom = types.ModuleType("frappe.custom.doctype.custom_field.custom_field")
        custom.create_custom_fields = lambda *a, **k: None
        capxul = types.ModuleType("capxul")
        capxul.__path__ = [str(APP / "capxul")]
        mods = {"frappe": frappe, "frappe.utils": utils, "frappe.desk.page.setup_wizard.setup_wizard": wizard,
                "capxul": capxul, "capxul.jobs": jobs_module, "frappe.custom.doctype.custom_field.custom_field": custom}
        for name in ("frappe.desk", "frappe.desk.page", "frappe.desk.page.setup_wizard", "frappe.custom",
                     "frappe.custom.doctype", "frappe.custom.doctype.custom_field"):
            mods[name] = types.ModuleType(name)
        with patch.dict(sys.modules, mods):
            spec = importlib.util.spec_from_file_location("setup_under_test", APP / "capxul" / "setup.py")
            setup = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(setup)
            self.assertEqual(setup.run_wizard("Acme Ltd", "USD", "United Kingdom"), {"status": "ok"})
        self.assertEqual(done, ["wizard Europe/London", "settle", "commit"])


if __name__ == "__main__":
    unittest.main()

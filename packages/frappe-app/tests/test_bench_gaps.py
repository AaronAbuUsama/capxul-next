"""The four gaps a shared bench had (spikes/bench-clocks, README "What does not hold"), each held by a test that needs no site."""
import contextlib
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import types
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

APP = Path(__file__).resolve().parents[1]
HOST = {"ms": 1794560400000}  # 2026-11-13 09:00 UTC: Europe/London is on GMT (UTC+0)


def ms(text):
    return int(datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp() * 1000)


class HostDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime.fromtimestamp(HOST["ms"] / 1000, tz or timezone.utc)


@contextlib.contextmanager
def clock_module(tz="Europe/London", **local):
    """capxul/clock.py on a fake Frappe whose now_datetime() is Frappe's own: the host's instant in the site's time zone."""
    with tempfile.TemporaryDirectory() as directory:
        frappe = types.ModuleType("frappe")
        frappe.local = types.SimpleNamespace(**{"conf": {"capxul_world": "w"}, "sites_path": directory, **local})
        frappe.whitelist = lambda **kw: lambda fn: fn
        utils, data = types.ModuleType("frappe.utils"), types.ModuleType("frappe.utils.data")
        data.now_datetime = lambda: HostDateTime.now(ZoneInfo(tz)).replace(tzinfo=None)
        utils.now_datetime, utils.get_system_timezone, utils.data, frappe.utils = data.now_datetime, lambda: tz, data, utils
        capxul = types.ModuleType("capxul")
        capxul.__path__ = [str(APP / "capxul")]
        with patch.dict(sys.modules, {"frappe": frappe, "frappe.utils": utils, "frappe.utils.data": data, "capxul": capxul}):
            spec = importlib.util.spec_from_file_location("clock_under_test", APP / "capxul" / "clock.py")
            clock = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(clock)
            clock.datetime = HostDateTime
            clock.install()
            yield clock, frappe, utils, directory


def write(clock, *a, **k):
    with contextlib.redirect_stdout(io.StringIO()):
        clock.write_world(*a, **k)


class RunningClockAcrossDaylightSaving(unittest.TestCase):
    """Gap 3: a running clock added its offset to the host's wall time, so in November (GMT) a world running in June (BST) read an hour early."""

    def test_running_world_reads_the_site_time_of_its_instant(self):
        with clock_module() as (clock, frappe, utils, _):
            write(clock, "w", ms("2026-06-15 12:00:00") - HOST["ms"])
            self.assertEqual(utils.now_datetime(), datetime(2026, 6, 15, 13, 0), "12:00 UTC on 15 June is 13:00 in London")
            write(clock, "w", 0, rate=2)  # a fast clock from the host's own instant: same arithmetic, no daylight change
            HOST["ms"] += 10000
            try:
                self.assertEqual(utils.now_datetime(), datetime(2026, 11, 13, 9, 0, 20))
            finally:
                HOST["ms"] -= 10000

    def test_frozen_and_running_worlds_at_one_instant_agree(self):
        with clock_module() as (clock, frappe, utils, _):
            at = ms("2026-06-15 12:00:00")
            write(clock, "frozen", 0, frozen_at_ms=at)
            write(clock, "running", at - HOST["ms"])
            frappe.local.conf["capxul_world"] = "frozen"
            frozen = utils.now_datetime()
            frappe.local.conf["capxul_world"] = "running"
            self.assertEqual(utils.now_datetime(), frozen)

    def test_advance_stops_at_one_in_the_morning_on_both_sides_of_the_change(self):
        with clock_module() as (clock, *_):
            start, end = ms("2026-10-23 12:00:00") - HOST["ms"], ms("2026-10-27 12:00:00") - HOST["ms"]
            stops = clock.advance_stops(HOST["ms"], start, end)
            self.assertEqual([str(d) for d, _ in stops],
                             ["2026-10-24 01:00:00", "2026-10-25 01:00:00", "2026-10-26 01:00:00", "2026-10-27 01:00:00", "2026-10-27 12:00:00"])
            for d, off in stops:
                self.assertEqual(clock.site_time(HOST["ms"] + off), d, "each stop's offset reads back as the stop")


class WorldChangeReachesWeb(unittest.TestCase):
    """Gap 4: a web process keeps frappe.local.conf for up to 60 s; the site's world is read from its site_config.json."""

    def test_world_follows_site_config_while_the_conf_is_stale(self):
        with tempfile.TemporaryDirectory() as site:
            with clock_module(site_path=site) as (clock, frappe, utils, _):
                write(clock, "alpha", 0, frozen_at_ms=ms("2027-03-31 10:00:00"))
                write(clock, "beta", 0, frozen_at_ms=ms("2026-06-15 12:00:00"))
                frappe.local.conf["capxul_world"] = "alpha"  # what the web process loaded, and keeps
                Path(site, "site_config.json").write_text(json.dumps({"capxul_world": "alpha"}))
                self.assertEqual(utils.now_datetime(), datetime(2027, 3, 31, 11, 0))
                Path(site, "site_config.json").write_text(json.dumps({"capxul_world": "beta", "db_name": "x"}))
                os.utime(Path(site, "site_config.json"), ns=(1, 1))  # a different modification time, however fast the write
                self.assertEqual(clock.world_of_site(), "beta")
                self.assertEqual(utils.now_datetime(), datetime(2026, 6, 15, 13, 0))


class EncryptionKeyAtCreation(unittest.TestCase):
    """Gap 4: the site's encryption key is written when capxul is installed, before the site can be served."""

    def test_after_install_writes_the_key(self):
        made = []
        frappe = types.ModuleType("frappe")
        password = types.ModuleType("frappe.utils.password")
        password.get_encryption_key = lambda: made.append("key") or "key"
        custom = types.ModuleType("frappe.custom.doctype.custom_field.custom_field")
        custom.create_custom_fields = lambda *a, **k: None
        mods = {"frappe": frappe, "frappe.utils": types.ModuleType("frappe.utils"), "frappe.utils.password": password,
                "frappe.custom": types.ModuleType("x"), "frappe.custom.doctype": types.ModuleType("x"),
                "frappe.custom.doctype.custom_field": types.ModuleType("x"), "frappe.custom.doctype.custom_field.custom_field": custom}
        with patch.dict(sys.modules, mods):
            spec = importlib.util.spec_from_file_location("setup_under_test", APP / "capxul" / "setup.py")
            setup = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(setup)
            setup.ensure_defaults = lambda: made.append("defaults")
            setup.after_install()
        self.assertEqual(made, ["key", "defaults"])


FAKE_FRAPPE = {
    "frappe/__init__.py": """
        import types
        local = types.SimpleNamespace(conf={"capxul_world": "w"}, sites_path=SITES)
        def whitelist(**k):
            return lambda fn: fn
        from frappe.utils.data import now_datetime  # as Frappe does: a reference taken before any app is loaded
        import frappe.utils
    """,
    "frappe/utils/__init__.py": "from frappe.utils.data import now_datetime, get_system_timezone\n",
    "frappe/utils/data.py": """
        from datetime import datetime
        from zoneinfo import ZoneInfo
        def get_system_timezone():
            return "Europe/London"
        def now_datetime():
            return datetime.now(ZoneInfo(get_system_timezone())).replace(tzinfo=None)
    """,
    "frappe/app.py": "import frappe\napplication = object()\n",
}


class EveryBenchProcessReadsWorldTime(unittest.TestCase):
    """Gaps 1 and 2: gunicorn (frappe.app) and a plain Python process load the clock through capxul_world_clock.pth."""

    def run_python(self, code):
        with tempfile.TemporaryDirectory() as d:
            sites, lib, site_packages = Path(d, "sites"), Path(d, "lib"), Path(d, "site-packages")
            for p in (sites, site_packages):
                p.mkdir()
            for name, body in FAKE_FRAPPE.items():
                Path(lib, name).parent.mkdir(parents=True, exist_ok=True)
                Path(lib, name).write_text(textwrap.dedent(body).replace("SITES", repr(str(sites))))
            Path(sites, "capxul-world-clocks.json").write_text(json.dumps({"w": {
                "offset_ms": 0, "frozen_at_ms": ms("2027-03-31 10:00:00"), "rate": 1.0, "host_anchor_ms": 0}}))
            Path(site_packages, "capxul.pth").write_text(str(APP) + "\n")  # what the editable install writes
            env = {**os.environ, "PYTHONPATH": str(lib)}
            subprocess.run([sys.executable, "-c", f"import capxul.boot as b; b.write_pth({str(site_packages)!r})"],
                           env={**env, "PYTHONPATH": f"{lib}{os.pathsep}{APP}"}, check=True)
            head = f"import site, sys; site.addsitedir({str(site_packages)!r}); assert 'frappe' not in sys.modules, 'arming imported frappe'\n"
            out = subprocess.run([sys.executable, "-c", head + code], env=env, capture_output=True, text=True)
            self.assertEqual(out.returncode, 0, out.stderr)
            return out.stdout.split()

    def test_web_entry_reads_world_time_from_the_first_request(self):
        got = self.run_python("import frappe.app, frappe; print(frappe.now_datetime().date(), frappe.utils.data.now_datetime._capxul)")
        self.assertEqual(got, ["2027-03-31", "True"])

    def test_plain_python_process_reads_world_time(self):
        got = self.run_python("import frappe; from frappe.utils import now_datetime; print(now_datetime())")
        self.assertEqual(got, ["2027-03-31", "11:00:00"])

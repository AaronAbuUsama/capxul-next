"""The clock follower's public write/read contract, isolated from other tests' Frappe fakes."""
import contextlib
from datetime import datetime, timezone
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo


class RestoredClock(unittest.TestCase):
    def test_frozen_rate_and_legacy_worlds_stay_independent(self):
        app = Path(__file__).resolve().parents[1] / "capxul"
        host_ms = 1772442000000  # 2026-03-02 09:00 UTC

        class HostDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime.fromtimestamp(host_ms / 1000, tz or timezone.utc)

        with tempfile.TemporaryDirectory() as directory:
            frappe = types.ModuleType("frappe")
            frappe.local = types.SimpleNamespace(conf={"capxul_world": "frozen"}, sites_path=directory)
            frappe.whitelist = lambda **kw: lambda fn: fn
            utils = types.ModuleType("frappe.utils")
            data = types.ModuleType("frappe.utils.data")
            data.now_datetime = lambda: datetime.fromtimestamp(host_ms / 1000, ZoneInfo("America/New_York")).replace(tzinfo=None)
            utils.now_datetime = data.now_datetime
            utils.get_system_timezone = lambda: "America/New_York"
            utils.data = data
            frappe.utils = utils
            capxul = types.ModuleType("capxul")
            capxul.__path__ = [str(app)]
            with patch.dict(sys.modules, {"frappe": frappe, "frappe.utils": utils, "frappe.utils.data": data, "capxul": capxul}):
                spec = importlib.util.spec_from_file_location("clock_under_test", app / "clock.py")
                clock = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(clock)
                clock.datetime = HostDateTime
                clock.install()
                with contextlib.redirect_stdout(io.StringIO()):
                    clock.write_world("frozen", 0, frozen_at_ms=host_ms)
                    clock.write_world("legacy", 7200000)
                    clock.write_world("fast", 0, rate=2)
                first = utils.now_datetime()
                self.assertEqual(first, datetime(2026, 3, 2, 4))
                host_ms += 10000
                self.assertEqual(utils.now_datetime(), first, "frozen UTC instant does not drift with host time")
                frappe.local.conf["capxul_world"] = "fast"
                self.assertEqual(utils.now_datetime(), datetime(2026, 3, 2, 4, 0, 20))
                frappe.local.conf["capxul_world"] = "legacy"
                self.assertEqual(utils.now_datetime(), datetime(2026, 3, 2, 6, 0, 10))
                frappe.local.conf["capxul_world"] = "frozen"
                frappe.local.conf[clock.OVERRIDE] = 1000
                self.assertEqual(utils.now_datetime(), datetime(2026, 3, 2, 4, 0, 11), "warp override takes precedence over frozen state")
                with self.assertRaises(ValueError):
                    clock.write_world("bad", 0, rate=0)
                del frappe.local.conf
                self.assertEqual(utils.now_datetime(), datetime(2026, 3, 2, 4, 0, 10), "bench commands can read time before a site is initialized")

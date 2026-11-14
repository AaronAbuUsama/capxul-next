"""Bench templates never change, and are removed by age (templates.py; decision "Bench templates never change", 14
November 2026), without a bench: MariaDB's and the bench's work is replaced by stand-ins that record what was asked."""

import json
import os
import shutil
import threading
import time
import unittest
from unittest import mock

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import db
import pool
import sites
import templates
from sites import Refused

W1 = {"world": "w1", "quota": 1, "expires": int(time.time()) + 600}
W2 = {"world": "w2", "quota": 1, "expires": int(time.time()) + 600}


def ready_site(world):
    site = f"northwind-{world}.pool.test"
    sites.write_entry({"site": site, "world": world, "state": "ready", "company": "Northwind"})
    os.makedirs(f"{sites.BENCH}/sites/{site}", exist_ok=True)
    return site


def kept(name, used, label="northwind"):
    home = f"{templates.TEMPLATES}/{name}/{label}"
    os.makedirs(f"{home}/site", exist_ok=True)
    with open(f"{home}/meta.json", "w") as f:
        json.dump({"template": name, "label": label, "db": "_00000000000000aa", "made_at": used}, f)
    templates.mark_used(name, used)


class Bench:
    """Stand-ins for MariaDB and the bench: each copy waits on `gate` when one is given, and every database copied or
    dropped is recorded."""

    def __init__(self, gate=None, fail=False):
        self.copied, self.dropped, self.gate, self.fail = [], [], gate, fail

    def copy(self, src, dst, conn=None):
        if self.gate is not None:
            self.gate.wait(5)
        if self.fail:
            raise RuntimeError("copy failed")
        self.copied.append(dst)

    def patches(self):
        return [mock.patch.object(db, "copy", self.copy), mock.patch.object(db, "drop", self.dropped.append),
                mock.patch.object(db, "drop_user", lambda _name: None),
                mock.patch.object(db, "site_config", lambda _folder: {"db_name": "_source"}),
                mock.patch.object(pool, "site_folder_copy", lambda _src, dst: os.makedirs(dst, exist_ok=True)),
                mock.patch.object(pool, "refill_soon", lambda _template: None)]


class TemplatesTest(unittest.TestCase):
    def setUp(self):
        self.bench = Bench()
        self.patched = self.bench.patches()
        for patch in self.patched:
            patch.start()

    def tearDown(self):
        for patch in self.patched:
            patch.stop()
        shutil.rmtree(sites.REGISTRY, ignore_errors=True)
        shutil.rmtree(f"{sites.BENCH}/sites", ignore_errors=True)
        os.makedirs(f"{sites.BENCH}/sites", exist_ok=True)

    def make(self, c, name="payment-drafted-0a1b2c3d4e-5f6a7b"):
        return templates.make_template(c, {"template": name, "site": ready_site(c["world"])})

    def test_a_template_is_made_once_and_never_replaced(self):
        first = self.make(W1)
        self.assertTrue(first["made"])
        second = self.make(W2)
        self.assertFalse(second["made"], "a second make of the name changes nothing")
        self.assertEqual(second["sites"][0]["made_by"], "w1")
        self.assertEqual(len(self.bench.copied), 1)
        self.assertEqual(self.bench.dropped, [], "nothing of the first is dropped")
        self.assertEqual(templates.names(), ["payment-drafted-0a1b2c3d4e-5f6a7b"])

    def test_two_makes_at_once_make_it_once_and_the_second_gets_the_first(self):
        gate = threading.Event()
        self.bench.gate = gate
        answers = {}
        first = threading.Thread(target=lambda: answers.setdefault("w1", self.make(W1)))
        first.start()
        time.sleep(0.2)
        self.assertEqual(templates.names(), [], "a template being made is not one yet")
        second = threading.Thread(target=lambda: answers.setdefault("w2", self.make(W2)))
        second.start()
        time.sleep(0.2)
        self.assertNotIn("w2", answers, "the second waits for the first's make")
        gate.set()
        first.join(5)
        second.join(5)
        self.assertTrue(answers["w1"]["made"])
        self.assertFalse(answers["w2"]["made"])
        self.assertEqual(answers["w2"]["sites"][0]["db"], answers["w1"]["sites"][0]["db"])
        self.assertEqual(len(self.bench.copied), 1)

    def test_a_make_that_fails_leaves_nothing(self):
        self.bench.fail = True
        with self.assertRaises(RuntimeError):
            self.make(W1)
        self.assertEqual(templates.names(), [])
        self.assertFalse(os.path.exists(f"{templates.TEMPLATES}/payment-drafted-0a1b2c3d4e-5f6a7b.making"))
        self.assertEqual(len(self.bench.dropped), 1, "the database its meta named is dropped")
        self.bench.fail = False
        self.assertTrue(self.make(W1)["made"], "the name can be made after a failed make")

    def test_a_template_left_half_made_by_a_stopped_door_is_removed_at_start(self):
        home = f"{templates.TEMPLATES}/founded-0a1b2c3d4e-5f6a7b{templates.MAKING}/northwind"
        os.makedirs(home)
        with open(f"{home}/meta.json", "w") as f:
            json.dump({"db": "_00000000000000bb", "label": "northwind"}, f)
        pool.tidy()
        self.assertFalse(os.path.exists(os.path.dirname(home)))
        self.assertEqual(self.bench.dropped, ["_00000000000000bb"])

    def test_a_claim_marks_the_template_used(self):
        kept("founded-0a1b2c3d4e-5f6a7b", used=1000)
        self.assertEqual(templates.used_at("founded-0a1b2c3d4e-5f6a7b"), 1000)
        self.assertEqual(len(templates.claimable("founded-0a1b2c3d4e-5f6a7b")), 1)
        self.assertGreater(templates.used_at("founded-0a1b2c3d4e-5f6a7b"), time.time() - 5)
        self.assertEqual(templates.claimable("nothing-here"), [])

    def test_the_sweep_removes_only_what_has_long_been_unused_and_is_not_busy(self):
        now = int(time.time())
        kept("old", used=now - 7 * 3600)
        kept("recent", used=now - 600)
        kept("busy", used=now - 7 * 3600)
        with self.assertRaises(Refused) as r:
            templates.sweep(W1, {"idle_s": 60})
        self.assertEqual(r.exception.code, "sweep-idle-invalid", "an idle under the door's floor is refused")
        dry = templates.sweep(W1, {"idle_s": 6 * 3600, "dry_run": True})
        self.assertEqual([t["template"] for t in dry["removed"]], ["busy", "old"])
        self.assertEqual(templates.names(), ["busy", "old", "recent"], "a dry run removes nothing")
        with templates.template_lock("busy"):
            swept = templates.sweep(W1, {"idle_s": 6 * 3600})
        self.assertEqual([t["template"] for t in swept["removed"]], ["old"])
        self.assertEqual(swept["busy"], ["busy"])
        self.assertEqual([t["template"] for t in swept["kept"]], ["recent"])
        self.assertEqual(templates.names(), ["busy", "recent"])
        self.assertEqual(self.bench.dropped, ["_00000000000000aa"])

    def test_the_apps_hash_follows_the_capxul_app(self):
        apps = f"{sites.BENCH}/apps"
        templates._app_version.clear()
        self.assertEqual(templates.app_version(), "none")
        os.makedirs(f"{apps}/capxul/capxul/__pycache__")
        os.makedirs(f"{apps}/frappe/frappe")
        for path, text in ((f"{apps}/capxul/capxul/api.py", "a"), (f"{apps}/frappe/frappe/__init__.py", "v16"),
                           (f"{apps}/capxul/capxul/__pycache__/api.pyc", "x")):
            with open(path, "w") as f:
                f.write(text)
        try:
            templates._app_version.clear()
            before = templates.app_version()
            with open(f"{apps}/capxul/capxul/__pycache__/api.pyc", "w") as f:
                f.write("y")
            templates._app_version.clear()
            self.assertEqual(templates.app_version(), before, "compiled files are not the app")
            with open(f"{apps}/capxul/capxul/api.py", "w") as f:
                f.write("b")
            templates._app_version.clear()
            self.assertNotEqual(templates.app_version(), before)
        finally:
            shutil.rmtree(apps, ignore_errors=True)
            templates._app_version.clear()


if __name__ == "__main__":
    unittest.main()

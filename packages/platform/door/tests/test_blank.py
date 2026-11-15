"""Blank company sites (blank.py), without a bench: a company's site is a copy of the bench's blank one, taken from its
pool or copied from it, then configured; with no blank it is built from nothing. MariaDB, the bench's commands and the
bench's Python are stand-ins that record what was asked."""

import json
import os
import shutil
import threading
import time
import unittest
from unittest import mock

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import blank
import db
import pool
import sites
import templates
from sites import Refused

CRED = ("a" * 16, "b" * 32)


def asked(world):
    """A company site the door was asked for (`POST /sites`), as create_site leaves it in the registry."""
    site = f"northwind-{world}.pool.test"
    sites.write_entry({"site": site, "world": world, "company": "Northwind", "state": "creating", "steps": []})
    return site


def config(folder, **conf):
    os.makedirs(folder, exist_ok=True)
    db.write_site_config(folder, {"db_name": "_00000000000000aa", "encryption_key": "blank-key", **conf})


def kept_blank(fingerprint, copies=0):
    """A whole blank template of the fingerprint, with `copies` ready copies in its pool."""
    name, home = f"blank-{fingerprint}", f"{templates.TEMPLATES}/blank-{fingerprint}/blank"
    config(f"{home}/site")
    templates.write_meta(home, {"template": name, "label": "blank", "db": "_00000000000000aa", "made_at": 1})
    for n in range(copies):
        config(f"{pool.POOL}/{name}/blank/0000000{n}", db_name=f"_copy{n}")
    return name


class Bench:
    """Stand-ins: MariaDB's copies and drops, the bench's commands, and the configure process, each recorded."""

    def __init__(self):
        self.copied, self.dropped, self.commands, self.configured, self.gate = [], [], [], [], None

    def copy_site(self, src_db, src_folder, dst_folder, conn=None):
        self.copied.append(src_db)
        config(dst_folder, db_name=f"_new{len(self.copied)}")

    def bench(self, *args, env=None):
        self.commands.append(args)
        if args[0] == "new-site":
            config(f"{sites.BENCH}/sites/{args[1]}", db_name="_00000000000000bb")
        if self.gate is not None:
            self.gate.wait(5)
        return "", 1

    def configure(self, site, world, company, key, secret):
        self.configured.append((site, world, company))
        return [{"step": "setup wizard", "ms": 1}, {"step": "core user", "ms": 1}]

    def patches(self):
        return [mock.patch.object(pool, "copy_site", self.copy_site), mock.patch.object(blank, "bench", self.bench),
                mock.patch.object(sites, "bench", self.bench), mock.patch.object(blank, "configure", self.configure),
                mock.patch.object(db, "drop", self.dropped.append), mock.patch.object(db, "drop_user", lambda *_: None),
                mock.patch.object(db, "run", lambda *_a, **_k: ((0,),)),
                mock.patch.object(sites, "make_core_user", lambda *_a: 1),
                mock.patch.object(blank, "drop_database", lambda _site: None)]


class BlankTest(unittest.TestCase):
    def setUp(self):
        self.bench = Bench()
        self.patched = self.bench.patches()
        for patch in self.patched:
            patch.start()
        templates._app_version[:] = ["0a1b2c3d4e5f6a7b"]
        blank._state.update(making=False, failed_at=None, error=None)
        self.refills = []
        self.refill = mock.patch.object(pool, "refill_soon", self.refills.append)
        self.refill.start()

    def tearDown(self):
        self.refill.stop()
        for patch in self.patched:
            patch.stop()
        templates._app_version.clear()
        shutil.rmtree(sites.REGISTRY, ignore_errors=True)
        shutil.rmtree(f"{sites.BENCH}/sites", ignore_errors=True)
        os.makedirs(f"{sites.BENCH}/sites", exist_ok=True)

    def make(self, world):
        site = asked(world)
        sites.build(site, world, "Northwind", *CRED)
        return sites.read_entry(site)

    def test_a_company_site_is_a_ready_copy_of_the_blank_then_configured(self):
        name = kept_blank("0a1b2c3d4e5f6a7b", copies=1)
        entry = self.make("w1")
        self.assertEqual(entry["state"], "ready")
        self.assertEqual(entry["made_from"], {"template": name, "how": "pool"})
        self.assertEqual([s["step"] for s in entry["steps"]],
                         ["blank copy taken from the pool", "own encryption key", "setup wizard", "core user"])
        self.assertEqual(self.bench.configured, [("northwind-w1.pool.test", "w1", "Northwind")])
        self.assertEqual(self.bench.commands, [], "no bench command: nothing is built")
        self.assertEqual(pool.ready_copies(name, "blank"), [], "the copy left the pool")
        conf = db.site_config(f"{sites.BENCH}/sites/northwind-w1.pool.test")
        self.assertNotEqual(conf["encryption_key"], "blank-key", "a key of its own: the blank's database held none")
        self.assertIn(name, self.refills, "the pool is refilled after")
        self.assertEqual(sites.public(entry)["made_from"]["how"], "pool")

    def test_with_the_pool_empty_it_is_copied_from_the_blank(self):
        name = kept_blank("0a1b2c3d4e5f6a7b")
        entry = self.make("w1")
        self.assertEqual(entry["state"], "ready")
        self.assertEqual(entry["made_from"]["how"], "copy")
        self.assertEqual(self.bench.copied, ["_00000000000000aa"])
        self.assertIn(name, self.refills)

    def test_with_no_blank_it_is_built_from_nothing_as_before(self):
        blank._state["failed_at"] = time.time()  # a blank that failed just now is not tried again yet
        entry = self.make("w1")
        self.assertEqual(entry["state"], "ready")
        self.assertIsNone(entry.get("made_from"))
        self.assertEqual([c[0] if c[0] == "new-site" else c[2] for c in self.bench.commands],
                         ["new-site", "install-app", "install-app", "install-app", "execute", "migrate",
                          "enable-scheduler", "execute"])
        self.assertEqual(self.bench.configured, [])

    def test_a_blank_of_other_apps_is_never_used_and_goes_at_the_start(self):
        old = kept_blank("ffffffffffffffff", copies=2)
        blank._state["failed_at"] = time.time()
        entry = self.make("w1")
        self.assertIsNone(entry.get("made_from"), "built from nothing: the only blank holds other apps")
        self.assertEqual(len(pool.ready_copies(old, "blank")), 2, "none of its copies taken")
        blank.tidy()
        self.assertEqual(templates.names(), [], "removed with its pool")
        self.assertFalse(os.path.exists(f"{pool.POOL}/{old}"))
        self.assertIn("_00000000000000aa", self.bench.dropped)

    def test_two_companies_at_once_with_one_ready_copy(self):
        name = kept_blank("0a1b2c3d4e5f6a7b", copies=1)
        sites_ = [asked("w1"), asked("w2")]
        threads = [threading.Thread(target=sites.build, args=(s, s.split("-")[1].split(".")[0], "Northwind", *CRED))
                   for s in sites_]
        for each in threads:
            each.start()
        for each in threads:
            each.join(5)
        entries = [sites.read_entry(s) for s in sites_]
        self.assertEqual([e["state"] for e in entries], ["ready", "ready"])
        self.assertEqual(sorted(e["made_from"]["how"] for e in entries), ["copy", "pool"])
        self.assertEqual(self.bench.copied, ["_00000000000000aa"], "one copied from the blank, one from the pool")
        names = {db.site_config(f"{sites.BENCH}/sites/{s}")["db_name"] for s in sites_}
        self.assertEqual(len(names), 2, "each its own database")
        self.assertEqual(set(self.refills), {name})

    def test_the_blank_is_made_once_the_bench_is_idle_and_a_company_waits_for_it(self):
        sites.BENCH_LOCK.acquire()  # another world's site being made from nothing
        with mock.patch.object(blank, "IDLE_POLL_S", 0.05):
            blank.keep_warm()
            time.sleep(0.2)
            self.assertEqual(self.bench.commands, [], "the blank waits for the bench's long command")
            company = threading.Thread(target=lambda: self.make("w1"))
            company.start()
            time.sleep(0.2)
            self.assertEqual(sites.read_entry("northwind-w1.pool.test")["state"], "creating")
            sites.BENCH_LOCK.release()
            company.join(5)
        name = "blank-0a1b2c3d4e5f6a7b"
        self.assertEqual([c[0] if c[0] == "new-site" else c[-1] for c in self.bench.commands],
                         ["new-site", "erpnext", "hrms", "capxul", "migrate"], "the blank made; the company copied")
        self.assertEqual(self.bench.commands[0][1], f"{name}.invalid", "made under a name no request can reach")
        self.assertEqual(templates.names(), [name])
        self.assertEqual(templates.template_sites(name)[0]["db"], "_00000000000000bb")
        self.assertFalse(os.path.exists(f"{sites.BENCH}/sites/{name}.invalid"), "moved off the top of sites/")
        entry = sites.read_entry("northwind-w1.pool.test")
        self.assertEqual((entry["state"], entry["made_from"]["how"]), ("ready", "copy"))
        self.assertIn(name, self.refills, "its pool filled once made")

    def test_a_blank_refills_to_its_own_pool_size(self):
        name = kept_blank("0a1b2c3d4e5f6a7b", copies=1)
        self.refill.stop()
        try:
            with mock.patch.object(pool, "BLANK_POOL_SIZE", 3), mock.patch.object(pool, "copy_site", self.copy_into):
                pool._refill(name)
        finally:
            self.refill.start()
        self.assertEqual(len(pool.ready_copies(name, "blank")), 3)
        self.assertEqual(pool.size_of("founded-0a1b2c3d4e-5f6a7b"), pool.POOL_SIZE)

    def copy_into(self, _src_db, _src_folder, dst_folder, conn=None):
        config(dst_folder)

    def test_a_failed_blank_is_built_from_nothing_and_not_tried_again_at_once(self):
        def failing(*args, env=None):
            raise Refused(500, "bench-failed", "bench ('new-site',): no space left")

        with mock.patch.object(blank, "bench", failing):
            entry = self.make("w1")
        self.assertIsNone(entry.get("made_from"))
        self.assertEqual(entry["state"], "ready")
        self.assertIn("no space left", blank.state()["error"])
        blank.keep_warm()
        self.assertFalse(blank._state["making"], "not tried again within DOOR_BLANK_RETRY_S")

    def test_worlds_may_not_make_claim_or_sweep_a_blank(self):
        kept_blank("0a1b2c3d4e5f6a7b")
        c = {"world": "w1", "quota": 1, "expires": int(time.time()) + 600}
        for call in (lambda: templates.make_template(c, {"template": "blank-0a1b2c3d4e5f6a7b", "site": "x"}),
                     lambda: __import__("claim").claim_world(c, {"template": "blank-0a1b2c3d4e5f6a7b",
                                                                 "api_key": CRED[0], "api_secret": CRED[1]})):
            with self.assertRaises(Refused) as r:
                call()
            self.assertEqual(r.exception.code, "template-reserved")
        swept = templates.sweep(c, {"idle_s": templates.MIN_IDLE_S})
        self.assertEqual(swept["removed"], [])
        self.assertEqual(templates.names(), ["blank-0a1b2c3d4e5f6a7b"])

    def test_a_copy_keeps_the_blanks_key_when_something_is_encrypted_with_it(self):
        folder = f"{sites.BENCH}/sites/x.pool.test"
        config(folder)
        with mock.patch.object(db, "run", lambda *_a, **_k: ((2,),)):
            self.assertFalse(blank.own_key(folder))
        self.assertEqual(db.site_config(folder)["encryption_key"], "blank-key")
        self.assertTrue(blank.own_key(folder))
        self.assertEqual(len(json.dumps(db.site_config(folder)["encryption_key"])), 46, "a Fernet key")


if __name__ == "__main__":
    unittest.main()

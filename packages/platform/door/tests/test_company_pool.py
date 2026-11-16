"""The builder's own checks of ready company copies (company.py, pool.py's quiet refills), without a bench. The
behaviour spec is test_company.py; these cover what it may not: naming, the make of a template, tidy and the quiet
wait. MariaDB and the bench's Python are stand-ins that record what was asked."""

import os
import shutil
import threading
import time
import unittest
from unittest import mock

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import blank
import company
import db
import pool
import sites
import templates
from sites import Refused

CRED = ("a" * 16, "b" * 32)
APP = "0a1b2c3d4e5f6a7b"


def config(folder, **conf):
    os.makedirs(folder, exist_ok=True)
    db.write_site_config(folder, {"db_name": "_00000000000000aa", "encryption_key": "k", **conf})


def kept(template, label, copies=0, used=None):
    home = f"{templates.TEMPLATES}/{template}/{label}"
    config(f"{home}/site")
    templates.write_meta(home, {"template": template, "label": label, "company": "Northwind Trading",
                                "db": f"_{template[:6]}", "made_at": int(time.time())})
    templates.mark_used(template, used)
    for n in range(copies):
        config(f"{pool.POOL}/{template}/{label}/0000000{n}", db_name=f"_copy{n}")
    return template


def asked(world, label="northwind"):
    site = f"{label}-{world}.pool.test"
    sites.write_entry({"site": site, "world": world, "company": "Northwind Trading", "state": "creating", "steps": []})
    return site


class CompanyPoolTest(unittest.TestCase):
    def setUp(self):
        templates._app_version[:] = [APP]
        self.scripts, self.copied, self.warmed, self.refills = [], [], [], []
        company._state.clear()
        self.patches = [
            mock.patch.object(pool, "copy_site", self.copy_site),
            mock.patch.object(blank, "run_script", self.run_script),
            mock.patch.object(db, "run", lambda *_a, **_k: ((0,),)),
            mock.patch.object(db, "drop", lambda *_a: None), mock.patch.object(db, "drop_user", lambda *_a: None),
            mock.patch.object(pool, "refill_soon", self.refills.append),
            mock.patch.object(pool, "_busy", {"at": None})]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        templates._app_version.clear()
        shutil.rmtree(sites.REGISTRY, ignore_errors=True)
        shutil.rmtree(f"{sites.BENCH}/sites", ignore_errors=True)
        os.makedirs(f"{sites.BENCH}/sites", exist_ok=True)

    def copy_site(self, src_db, _src_folder, dst_folder, conn=None):
        self.copied.append(src_db)
        config(dst_folder, db_name=f"_new{len(self.copied)}")

    def run_script(self, site, parts, **kw):
        self.scripts.append((site, ["wizard" if p is blank.WIZARD_SCRIPT else "join" for p in parts], kw))
        return [{"step": "frappe started", "ms": 1}]

    def test_a_site_template_is_named_by_the_apps_and_the_wizards_inputs(self):
        name = company.name("Northwind Trading")
        self.assertRegex(name, rf"^co-{APP}-[0-9a-f]{{8}}$")
        self.assertEqual(templates.name_of(name), name, "a template's name")
        self.assertNotEqual(company.name("Contoso"), name)
        with mock.patch.object(company.time, "gmtime", lambda: time.struct_time((2099, 1, 1, 0, 0, 0, 0, 1, 0))):
            self.assertNotEqual(company.name("Northwind Trading"), name, "a new fiscal year: a new template")
        with self.assertRaises(Refused) as r:
            templates.worlds_name(name)
        self.assertEqual(r.exception.code, "template-reserved")

    def test_a_site_from_the_company_pool_is_taken_and_joined(self):
        name = kept(company.name("Northwind Trading"), company.LABEL, copies=1)
        site = asked("w1")
        sites.build(site, "w1", "Northwind Trading", *CRED)
        entry = sites.read_entry(site)
        self.assertEqual(entry["state"], "ready")
        self.assertEqual(entry["made_from"], {"template": name, "how": "company pool", "fell_back": None})
        self.assertEqual([(s["step"], s.get("span")) for s in entry["steps"]],
                         [("site.make.take", None), ("frappe started", "site.make.join")], "the join's own steps")
        self.assertEqual(self.scripts[0][1], ["join"], "no wizard on the run's path")
        self.assertEqual(self.scripts[0][2]["world"], "w1")
        self.assertEqual(self.copied, [])
        self.assertIn(name, self.refills)

    def test_with_the_company_pool_empty_it_is_copied_from_its_site_template(self):
        name = kept(company.name("Northwind Trading"), company.LABEL)
        site = asked("w1")
        sites.build(site, "w1", "Northwind Trading", *CRED)
        entry = sites.read_entry(site)
        self.assertEqual(entry["made_from"], {"template": name, "how": "company copy", "fell_back": "company pool empty"})
        self.assertEqual([(s["step"], s.get("reason")) for s in entry["steps"]],
                         [("site.make.fell_back", "company pool empty"), ("site.make.take", None), ("frappe started", None)])
        self.assertEqual(self.copied, [f"_{name[:6]}"])

    def test_with_none_for_the_company_it_falls_back_to_the_blank_and_asks_for_one(self):
        kept(blank.name(), blank.LABEL, copies=1)
        site = asked("w1")
        with mock.patch.object(company, "make_site_template_soon", self.warmed.append):
            sites.build(site, "w1", "Northwind Trading", *CRED)
        entry = sites.read_entry(site)
        self.assertEqual(entry["state"], "ready")
        self.assertEqual(entry["made_from"], {"template": blank.name(), "how": "blank pool",
                                             "fell_back": "no company template"})
        self.assertEqual(entry["steps"][0], {"step": "site.make.fell_back", "reason": "no company template", "ms": 0})
        self.assertEqual(self.warmed, [company.inputs("Northwind Trading")])
        self.assertEqual(self.scripts[0][1], ["wizard", "join"], "the blank path runs both parts in one process")

    def test_a_site_template_is_made_from_the_blank_once_the_bench_is_quiet(self):
        kept(blank.name(), blank.LABEL)
        name = company.name("Northwind Trading")
        pool.touch()
        with mock.patch.object(pool, "REFILL_QUIET_S", 0.3), mock.patch.object(pool, "QUIET_POLL_S", 0.05), \
                mock.patch.object(blank, "drop_database", lambda _s: None):
            company.make_site_template_soon(company.inputs("Northwind Trading"))
            time.sleep(0.1)
            self.assertEqual(self.scripts, [], "waits for the bench to be quiet")
            for _ in range(100):
                if company.usable(name):
                    break
                time.sleep(0.05)
        self.assertTrue(company.usable(name))
        self.assertEqual([s[1] for s in self.scripts], [["wizard"]])
        self.assertEqual(self.scripts[0][0], f"{name}.invalid", "made under a name no request can reach")
        meta = templates.template_sites(name)[0]
        self.assertEqual((meta["label"], meta["company"], meta["made_from"]), ("company", "Northwind Trading",
                                                                               blank.name()))
        self.assertFalse(os.path.exists(f"{sites.BENCH}/sites/{name}.invalid"))
        self.assertIn(name, self.refills)

    def test_names_asked_are_kept_warm_and_old_site_templates_go_at_the_start(self):
        company.note_asked("Northwind Trading")
        company._write_asked({**company.asked(), "Old Co": int(time.time()) - company.KEEP_S - 1})
        other = kept("co-ffffffffffffffff-00000000", company.LABEL, copies=1)
        stale = kept(f"co-{APP}-11111111", company.LABEL, used=int(time.time()) - company.KEEP_S - 1)
        fresh = kept(f"co-{APP}-22222222", company.LABEL)
        os.makedirs(f"{sites.BENCH}/sites/co-{APP}-33333333.invalid")
        with mock.patch.object(company, "make_site_template_soon", self.warmed.append):
            company.tidy()
        self.assertEqual(templates.names(), [fresh])
        self.assertFalse(os.path.exists(f"{pool.POOL}/{other}"))
        self.assertFalse(os.path.exists(f"{sites.BENCH}/sites/co-{APP}-33333333.invalid"))
        self.assertEqual(self.warmed, [company.inputs("Northwind Trading")])
        self.assertEqual(list(company.asked()), ["Northwind Trading"])
        self.assertNotIn(stale, templates.names())

    def test_the_company_pool_is_listed(self):
        name = kept(company.name("Northwind Trading"), company.LABEL, copies=2)
        listed = pool.list_templates()
        self.assertEqual(listed["company_pool_size"], pool.company_pool_size())
        self.assertEqual(next(t for t in listed["templates"] if t["template"] == name)["pool_ready"], 2)
        self.assertEqual(pool.size_of(name), pool.company_pool_size())


class QuietRefillTest(unittest.TestCase):
    def tearDown(self):
        shutil.rmtree(sites.REGISTRY, ignore_errors=True)

    def test_company_and_blank_refills_wait_for_a_quiet_bench_and_others_do_not(self):
        made = []
        name = kept(f"co-{APP}-44444444", company.LABEL)
        with mock.patch.object(pool, "REFILL_QUIET_S", 0.3), mock.patch.object(pool, "QUIET_POLL_S", 0.05), \
                mock.patch.object(pool, "COMPANY_POOL_SIZE", 1), \
                mock.patch.object(pool, "copy_site", lambda *a, **k: (made.append(time.monotonic()), config(a[2]))), \
                mock.patch.object(pool, "_busy", {"at": None}):
            pool.touch()
            t0 = time.monotonic()
            worker = threading.Thread(target=pool._refill, args=(name,))
            worker.start()
            worker.join(5)
        self.assertEqual(len(made), 1)
        self.assertGreaterEqual(made[0] - t0, 0.25, "made once the bench had been quiet for QUIET_S")
        self.assertTrue(pool.waits_for_quiet("blank-x") and pool.waits_for_quiet(name))
        self.assertFalse(pool.waits_for_quiet("founded"))

    def test_company_pool_size_default_and_bounds(self):
        import importlib

        for value, size in ((None, None), ("10", 10), ("50", pool.BLANK_POOL_MAX), ("2", 2)):
            env = {k: v for k, v in os.environ.items() if k != "DOOR_COMPANY_POOL_SIZE"}
            if value is not None:
                env["DOOR_COMPANY_POOL_SIZE"] = value
            with mock.patch.dict(os.environ, env, clear=True):
                self.assertEqual(importlib.reload(pool).COMPANY_POOL_SIZE, size)
        importlib.reload(pool)


if __name__ == "__main__":
    unittest.main()

"""Ready company copies (company.py; roadmap 4.8, option 2), without a bench: the door keeps a pool of copies of a
company template, a company's site with Frappe's setup wizard already run, so a founded company's site is a rename and a
join, not a wizard. The behaviour spec, written before the build: skipped until company.py exists, then every case runs.

The seams this spec names, for the door's builder:
- `company.PREFIX`: "co-", the door's own company templates; no world makes, claims or sweeps one.
- `company.inputs(name, fiscal_year=None)`: what a company template is made of: {company, currency, country,
  fiscal_year}, the year the current one when none is given.
- `company.key(app, inputs)`: `co-<app fingerprint, 16 hex>-<inputs, 8 hex>`.
- `company.join(site, world, key, secret)`: one bench process that joins a ready copy to the world (the world's clock,
  Core's API user, the scheduler) and answers its steps; the stand-in below records it.
- `company.make_site_template_soon(inputs)`: schedules the company template's making in the background.
- `company.tidy()`: at the door's start, removes company templates of another app fingerprint.
- `pool.REFILL_QUIET_S`, read from the environment at start, and `pool.touch()`: each `POST /sites` touches, and a
  refill copies only once no site was asked for for REFILL_QUIET_S.
- `sites.build` tries, in order: the company pool, a copy of the company template, the blank, nothing. Its registry
  entry's `made_from` is {template, how, fell_back}: `how` one of the blueprint's SiteOrigin, `fell_back` one of its
  MakeFallback (null when taken from the company pool).
"""

import importlib.util
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

BUILT = importlib.util.find_spec("company") is not None
UNTIL_BUILT = "until the door's builder lands company.py (4.8, option 2)"
if BUILT:
    import company

APP = "0a1b2c3d4e5f6a7b"
CRED = ("a" * 16, "b" * 32)
JOIN_STEPS = [{"step": "join world", "ms": 1}, {"step": "core user", "ms": 1}, {"step": "enable scheduler", "ms": 1}]


def asked(world):
    """A company site the door was asked for (`POST /sites`), as create_site leaves it in the registry."""
    site = f"northwind-{world}.pool.test"
    sites.write_entry({"site": site, "world": world, "company": "Northwind", "state": "creating", "steps": []})
    return site


def config(folder, **conf):
    os.makedirs(folder, exist_ok=True)
    db.write_site_config(folder, {"db_name": "_00000000000000cc", "encryption_key": "company-key", **conf})


def kept_site_template(name, label, copies=0):
    """A whole template `name` with one site labelled `label`, and `copies` ready copies in its pool."""
    home = f"{templates.TEMPLATES}/{name}/{label}"
    config(f"{home}/site")
    templates.write_meta(home, {"template": name, "label": label, "db": "_00000000000000cc", "made_at": 1})
    for n in range(copies):
        config(f"{pool.POOL}/{name}/{label}/0000000{n}", db_name=f"_copy{n}")
    return name


class Bench:
    """Stand-ins: MariaDB's copies and drops, the bench's commands, the wizard and the join, each recorded."""

    def __init__(self):
        self.copied, self.dropped, self.commands, self.configured, self.joined, self.scheduled = [], [], [], [], [], []

    def copy_site(self, src_db, src_folder, dst_folder, conn=None):
        self.copied.append(src_db)
        config(dst_folder, db_name=f"_new{len(self.copied)}")

    def bench(self, *args, env=None):
        self.commands.append(args)
        return "", 1

    def configure(self, site, world, company_name, key, secret):
        self.configured.append((site, world, company_name))
        return [{"step": "setup wizard", "ms": 1}, {"step": "core user", "ms": 1}]

    def join(self, site, world, key, secret):
        self.joined.append((site, world))
        return list(JOIN_STEPS)

    def patches(self):
        return [mock.patch.object(pool, "copy_site", self.copy_site), mock.patch.object(blank, "bench", self.bench),
                mock.patch.object(sites, "bench", self.bench), mock.patch.object(blank, "configure", self.configure),
                mock.patch.object(company, "join", self.join),
                mock.patch.object(company, "make_site_template_soon", self.scheduled.append),
                mock.patch.object(db, "drop", self.dropped.append), mock.patch.object(db, "drop_user", lambda *_: None),
                mock.patch.object(db, "run", lambda *_a, **_k: ((0,),)),
                mock.patch.object(sites, "make_core_user", lambda *_a: 1),
                mock.patch.object(blank, "drop_database", lambda _site: None)]


@unittest.skipUnless(BUILT, UNTIL_BUILT)
class CompanyTest(unittest.TestCase):
    def setUp(self):
        self.bench = Bench()
        self.patched = self.bench.patches()
        for patch in self.patched:
            patch.start()
        templates._app_version[:] = [APP]
        blank._state.update(making=False, failed_at=None, error=None)
        self.refills = []
        self.refill = mock.patch.object(pool, "refill_soon", self.refills.append)
        self.refill.start()
        self.inputs = company.inputs("Northwind")
        self.name = company.key(APP, self.inputs)

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

    def test_a_take_is_a_ready_company_copy_with_only_the_join_steps(self):
        kept_site_template(self.name, "company", copies=1)
        entry = self.make("w1")
        self.assertEqual(entry["state"], "ready")
        self.assertEqual(entry["made_from"], {"template": self.name, "how": "company pool", "fell_back": None})
        names = [s["step"] for s in entry["steps"]]
        self.assertEqual(names[1:], [s["step"] for s in JOIN_STEPS], "after the take, only the join")
        self.assertNotIn("setup wizard", names, "the wizard ran when the copy was made, not on the request")
        self.assertEqual(self.bench.configured, [], "no wizard")
        self.assertEqual(self.bench.joined, [("northwind-w1.pool.test", "w1")])
        self.assertEqual(self.bench.copied, [], "a rename: nothing copied on the request's path")
        self.assertEqual(pool.ready_copies(self.name, "company"), [], "the copy left the pool")
        self.assertIn(self.name, self.refills, "the pool is refilled after")

    def test_with_the_company_pool_empty_it_is_copied_from_the_company_site_template(self):
        kept_site_template(self.name, "company")
        entry = self.make("w1")
        self.assertEqual(entry["state"], "ready")
        self.assertEqual(entry["made_from"],
                         {"template": self.name, "how": "company copy", "fell_back": "company pool empty"})
        self.assertEqual(self.bench.copied, ["_00000000000000cc"])
        self.assertEqual(self.bench.configured, [], "the template's wizard already ran")
        self.assertEqual(self.bench.joined, [("northwind-w1.pool.test", "w1")])
        self.assertIn(self.name, self.refills)

    def test_with_no_company_site_template_it_takes_the_blank_path_and_schedules_one(self):
        blank_name = kept_site_template(blank.name(), blank.LABEL, copies=1)
        entry = self.make("w1")
        self.assertEqual(entry["state"], "ready")
        self.assertEqual(entry["made_from"]["template"], blank_name)
        self.assertIn(entry["made_from"]["how"], ("blank pool", "pool"), "the blank's own path, as before")
        self.assertEqual(entry["made_from"]["fell_back"], "no company template")
        self.assertEqual(self.bench.configured, [("northwind-w1.pool.test", "w1", "Northwind")], "the wizard ran")
        self.assertEqual(self.bench.scheduled, [self.inputs], "the company template is made for the next one")

    def test_a_company_site_template_of_another_app_fingerprint_goes_at_tidy(self):
        other = kept_site_template(company.key("ffffffffffffffff", self.inputs), "company", copies=2)
        mine = kept_site_template(self.name, "company", copies=1)
        company.tidy()
        self.assertEqual(templates.names(), [mine], "only this fingerprint's is kept")
        self.assertFalse(os.path.exists(f"{pool.POOL}/{other}"), "removed with its pool")
        self.assertIn("_00000000000000cc", self.bench.dropped)

    def test_the_key_names_the_app_and_the_inputs_and_another_year_is_another_key(self):
        self.assertRegex(self.name, rf"^co-{APP}-[0-9a-f]{{8}}$")
        self.assertEqual(set(self.inputs), {"company", "currency", "country", "fiscal_year"})
        this_year, next_year = company.inputs("Northwind", 2026), company.inputs("Northwind", 2027)
        self.assertEqual(company.key(APP, this_year), company.key(APP, dict(this_year)), "the same inputs, one key")
        self.assertNotEqual(company.key(APP, this_year), company.key(APP, next_year))
        self.assertNotEqual(company.key(APP, this_year), company.key(APP, company.inputs("Southwind", 2026)))
        self.assertNotEqual(company.key(APP, this_year), company.key("ffffffffffffffff", this_year))

    def test_a_refill_waits_for_quiet(self):
        name = kept_site_template(self.name, "company")
        self.refill.stop()
        try:
            with mock.patch.object(pool, "REFILL_QUIET_S", 0.4), mock.patch.object(pool, "POOL_SIZE", 1):
                pool.touch()  # a site was just asked for
                filling = threading.Thread(target=pool._refill, args=(name,))
                filling.start()
                time.sleep(0.15)
                self.assertEqual(self.bench.copied, [], "no copy while sites are being asked for")
                filling.join(5)
        finally:
            self.refill.start()
        self.assertEqual(self.bench.copied, ["_00000000000000cc"], "copied once the door was quiet")
        self.assertEqual(len(pool.ready_copies(name, "company")), 1)

    def test_worlds_may_not_name_a_company_site_template(self):
        for name in (self.name, "co-anything"):
            with self.assertRaises(Refused) as r:
                templates.worlds_name(name)
            self.assertEqual(r.exception.code, "template-reserved")
        self.assertTrue(self.name.startswith(company.PREFIX))


if __name__ == "__main__":
    unittest.main()

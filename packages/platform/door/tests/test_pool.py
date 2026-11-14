"""The site pool's own rules (pool.py, claim.py), without a bench: what a template may be named, which pool copies a
claim may take, and the refusals a claim answers before any work."""

import json
import os
import shutil
import time
import unittest

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import claim
import pool
import sites
from sites import Refused


def token(world="w1", quota=1):
    return {"world": world, "quota": quota, "expires": int(time.time()) + 600}


def template(name="founded", label="northwind"):
    home = f"{pool.TEMPLATES}/{name}/{label}"
    os.makedirs(f"{home}/site", exist_ok=True)
    with open(f"{home}/meta.json", "w") as f:
        json.dump({"template": name, "label": label, "company": "Northwind Ltd", "db": "_0123456789abcdef"}, f)


class PoolTest(unittest.TestCase):
    def tearDown(self):
        for folder in (sites.REGISTRY, f"{sites.BENCH}/sites/northwind-w1.pool.test"):
            shutil.rmtree(folder, ignore_errors=True)

    def test_a_template_is_named_like_a_starting_world(self):
        for good in ("founded", "office-holder", "payment-drafted"):
            self.assertEqual(pool._name(good), good)
        for bad in ("", "Founded", "-founded", "a/b", "x" * 41, None):
            with self.assertRaises(Refused) as r:
                pool._name(bad)
            self.assertEqual(r.exception.code, "template-invalid")

    def test_a_claim_takes_only_a_ready_copy(self):
        home = f"{pool.POOL}/founded/northwind"
        os.makedirs(f"{home}/0a1b2c3d.making")
        dest = f"{sites.BENCH}/sites/northwind-w1.pool.test"
        self.assertFalse(pool.take("founded", "northwind", dest), "a copy being made is not taken")
        os.makedirs(f"{home}/0a1b2c3e")
        self.assertTrue(pool.take("founded", "northwind", dest))
        self.assertTrue(os.path.isdir(dest))
        self.assertEqual(pool.ready_copies("founded", "northwind"), [])
        self.assertFalse(pool.take("founded", "northwind", dest + "x"), "an empty pool answers False: clone instead")

    def test_templates_are_listed_with_their_ready_copies(self):
        template()
        os.makedirs(f"{pool.POOL}/founded/northwind/0a1b2c3d")
        os.makedirs(f"{pool.POOL}/founded/northwind/0a1b2c3e.making")
        listed = pool.list_templates()
        self.assertEqual(listed["pool_size"], 2)
        self.assertEqual(listed["templates"][0]["sites"][0]["pool_ready"], 1)

    def test_a_clock_is_frozen_or_running(self):
        self.assertIsNone(claim._clock_of({}))
        self.assertEqual(claim._clock_of({"clock": {"frozen_at_ms": "5", "x": 1}}), {"frozen_at_ms": 5})
        with self.assertRaises(Refused):
            claim._clock_of({"clock": {"rate": 2}})

    def refused(self, c, body):
        with self.assertRaises(Refused) as r:
            claim.claim_world(c, {"template": "founded", "api_key": "a" * 16, "api_secret": "b" * 32, **body})
        return r.exception.code

    def test_a_claim_is_refused_before_any_work(self):
        self.assertEqual(self.refused(token(), {"api_key": "short"}), "credential-invalid")
        self.assertEqual(self.refused(token(), {}), "template-not-found")
        template()
        self.assertEqual(self.refused(token(quota=0), {}), "site-quota-reached")
        os.makedirs(f"{sites.BENCH}/sites/northwind-w1.pool.test")
        self.assertEqual(self.refused(token(), {}), "site-exists")
        self.assertEqual(sites.entries_of("w1"), [], "a refused claim leaves nothing in the registry")

    def test_a_template_needs_a_source_of_the_world(self):
        with self.assertRaises(Refused) as r:
            pool.make_template(token(), {"template": "founded"})
        self.assertEqual(r.exception.code, "template-source-missing")
        sites.write_entry({"site": "northwind-w2.pool.test", "world": "w2", "state": "ready"})
        with self.assertRaises(Refused) as r:
            pool.make_template(token(), {"template": "founded", "site": "northwind-w2.pool.test"})
        self.assertEqual(r.exception.code, "site-not-in-world")


if __name__ == "__main__":
    unittest.main()

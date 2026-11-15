"""On a restart, `mark_stale` marks what was left half-way: a site being made is `interrupted`,
which Core makes again once (packages/core, src/organizations/site.ts); a site it was removing is `failed`; any other
site is left as it was. World run 43759314286 (15 November 2026) lost a site to a redeploy of the bench."""

import os
import unittest

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import door
import sites


def entry(site, state):
    sites.write_entry({"site": site, "world": "w1", "company": "Northwind Ltd", "state": state, "steps": [],
                       "ms": None, "error": None})


class MarkStale(unittest.TestCase):
    def setUp(self):
        for site, state in (("a-w1.pool.test", "creating"), ("b-w1.pool.test", "removing"),
                            ("c-w1.pool.test", "ready"), ("d-w1.pool.test", "failed")):
            entry(site, state)

    def tearDown(self):
        for site in ("a", "b", "c", "d"):
            os.remove(sites.entry_path(f"{site}-w1.pool.test"))

    def test_a_site_being_made_is_interrupted_and_one_being_removed_failed(self):
        door.mark_stale()
        self.assertEqual(sites.read_entry("a-w1.pool.test")["state"], "interrupted")
        self.assertIn("restarted while it was being made", sites.read_entry("a-w1.pool.test")["error"])
        self.assertEqual(sites.read_entry("b-w1.pool.test")["state"], "failed")
        self.assertEqual(sites.read_entry("c-w1.pool.test")["state"], "ready")
        self.assertEqual(sites.read_entry("d-w1.pool.test")["state"], "failed")

    def test_an_interrupted_site_is_shown_as_such(self):
        door.mark_stale()
        self.assertEqual(sites.public(sites.read_entry("a-w1.pool.test"))["state"], "interrupted")


if __name__ == "__main__":
    unittest.main()

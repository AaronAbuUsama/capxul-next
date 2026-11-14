"""Removing sites in the background (sites.start_removal), without a bench: each site reads `removing` at once, is
removed one by one, then `after` runs; a removal that fails leaves its site `failed`, with why, and goes on."""

import threading
import unittest
from unittest.mock import patch

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import sites


class StartRemovalTest(unittest.TestCase):
    def remove(self, names, remove_site, after=None):
        states, gate = {}, threading.Event()

        def record(site, **fields):
            states.setdefault(site, []).append(fields.get("state"))
            if fields.get("error"):
                states[site].append(fields["error"])

        def slow(site):
            gate.wait(5)
            return remove_site(site)

        with patch.object(sites, "update_entry", side_effect=record), patch.object(sites, "remove_site", slow):
            answered = sites.start_removal(names, after=after)
            at_once = {site: list(seen) for site, seen in states.items()}
            gate.set()
            for thread in threading.enumerate():
                if thread is not threading.current_thread() and thread.daemon:
                    thread.join(5)
        return answered, at_once, states

    def test_it_answers_removing_at_once_and_removes_each_then_runs_after(self):
        removed, after = [], threading.Event()
        answered, at_once, _ = self.remove(["a.pool.test", "b.pool.test"], removed.append, after=after.set)
        self.assertEqual(answered, [{"site": "a.pool.test", "state": "removing"},
                                    {"site": "b.pool.test", "state": "removing"}])
        self.assertEqual(at_once, {"a.pool.test": ["removing"], "b.pool.test": ["removing"]})
        self.assertEqual(removed, ["a.pool.test", "b.pool.test"])
        self.assertTrue(after.is_set())

    def test_a_removal_that_fails_leaves_its_site_failed_and_the_next_goes_on(self):
        removed = []

        def remove(site):
            if site == "a.pool.test":
                raise sites.Refused(500, "bench-failed", "drop-site: no such database")
            removed.append(site)

        _, _, states = self.remove(["a.pool.test", "b.pool.test"], remove)
        self.assertEqual(states["a.pool.test"][1], "failed")
        self.assertIn("remove:", states["a.pool.test"][2])
        self.assertEqual(removed, ["b.pool.test"])

    def test_no_sites_still_runs_after(self):
        after = threading.Event()
        answered, _, _ = self.remove([], lambda site: None, after=after.set)
        self.assertEqual(answered, [])
        self.assertTrue(after.is_set())


if __name__ == "__main__":
    unittest.main()

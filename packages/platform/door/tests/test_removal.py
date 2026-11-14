"""A world's backup and a site's removal answer at once, whatever else the bench is doing (snapshots.py, sites.py):
answered on the request's path, a backup waited behind another world's site being made from nothing and outlasted
the 100 s a call may take through Cloudflare's edge (HTTP 524, PR #227's CI run 43599082569). The bench's commands
are stand-ins here; BENCH_LOCK is held by the test as a site being made would hold it."""

import json
import os
import shutil
import threading
import time
import unittest

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import snapshots
import sites
from sites import Refused

WORLD = "w1"
SITE = f"northwind-{WORLD}.pool.test"


def token(world=WORLD):
    return {"world": world, "quota": 1, "expires": int(time.time()) + 600}


def ready_site(state="ready", **more):
    sites.write_entry({"site": SITE, "world": WORLD, "company": "Northwind Ltd", "state": state, "steps": [],
                       "ms": None, "error": None, **more})
    os.makedirs(f"{sites.BENCH}/sites/{SITE}", exist_ok=True)
    with open(f"{sites.BENCH}/sites/{SITE}/site_config.json", "w") as f:
        json.dump({"db_name": "_0123456789abcdef", "encryption_key": "key-for-tests"}, f)


def fake_bench(*args, env=None):
    """`bench --site <site> backup --backup-path <folder>` writes one dump; any other command does nothing."""
    if "backup" in args:
        folder = args[args.index("--backup-path") + 1]
        with open(f"{folder}/20261114_000000-site-database.sql.gz", "wb") as f:
            f.write(b"dump")
        with open(f"{folder}/20261114_000000-site_config_backup.json", "w") as f:
            f.write("{}")
    return "", 7


def failing_bench(*args, env=None):
    raise Refused(500, "bench-failed", "bench ('--site', 'x', 'backup'): no space left")


def settled(snapshot, timeout=5.0):
    """The backup's state once it is no longer `saving`."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = snapshots.backup_state(token(), snapshot)
        if state["state"] != "saving":
            return state
        time.sleep(0.01)
    raise AssertionError(f"backup {snapshot} still saving after {timeout} s")


class Bench(unittest.TestCase):
    def setUp(self):
        self.real_bench = (snapshots.bench, sites.bench)
        snapshots.bench = sites.bench = fake_bench

    def tearDown(self):
        snapshots.bench, sites.bench = self.real_bench
        if sites.BENCH_LOCK.locked():
            sites.BENCH_LOCK.release()
        snapshots.remove_backups(WORLD)
        for folder in (sites.REGISTRY, f"{sites.BENCH}/sites/{SITE}"):
            shutil.rmtree(folder, ignore_errors=True)


class RemovalTest(Bench):
    def removed_within(self, seconds):
        done = []
        worker = threading.Thread(target=lambda: done.append(sites.remove_site(SITE)), daemon=True)
        worker.start()
        worker.join(seconds)
        return done

    def test_a_ready_site_is_removed_while_the_bench_is_busy(self):
        ready_site()
        sites.BENCH_LOCK.acquire()  # another world's site being made from nothing
        self.assertEqual(len(self.removed_within(2.0)), 1, "the removal does not wait for the bench's long commands")
        self.assertIsNone(sites.read_entry(SITE))
        self.assertFalse(os.path.exists(f"{sites.BENCH}/sites/{SITE}"))

    def test_a_site_being_made_is_removed_once_its_build_lets_go(self):
        ready_site(state="creating")
        sites.BENCH_LOCK.acquire()  # its own build
        self.assertEqual(self.removed_within(0.3), [], "a site being made is removed only after its build stops")
        self.assertEqual(sites.read_entry(SITE)["state"], "removing", "its build sees `removing` and stops")
        sites.BENCH_LOCK.release()
        deadline = time.monotonic() + 5
        while sites.read_entry(SITE) is not None and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertIsNone(sites.read_entry(SITE))

    def test_a_claimed_site_is_removed_without_the_bench_lock(self):
        ready_site(state="creating", claimed_from={"template": "founded", "label": "northwind"})
        sites.BENCH_LOCK.acquire()
        self.assertEqual(len(self.removed_within(2.0)), 1)


if __name__ == "__main__":
    unittest.main()

"""A world's backup in the background (snapshots.start_backup, backup_state), without a bench: it answers at once,
then reads saving, saved with its sites, or failed with why; a door that restarts mid-way leaves it failed."""

import json
import os
import threading
import unittest
from unittest.mock import patch

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import snapshots
from sites import Refused

WORLD = "w-test"
CLAIMS = {"world": WORLD, "quota": 3}
READY = [{"site": f"acme-{WORLD}.pool.test", "state": "ready", "company": "acme"}]


class BackgroundBackupTest(unittest.TestCase):
    def start(self, backup, entries=READY, snapshot="s1"):
        gate = threading.Event()

        def slow(*args):
            gate.wait(5)
            return backup(*args)

        with patch.object(snapshots, "entries_of", return_value=entries), patch.object(snapshots, "_backup", slow):
            started = snapshots.start_backup(CLAIMS, {"snapshot": snapshot})
            during = snapshots.backup_state(CLAIMS, snapshot)
            gate.set()
            for thread in threading.enumerate():
                if thread is not threading.current_thread() and thread.daemon:
                    thread.join(5)
        return started, during, snapshots.backup_state(CLAIMS, snapshot)

    def test_it_answers_saving_at_once_then_saved_with_its_sites(self):
        sites = [{"site": READY[0]["site"], "label": "acme", "ms": 120000, "bytes": 1}]
        started, during, after = self.start(lambda world, snapshot, held: sites)
        self.assertEqual(started, {"world": WORLD, "snapshot": "s1", "state": "saving"})
        self.assertEqual(during["state"], "saving")
        self.assertEqual(after["state"], "saved")
        self.assertEqual(after["sites"], sites)

    def test_a_backup_that_fails_reads_failed_with_why(self):
        def refuse(world, snapshot, held):
            raise Refused(500, "backup-failed", "acme: 0 database dumps")

        _, _, after = self.start(refuse, snapshot="s2")
        self.assertEqual(after["state"], "failed")
        self.assertIn("backup-failed", after["error"])

    def test_a_world_with_a_site_not_ready_is_refused_before_anything_starts(self):
        with patch.object(snapshots, "entries_of", return_value=[{**READY[0], "state": "creating"}]):
            with self.assertRaises(Refused) as refused:
                snapshots.start_backup(CLAIMS, {"snapshot": "s3"})
        self.assertEqual(refused.exception.code, "site-not-ready")
        with self.assertRaises(Refused):
            snapshots.backup_state(CLAIMS, "s3")

    def test_a_backup_the_door_was_saving_when_it_stopped_reads_failed(self):
        snapshots._write_job(WORLD, "s4", {"state": "saving", "started_at": 1})
        snapshots.tidy_backups()
        state = snapshots.backup_state(CLAIMS, "s4")
        self.assertEqual(state["state"], "failed")
        self.assertIn("restarted", state["error"])

    def test_a_dropped_backup_is_gone_and_dropping_it_again_answers_the_same(self):
        snapshots._write_job(WORLD, "s5", {"state": "saved", "sites": []})
        os.makedirs(f"{snapshots._snapshot_dir(WORLD, 's5')}/acme", exist_ok=True)
        self.assertTrue(snapshots.drop_backup(CLAIMS, "s5")["removed"])
        self.assertFalse(os.path.exists(snapshots._snapshot_dir(WORLD, "s5")))
        with self.assertRaises(Refused):
            snapshots.backup_state(CLAIMS, "s5")
        self.assertEqual(snapshots.drop_backup(CLAIMS, "s5"), {"world": WORLD, "snapshot": "s5", "removed": False})
        with self.assertRaises(Refused):
            snapshots.drop_backup(CLAIMS, "../x")

    def test_an_invalid_snapshot_name_is_refused(self):
        with patch.object(snapshots, "entries_of", return_value=READY):
            with self.assertRaises(Refused):
                snapshots.start_backup(CLAIMS, {"snapshot": "../x"})


if __name__ == "__main__":
    unittest.main()

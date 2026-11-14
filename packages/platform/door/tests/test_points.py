"""Saving and resetting in place (points.py, db.put_back), without a bench: which tables a reset touches and how,
the world's clock entry put back beside the other worlds', a site's files compared, and the refusals."""

import json
import os
import shutil
import time
import unittest
from unittest.mock import patch

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import db
import points
import sites
from sites import Refused


class PutBackTest(unittest.TestCase):
    """db.put_back with MariaDB replaced by what it would answer: only what differs is touched."""

    def put_back(self, live_tables, live_sums, saved_tables, saved_sums):
        ran = []
        with patch.object(db, "tables", return_value=live_tables), \
                patch.object(db, "checksums", return_value=live_sums), \
                patch.object(db, "run", side_effect=lambda statements, conn=None: ran.extend(statements)), \
                patch.object(db, "connect", return_value=type("C", (), {"close": lambda self: None})()):
            did = db.put_back("_live", "_saved", saved_tables, saved_sums)
        return did, ran

    def test_nothing_changed_touches_nothing(self):
        t = {"tabA": "BASE TABLE", "s_seq": "SEQUENCE"}
        did, ran = self.put_back(t, {"tabA": "1", "s_seq": "[1]"}, t, {"tabA": "1", "s_seq": "[1]"})
        self.assertEqual(did, {"tables_changed": [], "tables_dropped": [], "tables_made": []})
        self.assertEqual(ran, [])

    def test_a_changed_table_is_emptied_and_filled_in_one_transaction(self):
        t = {"tabA": "BASE TABLE", "tabB": "BASE TABLE"}
        did, ran = self.put_back(t, {"tabA": "1", "tabB": "9"}, t, {"tabA": "1", "tabB": "2"})
        self.assertEqual(did["tables_changed"], ["tabB"])
        self.assertEqual(ran, ["set foreign_key_checks = 0", "start transaction", "delete from `_live`.`tabB`",
                               "insert into `_live`.`tabB` select * from `_saved`.`tabB`", "commit",
                               "set foreign_key_checks = 1"])

    def test_a_sequence_is_set_back_not_emptied(self):
        t = {"s_seq": "SEQUENCE"}
        did, ran = self.put_back(t, {"s_seq": "[7]"}, t, {"s_seq": "[3]"})
        self.assertEqual(did["tables_changed"], ["s_seq"])
        self.assertEqual(ran, ["insert into `_live`.`s_seq` select * from `_saved`.`s_seq`"])

    def test_a_table_made_since_goes_and_one_dropped_since_comes_back(self):
        live = {"tabA": "BASE TABLE", "tabNew": "BASE TABLE"}
        saved = {"tabA": "BASE TABLE", "tabOld": "BASE TABLE"}
        did, ran = self.put_back(live, {"tabA": "1", "tabNew": "5"}, saved, {"tabA": "1", "tabOld": "4"})
        self.assertEqual((did["tables_dropped"], did["tables_made"]), (["tabNew"], ["tabOld"]))
        self.assertIn("drop table `_live`.`tabNew`", ran)
        self.assertIn("create table `_live`.`tabOld` like `_saved`.`tabOld`", ran)
        self.assertIn("insert into `_live`.`tabOld` select * from `_saved`.`tabOld`", ran)


class CopyTest(unittest.TestCase):
    """db.copy starts again when a site that is serving writes a row the copy meets, and gives up after three tries."""

    def copy(self, failures):
        ran, left = [], list(failures)

        def run(statements, conn=None):
            ran.append(statements[0])
            if statements[0] == "set session innodb_snapshot_isolation = 0" and left:
                raise db.pymysql.err.OperationalError(left.pop(0), "conflict")

        with patch.object(db, "tables", return_value={"tabA": "BASE TABLE"}), patch.object(db, "run", side_effect=run):
            db.copy("_src", "_dst", conn=object())
        return ran

    def test_a_conflict_starts_the_copy_again(self):
        ran = self.copy([1020, 1213])
        self.assertEqual(ran.count("rollback"), 2)
        self.assertEqual(ran.count("create database `_dst`"), 3)

    def test_other_failures_and_a_third_conflict_are_not_hidden(self):
        with self.assertRaises(db.pymysql.err.OperationalError):
            self.copy([1146])
        with self.assertRaises(db.pymysql.err.OperationalError):
            self.copy([1020, 1020, 1020])


class PointsTest(unittest.TestCase):
    def setUp(self):
        self.clocks = points.CLOCKS

    def tearDown(self):
        shutil.rmtree(sites.REGISTRY, ignore_errors=True)
        for path in (self.clocks, self.clocks + ".lock"):
            if os.path.exists(path):
                os.remove(path)

    def test_a_point_is_named_like_a_snapshot(self):
        for bad in ("", "P1", "a/b", "-x", None):
            with self.assertRaises(Refused) as r:
                points._paths("w1", bad)
            self.assertEqual(r.exception.code, "point-invalid")

    def test_the_clock_entry_is_put_back_beside_the_other_worlds(self):
        with open(self.clocks, "w") as f:
            json.dump({"w1": {"frozen_at_ms": 9}, "w2": 5}, f)
        points._put_clock("w1", {"frozen_at_ms": 1, "offset_ms": 0, "rate": 1.0, "host_anchor_ms": 0})
        with open(self.clocks) as f:
            self.assertEqual(json.load(f), {"w1": {"frozen_at_ms": 1, "offset_ms": 0, "rate": 1.0, "host_anchor_ms": 0},
                                            "w2": 5})
        points._put_clock("w1", None)  # a world that had no clock when saved has none again
        with open(self.clocks) as f:
            self.assertEqual(json.load(f), {"w2": 5})

    def test_files_are_compared_by_name_size_and_time(self):
        a, b = f"{sites.BENCH}/files-a", f"{sites.BENCH}/files-b"
        for folder in (a, b):
            shutil.rmtree(folder, ignore_errors=True)
            os.makedirs(folder)
        with open(f"{a}/x.txt", "w") as f:
            f.write("one")
        shutil.copytree(a, f"{b}/../files-c", dirs_exist_ok=True)
        self.assertEqual(points._listing(a), points._listing(f"{b}/../files-c"))
        self.assertNotEqual(points._listing(a), points._listing(b))
        self.assertEqual(points._listing(f"{sites.BENCH}/none"), {})

    def test_a_world_with_a_site_not_ready_is_not_saved(self):
        sites.write_entry({"site": "northwind-w1.pool.test", "world": "w1", "state": "creating"})
        with self.assertRaises(Refused) as r:
            points.save_world({"world": "w1", "quota": 1, "expires": int(time.time()) + 60}, {"point": "p1"})
        self.assertEqual(r.exception.code, "site-not-ready")

    def test_a_reset_needs_the_point_and_its_sites(self):
        c = {"world": "w1", "quota": 1, "expires": int(time.time()) + 60}
        with self.assertRaises(Refused) as r:
            points.reset_world(c, {"point": "p1"})
        self.assertEqual(r.exception.code, "point-not-found")
        path, _ = points._paths("w1", "p1")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"point": "p1", "saved_at": 1, "clock": None, "sites": {"northwind-w1.pool.test": {"label": "northwind"}}}, f)
        with self.assertRaises(Refused) as r:
            points.reset_world(c, {"point": "p1"})
        self.assertEqual(r.exception.code, "point-site-missing")
        self.assertEqual(points.list_points(c)["points"][0]["sites"], ["northwind-w1.pool.test"])


if __name__ == "__main__":
    unittest.main()

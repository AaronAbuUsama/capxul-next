"""The dashboard's state comes only from committed proof: tests against a throwaway git repository."""
import json, os, subprocess, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from feed import Repo, critical_path, proven, ratchets, record_passed, steps  # noqa: E402

ROADMAP = """# Roadmap

## Steps to the goal

| Step | Milestone | What | Needs | State | Count | Waits on | Evidence | Proof |
|---|---|---|---|---|---|---|---|---|
| 0.1 | 0 | proven by a folder of records | | Done | | | | `records/good` |
| 0.2 | 0 | marked Done with no proof | | Done | | | | |
| 0.3 | 0 | a record that failed | | Done | | | | `records/bad` |
| 0.4 | 0 | a rule CI runs | | Done | | | | check:pnpm lint |
| 1.1 | 1 | twelve things | 0.2 | In progress | 3/12 | | | |
| 1.2 | 1 | after them | 1.1 | Not started | | | | |
"""


def run(cwd, *args, when=None):
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
    if when:
        env.update(GIT_AUTHOR_DATE=when, GIT_COMMITTER_DATE=when)
    subprocess.run(["git", "-C", cwd, *args], check=True, capture_output=True, env=env)


def write(root, path, text):
    os.makedirs(os.path.dirname(os.path.join(root, path)), exist_ok=True)
    with open(os.path.join(root, path), "w") as f:
        f.write(text)


class Feed(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        root = cls.root = cls.dir.name
        run(root, "init", "-q", "-b", "master")
        write(root, "docs/roadmap.md", ROADMAP)
        write(root, ".github/workflows/check.yml", "run: pnpm format:check\n")
        run(root, "add", "-A")
        run(root, "commit", "-qm", "start", when="2026-11-13T06:00:00Z")
        # The good records are written on a branch at 07:00 and merged into master at 08:00.
        run(root, "checkout", "-qb", "work")
        write(root, "records/good/run-1.json", json.dumps({"outcome": "passed"}))
        write(root, "records/good/run-2.json", json.dumps({"outcome": "passed"}))
        write(root, "records/good/notes.txt", "transcript")
        write(root, "records/bad/run-1.json", json.dumps({"outcome": "failed"}))
        run(root, "add", "-A")
        run(root, "commit", "-qm", "records", when="2026-11-13T07:00:00Z")
        run(root, "checkout", "-q", "master")
        run(root, "merge", "-q", "--no-ff", "-m", "Merge work", "work", when="2026-11-13T08:00:00Z")
        write(root, ".github/workflows/check.yml", "run: pnpm format:check\nrun: pnpm lint\n")
        run(root, "commit", "-qam", "lint in CI", when="2026-11-13T09:00:00Z")
        cls.repo = Repo(root, "master")
        cls.steps = {s["id"]: s for s in steps(cls.repo, ROADMAP)}

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def test_a_record_passes_only_when_it_says_so(self):
        self.assertTrue(record_passed('{"outcome": "passed"}'))
        self.assertFalse(record_passed('{"outcome": "failed"}'))
        self.assertFalse(record_passed("{}"))
        self.assertFalse(record_passed("[]"))
        self.assertFalse(record_passed("not json"))

    def test_done_comes_from_a_committed_proof_and_its_time_from_the_merge(self):
        self.assertEqual(self.steps["0.1"]["state"], "Done")
        self.assertEqual(self.steps["0.1"]["at"], "2026-11-13T08:00Z")

    def test_marked_done_without_proof_is_claimed(self):
        self.assertEqual(self.steps["0.2"]["state"], "Claimed")
        self.assertEqual(self.steps["0.2"]["at"], "")

    def test_a_failed_record_keeps_the_step_from_done(self):
        self.assertEqual(self.steps["0.3"]["state"], "Claimed")

    def test_a_ci_rule_is_done_when_the_gate_runs_it(self):
        self.assertEqual(self.steps["0.4"]["state"], "Done")
        self.assertEqual(self.steps["0.4"]["at"], "2026-11-13T09:00Z")
        self.assertIsNone(proven(self.repo, "check:pnpm types"))

    def test_a_missing_path_does_not_hold(self):
        self.assertIsNone(proven(self.repo, "records/none"))
        self.assertIsNone(proven(self.repo, "records/good; records/none"))

    def test_counts_and_the_critical_path(self):
        self.assertEqual((self.steps["1.1"]["done"], self.steps["1.1"]["of"]), (3, 12))
        self.assertEqual(critical_path(list(self.steps.values())), ["0.2", "1.1", "1.2"])


SCORECARD = """# The scorecard

| Thing | Lifecycle (R4) |
| --- | --- |
| [site](site.md) | ✗ |

## The ratchets

| Ratchet | What its list holds | Count | Closes in |
| --- | --- | --- | --- |
| R1 Raw schemas | Raw schemas outside `values` files. | 12 | 3.3 |
| R3 Rows not decoded | Stored rows cast. | 0 | 3.3 |
| R4 Lifecycles not machines | Things with no machine. | not yet counted (C.1) | C.1 |
| R15 Old words | The glossary's old words. | 9, gated by `pnpm words` | 3.8 |
"""


class Ratchets(unittest.TestCase):
    """The scorecard's ratchets on the dashboard: each count from ratchets.json, R15's from old-words.json's total."""

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        root = cls.dir.name
        run(root, "init", "-q", "-b", "master")
        generated = "packages/blueprint/generated"
        write(root, f"{generated}/scorecard.md", SCORECARD)
        write(root, f"{generated}/ratchets.json", json.dumps({"generated": "x", "counts": {"R1": 12, "R3": 0}}))
        write(root, f"{generated}/old-words.json", json.dumps({"generated": "x", "counts": {"core": 5, "door": 4, "hub": 0}}))
        run(root, "add", "-A")
        run(root, "commit", "-qm", "scorecard", when="2026-11-15T06:00:00Z")
        cls.rows = {r["id"]: r for r in ratchets(Repo(root, "master"))}

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def test_every_ratchet_of_the_scorecard_is_a_row(self):
        self.assertEqual(list(self.rows), ["R1", "R3", "R4", "R15"])
        self.assertTrue(all(r["kind"] == "ratchet" for r in self.rows.values()))
        self.assertEqual(self.rows["R1"]["name"], "R1 Raw schemas")
        self.assertEqual(self.rows["R1"]["detail"], "Raw schemas outside values files.")
        self.assertEqual(self.rows["R1"]["waits"], "3.3")

    def test_a_counted_ratchet_shows_its_committed_count(self):
        self.assertEqual((self.rows["R1"]["count"], self.rows["R1"]["state"]), (12, "Counting"))
        self.assertEqual((self.rows["R3"]["count"], self.rows["R3"]["state"]), (0, "Closed"))

    def test_old_words_show_their_total(self):
        self.assertEqual((self.rows["R15"]["count"], self.rows["R15"]["state"]), (9, "Counting"))

    def test_a_ratchet_not_yet_counted_says_so(self):
        self.assertEqual((self.rows["R4"]["count"], self.rows["R4"]["state"]), ("", "Not yet counted"))

    def test_no_scorecard_no_rows(self):
        with tempfile.TemporaryDirectory() as root:
            run(root, "init", "-q", "-b", "master")
            write(root, "a.txt", "a")
            run(root, "add", "-A")
            run(root, "commit", "-qm", "a")
            self.assertEqual(ratchets(Repo(root, "master")), [])


if __name__ == "__main__":
    unittest.main()

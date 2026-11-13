"""The dashboard's state comes only from committed proof: tests against a throwaway git repository."""
import json, os, subprocess, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from feed import Repo, critical_path, proven, record_passed, steps  # noqa: E402

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


if __name__ == "__main__":
    unittest.main()

"""What the dashboard shows, worked out from docs/roadmap.md and git history at one ref.

Nothing here is typed by hand: a step is Done only when the proof it names is committed and holds, and the time it was
done is when that proof landed on the ref's first-parent line (for master, the merge that brought it in).
"""
import datetime, json, re, subprocess


class Repo:
    """Git at one ref, read-only."""

    def __init__(self, root, ref):
        self.root, self.ref = root, ref

    def git(self, *args):
        return subprocess.run(["git", "-C", self.root, *args], check=True, capture_output=True, text=True).stdout

    def exists(self, path):
        return subprocess.run(["git", "-C", self.root, "cat-file", "-e", f"{self.ref}:{path}"], capture_output=True).returncode == 0

    def show(self, path):
        return self.git("show", f"{self.ref}:{path}")

    def files(self, path):
        return self.git("ls-tree", "-r", "--name-only", self.ref, "--", path).split()

    def landed(self, path):
        """When each file under path first appeared on the ref's first-parent line, by file."""
        out = self.git("log", "--first-parent", "-m", "--diff-filter=A", "--name-only", "--format=%x00%cI", self.ref, "--", path)
        first = {}
        for chunk in filter(None, out.split("\x00")):
            lines = [l for l in chunk.splitlines() if l.strip()]
            for name in lines[1:]:
                first[name] = lines[0]  # git log runs newest first, so the last write is the earliest
        return first

    def landed_text(self, path, text):
        """When text first appeared in path on the ref's first-parent line, or None."""
        out = self.git("log", "--first-parent", "-m", f"-S{text}", "--format=%cI", self.ref, "--", path).split()
        return out[-1] if out else None


def table(text, heading):
    """The rows of the first table under a heading, as lists of cells."""
    rows = []
    for line in text.split(heading, 1)[1].splitlines():
        if line.startswith("|"):
            rows.append([c.strip() for c in line.strip().strip("|").split("|")])
        elif rows:
            break
    return rows[2:]  # drop the header and the rule


def record_passed(body):
    """A JSON run record passes only when it says so: an object whose outcome is "passed"."""
    try:
        record = json.loads(body)
    except json.JSONDecodeError:
        return False
    return isinstance(record, dict) and record.get("outcome") == "passed"


def utc(text):
    stamp = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    return stamp.astimezone(datetime.timezone.utc) if stamp.tzinfo else stamp.replace(tzinfo=datetime.timezone.utc)


CHECKS = ".github/workflows/check.yml"


def proven(repo, proof):
    """(what holds, when it landed in UTC) for a step's Proof cell, or None when it does not hold on the ref.

    A part is a path (a file, or a directory whose JSON run records must all pass) or `check:<command>`, a command
    CI's gate runs. Parts are separated by semicolons; the step is done when the last of them landed.
    """
    parts = [p.strip().strip("`") for p in proof.split(";") if p.strip()]
    if not parts:
        return None
    times = []
    for part in parts:
        if part.startswith("check:"):
            command = part[len("check:"):].strip()
            if not repo.exists(CHECKS) or command not in repo.show(CHECKS):
                return None
            times.append(repo.landed_text(CHECKS, command))
        elif not repo.exists(part):
            return None
        else:
            listed = repo.files(part)
            if any(not record_passed(repo.show(f)) for f in listed if f.endswith(".json")):
                return None
            first = repo.landed(part)
            times.append(max(first[f] for f in listed if f in first) if any(f in first for f in listed) else None)
    if any(t is None for t in times):
        return None
    return "; ".join(parts), max(utc(t) for t in times)


def steps(repo, roadmap):
    """Every step of the roadmap with its state, its units and, when done, the time its proof landed."""
    out = []
    for step, milestone, what, needs, marked, count, waits, evidence, proof in table(roadmap, "## Steps to the goal"):
        holds = proven(repo, proof)
        # Done comes only from a committed proof. A row marked Done without one is shown as Claimed.
        state = "Done" if holds else "Claimed" if marked == "Done" else marked
        done, of = (int(n) for n in count.split("/")) if count else (0, 1)
        done = of if state == "Done" else (done if state != "Claimed" else 0)
        out.append({"id": step, "milestone": milestone, "name": what, "needs": [n.strip() for n in needs.split(",") if n.strip()],
                    "state": state, "done": done, "of": of, "waits": waits,
                    "at": holds[1].strftime("%Y-%m-%dT%H:%MZ") if holds else "",
                    "evidence": re.sub(r"`", "", evidence), "proof": holds[0] if holds else (proof.replace("`", "") if proof else "none committed")})
    return out


def critical_path(all_steps):
    """The chain of unfinished steps, each needing the one before, with the most work left in it."""
    left = {s["id"]: s for s in all_steps if s["state"] != "Done"}
    best = {}

    def longest(step_id):
        if step_id not in best:
            before = max((longest(n) for n in left[step_id]["needs"] if n in left), key=lambda p: p[0], default=(0, []))
            best[step_id] = (before[0] + left[step_id]["of"] - left[step_id]["done"], before[1] + [step_id])
        return best[step_id]

    return max((longest(i) for i in left), key=lambda p: p[0], default=(0, []))[1]

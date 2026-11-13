"""Builds the status dashboard's two data files from docs/roadmap.md and master's git history."""
import datetime, json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
BRANCH_POINT = "f12a831"  # where master was cut from main
REF = sys.argv[1] if len(sys.argv) > 1 else "origin/master"


def git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], check=True, capture_output=True, text=True).stdout


def table(text, heading):
    """The rows of the first table under a heading, as lists of cells."""
    body = text.split(heading, 1)[1]
    rows = []
    for line in body.splitlines():
        if line.startswith("|"):
            rows.append([c.strip() for c in line.strip().strip("|").split("|")])
        elif rows:
            break
    return rows[2:]  # drop the header and the rule


roadmap = git("show", f"{REF}:docs/roadmap.md")
items = []
for phase, delivers, done_when, state in table(roadmap, "## Phases"):
    items.append({"kind": "phase", "name": phase, "detail": done_when, "state": state, "at": ""})
for risk, state in table(roadmap, "## Risks to spike"):
    short = "Proven" if state.startswith("Proven") else "Killed" if state.startswith("Killed") else "Open"
    items.append({"kind": "risk", "name": risk, "detail": re.sub(r"[`()]", "", state), "state": short, "at": ""})
merges = git("log", "--merges", "--first-parent", "--format=%cI%x09%s%x09%b%x1e", f"{BRANCH_POINT}..{REF}")
for entry in filter(None, (e.strip() for e in merges.split("\x1e"))):
    at, subject, body = (entry.split("\t", 2) + ["", ""])[:3]
    number = re.search(r"#(\d+)", subject)
    title = body.strip().splitlines()[0] if body.strip() else subject
    items.append({"kind": "change", "name": title, "detail": f"pull request {number.group(1)}" if number else "", "state": "Merged", "at": at})

per_day = {}
for day in git("log", "--no-merges", "--format=%cd", "--date=format:%Y-%m-%d", f"{BRANCH_POINT}..{REF}").split():
    per_day[day] = per_day.get(day, 0) + 1
today = datetime.datetime.now(datetime.timezone.utc).date()
activity = [{"date": str(today - datetime.timedelta(days=n)), "commits": per_day.get(str(today - datetime.timedelta(days=n)), 0)} for n in range(13, -1, -1)]

out = os.path.join(ROOT, "var", "status-feed")
os.makedirs(out, exist_ok=True)
built = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
meta = [{"label": "Built", "value": built}, {"label": "From", "value": f"docs/roadmap.md and git history at {git('rev-parse', '--short', REF).strip()}"}]
for name, rows in (("items", items), ("activity", activity)):
    with open(os.path.join(out, f"{name}.json"), "w") as f:
        json.dump({"rows": rows, "meta": meta}, f, indent=1)
print(f"{len(items)} items, {sum(r['commits'] for r in activity)} commits in 14 days, built {built}")

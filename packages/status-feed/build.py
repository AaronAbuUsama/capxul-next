"""Builds the status dashboard's two data files from docs/roadmap.md and master's git history."""
import datetime, json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
BRANCH_POINT = "f12a831"  # where master was cut from main
REF = sys.argv[1] if len(sys.argv) > 1 else "origin/master"


def git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], check=True, capture_output=True, text=True).stdout


def table(text, heading):
    """The rows of the first table under a heading, as lists of cells."""
    rows = []
    for line in text.split(heading, 1)[1].splitlines():
        if line.startswith("|"):
            rows.append([c.strip() for c in line.strip().strip("|").split("|")])
        elif rows:
            break
    return rows[2:]  # drop the header and the rule


roadmap = git("show", f"{REF}:docs/roadmap.md")
steps = []
for step, milestone, what, needs, state, count, waits, done_on, evidence in table(roadmap, "## Steps to the goal"):
    done, of = (int(n) for n in count.split("/")) if count else ((1, 1) if state == "Done" else (0, 1))
    if state == "Done":
        done = of
    steps.append({"id": step, "milestone": milestone, "name": what, "needs": [n.strip() for n in needs.split(",") if n.strip()],
                  "state": state, "done": done, "of": of, "waits": waits, "at": done_on, "evidence": re.sub(r"`", "", evidence)})

# The critical path: the chain of unfinished steps, each needing the one before, with the most work left in it.
left = {s["id"]: s for s in steps if s["state"] != "Done"}
best = {}


def longest(step_id):
    if step_id not in best:
        before = max((longest(n) for n in left[step_id]["needs"] if n in left), key=lambda p: p[0], default=(0, []))
        best[step_id] = (before[0] + left[step_id]["of"] - left[step_id]["done"], before[1] + [step_id])
    return best[step_id]


path = max((longest(i) for i in left), key=lambda p: p[0], default=(0, []))[1]

items = []
for number, name, delivers, done_when, _state in table(roadmap, "## Phases"):
    m = number.split(".")[0] if "." in number else number
    mine = [s for s in steps if s["milestone"] == number.split(".")[0]]
    if not mine:
        continue
    done, of = sum(s["done"] for s in mine), sum(s["of"] for s in mine)
    state = "Done" if done == of else "In progress" if any(s["state"] != "Not started" for s in mine) else "Not started"
    items.append({"kind": "milestone", "id": number, "name": number, "detail": done_when, "state": state, "done": done, "of": of,
                  "pct": round(100 * done / of), "path": "", "waits": "", "at": "", "needs": ""})
for s in steps:
    items.append({"kind": "step", "id": s["id"], "name": f"{s['id']} {s['name']}", "detail": s["evidence"], "state": s["state"],
                  "done": s["done"], "of": s["of"], "pct": round(100 * s["done"] / s["of"]),
                  "path": path.index(s["id"]) + 1 if s["id"] in path else "", "waits": s["waits"], "at": s["at"], "needs": ", ".join(s["needs"])})
merges = git("log", "--merges", "--first-parent", "--format=%cI%x09%s%x09%b%x1e", f"{BRANCH_POINT}..{REF}")
for entry in filter(None, (e.strip() for e in merges.split("\x1e"))):
    at, subject, body = (entry.split("\t", 2) + ["", ""])[:3]
    number = re.search(r"#(\d+)", subject)
    title = body.strip().splitlines()[0] if body.strip() else subject
    items.append({"kind": "change", "id": number.group(1) if number else "", "name": title, "detail": f"pull request {number.group(1)}" if number else "",
                  "state": "Merged", "done": 1, "of": 1, "pct": 100, "path": "", "waits": "", "at": at, "needs": ""})

# Work done so far, day by day: the units of every step finished on or before each day.
total = sum(s["of"] for s in steps)
today = datetime.datetime.now(datetime.timezone.utc).date()
start = min([datetime.date.fromisoformat(s["at"]) for s in steps if s["at"]] + [today])
days = max(1, (today - start).days + 1)
activity = []
for n in range(13, -1, -1):
    day = today - datetime.timedelta(days=n)
    activity.append({"date": str(day), "done": sum(s["of"] for s in steps if s["at"] and s["at"] <= str(day)), "total": total})
done_now = sum(s["done"] for s in steps)
items.append({"kind": "pace", "id": "pace", "name": "Units of work finished per day since the first step was done", "detail": f"{days} day(s) counted",
              "state": "", "done": done_now, "of": total, "pct": round(100 * done_now / total), "path": "", "waits": "", "at": str(start), "needs": str(days)})

out = os.path.join(ROOT, "var", "status-feed")
os.makedirs(out, exist_ok=True)
built = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
meta = [{"label": "Built", "value": built}, {"label": "From", "value": f"docs/roadmap.md and git history at {git('rev-parse', '--short', REF).strip()}"}]
for name, rows in (("items", items), ("activity", activity)):
    with open(os.path.join(out, f"{name}.json"), "w") as f:
        json.dump({"rows": rows, "meta": meta}, f, indent=1)
print(f"{done_now} of {total} units done; critical path: {' > '.join(path)}; built {built}")

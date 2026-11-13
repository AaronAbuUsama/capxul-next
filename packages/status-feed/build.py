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


def exists(path):
    return subprocess.run(["git", "-C", ROOT, "cat-file", "-e", f"{REF}:{path}"], capture_output=True).returncode == 0


def record_passed(path):
    """A JSON run record passes when its outcome is passed; a record with no outcome field counts by existing."""
    try:
        body = json.loads(git("show", f"{REF}:{path}"))
    except json.JSONDecodeError:
        return False
    outcome = body.get("outcome") if isinstance(body, dict) else None
    return outcome is None or outcome == "passed"


def proven(proof):
    """Why a step's proof holds on REF, or None when it does not (docs/roadmap.md, "Steps to the goal")."""
    parts = [p.strip().strip("`") for p in proof.split(";") if p.strip()]
    if not parts:
        return None
    workflow = git("show", f"{REF}:.github/workflows/check.yml") if exists(".github/workflows/check.yml") else ""
    for part in parts:
        if part.startswith("check:"):
            if part[len("check:"):].strip() not in workflow:
                return None
        elif not exists(part):
            return None
        else:
            listed = git("ls-tree", "-r", "--name-only", REF, part).split()
            records = [f for f in listed if f.endswith(".json")]
            if any(not record_passed(f) for f in records):
                return None
    return "; ".join(parts)


roadmap = git("show", f"{REF}:docs/roadmap.md")
steps = []
for step, milestone, what, needs, marked, count, waits, done_on, evidence, proof in table(roadmap, "## Steps to the goal"):
    holds = proven(proof)
    # Done comes only from a committed proof. A row marked Done without one is shown as Claimed.
    state = "Done" if holds else "Claimed" if marked == "Done" else marked
    done, of = (int(n) for n in count.split("/")) if count else (0, 1)
    done = of if state == "Done" else (done if state != "Claimed" else 0)
    steps.append({"id": step, "milestone": milestone, "name": what, "needs": [n.strip() for n in needs.split(",") if n.strip()],
                  "state": state, "done": done, "of": of, "waits": waits, "at": done_on if state == "Done" else "",
                  "evidence": re.sub(r"`", "", evidence), "proof": holds or (proof.replace("`", "") if proof else "none committed")})

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
for number, delivers, done_when, _state in table(roadmap, "## Phases"):
    mine = [s for s in steps if s["milestone"] == number.split(".")[0]]
    if not mine:
        continue
    done, of = sum(s["done"] for s in mine), sum(s["of"] for s in mine)
    state = "Done" if done == of else "In progress" if any(s["state"] != "Not started" for s in mine) else "Not started"
    items.append({"kind": "milestone", "id": number, "name": number, "detail": done_when, "state": state, "done": done, "of": of,
                  "pct": round(100 * done / of), "path": "", "waits": "", "at": "", "needs": ""})
for s in steps:
    items.append({"kind": "step", "id": s["id"], "name": f"{s['id']} {s['name']}", "detail": s["evidence"], "proof": s["proof"], "state": s["state"],
                  "done": s["done"], "of": s["of"], "pct": round(100 * s["done"] / s["of"]),
                  "path": path.index(s["id"]) + 1 if s["id"] in path else "", "waits": s["waits"], "at": s["at"], "needs": ", ".join(s["needs"])})
# Risks: every step of milestone 0, then the risks the roadmap lists for later phases.
RISK_STATE = {"Done": "Proven", "Killed": "Killed", "In progress": "Being tested", "Claimed": "Claimed, no record"}
for s in steps:
    if s["milestone"] == "0":
        items.append({"kind": "risk", "id": s["id"], "name": s["name"], "detail": s["evidence"], "state": RISK_STATE.get(s["state"], "Open"),
                      "done": s["done"], "of": s["of"], "pct": round(100 * s["done"] / s["of"]), "path": "", "waits": "", "at": s["at"], "needs": ""})
for risk, state in table(roadmap, "## Risks, proven or killed"):
    items.append({"kind": "risk", "id": "", "name": risk, "detail": "a later phase", "state": state, "done": 0, "of": 1, "pct": 0,
                  "path": "", "waits": "", "at": "", "needs": ""})
merges = git("log", "--merges", "--first-parent", "--format=%cI%x09%s%x09%b%x1e", f"{BRANCH_POINT}..{REF}")
for entry in filter(None, (e.strip() for e in merges.split("\x1e"))):
    at, subject, body = (entry.split("\t", 2) + ["", ""])[:3]
    number = re.search(r"#(\d+)", subject)
    title = body.strip().splitlines()[0] if body.strip() else subject
    items.append({"kind": "change", "id": number.group(1) if number else "", "name": title, "detail": f"pull request {number.group(1)}" if number else "",
                  "state": "Merged", "done": 1, "of": 1, "pct": 100, "path": "", "waits": "", "at": at, "needs": ""})

# Work done so far, hour by hour: the units of every step finished by the end of each of the last 48 hours.
def when(text):
    stamp = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=datetime.timezone.utc)


total = sum(s["of"] for s in steps)
now = datetime.datetime.now(datetime.timezone.utc)
finished = [(when(s["at"]), s["of"]) for s in steps if s["at"]]
start = min([t for t, _ in finished] + [now])
hours = max(1.0, (now - start).total_seconds() / 3600)
this_hour = now.replace(minute=0, second=0, microsecond=0)
activity = []
for n in range(47, -1, -1):
    end = this_hour - datetime.timedelta(hours=n) + datetime.timedelta(hours=1)
    activity.append({"hour": (end - datetime.timedelta(hours=1)).strftime("%Y-%m-%dT%H:00Z"), "done": sum(of for t, of in finished if t < end), "total": total})
done_now = sum(s["done"] for s in steps)
items.append({"kind": "pace", "id": "pace", "name": "Work finished per hour since the first step was done", "detail": f"{hours:.1f} hours counted",
              "state": "", "done": done_now, "of": total, "pct": round(100 * done_now / total), "path": "", "waits": "", "at": start.strftime("%Y-%m-%dT%H:%MZ"),
              "needs": f"{hours:.2f}"})

out = os.path.join(ROOT, "var", "status-feed")
os.makedirs(out, exist_ok=True)
built = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
meta = [{"label": "Built", "value": built}, {"label": "From", "value": f"docs/roadmap.md and git history at {git('rev-parse', '--short', REF).strip()}"}]
for name, rows in (("items", items), ("activity", activity)):
    with open(os.path.join(out, f"{name}.json"), "w") as f:
        json.dump({"rows": rows, "meta": meta}, f, indent=1)
print(f"{done_now} of {total} units done; critical path: {' > '.join(path)}; built {built}")

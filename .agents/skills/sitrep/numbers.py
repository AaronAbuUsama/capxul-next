"""The sitrep's numbers: milestones, the next milestone's steps, the plan's totals and the burn-down.

Reads docs/roadmap.md and master's history through packages/status-feed/feed.py (the same rules as the status
dashboard: a step is Done only when its proof is committed, and done at the time that proof landed), and writes one
JSON document for the sitrep artifact's database, `sitrep/numbers`.

    python3 .agents/skills/sitrep/numbers.py [ref] > numbers.json      # ref defaults to origin/master

Needs master's full history: run `git fetch --unshallow origin master` first in a shallow clone.
"""
import datetime, json, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "packages", "status-feed"))
import feed  # noqa: E402

REF = sys.argv[1] if len(sys.argv) > 1 else "origin/master"
STEPS = "## Steps to the goal"
_table = feed.table


def table(text, heading):
    """feed.table, tolerant of a stray `|` inside a step's text: extra cells are folded into Evidence."""
    rows = _table(text, heading)
    if heading == STEPS:
        rows = [r if len(r) <= 9 else r[:7] + [" ".join(r[7:-1]), r[-1]] for r in rows]
    return rows


feed.table = table


def short(name):
    """A step's name, short enough for a list: up to the first colon or bracket, at most eight words."""
    name = re.sub(r"`", "", name)
    name = re.split(r": |\(|;| — ", name, maxsplit=1)[0].strip().rstrip(",.")
    words = name.split()
    return " ".join(words[:8]) + ("…" if len(words) > 8 else "")


def units(rows):
    total = 0
    for r in rows:
        count = r[5] if len(r) > 5 else ""
        total += int(count.split("/")[1]) if re.match(r"^\d+/\d+$", count) else 1
    return total


def scope_history(repo):
    """(time, units in the plan) at every change of docs/roadmap.md on master's first-parent line."""
    log = repo.git("log", "--first-parent", "--reverse", "--format=%H %cI", REF, "--", "docs/roadmap.md")
    out, last = [], None
    for line in filter(None, log.splitlines()):
        sha, at = line.split()
        text = repo.git("show", f"{sha}:docs/roadmap.md")
        if STEPS not in text:
            continue
        n = units(table(text, STEPS))
        if n != last:
            out.append((feed.utc(at), n))
            last = n
    return out


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%MZ")


def main():
    repo = feed.Repo(ROOT, REF)
    roadmap = repo.show("docs/roadmap.md")
    steps = feed.steps(repo, roadmap)
    path = feed.critical_path(steps)
    by_id = {s["id"]: s for s in steps}

    milestones = []
    for number, _delivers, _done_when, _state in table(roadmap, "## Phases"):
        mid, _, name = number.partition(". ")
        mine = [s for s in steps if s["milestone"] == mid]
        if not mine:
            continue
        done, of = sum(s["done"] for s in mine), sum(s["of"] for s in mine)
        state = "Done" if done == of else "In progress" if any(s["state"] != "Not started" for s in mine) else "Not started"
        milestones.append({"id": mid, "name": name or number, "done": done, "of": of, "state": state})

    current = by_id[path[0]]["milestone"] if path else next((m["id"] for m in milestones if m["state"] != "Done"), None)
    milestone = None
    if current:
        mine = [s for s in steps if s["milestone"] == current]
        m = next(m for m in milestones if m["id"] == current)
        milestone = {
            "id": current, "name": m["name"], "done": sum(1 for s in mine if s["state"] == "Done"), "of": len(mine),
            "next": next((i for i in path if by_id[i]["milestone"] == current), None),
            "steps": [{"id": s["id"], "name": short(re.sub(r"^\S+\s", "", s["name"]) if s["name"].startswith(s["id"]) else s["name"]),
                       "state": s["state"]} for s in mine],
            "path": [short(by_id[i]["name"]) for i in path[:6]],
        }

    # The burn-down: every time a step was done or the plan changed, the units left.
    events = {}
    for s in steps:
        if s["at"]:
            e = events.setdefault(s["at"], {"done": [], "units": 0, "scope": None})
            e["done"].append(s["id"])
            e["units"] += s["of"]
    for at, n in scope_history(repo):
        events.setdefault(iso(at), {"done": [], "units": 0, "scope": None})["scope"] = n
    burn, done, total = [], 0, None
    for at in sorted(events):
        e, before = events[at], total
        if e["scope"] is not None:
            total = e["scope"]
        if total is None:
            continue
        done += e["units"]
        notes = []
        if e["done"]:
            ids = sorted(e["done"], key=lambda x: [int(p) if p.isdigit() else p for p in x.split(".")])
            notes.append(("Step " if len(ids) == 1 else "Steps ") + ", ".join(ids) + f" done (+{e['units']})")
        if before is None:
            notes.append(f"plan starts at {total} units")
        elif total != before:
            notes.append(f"plan {total - before:+d} units")
        burn.append({"t": at, "left": max(0, total - done), "done": done, "total": total, "note": "; ".join(notes),
                     "kind": "done" if e["done"] else "plan"})

    now = datetime.datetime.now(datetime.timezone.utc)
    midnight = iso(now.replace(hour=0, minute=0, second=0, microsecond=0))
    before_today = [b for b in burn if b["t"] < midnight]
    start_total = before_today[-1]["total"] if before_today else (burn[0]["total"] if burn else 0)
    today = {"done": sum(s["of"] for s in steps if s["at"] and s["at"] >= midnight),
             "added": (burn[-1]["total"] if burn else 0) - start_total}

    plan_done = sum(s["done"] for s in steps)
    plan_total = sum(s["of"] for s in steps)
    print(json.dumps({
        "schema": 1, "builtAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "ref": repo.git("rev-parse", "--short", REF).strip(),
        "plan": {"done": plan_done, "total": plan_total}, "milestone": milestone, "milestones": milestones,
        "burn": burn, "today": today,
    }, indent=1))


if __name__ == "__main__":
    main()

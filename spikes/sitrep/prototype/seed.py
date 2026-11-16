"""Builds the prototype's event log, events.jsonl, and its derived facts, derived.json, from the real state.

    python3 spikes/sitrep/prototype/seed.py [--refresh]

Sources, each read at a time the snapshot records:
- docs/roadmap.md on origin/master: the plan, every milestone and every step, with when each first appeared;
- packages/status-feed/feed.py over master's history: each step's state and the time its proof landed (the same rules
  as the status dashboard, with numbers.py's workaround for the stray `|` in row 3.3);
- .agents/skills/sitrep/example/now.json and sitreps.json: the lanes, their pull requests, the threads and the sitreps;
- GitHub Actions (through `gh`, cached in var/sitrep-prototype/github.json; --refresh reads it again): the CI run that
  proved each step, master's health, and the full runs' wall times;
- master's history: the ratchet counts at each change, and what landed.

Two asks are written to the full ask schema as examples: their ids start `ask-example-`, and the page marks them.
Nothing else is invented. Where the real state does not fit the blueprint's shapes, the thing is left out and listed
in SKIPPED (printed at the end), never forced in.
"""
import datetime, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
REF = "origin/master"
REPO = "AaronAbuUsama/capxul-next"
GH = f"https://github.com/{REPO}"
SKILL = os.path.join(ROOT, ".agents", "skills", "sitrep")
CACHE = os.path.join(ROOT, "var", "sitrep-prototype", "github.json")
sys.path.insert(0, os.path.join(ROOT, "packages", "status-feed"))
import feed  # noqa: E402

_table = feed.table


def _tolerant(text, heading):
    """feed.table, tolerant of a stray `|` inside a step's text (row 3.3), as .agents/skills/sitrep/numbers.py does."""
    rows = _table(text, heading)
    if heading == "## Steps to the goal":
        rows = [r if len(r) <= 9 else r[:7] + [" ".join(r[7:-1]), r[-1]] for r in rows]
    return rows


feed.table = _tolerant

STEPS = "## Steps to the goal"
CONDUCTOR = "session_01S8RF7Ce7ysZNMXvaxLQkix"
AARON = {"kind": "person", "person": "aaron"}
SKIPPED = []


def agent(thread):
    return {"kind": "agent", "thread": thread}


def git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], check=True, capture_output=True, text=True).stdout


def iso(t):
    return t.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def at(text, seconds=0):
    return iso(feed.utc(text) + datetime.timedelta(seconds=seconds))


def read(path):
    with open(path) as f:
        return json.load(f)


# Threads named in now.json, with what Claude Code's session list says of each (title, when it started).
SESSIONS = {
    "session_01S8RF7Ce7ysZNMXvaxLQkix": ("conductor", "Conductor: the Capxul rebuild", "2026-11-15T17:06:21Z", None),
    "session_01S8RF79VUFRRBGBDTzB485K": ("lead", "Lead: blueprint stage 2 (2a lands, then 2b)", "2026-11-15T17:07:48Z", "blueprint"),
    "session_01S8RF7A5EFsECELJk2x94CG": ("lead", "Lead: run time under 5 minutes", "2026-11-15T17:51:08Z", "run-time"),
    "session_01S8RF7BnxXPJvTcMYQPWzPD": ("lead", "Lead: instrumentation, telemetry to Axiom", "2026-11-15T17:46:36Z", "telemetry"),
    "session_01S8RF7D33sfKcWfHsnDPd8z": ("lead", "Lead: docs, one set by progressive disclosure", "2026-11-15T17:39:15Z", None),
    "session_01S8RF79ozyx81cyXgaj9eUZ": ("author", "Author: journeys safe side by side (4.11)", "2026-11-15T17:54:39Z", "run-time"),
    "session_01S8RF7CdntXG9ZAhQTJ6GA8": ("designer", "Designer: the sitrep page's UX (with Aaron)", "2026-11-15T18:08:07Z", None),
}

# Why each milestone comes where it does, from the roadmap's phases and the decisions behind their order.
WHY_NOW = {
    "0": "The rebuild rests on a handful of risky bets; each had to be proven or killed by a run before anything was built on it.",
    "1": "The thin line in the new shape is the smallest whole system, so every later step has something real to run against.",
    "2": "A shared hosted world is where the product will live; the thin line must pass there, deployed by Alchemy, before it grows.",
    "3": "Everything later is declared in the blueprint first, so the blueprint and its checks must exist before any feature goes through it.",
    "4": "A feature is done when run records prove it and its measures are watched, so measurement comes before the first feature.",
    "C": "Bringing every existing thing up to spec in parallel lanes rehearses breadth at a size where a mistake is cheap.",
    "5": "Account identity is the first feature through the whole loop, and every later feature depends on who may call.",
    "6": "The invoice ledger proves side by side, flip and retire on real behaviour once versions exist.",
    "7": "Breadth ports the journeys in waves once the format and its checks hold, so parallel agents cannot drift.",
    "8": "The goal is Capxul's own company running on Capxul, which needs the real platform, sign-in and chain.",
}

PLAN = {
    "title": "The Capxul rebuild",
    "why": "The product line drifted from its own description: facts were typed twice, and nothing proved the system did what it said.",
    "what": "Rebuild on one owner for every fact. The blueprint declares what Capxul does, the world says what runs where, and verdicts made by CI say what is proven. Every feature is measured by run records, not by code written.",
    "endState": "Capxul's own company runs a month on the rebuilt system in production, with every journey proven by CI and every measure watched.",
    "outOfScope": "New product features before the accounts pilot, and anything on main or integration/build, which carry the product work in flight.",
}

ASKS = [
    {
        "ask": "ask-example-shared-world", "from": "session_01S8RF7A5EFsECELJk2x94CG", "lane": "run-time", "step": "4.8",
        "at": "2026-11-15T19:12:00Z",
        "question": "Share one world across every journey now, or after telemetry lands?",
        "problem": "Step 4.8 puts every journey side by side in one shared world, the biggest cut in the full run's time. It can start now, or wait until telemetry is on master.",
        "context": "A full run takes about thirty minutes against a target of five. When journeys share a world, a failure in one can show up in another, and without telemetry the record cannot say which call caused it.",
        "rubric": [
            {"name": "Time to a faster run", "why": "Every day the run stays slow, every slice waits longer at its merge."},
            {"name": "Explainable failures", "why": "A failure we cannot explain from its record costs a rerun, and reruns cost money under the daily cap."},
        ],
        "options": [
            {"key": "A", "title": "Start now", "detail": "Build the shared world tonight on the runner's own records.", "tradeoffs": "The fastest cut, but a cross-journey failure is hard to explain until telemetry lands."},
            {"key": "B", "title": "After telemetry", "detail": "Start once 4.4 is on master, with the isolation check reading spans.", "tradeoffs": "About a day later, but every failure names the call that caused it."},
            {"key": "C", "title": "Company journeys first", "detail": "Share the world only for company journeys now; world journeys keep their own.", "tradeoffs": "Half the gain now with little risk; a second change later."},
        ],
        "recommended": "C", "because": "It takes most of the gain tonight while keeping the journeys whose failures are hardest to explain in worlds of their own.",
    },
    {
        "ask": "ask-example-glossary-renames", "from": "session_01S8RF79VUFRRBGBDTzB485K", "lane": "blueprint", "step": "3.8",
        "at": "2026-11-15T19:30:00Z",
        "question": "Rename the glossary's old words in one sweep, or file by file on the ratchet?",
        "problem": "The glossary is declared and counts its old words: several thousand across the code. They can be renamed in one pull request or a file at a time.",
        "context": "Three lanes are building on master at once. A sweep touches most packages and would conflict with each of them; the ratchet lets each lane rename the files it already touches.",
        "rubric": [
            {"name": "Conflicts with other lanes", "why": "A conflict stops a lane until someone merges by hand."},
            {"name": "Time until the count is zero", "why": "Step 3.8 is done only when the old words are gone."},
        ],
        "options": [
            {"key": "A", "title": "One sweep", "detail": "One builder renames every old word in one pull request tonight.", "tradeoffs": "Done in a day, but every open slice conflicts with it."},
            {"key": "B", "title": "File by file", "detail": "Each lane renames the old words in the files it touches; the ratchet only falls.", "tradeoffs": "No conflicts, but the count falls slowly and 3.8 stays open for weeks."},
        ],
        "recommended": "B", "because": "Three lanes are mid-flight; a sweep would cost each of them a merge by hand for a step nothing else waits on.",
    },
]


def github():
    """Check runs on master and the full runs, from GitHub Actions, cached so a rebuild does not need the network."""
    if os.path.exists(CACHE) and "--refresh" not in sys.argv:
        return read(CACHE)
    def runs(workflow, query, more=True):
        out = subprocess.run(["gh", "api", *(["--paginate"] if more else []), f"repos/{REPO}/actions/workflows/{workflow}/runs?per_page=100{query}",
                              "--jq", ".workflow_runs[] | {id, event, branch: .head_branch, sha: .head_sha, started: .run_started_at, updated: .updated_at, conclusion}"],
                             check=True, capture_output=True, text=True).stdout
        return [json.loads(l) for l in out.splitlines() if l.strip()]
    data = {"read": iso(datetime.datetime.now(datetime.timezone.utc)),
            "check": runs("check.yml", "&branch=master&event=push"), "world": runs("world.yml", "&status=completed", more=False)}
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w") as f:
        json.dump(data, f)
    return data


def any_run(gh, sha):
    """Any CI run of a merge whose `check` run is missing (before check.yml existed), cached with the rest."""
    found = gh.setdefault("bySha", {})
    if sha and sha not in found:
        out = subprocess.run(["gh", "api", f"repos/{REPO}/actions/runs?head_sha={sha}", "--jq", "[.workflow_runs[] | select(.conclusion == \"success\") | .id][0]"],
                             capture_output=True, text=True).stdout.strip()
        found[sha] = int(out) if out.isdigit() else None
        with open(CACHE, "w") as f:
            json.dump(gh, f)
    return found.get(sha)


def first_seen(text):
    t = feed.Repo(ROOT, REF).landed_text("docs/roadmap.md", text)
    return at(t) if t else None


def short(name):
    name = re.sub(r"`", "", name)
    name = re.split(r": |\(|;| — ", name, maxsplit=1)[0].strip().rstrip(",.")
    words = name.split()
    out = " ".join(words[:9])
    return out if len(out) <= 90 else out[:88] + "…"


def prose(text, floor):
    text = re.sub(r"`", "", text or "").strip()
    return (text if len(text) >= 20 else floor)[:3990]


def ratchets(now):
    """Each counted ratchet's count at every change on master, and the registry's uncounted ones."""
    registry = git("show", f"{REF}:packages/blueprint/src/ratchets.ts")
    entries = re.findall(r'\{\s*id: "(R\d+)",\s*name: "([^"]+)",\s*holds:\s*"([^"]+)",\s*closes: "([^"]+)",\s*count: "([^"]+)"(?:,\s*countedBy: "([^"]+)")?', registry)
    counts = json.loads(git("show", f"{REF}:packages/blueprint/generated/ratchets.json"))["counts"]

    def history(path, measure):
        out = []
        for line in git("log", "--first-parent", "--reverse", "--format=%H %cI", REF, "--", path).splitlines():
            sha, t = line.split()
            try:
                value = measure(git("show", f"{sha}:{path}"))
            except subprocess.CalledProcessError:
                continue
            if value is not None and (not out or out[-1]["count"] != value):
                out.append({"at": at(t), "count": value})
        return out

    def lint_rule(rule):
        def measure(text):
            block = re.search(rf'"{rule}": \{{(.*?)\n  \}}', text, re.S)
            return sum(int(n) for n in re.findall(r": (\d+),", block.group(1))) if block else None
        return measure

    series = {
        "R1": history("packages/lint/src/unmigrated.ts", lint_rule("owned-values")),
        "R2": history("packages/lint/src/unmigrated.ts", lint_rule("declared-names")),
        "R3": history("packages/lint/src/unmigrated.ts", lint_rule("decoded-rows")),
        "R5": history("packages/blueprint-tools/src/checks/formats.ts",
                      lambda t: len(re.findall(r'^\s+"[a-z.]+",$', t.split("unmigratedMachine", 1)[1].split("];", 1)[0], re.M)) if "unmigratedMachine" in t else None),
        "R15": history("packages/blueprint/generated/old-words.json", lambda t: sum(json.loads(t)["counts"].values())),
    }
    out = []
    for rid, name, holds, closes, count, counted_by in entries:
        s = series.get(rid, [])
        value = counts.get(rid, s[-1]["count"] if s and count != "not yet counted" else None)
        if value is not None and s and s[-1]["count"] != value:
            s.append({"at": now, "count": value})
        item = {"id": rid, "name": name, "holds": holds, "closes": closes, "count": value, "series": s if value is not None else []}
        if counted_by:
            item["countedBy"] = counted_by
        out.append(item)
    return out


def main():
    repo = feed.Repo(ROOT, REF)
    roadmap = repo.show("docs/roadmap.md")
    head_sha, head_at = git("log", "-1", "--format=%H %cI", REF).split()
    now = at(head_at, 60)
    gh = github()
    now_json, sitreps = read(os.path.join(SKILL, "example", "now.json")), read(os.path.join(SKILL, "example", "sitreps.json"))
    steps = feed.steps(repo, roadmap)
    by_id = {s["id"]: s for s in steps}
    phases = feed.table(roadmap, "## Phases")
    events = []

    def add(e):
        events.append(e)

    # The plan: written with Aaron on 13 November, revised on 15 November when the foundations became phases 3 to 6.
    first = at(git("log", "--first-parent", "--reverse", "--format=%cI", REF, "--", "docs/roadmap.md").split()[0])
    m_ids = [p[0].split(".")[0] for p in phases if any(s["milestone"] == p[0].split(".")[0] for s in steps)]
    original = [m for m in m_ids if m in ("0", "1", "2", "7", "8")]
    add({"_tag": "plan_written", "plan": "rebuild", "by": AARON, "at": first, **PLAN, "milestones": original})
    add({"_tag": "plan_agreed", "plan": "rebuild", "by": AARON, "at": at(first, 60)})
    add({"_tag": "plan_revised", "plan": "rebuild", "by": agent(CONDUCTOR), "at": "2026-11-15T17:10:00Z", **PLAN, "milestones": m_ids})
    add({"_tag": "plan_agreed", "plan": "rebuild", "by": AARON, "at": "2026-11-15T17:20:00Z"})

    # Milestones, each planned when its phase row first appeared, and started when its first step moved.
    lane_of = {s["id"]: l["id"] for l in now_json["lanes"] for s in l.get("steps", [])}
    leads = {l["id"]: l["lead"].rsplit("/", 1)[1] for l in now_json["lanes"] if l.get("lead")}
    started = {}
    for number, delivers, done_when, _state in phases:
        mid, _, name = number.partition(". ")
        mine = [s for s in steps if s["milestone"] == mid]
        if not mine:
            SKIPPED.append(f"milestone {mid}: no steps")
            continue
        planned = min(t for t in [first_seen(f"| {number} |"), at(first, 30)] if t) if mid in original else (first_seen(f"| {number} |") or "2026-11-15T17:10:30Z")
        add({"_tag": "milestone_planned", "milestone": mid, "by": agent(CONDUCTOR) if mid not in original else AARON, "at": planned,
             "plan": "rebuild", "title": short(name), "goal": prose(delivers, f"Milestone {mid} of the plan."),
             "why": WHY_NOW[mid], "doneWhen": prose(re.sub(r"\s+", " ", done_when), "Every step of it is Done on master."),
             "steps": [s["id"] for s in mine]})
        moved = [feed.utc(s["at"]) for s in mine if s["at"]] + [feed.utc(SESSIONS[leads[lane_of[s["id"]]]][2]) for s in mine if s["id"] in lane_of and lane_of[s["id"]] in leads]
        if moved:
            started[mid] = iso(max(min(moved), feed.utc(planned)) + datetime.timedelta(seconds=5))
            add({"_tag": "milestone_started", "milestone": mid, "by": agent(CONDUCTOR), "at": started[mid]})

    # Steps: planned when their row first appeared on master, started by a lane, proven by the CI run of the merge.
    first_parent = {}
    for line in git("log", "--first-parent", "--format=%H %cI", REF).splitlines():
        sha, t = line.split()
        first_parent.setdefault(feed.utc(t).strftime("%Y-%m-%dT%H:%M"), sha)
    check_by_sha = {r["sha"]: r["id"] for r in gh["check"]}
    milestone_of = {m: (p[1]) for p in phases for m in [p[0].split(".")[0]]}
    for s in steps:
        cell = next(r for r in feed.table(roadmap, STEPS) if r[0] == s["id"])
        planned = first_seen(f"| {s['id']} | {s['milestone']} |") or first
        if s["at"]:
            planned = min(planned, at(s["at"], -60))
        add({"_tag": "step_planned", "step": s["id"], "by": agent(CONDUCTOR) if planned > "2026-11-15" else AARON, "at": planned,
             "milestone": s["milestone"], "title": short(re.sub(r"^\S+\s", "", s["name"]) if s["name"].startswith(s["id"]) else s["name"]),
             "what": prose(s["name"], "See the roadmap."), "why": prose(f"Milestone {s['milestone']} needs it: {milestone_of[s['milestone']]}", "Its milestone needs it."),
             "doneWhen": prose(f"Its proof is committed on master: {cell[8]}" if cell[8] else "", "A passing run record, named in the roadmap's Proof column, is committed on master."),
             "needs": s["needs"], "units": s["of"]})
        lane = lane_of.get(s["id"]) or ("blueprint" if s["id"] in ("3.8", "3.11") and s["state"] == "In progress" else None)
        if lane and lane in leads and s["state"] != "Done":
            add({"_tag": "step_started", "step": s["id"], "by": agent(leads[lane]), "at": max(at(SESSIONS[leads[lane]][2], 120), at(planned, 60)), "lane": lane})
        elif s["state"] == "In progress":
            SKIPPED.append(f"step {s['id']}: in progress on the roadmap, but no lane in now.json has started it")
        if s["state"] == "Done":
            done = feed.utc(s["at"])
            sha = first_parent.get(done.strftime("%Y-%m-%dT%H:%M"))
            run = check_by_sha.get(sha) or any_run(gh, sha)
            if not run:
                SKIPPED.append(f"step {s['id']}: proven at {s['at']}, but no CI run of that merge was found")
                continue
            part = s["proof"].split(";")[0].strip()
            proof = f"{GH}/blob/{sha[:8]}/.github/workflows/check.yml" if part.startswith("check:") else f"{GH}/tree/{sha[:8]}/{part}"
            add({"_tag": "step_proven", "step": s["id"], "by": {"kind": "pipeline", "run": f"ci-{run}"}, "at": iso(done), "proof": proof})

    # Threads and lanes from now.json, each thread's start from its session.
    for tid, (kind, title, created, lane) in SESSIONS.items():
        e = {"_tag": "thread_started", "thread": tid, "by": agent(CONDUCTOR), "at": created, "type": kind, "title": title,
             "agent": "claude-code", "link": f"https://claude.ai/code/{tid}", "parent": CONDUCTOR}
        if tid == CONDUCTOR:
            e.pop("parent")
        if lane:
            e["lane"] = lane
        add(e)
    for l in now_json["lanes"]:
        if not l.get("steps"):
            SKIPPED.append(f"lane {l['id']}: it names no roadmap step, and a lane must name at least one")
            continue
        opened = at(SESSIONS[leads[l["id"]]][2], 30) if l["id"] in leads else "2026-11-15T17:47:30Z"
        add({"_tag": "lane_opened", "lane": l["id"], "by": agent(CONDUCTOR), "at": opened, "title": l["name"],
             "branch": f"slice/{l['id']}", "steps": [s["id"] for s in l["steps"]]})
        if l["id"] in leads:
            add({"_tag": "lane_led", "lane": l["id"], "by": agent(CONDUCTOR), "at": at(opened, 10), "lead": leads[l["id"]]})

    # Sitreps, as the conductor said them.
    opened_lanes = {e["lane"] for e in events if e["_tag"] == "lane_opened"}
    for r in sitreps:
        lanes = [x for x in r["lanes"] if x in opened_lanes]
        add({"_tag": "sitrep_said", "sitrep": r["id"], "by": agent(CONDUCTOR), "at": r["at"], "title": r["title"],
             "parts": r["paras"], "links": r["links"], "lanes": lanes,
             "steps": sorted({s["id"] for l in now_json["lanes"] if l["id"] in lanes for s in l.get("steps", [])})})

    # The example asks; each asking thread waits on Aaron.
    for a in ASKS:
        a = dict(a)
        when = a.pop("at")
        add({"_tag": "ask_opened", "ask": a.pop("ask"), "by": agent(a["from"]), "at": when, **a})
        add({"_tag": "thread_waiting", "thread": a["from"], "by": agent(a["from"]), "at": at(when, 5)})

    events.sort(key=lambda e: e["at"])
    with open(os.path.join(HERE, "events.jsonl"), "w") as f:
        f.write("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in events))

    # Derived facts: never events, each with the time its source was read.
    def minutes(r):
        return round((feed.utc(r["updated"]) - feed.utc(r["started"])).total_seconds() / 60, 1)
    full = [r for r in gh["world"] if r["conclusion"] in ("success", "failure")]
    full.sort(key=lambda r: r["started"])
    master = next(r for r in gh["check"] if r["sha"] == head_sha) if any(r["sha"] == head_sha for r in gh["check"]) else gh["check"][0]
    landed = []
    for entry in filter(None, (e.strip() for e in git("log", "--merges", "--first-parent", "-8", "--format=%cI%x09%s%x09%b%x1e", REF).split("\x1e"))):
        t, subject, body = (entry.split("\t", 2) + ["", ""])[:3]
        number = re.search(r"#(\d+)", subject)
        if number:
            landed.append({"at": at(t), "title": short(body.strip().splitlines()[0] if body.strip() else subject), "href": f"{GH}/pull/{number.group(1)}"})
    derived = {
        "sources": [
            {"id": "roadmap", "name": "The roadmap and master's history", "read": now},
            {"id": "github", "name": "GitHub Actions", "read": at(gh["read"])},
            {"id": "conductor", "name": "The conductor's lanes and pull requests", "read": at(now_json["at"])},
        ],
        "health": {
            "master": {"state": "green" if master["conclusion"] == "success" else "red" if master["conclusion"] == "failure" else "running",
                       "label": master["sha"][:7], "href": f"{GH}/actions/runs/{master['id']}", "at": at(master["updated"])},
            "runs": [{"slice": r["branch"], "outcome": "passed" if r["conclusion"] == "success" else "failed", "minutes": minutes(r),
                      "at": at(r["updated"]), "href": f"{GH}/actions/runs/{r['id']}"} for r in full[-12:]],
        },
        "pulls": [{"number": p["number"], "title": p["title"], "state": p["state"], "lane": l["id"], "href": f"{GH}/pull/{p['number']}"}
                  for l in now_json["lanes"] if l["id"] in opened_lanes for p in l.get("prs", [])],
        "landed": landed,
        "measures": {
            "ratchets": ratchets(now),
            "budgets": [{"name": "A full run", "budget": now_json["run"]["target"], "unit": "min", "source": "github",
                         "measured": [minutes(r) for r in full if r["conclusion"] == "success"][-8:]}],
            "evals": [{"step": "4.2", "name": "Explainability", "what": "Every refusal has its deciding log, every span its parent, and the share of each call's time its declared steps explain."},
                      {"step": "4.3", "name": "The build evals", "what": "Tries to green, breakage and recovery, and speed and cost per journey, read from the verdicts."}],
        },
    }
    with open(os.path.join(HERE, "derived.json"), "w") as f:
        json.dump(derived, f, indent=1, ensure_ascii=False)
    print(f"{len(events)} events, {len(derived['pulls'])} pull requests, {len(derived['health']['runs'])} full runs; snapshot at {now}")
    for s in SKIPPED:
        print("left out:", s)


if __name__ == "__main__":
    main()

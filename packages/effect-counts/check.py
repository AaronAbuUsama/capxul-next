"""The two Effect counts of the rebuild line, and the rule that they may only fall.

Count 1: non-Effect constructs in TypeScript outside entry files (async, await, new Promise, try, throw,
process.env, Date.now, console). Count 2: runtime dependencies that are not Effect or Alchemy.
`check.py` fails when either count is above the committed baseline; `check.py --write` lowers the baseline.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
BASELINE = os.path.join(HERE, "baseline.json")
# Code written on the rebuild line. A folder is added here when its code is written the new way.
SCOPE = ["spikes/hosting", "spikes/pipeline", "spikes/state", "spikes/containers", "packages/blueprint", "packages/core", "packages/runner"]
# A file that starts a process may touch the outside world directly: one per program, named here by suffix.
ENTRY = ("alchemy.run.ts", "run-world.ts", ".entry.ts", "main.ts")
CONSTRUCTS = {
    "async": r"\basync\b", "await": r"\bawait\b", "new Promise": r"\bnew Promise\b", "try": r"\btry\s*\{", "throw": r"\bthrow\b",
    "process.env": r"\bprocess\.env\b", "Date.now": r"\bDate\.now\b|\bnew Date\(\)", "console": r"\bconsole\.",
}
EFFECT_DEP = re.compile(r"^(effect|@effect/.+|alchemy|@alchemy\.run/.+)$")
# Dependencies with no Effect replacement yet, kept by decision (docs/roadmap.md). They are listed on every run and
# are not counted; adding a name here is Aaron's decision, never a way to make the check pass.
ACCEPTED = {
    "ponder": "the chain index, kept by decision aaron.postgres-and-ponder",
    "hono": "Ponder's own API file must export a Hono app; it leaves when Ponder does",
    "viem": "chain calls and signing; no Effect replacement yet",
    "@pimlico/alto": "the bundler; no Effect replacement yet",
}
# A Ponder app is a program written to Ponder's API, which is async by design. Its files are not counted.
FOREIGN = ("/ponder/",)


def tracked(folder):
    out = subprocess.run(["git", "-C", ROOT, "ls-files", folder], check=True, capture_output=True, text=True).stdout
    return [p for p in out.split("\n") if p]


def strip(text):
    """Source with comments and string contents removed, so a word in prose is not counted as code."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"//[^\n]*", "", text)
    return re.sub(r"`(?:\\.|[^`\\])*`|\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'", '""', text)


def count():
    constructs, where, deps = 0, {}, set()
    for folder in SCOPE:
        for path in tracked(folder):
            full = os.path.join(ROOT, path)
            if path.endswith("package.json"):
                deps |= {d for d in json.load(open(full)).get("dependencies", {}) if not EFFECT_DEP.match(d)}
            if any(part in "/" + path for part in FOREIGN):
                continue
            if not path.endswith((".ts", ".tsx")) or path.endswith(ENTRY) or path.endswith(".d.ts"):
                continue
            source = strip(open(full).read())
            n = sum(len(re.findall(pattern, source)) for pattern in CONSTRUCTS.values())
            if n:
                constructs, where[path] = constructs + n, n
    return {"constructs": constructs, "dependencies": len(deps - set(ACCEPTED))}, where, sorted(deps)


now, where, deps = count()
if "--write" in sys.argv:
    json.dump(now, open(BASELINE, "w"), indent=1)
    open(BASELINE, "a").write("\n")
base = json.load(open(BASELINE))
print(f"non-Effect constructs outside entry files: {now['constructs']} (baseline {base['constructs']})")
for path, n in sorted(where.items()):
    print(f"  {n:3d}  {path}")
print(f"non-Effect runtime dependencies not accepted: {now['dependencies']} (baseline {base['dependencies']})")
for name in deps:
    print(f"  {'accepted' if name in ACCEPTED else 'COUNTED '}  {name}" + (f": {ACCEPTED[name]}" if name in ACCEPTED else ""))
risen = [k for k in now if now[k] > base[k]]
if risen:
    sys.exit(f"FAILED: {', '.join(risen)} rose above the baseline. Write the code the Effect way, or remove the dependency.")
if any(now[k] < base[k] for k in now):
    print("A count fell: run `python3 packages/effect-counts/check.py --write` and commit the new baseline.")

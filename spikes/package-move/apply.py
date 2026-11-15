# Applies the agreed move to the working tree of packages/world, reusing the explorer's rewrite.
import os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ns = {"__file__": os.path.join(HERE, "build.py")}
exec(open(os.path.join(HERE, "build.py")).read(), ns)
MOVES, OPS, rewrite, new_of, read = ns["MOVES"], ns["OPS"], ns["rewrite"], ns["new_of"], ns["read"]
ROOT = "/home/user/capxul-next"
PKG = ROOT + "/packages/world"
git = lambda *a: subprocess.check_call(["git", *a], cwd=PKG)

files = subprocess.check_output(["git", "ls-files", "src", "test"], cwd=PKG).decode().split()
originals = {f: read(f) for f in files}

for f in files:
    if f == "src/lifecycle/operations.ts":
        git("rm", "-q", f)
        for t, text in OPS.items():
            os.makedirs(os.path.dirname(os.path.join(PKG, t)), exist_ok=True)
            open(os.path.join(PKG, t), "w").write(rewrite(f, t, text))
        continue
    nt = new_of(f)
    if nt != f:
        os.makedirs(os.path.dirname(os.path.join(PKG, nt)), exist_ok=True)
        git("mv", f, nt)
    if not f.endswith(".hex"):
        content = originals[f]
        if f == "src/door.ts":
            content = content.replace("// The package's door: everything another package may import.",
                                      "// The package's one import entry: everything another package may import.")
        open(os.path.join(PKG, nt), "w").write(rewrite(f, nt, content))
for t in OPS: git("add", t)

def edit(path, pairs):
    p = os.path.join(ROOT, path); s = open(p).read()
    for a, b in pairs:
        assert a in s, (path, a)
        s = s.replace(a, b)
    open(p, "w").write(s)

edit("packages/world/package.json", [("./src/door.ts", "./src/index.ts")])
edit("packages/world/run.sh", [("src/main.ts", "src/cli/main.ts")])
edit("packages/world/alchemy.run.ts", [('"./src/core/Core.ts"', '"./src/parts/api/Api.ts"'), ('"./src/stack/stack.ts"', '"./src/things/world/stage.ts"')])

# Outside the package: real references to the moved files (not the lint tests' made-up fixtures).
def outside(path):
    p = os.path.join(ROOT, path); s = open(p).read()
    def sub(m):
        old = m.group(1)
        if old == "src/lifecycle/operations.ts": return None
        return "packages/world/" + (new_of(old) or old)
    s2 = re.sub(r"packages/world/(src/[A-Za-z/._-]+\.(?:ts|hex))", lambda m: sub(m) or m.group(0), s)
    open(p, "w").write(s2)
    return s2 != s
for path in [".oxlintrc.json", "packages/core/test/chain/up.sh", "docs/roadmap.md", "spikes/world-speed/measure/reset.py",
             "spikes/world-speed/patches/pinned-images.diff", "packages/world/README.md", "packages/lint/src/unmigrated.ts"]:
    print(path, outside(path))

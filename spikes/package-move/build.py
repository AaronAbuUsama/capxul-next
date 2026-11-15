import json, os, posixpath as pp, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from moves import MOVES, SPLITS, OUTSIDE
from pages import README, DOCS, LAYOUT_TEST, DESIGN

PKG = "/home/user/capxul-next/packages/world"
P = "packages/world/"
read = lambda f: open(os.path.join(PKG, f)).read()
files = subprocess.check_output(["git", "ls-files", "src", "test"], cwd=PKG).decode().split()

# ---- the split of operations.ts, cut along its own top-level declarations ----
def split_ops(src):
    lines = src.split("\n")
    imports = [l for l in lines if l.startswith("import ")]
    body = "\n".join(l for l in lines[1:] if not l.startswith("import ")).strip("\n")
    # top-level chunks: a doc comment plus the declaration that follows it
    chunks, cur = [], []
    for l in body.split("\n"):
        if (l.startswith("/**") or l.startswith("const ") or l.startswith("export ")) and cur and not cur[-1].startswith(("/**", " *")):
            chunks.append("\n".join(cur).strip("\n")); cur = []
        cur.append(l)
    chunks.append("\n".join(cur).strip("\n"))
    out = {}
    for c in chunks:
        m = re.search(r"(?:export )?(?:const|interface) (\w+)", c)
        target, header = SPLITS["src/lifecycle/operations.ts"][m.group(1)][0], None
        for k, (t, h) in SPLITS["src/lifecycle/operations.ts"].items():
            if t == target and h: header = h
        out.setdefault(target, {"header": header, "parts": []})["parts"].append(c)
    result = {}
    for target, v in out.items():
        text = "\n\n".join(v["parts"])
        kept = []
        for imp in imports:
            names = re.findall(r"\b(?:type )?(\w+)\b(?=\s*[,}])", imp) if "{" in imp else re.findall(r"\* as (\w+)", imp)
            used = [n for n in names if re.search(rf"\b{n}\b", text)]
            if not used: continue
            if "{" in imp:
                parts = [p.strip() for p in imp[imp.index("{") + 1: imp.index("}")].split(",")]
                parts = [p for p in parts if p.split()[-1] in used]
                imp = imp[: imp.index("{") + 1] + " " + ", ".join(parts) + " " + imp[imp.index("}"):]
            kept.append(imp)
        result[target] = v["header"] + "\n" + "\n".join(kept) + "\n\n" + text + "\n"
    return result

OPS = split_ops(read("src/lifecycle/operations.ts"))
SPLIT_OF = {}  # exported name -> new path
for name, (t, _) in SPLITS["src/lifecycle/operations.ts"].items(): SPLIT_OF[name] = t

def new_of(old):
    if old in MOVES and MOVES[old][0]: return MOVES[old][0]
    if old.startswith("test/") or old in OUTSIDE: return old
    return None

# folder mentions in comments: src/hub -> src/things/cluster, ...
FOLDERS = {"src/hub": "src/things/cluster", "src/platform": "src/account", "src/containers": "src/parts/containers",
           "src/site": "src/things/site", "src/door": "src/parts/gateway", "src/core": "src/parts/api",
           "src/index": "src/parts/indexer", "src/chain": "src/parts/chain", "src/bundler": "src/parts/bundler",
           "src/database": "src/parts/database", "src/lifecycle": "src/things/world"}

def rewrite(old, new, text):
    d_old, d_new = pp.dirname(old), pp.dirname(new)
    def fix_spec(spec, names=None):
        target = pp.normpath(pp.join(d_old, spec))
        if target == "src/lifecycle/operations.ts": return None
        nt = new_of(target) or target
        rel = pp.relpath(nt, d_new)
        return rel if rel.startswith(".") else "./" + rel
    def imp(m):
        whole, spec = m.group(0), m.group(2)
        target = pp.normpath(pp.join(d_old, spec))
        if target == "src/lifecycle/operations.ts" and "{" in whole:
            names = [p.strip() for p in whole[whole.index("{") + 1: whole.index("}")].split(",") if p.strip()]
            groups = {}
            for n in names: groups.setdefault(SPLIT_OF[n.replace("type ","").split()[0]], []).append(n)
            head = whole[: whole.index("{")]
            out = []
            for t, ns in groups.items():
                rel = pp.relpath(t, d_new); rel = rel if rel.startswith(".") else "./" + rel
                out.append(f'{head}{{ {", ".join(ns)} }} from "{rel}"')
            return ";\n".join(out)
        return m.group(1) + fix_spec(spec) + '"'
    text = re.sub(r'((?:import|export)[^;"]*?from ")(\.{1,2}/[^"]+)"', imp, text)
    # import.meta.dirname paths that climb out of the folder
    def dirn(m):
        rest = m.group(1)
        target = pp.normpath(pp.join(d_old, rest))
        rel = pp.relpath(target, d_new)
        return "${import.meta.dirname}/" + rel
    text = re.sub(r"\$\{import\.meta\.dirname\}/((?:\.\./)+[^`\"]*)", dirn, text)
    # file and folder mentions in comments and messages
    def mention(m):
        path = m.group(0)
        if path in MOVES and MOVES[path][0]: return MOVES[path][0]
        if path == "src/lifecycle/operations.ts": return "src/things/world/create.ts"
        return FOLDERS.get(path, path)
    text = re.sub(r"\bsrc/[A-Za-z]+(?:/[A-Za-z.-]+\.(?:ts|hex))?", mention, text)
    return text

before, after, goes = {}, {}, {}
for f in files:
    if f.endswith(".hex"):
        content = "(compiled bytecode, one line; unchanged)"
    else:
        content = read(f)
    before[f] = content
    if f == "src/door.ts":
        content = content.replace("// The package's door: everything another package may import.", "// The package's one import entry: everything another package may import.")
    if f == "src/lifecycle/operations.ts":
        goes[f] = [P + t for t in OPS]
        for t, text in OPS.items():
            after[P + t] = {"from": f, "note": MOVES[f][1], "content": rewrite(f, t, text) if not f.endswith(".hex") else content}
        continue
    nt = new_of(f)
    goes[f] = [P + nt]
    note = MOVES[f][1] if f in MOVES else "Stays in test/; only its imports change."
    after[P + nt] = {"from": f if f != nt else nt, "kind": "kept" if f == nt else "", "note": note,
                     "content": content if f.endswith(".hex") else rewrite(f, nt, content)}

for f, (nt, note) in OUTSIDE.items():
    before[f] = read(f)
    goes[f] = [P + nt]
    if f == "README.md":
        after[P + nt] = {"from": f, "note": note, "content": README}
        goes[f] += [P + "docs/" + d for d in DOCS]
        for name, (src_lines, why, intro) in DOCS.items():
            lines = before[f].split("\n")
            body = "\n".join(lines[a - 1:b] for a, b in src_lines) if False else "\n\n".join("\n".join(lines[a - 1:b]) for a, b in src_lines)
            after[P + "docs/" + name] = {"from": f, "note": why, "content": rewrite("README.md", "README.md", intro + "\n\n" + body.strip() + "\n")}
        continue
    content = before[f]
    if f == "package.json": content = content.replace("./src/door.ts", "./src/index.ts")
    if f == "run.sh": content = content.replace("src/main.ts", "src/cli/main.ts")
    if f == "alchemy.run.ts": content = rewrite("alchemy.run.ts", "alchemy.run.ts", content.replace('"./src/core/Core.ts"', '"./src/parts/api/Api.ts"').replace('"./src/stack/stack.ts"', '"./src/things/world/stage.ts"'))
    after[P + nt] = {"from": f, "kind": "kept", "note": note, "content": content}

after[P + "test/layout.test.ts"] = {"from": "(new)", "note": "The check: fails any file under src/ that lands outside the layout.", "content": LAYOUT_TEST}
after["docs/design/world.md"] = {"from": "(new)", "note": "The agreed layout, recorded in the style of the blueprint's part 13. Written once you agree.", "content": DESIGN}

# ---- the generated map: one line per file, from its opening comment ----
def first_line(text):
    out = []
    for l in text.split("\n"):
        if l.startswith("//"):
            out.append(l.lstrip("/ ").strip())
            if l.rstrip().endswith(".") or len(out) >= 2: break
        elif out or l.startswith("import") or l.strip() == "":
            if out: break
        else: break
    s = " ".join(out)
    m = re.match(r"(.+?\.)(\s|$)", s)
    s = m.group(1) if m else s
    if len(s) > 150:
        cut = max(s.rfind(c, 40, 150) for c in ":;,(")
        s = s[:cut].rstrip(" (") + "."
    return s

groups = {}
for path, e in after.items():
    if not path.startswith(P + "src/") or path.endswith(".hex"): continue
    rel = path[len(P):]
    parts = rel.split("/")
    folder = "/".join(parts[:-1])
    groups.setdefault(folder, []).append((parts[-1], first_line(e["content"])))
FOLDER_SAYS = {
    "src": "the one import entry",
    "src/things/world": "a world: what it is, and one file per verb",
    "src/things/cluster": "the cluster: the shared containers worlds run on",
    "src/things/registry": "the registry: one row per world name",
    "src/things/site": "a world's company sites, on the bench",
    "src/things/site-template": "site templates: ready copies of a starting point's sites",
    "src/parts/gateway": "the gateway: the cluster's one address",
    "src/parts/api": "the api: what fills a world's api slot",
    "src/parts/chain": "the chain: one world's anvil, and its client",
    "src/parts/bundler": "the bundler: one world's alto, and its client",
    "src/parts/indexer": "the indexer: one world's Ponder",
    "src/parts/database": "the database: Neon, as resources and as calls",
    "src/parts/containers": "what the chain, bundler and indexer objects share",
    "src/account": "the account: the operations served outside any world",
    "src/stack": "Alchemy: the engine, images, names, the cloud accounts",
    "src/cli": "the command line",
    "src/common": "what every kind uses: failures, records, timing",
    "src/proofs": "the proofs, frozen with their records",
    "src/proofs/cases": "one proof case per file",
    "src/proofs/support": "what the proof cases share",
}
order = ["src", "src/things/world", "src/things/cluster", "src/things/registry", "src/things/site", "src/things/site-template",
         "src/parts/gateway", "src/parts/api", "src/parts/chain", "src/parts/bundler", "src/parts/indexer", "src/parts/database",
         "src/parts/containers", "src/account", "src/stack", "src/cli", "src/common", "src/proofs", "src/proofs/cases", "src/proofs/support"]
md = ["<!-- Generated by pnpm generate from the first comment of each file. Never edited. -->", "# @capxul/world: the map", "",
      "One line per file, from the comment it opens with. The kinds of folder are in [README.md](../README.md).", ""]
for g in order:
    md.append(f"## `{g}/`: {FOLDER_SAYS[g]}"); md.append("")
    for name, line in sorted(groups.get(g, [])):
        md.append(f"- [`{name}`](../{g}/{name}): {line}")
    md.append("")
md.append("## `docs/`"); md.append("")
for name, (_, why, intro) in DOCS.items():
    md.append(f"- [`{name}`](../docs/{name}): {intro.split(chr(10))[0].lstrip('# ')}")
after[P + "generated/index.md"] = {"from": "(new)", "note": "Written by pnpm generate from each file's opening comment; pnpm generate:check keeps it current. Never edited.", "content": "\n".join(md) + "\n"}

removed = {}
data = {"before": before, "after": after, "removed": removed, "goes": goes}
json.dump(data, open(os.path.join(HERE, "data.json"), "w"))
html = open(os.path.join(HERE, "page.html")).read().replace("__DATA__", json.dumps(data).replace("</", "<\\/"))
open(os.path.join(HERE, "world-layout.html"), "w").write(html)
print(len(before), len(after), len(html))

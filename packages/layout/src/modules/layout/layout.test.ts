import assert from "node:assert/strict";
import { test } from "node:test";

import { checkLayout, isSized, readmeProblems, sizeProblems, topLevelProblems, type Policy, type Tree } from "./service.ts";

const policy: Policy = {
  allowed: { "README.md": "the front door", packages: "the code", docs: "designs", ".github": "templates" },
  limit: 300,
  sourceExtensions: [".ts", ".sol"],
  sizeExempt: ["docs/", "archive/", "/generated/", "packages/contracts/lib/"],
  oversize: { "packages/a/src/big.ts": 500 },
};

const treeOf = (lines: Record<string, number>, extra: Partial<Tree> = {}): Tree => {
  const files = Object.keys(lines), top = [...new Set(files.map((p) => p.split("/")[0]!))];
  return {
    files, topLevel: top, topLevelDirs: top.filter((t) => files.some((p) => p.startsWith(`${t}/`))),
    packages: [...new Set(files.filter((p) => p.startsWith("packages/") && p.split("/").length > 2).map((p) => p.split("/")[1]!))],
    linesOf: (p) => lines[p] ?? 0, ...extra,
  };
};

const good = { "README.md": 10, "packages/README.md": 5, "packages/a/README.md": 5, "packages/a/src/big.ts": 500, "packages/a/src/small.ts": 300, "docs/README.md": 5, "docs/design.md": 5, ".github/x.yml": 5 };

test("a tree that keeps every rule has no problems", () => {
  assert.deepEqual(checkLayout(treeOf(good), policy), []);
});

test("top level: an entry that is not on the allowlist fails, tracked or not, and the message says where it could go", () => {
  const tracked = topLevelProblems(treeOf({ ...good, "runs/x/status.json": 1 }), policy);
  assert.deepEqual(tracked.map((p) => p.at), ["runs"]);
  assert.match(tracked[0]!.why, /var\//);
  const untracked = topLevelProblems(treeOf(good, { topLevel: ["README.md", "packages", "scratch.txt"] }), policy);
  assert.deepEqual(untracked.map((p) => p.at), ["scratch.txt"]);
});

test("size: a new source file over the limit fails; one at the limit passes", () => {
  const p = checkLayout(treeOf({ ...good, "packages/a/src/new.ts": 301 }), policy);
  assert.deepEqual(p.map((x) => [x.rule, x.at]), [["size", "packages/a/src/new.ts"]]);
  assert.match(p[0]!.why, /301 lines/);
});

test("size: a recorded offender may shrink but not grow", () => {
  assert.deepEqual(checkLayout(treeOf({ ...good, "packages/a/src/big.ts": 420 }), policy), []);
  const grown = checkLayout(treeOf({ ...good, "packages/a/src/big.ts": 501 }), policy);
  assert.match(grown[0]!.why, /grew from 500 to 501/);
});

test("size: an entry on the list that is no longer needed must be removed, so the list only shrinks", () => {
  assert.match(checkLayout(treeOf({ ...good, "packages/a/src/big.ts": 200 }), policy)[0]!.why, /remove its line/);
  const { "packages/a/src/big.ts": _gone, ...rest } = good;
  assert.match(checkLayout(treeOf(rest), policy)[0]!.why, /gone or exempt/);
});

test("size: designs, the archive, generated and vendored code, and files that are not source are not measured", () => {
  for (const path of ["docs/a.ts", "archive/tools/old.ts", "packages/a/src/generated/abi.ts", "packages/contracts/lib/forge-std/src/Vm.sol", "packages/a/data.json"])
    assert.equal(isSized(path, policy), false, path);
  assert.equal(isSized("packages/contracts/src/Budgets.sol", policy), true);
  assert.deepEqual(sizeProblems([], { ...policy, oversize: {} }), []);
});

test("readme: a package or a top-level directory without one fails; hidden directories are not asked for one", () => {
  const { "packages/a/README.md": _a, "docs/README.md": _d, ...rest } = good;
  assert.deepEqual(readmeProblems(treeOf(rest)).map((p) => p.at), ["docs", "packages/a"]);
  assert.deepEqual(readmeProblems(treeOf(good)), []);
});

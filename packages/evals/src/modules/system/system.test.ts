import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { sliceZeroRequired } from "@capxul/blueprint-engine";
import { loadTarget } from "../../../../blueprint-engine/scripts/target.ts";
import { judgeGenerated, judgeImports, systemChecks } from "./service.ts";

const target = await loadTarget();
assert.ok(target.ok);
const b = target.blueprint;
const deps = (c: string) => ((b.records.get(`concept:${c}`) as unknown as { dependsOn?: { id: string }[] }).dependsOn ?? []).map((d) => d.id);
const tree = (files: Record<string, string>) => ({ files: Object.keys(files), read: (p: string) => files[p]! });
// payments depends on access and organizations but not on plugs or sites, per its blueprint record. The package manifests
// mirror the repository's: backend exports concept doors by subpath, site-service exports the Sites door as its root.
const pkg = {
  "packages/backend/package.json": JSON.stringify({ name: "@capxul/backend", exports: { "./plugs": "./src/plugs/door.ts", "./organizations": "./src/organizations/door.ts" } }),
  "packages/site-service/package.json": JSON.stringify({ name: "@capxul/site-service", exports: { ".": "./src/sites/door.ts" } }),
};
const doors = Object.fromEntries(["backend/src/access", "backend/src/plugs", "backend/src/organizations", "site-service/src/sites"]
  .map((d) => [`packages/${d}/door.ts`, ""]));

test("an @capxul import is judged by the file Node loads, and one that loads nothing or is computed is a violation", () => {
  const file = "packages/backend/src/payments/door.ts";
  // @capxul/x exports ./access with the given target; access is a payments dependency, sign-in.ts is not its door.
  const x = (exports: unknown) => ({ "packages/x/package.json": JSON.stringify({ name: "@capxul/x", exports: { "./access": exports } }),
    "packages/x/src/access/door.ts": "", "packages/x/src/access/sign-in.ts": "" });
  const [door, inner] = ["./src/access/door.ts", "./src/access/sign-in.ts"];
  for (const [label, source, files, why] of [
    ["an unexported subpath", 'import "@capxul/backend/nope";', {}, /does not resolve through @capxul\/backend's exports/],
    ["an unknown package", 'import "@capxul/nosuch/x";', {}, /no package @capxul\/nosuch/],
    ["a folder path the map does not export", 'import "@capxul/backend/src/plugs/door.ts";', {}, /does not resolve/],
    ["only types and require conditions, loaded by import", 'import "@capxul/x/access";', x({ types: "./a.d.ts", require: door }), /does not resolve/],
    ["only a development condition", 'import "@capxul/x/access";', x({ development: door }), /does not resolve/],
    ["an array with no usable target", 'import "@capxul/x/access";', x([{ types: "./a.d.ts" }]), /does not resolve/],
    ["an export to a file not at the commit", 'import "@capxul/x/access";', { ...x(door), "packages/x/src/access/door.ts": undefined }, /does not resolve/],
    ["default before import: Node takes default", 'import "@capxul/x/access";', x({ default: inner, import: door }), /not through access's door/],
    ["import of a require-only door", 'import "@capxul/x/access";', x({ import: inner, require: door }), /not through access's door/],
    ["import() with a substitution", "const m = await import(`../${name}/door.ts`);", {}, /cannot be judged statically/],
    ["import() of a variable", "const m = await import(name);", {}, /cannot be judged statically/],
    ["require() of a variable", "const m = require(name);", {}, /cannot be judged statically/],
    ["import.meta.resolve of a variable", "const u = import.meta.resolve(name);", {}, /cannot be judged statically/],
  ] as const) {
    const all: Record<string, string | undefined> = { ...pkg, ...doors, [file]: source, ...files };
    const j = judgeImports(b, "payments", tree(Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined)) as Record<string, string>));
    assert.equal(j.pass, false, `${label}: ${j.detail}`);
    assert.match(j.violations[0]?.why ?? "", why, `${label}: ${j.detail}`);
  }
  for (const [label, source, exports] of [
    ["import before default: Node takes import", 'import "@capxul/x/access";', { import: door, default: inner }],
    ["require() takes the require condition", 'const a = require("@capxul/x/access");', { import: inner, require: door }],
    ["an array falls back to its first usable target", 'import "@capxul/x/access";', ["not-relative", door]],
    ["a plain string export", 'import "@capxul/x/access";', door],
  ] as const) {
    const j = judgeImports(b, "payments", tree({ ...pkg, ...doors, ...x(exports), [file]: source }));
    assert.equal(j.pass, true, `${label}: ${j.detail}`);
  }
  // A pattern export resolves its star, and the longest matching prefix wins.
  const star = (source: string) => judgeImports(b, "payments", tree({ ...pkg, ...doors, ...x(door), [file]: source,
    "packages/x/package.json": JSON.stringify({ name: "@capxul/x", exports: { "./*": "./src/*/sign-in.ts", "./c/*": "./src/*/door.ts" } }) }));
  assert.equal(star('import "@capxul/x/c/access";').pass, true, star('import "@capxul/x/c/access";').detail);
  assert.match(star('import "@capxul/x/access";').detail, /not through access's door/);
});

test("checks are named from the gate's sys claims", () => {
  const named = systemChecks(b, sliceZeroRequired(b));
  assert.equal(named.filter((c) => c.concept).length, 19);
  assert.ok(named.some((c) => c.name === "SYSTEM.generated"));
  assert.deepEqual(systemChecks(b, ["sys:imports/no-such", "ret:doc.submit"]), []);
});

test("a concept imports another only through the door of a concept it depends on", () => {
  assert.ok(deps("payments").includes("access") && deps("payments").includes("organizations"));
  assert.ok(!deps("payments").includes("plugs") && !deps("payments").includes("sites"));
  const file = "packages/backend/src/payments/door.ts";
  for (const [label, source, pass] of [
    ["own folder and outside code", 'import { x } from "./internal.ts";\nimport { y } from "../platform/db.ts";', true],
    ["a dependency's door", 'import { a } from "../access/door.ts";', true],
    ["a dependency's door as .js", 'import { a } from "../access/door.js";', true],
    ["a dependency's door through the exports map", 'import { o } from "@capxul/backend/organizations";', true],
    ["a dependency's internals", 'import { a } from "../access/sign-in.ts";', false],
    ["a non-dependency's door", 'import { e } from "../plugs/door.ts";', false],
    ["a non-dependency through the exports map", 'import { e } from "@capxul/backend/plugs";', false],
    ["a non-dependency through a package root", 'import { s } from "@capxul/site-service";', false],
    ["a dynamic import of internals", 'const m = await import("../access/sign-in.ts");', false],
    ["a template-literal dynamic import", "const m = await import(`../access/sign-in.ts`);", false],
    ["a re-export of internals", 'export { a } from "../access/sign-in.ts";', false],
    ["a namespace re-export", 'export * as a from "../access/sign-in.ts";', false],
    ["import = require", 'import m = require("../plugs/door.ts");', false],
    ["require", 'const m = require("../plugs/door.ts");', false],
    ["a side-effect import mid-line", 'const x = 1; import "../plugs/door.ts";', false],
    ["an import type", 'type T = import("../access/sign-in.ts").T;', false],
    ["a module URL", 'const u = new URL("../plugs/door.ts", import.meta.url);', false],
    ["a commented-out import", '// import { e } from "../plugs/door.ts";\n/* import "../plugs/door.ts"; */', true],
    ["a string that looks like one", "const s = 'import { e } from \"../plugs/door.ts\"';", true],
    ["a concept folder named without a slash", 'import * as p from "../plugs";', false],
    ["import.meta.resolve", 'const u = import.meta.resolve("../plugs/door.ts");', false],
  ] as const) {
    const j = judgeImports(b, "payments", tree({ ...pkg, [file]: source, ...doors }));
    assert.equal(j.pass, pass, `${label}: ${j.detail}`);
  }
  // JavaScript in a concept folder counts too.
  const js = judgeImports(b, "payments", tree({ ...pkg, [file]: "", "packages/backend/src/payments/legacy.mjs": 'import "../plugs/door.ts";' }));
  assert.match(js.detail, /legacy\.mjs/);
  // A concept with no code under any src/<concept>/ fails rather than passing empty.
  assert.match(judgeImports(b, "payments", tree(pkg)).detail, /no TypeScript/);
  assert.equal(judgeImports(b, "payments", tree(pkg)).pass, false);
});

test("generated code passes only when the commit's own generator, run in a clean checkout of it, finds nothing stale", () => {
  assert.match(judgeGenerated(".", "abc1234", { files: ["packages/backend/src/generated/x.ts"] }).detail, /packages\/generate does not exist/);
  // A repository whose generator accepts packages/a/src/generated/x.ts only when it reads "fresh".
  const root = mkdtempSync(join(tmpdir(), "capxul-generated-test-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();
  const put = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const commit = (x: string) => { put("packages/a/src/generated/x.ts", x); git("add", "-A"); git("commit", "-qm", x); return git("rev-parse", "HEAD"); };
  try {
    git("init", "-q");
    put("package.json", '{ "name": "fixture", "private": true }\n');
    put("packages/generate/src/main.ts", `import { readFileSync } from "node:fs";
const x = readFileSync("packages/a/src/generated/x.ts", "utf8");
if (x === "fresh\\n") console.log("generate:check: 1 generated file matches the records");
else { console.error("generate:check  packages/a/src/generated/x.ts: differs"); process.exitCode = 1; }\n`);
    const stale = commit("stale\n");
    const fresh = commit("fresh\n");
    git("checkout", "-q", stale);
    put("packages/a/src/generated/x.ts", "fresh\n"); // fixed in the working tree only
    const judge = (c: string) => judgeGenerated(root, c, { files: git("ls-tree", "-r", "--name-only", c.replace("+dirty", "")).split("\n") });
    const failed = judge(stale);
    assert.equal(failed.pass, false, failed.detail);
    assert.match(failed.detail, /x\.ts: differs/);
    assert.equal(failed.steps.length, 3);
    const passed = judge(fresh);
    assert.equal(passed.pass, true, passed.detail);
    assert.match(passed.detail, /1 generated file matches/);
    assert.match(judge(`${fresh}+dirty`).detail, /uncommitted changes/);
    assert.equal(git("worktree", "list").split("\n").length, 1, "every checkout is removed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

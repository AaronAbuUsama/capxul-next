import assert from "node:assert/strict";
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
  ] as const) {
    const j = judgeImports(b, "payments", tree({ ...pkg, [file]: source, "packages/backend/src/access/door.ts": "", "packages/backend/src/plugs/door.ts": "" }));
    assert.equal(j.pass, pass, `${label}: ${j.detail}`);
  }
  // JavaScript in a concept folder counts too.
  const js = judgeImports(b, "payments", tree({ ...pkg, [file]: "", "packages/backend/src/payments/legacy.mjs": 'import "../plugs/door.ts";' }));
  assert.match(js.detail, /legacy\.mjs/);
  // A concept with no code under any src/<concept>/ fails rather than passing empty.
  assert.match(judgeImports(b, "payments", tree(pkg)).detail, /no TypeScript/);
  assert.equal(judgeImports(b, "payments", tree(pkg)).pass, false);
});

test("generated code cannot pass without a generator", () => {
  const j = judgeGenerated({ files: ["packages/backend/src/generated/x.ts"] }, "abc1234");
  assert.equal(j.pass, false);
  assert.match(j.detail, /packages\/generate does not exist/);
});

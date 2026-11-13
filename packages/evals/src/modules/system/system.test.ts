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
// payments depends on access but not on plugs, per its blueprint record.
const pkg = { "packages/backend/package.json": '{"name":"@capxul/backend"}' };

test("checks are named from the gate's sys claims", () => {
  const named = systemChecks(b, sliceZeroRequired(b));
  assert.equal(named.filter((c) => c.concept).length, 19);
  assert.ok(named.some((c) => c.name === "SYSTEM.generated"));
  assert.deepEqual(systemChecks(b, ["sys:imports/no-such", "ret:doc.submit"]), []);
});

test("a concept imports another only through the door of a concept it depends on", () => {
  assert.ok(deps("payments").includes("access") && !deps("payments").includes("plugs"));
  const file = "packages/backend/src/payments/door.ts";
  for (const [label, source, pass] of [
    ["own folder and outside code", 'import { x } from "./internal.ts";\nimport { y } from "../platform/db.ts";', true],
    ["a dependency's door", 'import { a } from "../access/door.ts";', true],
    ["a dependency's internals", 'import { a } from "../access/sign-in.ts";', false],
    ["a non-dependency's door", 'import { e } from "../plugs/door.ts";', false],
    ["a non-dependency through the package name", 'import { e } from "@capxul/backend/src/plugs/door.ts";', false],
    ["a dynamic import of internals", 'const m = await import("../access/sign-in.ts");', false],
    ["a re-export of internals", 'export { a } from "../access/sign-in.ts";', false],
  ] as const) {
    const j = judgeImports(b, "payments", tree({ ...pkg, [file]: source, "packages/backend/src/access/door.ts": "", "packages/backend/src/plugs/door.ts": "" }));
    assert.equal(j.pass, pass, `${label}: ${j.detail}`);
  }
  // A concept with no code under any src/<concept>/ fails rather than passing empty.
  assert.match(judgeImports(b, "payments", tree(pkg)).detail, /no TypeScript/);
  assert.equal(judgeImports(b, "payments", tree(pkg)).pass, false);
});

test("generated code cannot pass without a generator", () => {
  const j = judgeGenerated({ files: ["packages/backend/src/generated/x.ts"] }, "abc1234");
  assert.equal(j.pass, false);
  assert.match(j.detail, /packages\/generate does not exist/);
});

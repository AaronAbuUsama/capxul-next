import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";
import { executeRun } from "./execute.ts";
import { loadBindings, parseScriptList } from "./modules/bindings/service.ts";

test("a run asking for a screen's shows claim succeeds only with that screen's source-equality capture", async () => {
  const target = await loadTarget();
  assert.ok(target.ok);
  const ids = ["scr:supplier-invoice/shows", "scr:supplier-invoice/refuses"];
  const root = mkdtempSync(join(tmpdir(), "eval-screens-"));
  const printed: string[] = [];
  const log = console.log;
  try {
    mkdirSync(join(root, "packages/evals/src"), { recursive: true });
    symlinkSync(join(import.meta.dirname, "record-status.ts"), join(root, "packages/evals/src/record-status.ts"));
    mkdirSync(join(root, "status"));
    const loaded = loadBindings([{
      source: "acceptance.json", area: "acceptance", script: "run.sh", worlds: ["main"], secrets: [], near: [],
      bindings: ids.map((id, i) => ({ eval: id, checks: [`S${i + 1}.done`], why: "screen capture regression" })),
    }], { evals: new Set(ids), scripts: new Map([["run.sh", parseScriptList("S1.done\tcheck\nS2.done\tcheck")]]) });
    assert.ok(loaded.ok);
    const checks = "printf '@check\\tS1.done\\tpass\\t1\\tok\\n@check\\tS2.done\\tpass\\t1\\tok\\n'\nprintf image > \"$CAPXUL_EVAL_RUN_DIR/shot.png\"";
    const manifest = (screen: string, assertion: string) =>
      `\nprintf '[{"screen":"${screen}","path":"shot.png","source":"sources.json#/invoice/supplier","assertion":"${assertion}"}]' > "$CAPXUL_EVAL_RUN_DIR/screens.json"`;
    // Every case completes with both verdicts passing; only the capture decides success.
    for (const [script, passed] of [
      [checks, false],
      [checks + manifest("payment-entry", "source-equality"), false],
      [checks + manifest("supplier-invoice", "visual"), false],
      [checks + manifest("supplier-invoice", "source-equality"), true],
      [checks + manifest("screen:supplier-invoice", "source-equality"), true],
    ] as const) {
      writeFileSync(join(root, "run.sh"), script);
      printed.length = 0;
      console.log = (line: string) => { printed.push(line); };
      const code = await executeRun(root, target.blueprint, loaded.value, ids, { world: "main", slug: "test", json: true }, "abc1234", []);
      console.log = log;
      const result = JSON.parse(printed.at(-1)!) as { state: string; passed: boolean; counts: { pass: number }; uncaptured: string[] };
      assert.equal(code, passed ? 0 : 1, script);
      assert.equal(result.state, "complete", script);
      assert.equal(result.counts.pass, 2, script);
      assert.equal(result.passed, passed, script);
      assert.deepEqual(result.uncaptured, passed ? [] : ["scr:supplier-invoice/shows"], script);
    }
  } finally {
    console.log = log;
    rmSync(root, { recursive: true, force: true });
  }
});

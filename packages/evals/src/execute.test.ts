import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseRunReceipt, parseStatus } from "@capxul/blueprint-engine";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";
import { executeRun } from "./execute.ts";
import { loadBindings, parseScriptList } from "./modules/bindings/service.ts";

test("only a complete child run replaces prior passes; every attempt keeps intent, exits and same-run contracts", async () => {
  const target = await loadTarget();
  assert.ok(target.ok);
  const blueprint = target.blueprint;
  const ids = ["ret:doc.submit", "ret:doc.create"];
  const root = mkdtempSync(join(tmpdir(), "eval-run-"));
  try {
    // The real recorder and target loader run in child processes; only the score/evidence live in this temporary root.
    mkdirSync(join(root, "packages/evals/src"), { recursive: true });
    symlinkSync(join(import.meta.dirname, "record-status.ts"), join(root, "packages/evals/src/record-status.ts"));
    mkdirSync(join(root, "status"));
    const loaded = loadBindings([{
      source: "test.json", area: "test", script: "run.sh", worlds: ["main"], secrets: [], near: [],
      bindings: ids.map((id, i) => ({ eval: id, checks: [`B${i + 1}.done`], why: "public runner regression" })),
    }, {
      source: "other.json", area: "other", script: "other.sh", worlds: ["slice-zero"], secrets: [], near: [],
      bindings: [{ eval: "ret:doc.update", checks: ["B1.done"], why: "an unselected script must not constrain main" }],
    }], { evals: new Set([...ids, "ret:doc.update"]), scripts: new Map([["run.sh", parseScriptList("B1.done\tcheck\nB2.done\tcheck")], ["other.sh", parseScriptList("B1.done\tcheck")]]) });
    assert.ok(loaded.ok);
    const output = (name: string) => `printf '@check\\t${name}\\tpass\\t1\\tok\\n'`;
    const both = `${output("B1.done")}\n${output("B2.done")}`;
    for (const [script, complete, exit, signal] of [
      [both, true, 0, null], ["exit 0", false, 0, null],
      [output("B1.done"), false, 0, null], [`${both}\nexit 7`, false, 7, null],
      [`${both}\nkill -TERM $$`, false, null, "SIGTERM"],
      [`${both}\nprintf '@check\\tbroken\\n'`, false, 0, null],
      [`${both}\nprintf image > "$CAPXUL_EVAL_RUN_DIR/screen.png"\nprintf '[{"screen":"payment","path":"screen.png","source":"doctype:Payment Entry","assertion":"source-equality"}]' > "$CAPXUL_EVAL_RUN_DIR/screens.json"`, true, 0, null],
    ] as const) {
      writeFileSync(join(root, "status/status.json"), JSON.stringify({ version: 1, evals: Object.fromEntries(ids.map((id) => [id, { verdict: "pass", commit: "old", at: "2026-01-01T00:00:00Z" }])) }));
      writeFileSync(join(root, "run.sh"), script);
      const code = await executeRun(root, blueprint, loaded.value, ids, { world: "main", slug: "test" }, "abc1234", []);
      assert.equal(code, complete ? 0 : 1, script);
      const dirs = readdirSync(join(root, "status/runs")).sort();
      const dir = join(root, "status/runs", dirs.at(-1)!);
      const receipt = parseRunReceipt(JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8")));
      assert.ok(receipt.ok);
      assert.equal(receipt.value.state, complete ? "complete" : "incomplete");
      assert.deepEqual(receipt.value.requested, ids);
      assert.deepEqual(receipt.value.scripts, [{ script: "run.sh", exitCode: exit, signal }]);
      assert.deepEqual([...receipt.value.evals].sort((a, b) => a.id.localeCompare(b.id)), [...ids].sort().map((id) => ({ id, claim: blueprint.evals.find((e) => e.id === id)!.claim })));
      for (const file of [join(root, "status/status.json"), join(dir, "status.json")]) {
        const status = parseStatus(JSON.parse(readFileSync(file, "utf8")));
        assert.ok(status.ok);
        for (const id of ids) {
          assert.equal(status.value.evals[id]?.verdict, complete ? "pass" : "not_run");
          assert.equal(status.value.evals[id]?.run, receipt.value.id);
        }
      }
      assert.equal(receipt.value.screens.length, script.includes("screens.json") ? 1 : 0);
    }
    assert.equal(readdirSync(join(root, "status/runs")).length, 7, "same-second attempts never overwrite one another");
    // Equal names in two scripts cannot let one concept's output satisfy another concept's missing check.
    const split = loadBindings(ids.map((id, i) => ({
      source: `${i}.json`, area: `concept${i}`, script: `${i}.sh`, worlds: ["main"], secrets: [], near: [],
      bindings: [{ eval: id, checks: ["B1.done"], why: "only this script can prove this eval" }],
    })), { evals: new Set(ids), scripts: new Map([0, 1].map((i) => [`${i}.sh`, parseScriptList("B1.done\tcheck")])) });
    assert.ok(split.ok);
    writeFileSync(join(root, "0.sh"), output("B1.done"));
    writeFileSync(join(root, "1.sh"), "exit 0");
    assert.equal(await executeRun(root, blueprint, split.value, ids, { world: "main", slug: "test" }, "abc1234", []), 1);
    const status = parseStatus(JSON.parse(readFileSync(join(root, "status/status.json"), "utf8")));
    assert.ok(status.ok);
    assert.ok(ids.every((id) => status.value.evals[id]?.verdict === "not_run"));
    // Complete execution is not success when even one requested eval has no binding.
    assert.equal(await executeRun(root, blueprint, loaded.value, ["ret:record.export"], { world: "main", slug: "test" }, "abc1234", []), 1);
    const unbound = parseStatus(JSON.parse(readFileSync(join(root, "status/status.json"), "utf8")));
    assert.ok(unbound.ok);
    assert.equal(unbound.value.evals["ret:record.export"]?.verdict, "not_run");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

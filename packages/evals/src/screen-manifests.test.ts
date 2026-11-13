import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";
import { executeRun } from "./execute.ts";
import { loadBindings, parseScriptList } from "./modules/bindings/service.ts";

test("captures listed by two modules in one run both reach the receipt; a path listed twice fails the run", async () => {
  const target = await loadTarget();
  assert.ok(target.ok);
  const ids = ["ret:doc.submit"];
  const root = mkdtempSync(join(tmpdir(), "eval-manifests-"));
  try {
    mkdirSync(join(root, "packages/evals/src"), { recursive: true });
    symlinkSync(join(import.meta.dirname, "record-status.ts"), join(root, "packages/evals/src/record-status.ts"));
    mkdirSync(join(root, "status"));
    const loaded = loadBindings([{ source: "a.json", area: "a", script: "run.sh", worlds: ["main"], secrets: [], near: [],
      bindings: [{ eval: ids[0]!, checks: ["M1.done"], why: "manifest regression" }] }],
    { evals: new Set(ids), scripts: new Map([["run.sh", parseScriptList("M1.done\tcheck")]]) });
    assert.ok(loaded.ok);
    const entry = (screen: string, path: string) => `{"screen":"${screen}","path":"${path}","source":"sites/sources.json#/x","assertion":"source-equality"}`;
    // Acceptance writes the run-level file whole; Sites writes only its own module manifest, with run-relative paths.
    const script = (sites: string) => [
      "printf '@check\\tM1.done\\tpass\\t1\\tok\\n'",
      'mkdir -p "$CAPXUL_EVAL_RUN_DIR/acceptance" "$CAPXUL_EVAL_RUN_DIR/sites"',
      'printf png > "$CAPXUL_EVAL_RUN_DIR/acceptance/invoice.png"; printf png > "$CAPXUL_EVAL_RUN_DIR/sites/grants.png"',
      `printf '%s' '[${entry("supplier-invoice", "acceptance/invoice.png")}]' > "$CAPXUL_EVAL_RUN_DIR/screens.json"`,
      `printf '%s' '[${sites}]' > "$CAPXUL_EVAL_RUN_DIR/sites/screens.json"`,
    ].join("\n");
    for (const [sites, screens] of [
      [entry("hat-grants", "sites/grants.png"), ["supplier-invoice", "hat-grants"]],
      [entry("hat-grants", "acceptance/invoice.png"), null],
      [entry("hat-grants", "sites/missing.png"), null],
    ] as const) {
      writeFileSync(join(root, "run.sh"), script(sites));
      const code = await executeRun(root, target.blueprint, loaded.value, ids, { world: "main", slug: "test" }, "abc1234", []);
      const run = readdirSync(join(root, "status/runs")).sort().at(-1)!;
      const receipt = parseRunReceipt(JSON.parse(readFileSync(join(root, "status/runs", run, "receipt.json"), "utf8")));
      assert.ok(receipt.ok);
      assert.equal(code, screens ? 0 : 1, sites);
      assert.equal(receipt.value.state, screens ? "complete" : "incomplete", sites);
      assert.deepEqual(receipt.value.screens.map((s) => s.screen), screens ?? [], sites);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

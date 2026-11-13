import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";
import { executeRun } from "./execute.ts";
import { loadBindings, parseScriptList } from "./modules/bindings/service.ts";

test("each module lists only its own captures; duplicates, symlinked modules and mixed --screens fail collection", async () => {
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
    const entry = (screen: string, path: string, source = "sites/sources.json#/x") => `{"screen":"${screen}","path":"${path}","source":"${source}","assertion":"source-equality"}`;
    // Acceptance writes the run-level file whole; Sites writes only its own module manifest, with run-relative paths.
    const script = (sites: string, extra = "") => [
      "printf '@check\\tM1.done\\tpass\\t1\\tok\\n'",
      'mkdir -p "$CAPXUL_EVAL_RUN_DIR/acceptance" "$CAPXUL_EVAL_RUN_DIR/sites"',
      `printf '%s' '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==' | base64 -d > "$CAPXUL_EVAL_RUN_DIR/acceptance/invoice.png"; printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVQI12NoAAAAggCB3UNq9AAAAABJRU5ErkJggg==' | base64 -d > "$CAPXUL_EVAL_RUN_DIR/sites/grants.png"`,
      `printf '{"x":1}' > "$CAPXUL_EVAL_RUN_DIR/sites/sources.json"`,
      `printf '{"x":1}' > "$CAPXUL_EVAL_RUN_DIR/acceptance/sources.json"`,
      `printf '%s' '[${entry("supplier-invoice", "acceptance/invoice.png", "acceptance/sources.json#/x")}]' > "$CAPXUL_EVAL_RUN_DIR/screens.json"`,
      `printf '%s' '[${sites}]' > "$CAPXUL_EVAL_RUN_DIR/sites/screens.json"`,
      extra,
    ].join("\n");
    const grants = entry("hat-grants", "sites/grants.png");
    // [sites manifest entries, extra shell, --screens, collected paths or null when evidence collection must fail]
    for (const [sites, extra, screens, paths] of [
      [grants, "", undefined, ["acceptance/invoice.png", "sites/grants.png"]],
      [entry("hat-grants", "./sites/grants.png"), "", undefined, ["acceptance/invoice.png", "sites/grants.png"]],
      [entry("hat-grants", "acceptance/invoice.png"), "", undefined, null],
      [entry("hat-grants", "sites/grants.png", "acceptance/sources.json#/x"), "", undefined, null],
      [`${grants},${entry("hat-grants", "./sites/grants.png")}`, "", undefined, null],
      [entry("hat-grants", "sites/missing.png"), "", undefined, null],
      [grants, 'ln -s sites "$CAPXUL_EVAL_RUN_DIR/linked"', undefined, null],
      [grants, "", "sites-manifest.json", null],
    ] as const) {
      writeFileSync(join(root, "run.sh"), script(sites, extra));
      const label = `${sites} ${extra} ${screens ?? ""}`;
      const code = await executeRun(root, target.blueprint, loaded.value, ids, { world: "main", slug: "test", ...(screens ? { screens } : {}) }, "abc1234", []);
      const run = readdirSync(join(root, "status/runs")).sort().at(-1)!;
      const receipt = parseRunReceipt(JSON.parse(readFileSync(join(root, "status/runs", run, "receipt.json"), "utf8")));
      assert.ok(receipt.ok);
      assert.equal(code, paths ? 0 : 1, label);
      assert.equal(receipt.value.state, paths ? "complete" : "incomplete", label);
      assert.deepEqual(receipt.value.screens.map((s) => s.path), paths ?? [], label);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

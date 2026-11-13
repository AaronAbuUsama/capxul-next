// SYSTEM.imports.<concept> and SYSTEM.generated: one check per slice-zero sys claim (system.eval-system-checks).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRunReceipt, sliceZeroRequired } from "@capxul/blueprint-engine";
import { loadTarget } from "../../../../blueprint-engine/scripts/target.ts";
import { judgeGenerated, judgeImports, systemChecks, treeAt } from "./service.ts";

const target = await loadTarget();
assert(target.ok, "the blueprint must build");
const blueprint = target.blueprint;
const checks = systemChecks(blueprint, sliceZeroRequired(blueprint));
if (process.argv.includes("--list")) {
  for (const c of checks) console.log(`${c.name}\tcheck`);
} else {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]!.split(",") : null;
  const wanted = checks.filter((c) => !only || only.some((p) => c.name === p || c.name.startsWith(`${p}.`)));
  const reported = new Set<string>();
  const report = (name: string, pass: boolean, ms: number, detail: string): void => {
    reported.add(name);
    console.log(`@check\t${name}\t${pass ? "pass" : "fail"}\t${Math.ceil(ms)}\t${detail.replace(/\s+/g, " ").slice(0, 400)}`);
  };
  let failed = false;
  const start = performance.now();
  try {
    const run = process.env.CAPXUL_EVAL_RUN_DIR;
    assert(run, "a running receipt is required");
    const receipt = parseRunReceipt(JSON.parse(readFileSync(join(run, "receipt.json"), "utf8")));
    assert(receipt.ok && receipt.value.state === "running", "a running receipt is required");
    // The receipt's commit is the build under test; its files are read from git, never the working tree.
    const commit = receipt.value.commit, tree = treeAt(process.cwd(), commit);
    const dir = resolve(run, "system"); mkdirSync(dir, { recursive: true });
    for (const check of wanted) {
      const t = performance.now();
      const j = check.concept ? judgeImports(blueprint, check.concept, tree) : judgeGenerated(tree, commit);
      writeFileSync(join(dir, `${check.name}.json`), `${JSON.stringify({ eval: check.id, commit, ...j }, null, 2)}\n`);
      if (!j.pass) failed = true;
      report(check.name, j.pass, performance.now() - t, j.detail);
    }
  } catch (error) {
    const why = error instanceof assert.AssertionError ? error.message : "the receipt's commit could not be read";
    failed = true;
    for (const check of wanted.filter((c) => !reported.has(c.name))) report(check.name, false, performance.now() - start, `not checked: ${why}`);
  }
  process.exitCode = failed ? 1 : 0;
}

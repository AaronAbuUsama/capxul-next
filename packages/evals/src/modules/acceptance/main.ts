import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { alertIds, fixtureFrom } from "./fixture.ts";
import { proveAlerts } from "./alerts.ts";
import { readSources, reconcile } from "./sources.ts";
import { captureScreens } from "./screens.ts";
import { redact } from "../runs/service.ts";

export const checks = [
  "ACCEPT.selected-stack", "ACCEPT.money-reconciled", "ACCEPT.invoice-screen-source-equal",
  "ACCEPT.payment-screen-source-equal", "ACCEPT.ledger-screen-source-equal", "ACCEPT.balance-screen-source-equal", "ACCEPT.alerts-quiet-under-load",
  ...alertIds.flatMap((id) => [`ACCEPT.${id}-fires`, `ACCEPT.${id}-clears`]),
  "ACCEPT.payment-unchanged-after-faults",
];

if (process.argv.includes("--list")) {
  for (const name of checks) console.log(`${name}\tcheck`);
} else {
  const slug = process.argv[2];
  const path = process.env["CAPXUL_ACCEPTANCE_FIXTURE"];
  const run = process.env["CAPXUL_EVAL_RUN_DIR"];
  const secrets = Object.entries(process.env).filter(([key]) => /secret|password|private.?key|token|database_url/i.test(key)).flatMap(([, value]) => value ? [value] : []);
  const seen = new Set<string>();
  let failures = 0;
  const emit = async (name: string, check: () => Promise<void>): Promise<boolean> => {
    const start = Date.now();
    let detail = "source equality / expected alert transition established", passed = true;
    try { await check(); } catch (error) {
      passed = false; failures++;
      // Never print subprocess output, HTTP bodies, cookies, or fixture secrets.
      detail = error instanceof Error ? error.message.split("\n")[0]! : "acceptance check failed";
      detail = redact(detail, secrets);
    }
    seen.add(name);
    console.log(`@check\t${name}\t${passed ? "pass" : "fail"}\t${Date.now() - start}\t${detail.replace(/[\t\r\n]/g, " ").slice(0, 300)}`);
    return passed;
  };
  try {
    assert(slug && path && run, "requires slug, CAPXUL_ACCEPTANCE_FIXTURE and CAPXUL_EVAL_RUN_DIR from a required run");
    const f = fixtureFrom(path, slug);
    const dir = resolve(run, "acceptance"); mkdirSync(dir, { recursive: true });
    const selected = await emit("ACCEPT.selected-stack", async () => {
      const receipt = JSON.parse(readFileSync(join(run, "receipt.json"), "utf8"));
      assert.equal(receipt.environment.world, f.world);
      assert.equal(receipt.environment.stack, "postgres-ponder-erpnext-v4");
      assert.equal(receipt.environment.storage, "postgres"); assert.equal(receipt.environment.indexer, "ponder");
      const ready = await fetch(new URL("/ready", f.coreUrl), { signal: AbortSignal.timeout(10000) });
      assert(ready.ok, `Core database/schema/Ponder readiness returned HTTP ${ready.status}`);
    });
    if (!selected) throw new Error("selected-stack prerequisite failed");
    const sources = await readSources(f);
    writeFileSync(join(dir, "sources.json"), JSON.stringify(sources, null, 2) + "\n");
    const balanced = await emit("ACCEPT.money-reconciled", async () => reconcile(f, sources));
    if (!balanced) throw new Error("payment is not reconciled; screen and fault checks cannot accept it");
    await captureScreens(f, sources, dir, emit);
    await proveAlerts(f, emit, (stage, value) => appendFileSync(join(dir, "alerts.jsonl"), redact(JSON.stringify({ stage, ...value }), secrets) + "\n"));
    await emit("ACCEPT.payment-unchanged-after-faults", async () => {
      const after = await readSources(f); reconcile(f, after);
      const paymentRows = (ledger: typeof sources.ledger) => ledger.filter((r) => r.voucher_no === f.paymentEntry).sort((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(paymentRows(after.ledger), paymentRows(sources.ledger), "fault/replay changed the original payment posting");
      writeFileSync(join(dir, "after.json"), JSON.stringify(after, null, 2) + "\n");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0]! : "acceptance prerequisites failed";
    for (const name of checks.filter((c) => !seen.has(c))) await emit(name, async () => { throw new Error(message); });
  }
  // If a broken baseline stopped fault injection, omitted transitions are explicit failures, never old passes.
  for (const name of checks.filter((c) => !seen.has(c))) await emit(name, async () => { throw new Error("no valid baseline/seeded fault observation in this run"); });
  process.exitCode = failures ? 1 : 0;
}

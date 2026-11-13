// EVENTS.<operation>.<event>: one check per slice-zero evt claim (system.eval-event-checks).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRunReceipt, sliceZeroRequired } from "@capxul/blueprint-engine";
import { loadTarget } from "../../../../blueprint-engine/scripts/target.ts";
import { Database } from "../../../../backend/src/devnet/door.ts";
import { eventChecks, judgeEvent, readInvocations, type Envelope } from "./service.ts";

const target = await loadTarget();
assert(target.ok, "the blueprint must build");
const blueprint = target.blueprint;
const checks = eventChecks(blueprint, sliceZeroRequired(blueprint));
if (process.argv.includes("--list")) {
  for (const c of checks) console.log(`${c.name}\tcheck`);
} else {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]!.split(",") : null;
  const wanted = checks.filter((c) => !only || only.some((p) => c.name === p || c.name.startsWith(`${p}.`)));
  // Every requested check is reported, pass or an explicit fail with its reason, so the plan always completes.
  const reported = new Set<string>();
  const report = (name: string, pass: boolean, ms: number, detail: string): void => {
    reported.add(name);
    console.log(`@check\t${name}\t${pass ? "pass" : "fail"}\t${Math.ceil(ms)}\t${detail.replace(/\s+/g, " ")}`);
  };
  let failed = false, db: Database | undefined;
  const start = performance.now();
  try {
    const run = process.env.CAPXUL_EVAL_RUN_DIR, configPath = process.env.CAPXUL_WORLD_CONFIG;
    assert(run && configPath, "running receipt and private world config required");
    const receipt = parseRunReceipt(JSON.parse(readFileSync(join(run, "receipt.json"), "utf8")));
    assert(receipt.ok && receipt.value.state === "running", "a running receipt is required");
    const r = receipt.value;
    assert(r.environment.world === "slice-zero" && r.environment.stack === "postgres-ponder-erpnext-v4" &&
      r.environment.storage === "postgres" && r.environment.indexer === "ponder", "selected stack required");
    const c = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(r.commit, c.codeVersion, "receipt commit differs from the world's code");
    const url = (key: "tenant" | "worker", role: string): string => {
      const value = new URL(c.database[key]);
      assert.equal(decodeURIComponent(value.username), role);
      assert(["localhost", "127.0.0.1", "[::1]"].includes(value.hostname));
      value.pathname = `/${c.world.database}`; return value.href;
    };
    db = new Database(url("tenant", "capxul_core"), url("worker", "capxul_worker"));
    const identity = (await db.worker.query("select world_id,epoch from app.world")).rows[0];
    assert(identity?.world_id === c.world.id && Number(identity.epoch) === c.world.epoch, "the database is not this run's world");
    const role = (await db.worker.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
    assert(role && !role.rolsuper && !role.rolbypassrls, "the worker role must be restricted");
    const { invocations, errors } = readInvocations(run, Date.parse(r.at), r.id);
    const traces = [...new Set(invocations.map((i) => i.trace_id))];
    const outbox = (await db.worker.query("select event from app.transition_outbox where event->>'trace_id' = any($1::text[]) order by seq", [traces])).rows
      .map((row: { event: Envelope }) => row.event);
    const dir = resolve(run, "events"); mkdirSync(dir, { recursive: true });
    for (const check of wanted) {
      const t = performance.now(), j = judgeEvent(blueprint, check, invocations, outbox, errors);
      writeFileSync(join(dir, `${check.operation}-${check.event}.json`), `${JSON.stringify({ eval: check.id, logErrors: errors, ...j }, null, 2)}\n`);
      if (!j.pass) failed = true;
      report(check.name, j.pass, performance.now() - t, j.detail.slice(0, 400));
    }
  } catch (error) {
    // No connection URL or driver text: name the failed precondition only.
    const why = error instanceof assert.AssertionError ? error.message : "the run's world could not be read";
    failed = true;
    for (const check of wanted.filter((c) => !reported.has(c.name))) report(check.name, false, performance.now() - start, `not checked: ${why}`);
  } finally { await db?.close(); }
  process.exitCode = failed ? 1 : 0;
}

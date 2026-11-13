import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { Database } from "../../../../backend/src/devnet/door.ts";
import { fixtureFrom } from "../acceptance/fixture.ts";
import { constraints, crossOwner, schema, tenancy, writerAcl } from "./tables.ts";
import { driveResume, idempotent, idempotentChecks, resumed, resumeChecks } from "./workflows.ts";

const checks = ["ACTIVITY.selected-stack", "ACTIVITY.schema", "ACTIVITY.constraints", "ACTIVITY.tenancy", "ACTIVITY.cross-owner",
  "ACTIVITY.writer-acl", ...resumeChecks.map(([, name]) => name), ...idempotentChecks.map(([, name]) => name)];
if (process.argv.includes("--list")) {
  for (const name of checks) console.log(`${name}\tcheck`);
} else {
  const seen = new Set<string>(); let failed = false;
  const emit = async (name: string, check: () => Promise<void>) => {
    const start = performance.now(); let passed = true;
    try { await check(); } catch { passed = false; failed = true; }
    // Do not expose a driver error, HTTP response body, private config, or connection URL.
    console.log(`@check\t${name}\t${passed ? "pass" : "fail"}\t${Math.ceil(performance.now() - start)}\t${passed ? "live selected-world assertion retained" : "live assertion failed; no component evidence substituted"}`);
    seen.add(name); return passed;
  };
  let db: Database | undefined;
  try {
    const run = process.env.CAPXUL_EVAL_RUN_DIR, configPath = process.env.CAPXUL_WORLD_CONFIG;
    const fixturePath = process.env.CAPXUL_ACCEPTANCE_FIXTURE, slug = process.argv[2];
    assert(run && configPath && fixturePath && slug, "running receipt, private world config and fixture required");
    const fixture = fixtureFrom(fixturePath, slug);
    const dir = resolve(run, "activity"); mkdirSync(dir, { recursive: true });
    const c = JSON.parse(readFileSync(configPath, "utf8"));
    const rawReceipt = JSON.parse(readFileSync(join(run, "receipt.json"), "utf8"));
    const parsed = parseRunReceipt(rawReceipt); assert(parsed.ok);
    const receipt = parsed.value;
    const selected = await emit("ACTIVITY.selected-stack", async () => {
      assert.equal(receipt.state, "running"); assert.equal(receipt.environment.world, "slice-zero");
      assert.equal(fixture.world, "slice-zero"); assert.notEqual(c.world.id, "main");
      assert.equal(receipt.environment.storage, "postgres"); assert.equal(receipt.environment.indexer, "ponder");
      assert.equal(receipt.environment.stack, "postgres-ponder-erpnext-v4");
      assert.equal(receipt.commit, c.codeVersion);
      assert.equal(receipt.commit, execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
      assert(Date.parse(receipt.at) <= Date.now());
      const inspection = JSON.parse(execFileSync("pnpm", ["--silent", "capxul", "world", "inspect", "--config", configPath, "--json"], {
        encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"],
      }));
      assert.equal(inspection.codeVersion, receipt.commit); assert.equal(inspection.world.id, c.world.id);
      assert.equal(inspection.world.epoch, c.world.epoch); assert.equal(inspection.core.world, c.world.id);
      assert.equal(inspection.stack, "postgres-ponder-erpnext-v4");
      const url = (key: "tenant" | "worker", role: string) => {
        const value = new URL(c.database[key]);
        assert.equal(decodeURIComponent(value.username), role);
        assert(["localhost", "127.0.0.1", "[::1]"].includes(value.hostname));
        value.pathname = `/${c.world.database}`; return value.href;
      };
      db = new Database(url("tenant", "capxul_core"), url("worker", "capxul_worker"));
      const identity = (await db.worker.query("select world_id,epoch from app.world")).rows[0];
      assert.equal(identity.world_id, c.world.id); assert.equal(Number(identity.epoch), c.world.epoch);
      for (const [pool, name] of [[db.tenant, "capxul_core"], [db.worker, "capxul_worker"]] as const) {
        const role = (await pool.query("select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
        assert.deepEqual(role, { name, rolsuper: false, rolbypassrls: false });
      }
      writeFileSync(join(dir, "selected.json"), JSON.stringify({ run: receipt.id, commit: receipt.commit, world: inspection.world, observedAt: inspection.observedAt }) + "\n");
    });
    assert(selected && db);
    const database = db;
    await emit("ACTIVITY.schema", () => schema(database, dir));
    await emit("ACTIVITY.constraints", () => constraints(database, dir, receipt.id));
    let feeds: Awaited<ReturnType<typeof tenancy>> | undefined;
    await emit("ACTIVITY.tenancy", async () => { feeds = await tenancy(database, dir); });
    await emit("ACTIVITY.cross-owner", async () => { assert(feeds); await crossOwner(database, dir, feeds); });
    await emit("ACTIVITY.writer-acl", () => writerAcl(database, dir));
    // Resume first: each drives one more real in-run transition that the idempotency samples then include.
    for (const [transition, name] of resumeChecks) await emit(name, async () => resumed(database, dir, transition, await driveResume(database, configPath, transition)));
    for (const [transition, name] of idempotentChecks) await emit(name, () => idempotent(database, dir, transition, receipt.at));
  } catch { failed = true; }
  finally { await db?.close(); }
  for (const name of checks.filter((name) => !seen.has(name))) await emit(name, async () => { throw new Error("prerequisite failed"); });
  process.exitCode = failed ? 1 : 0;
}

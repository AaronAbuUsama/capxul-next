import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { Database } from "../../../../backend/src/devnet/door.ts";
import { createFrappeSite } from "../../../../backend/src/plugs/door.ts";
import { readConfig, databaseUrl } from "../../../../devnet/src/devnet/door.ts";
import { fixtureFrom, localUrl } from "../acceptance/fixture.ts";

const checks = ["PLUGS.selected-stack", "PLUGS.native-release-map", "PLUGS.native-site", "PLUGS.saved-answers"];
if (process.argv.includes("--list")) {
  for (const name of checks) console.log(`${name}\tcheck`);
} else {
  const seen = new Set<string>(); let failed = false;
  const emit = async (name: string, check: () => Promise<void>) => {
    const start = performance.now(); let passed = true;
    try { await check(); } catch { passed = false; failed = true; }
    // Provider/driver/subprocess errors can contain secrets or document bodies.
    console.log(`@check\t${name}\t${passed ? "pass" : "fail"}\t${Math.ceil(performance.now() - start)}\t${passed ? "selected-world observation retained; not lifecycle acceptance" : "selected-world assertion failed; no component evidence substituted"}`);
    seen.add(name); return passed;
  };
  let db: Database | undefined;
  try {
    const run = process.env.CAPXUL_EVAL_RUN_DIR, config = process.env.CAPXUL_WORLD_CONFIG;
    const fixture = process.env.CAPXUL_ACCEPTANCE_FIXTURE, slug = process.argv[2];
    assert(run && config && fixture && slug);
    const parsed = parseRunReceipt(JSON.parse(readFileSync(join(run, "receipt.json"), "utf8")));
    assert(parsed.ok);
    const receipt = parsed.value;
    // Refuse an old/finalized receipt before reading credentials or making any external call.
    assert.equal(receipt.state, "running"); assert.equal(receipt.environment.world, "slice-zero");
    assert.equal(receipt.environment.stack, "postgres-ponder-erpnext-v4");
    assert.equal(receipt.environment.storage, "postgres"); assert.equal(receipt.environment.indexer, "ponder");
    assert(Date.parse(receipt.at) <= Date.now());
    assert.equal(receipt.commit, execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
    const c = await readConfig(config), f = fixtureFrom(fixture, slug);
    assert.equal(receipt.commit, c.codeVersion); assert.equal(f.world, receipt.environment.world);
    assert.notEqual(c.world.id, "main");
    assert.equal(new URL(f.coreUrl).port, String(c.ports.publicCore));
    assert.equal(new URL(f.rpcUrl).port, String(c.ports.publicRpc));
    assert.equal(new URL(f.frappeUrl).port, String(c.ports.publicBench));
    localUrl(f.frappeUrl);
    const dir = resolve(run, "plugs"); mkdirSync(dir, { recursive: true });
    const selected = await emit("PLUGS.selected-stack", async () => {
      const inspection = JSON.parse(execFileSync("pnpm", ["--silent", "capxul", "world", "inspect", "--config", config, "--json"], {
        encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"],
      }));
      assert.equal(inspection.codeVersion, receipt.commit); assert.equal(inspection.stack, receipt.environment.stack);
      assert.equal(inspection.world.id, c.world.id); assert.equal(inspection.world.epoch, c.world.epoch);
      assert.equal(inspection.core.world, c.world.id);
      db = new Database(databaseUrl(c.database.tenant, c.world), databaseUrl(c.database.worker, c.world));
      const identity = (await db.worker.query("select world_id,epoch from app.world")).rows;
      assert.equal(identity.length, 1); assert.equal(identity[0].world_id, c.world.id);
      assert.equal(Number(identity[0].epoch), c.world.epoch);
      for (const [pool, name] of [[db.tenant, "capxul_core"], [db.worker, "capxul_worker"]] as const) {
        assert.deepEqual((await pool.query("select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows,
          [{ name, rolsuper: false, rolbypassrls: false }]);
      }
      const company = (await db.worker.query("select site,released from app.organizations where org_id=$1", [slug])).rows;
      assert.equal(company.length, 1); assert.equal(company[0].site, f.site); assert.equal(company[0].released, true);
      writeFileSync(join(dir, "selected.json"), JSON.stringify({ run: receipt.id, commit: receipt.commit, world: c.world.id, epoch: c.world.epoch }) + "\n");
    });
    assert(selected && db);
    const site = createFrappeSite({ baseUrl: f.frappeUrl, secret: c.secret });
    const input = { orgId: slug, site: f.site };
    let version: string | undefined;
    await emit("PLUGS.native-release-map", async () => {
      const map = await Effect.runPromise(site.readHatMap(input));
      version = map.map_version;
      writeFileSync(join(dir, "release-map.json"), JSON.stringify(map) + "\n");
    });
    await emit("PLUGS.native-site", async () => {
      const observed = await Effect.runPromise(site.readSite(input));
      assert(version); assert.equal(observed.map_version, version); assert.equal(observed.company, f.company);
      assert.equal(observed.sign_in.mode, "assertion"); assert.equal(observed.sign_in.configured, true);
      assert.deepEqual(observed.features, { accounts: "on", people: "on", projects: "on", crm: "on", payroll: "off",
        whatsapp: "off", attendance: "off", recruitment: "off", reviews: "off", stock: "off", manufacturing: "off" });
      for (const app of ["frappe", "erpnext", "hrms", "crm", "frappe_whatsapp", "capxul"]) assert(observed.apps.includes(app));
      writeFileSync(join(dir, "site.json"), JSON.stringify(observed) + "\n");
    });
    const database = db;
    await emit("PLUGS.saved-answers", async () => {
      // Inspect committed answers only. Never answer/prepare/retry a request or inject a native grant here.
      const rows = (await database.worker.query(`select s.request_id,s.request,s.answer,a.id,a.trace
        from app.site_request_answers s left join app.approvals a on a.org_id=s.org_id and a.request_id=s.request_id
        where s.org_id=$1 order by s.request_id`, [slug])).rows;
      assert(rows.length > 0);
      let after = 0; const native = new Map<string, Record<string, unknown>>();
      for (;;) {
        const page = await Effect.runPromise(site.collectPaymentRequests({ ...input, after, limit: 100 }));
        for (const request of page.requests) native.set(request.request_id, request);
        after = page.cursor;
        if (page.requests.length < 100) break;
      }
      let accepted = 0, refused = 0;
      for (const row of rows) {
        const request = native.get(row.request_id); assert(request);
        const { trace_id, idempotency_key, cursor, department, ...terms } = request;
        assert.deepEqual(row.request, { ...terms, ...(department ? { department } : {}) });
        assert.equal(idempotency_key, row.request_id);
        assert.equal(row.answer.org, slug); assert.equal(row.answer.request_id, row.request_id);
        if (row.answer.error) {
          assert.equal(typeof row.answer.error.code, "string"); assert.equal(typeof row.answer.error.message, "string");
          assert.equal(row.id, null); refused++;
        } else {
          assert.equal(row.answer.approval_id, row.id); assert.equal(row.answer.requested_by, request.requested_by);
          assert.equal(row.trace, trace_id); assert(/^[0-9a-f]{32}$/.test(String(trace_id)));
          const approval = new URL(row.answer.approval_url); assert.equal(approval.origin, new URL(f.coreUrl).origin);
          assert.equal(approval.pathname, `/approve/${row.id}`); accepted++;
        }
      }
      assert(accepted > 0);
      // No request bodies, emails, approval URLs, configuration or secrets in retained evidence.
      writeFileSync(join(dir, "answers.json"), JSON.stringify({ checked: rows.length, accepted, refused }) + "\n");
    });
  } catch { failed = true; }
  finally { await db?.close(); }
  for (const name of checks.filter((name) => !seen.has(name))) await emit(name, async () => { throw new Error("prerequisite failed"); });
  process.exitCode = failed ? 1 : 0;
}

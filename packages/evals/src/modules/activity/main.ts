import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { Database } from "../../../../backend/src/devnet/door.ts";
import { fixtureFrom } from "../acceptance/fixture.ts";

const checks = ["ACTIVITY.selected-stack", "ACTIVITY.schema", "ACTIVITY.tenancy", "ACTIVITY.writer-acl"];
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
    await emit("ACTIVITY.schema", async () => {
      const columns = (await database.worker.query(`select column_name,data_type,is_nullable from information_schema.columns
        where table_schema='app' and table_name='activity_changes' order by ordinal_position`)).rows;
      assert.deepEqual(columns, [
        ["owner_id", "text", "NO"], ["owner_kind", "text", "NO"], ["seq", "bigint", "NO"],
        ["row_kind", "text", "NO"], ["row_id", "text", "NO"], ["change", "text", "NO"],
        ["transition", "text", "NO"], ["from", "text", "YES"], ["to", "text", "NO"],
        ["event_id", "text", "NO"], ["changed_at", "double precision", "NO"],
      ].map(([column_name, data_type, is_nullable]) => ({ column_name, data_type, is_nullable })));
      const indexes = (await database.worker.query(`select i.indisprimary as primary,i.indisunique as unique,
        array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,n)
          join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum order by k.n) as fields
        from pg_index i where i.indrelid='app.activity_changes'::regclass order by i.indisprimary desc,i.indisunique`)).rows;
      assert.deepEqual(indexes, [
        { primary: true, unique: true, fields: ["owner_id", "owner_kind", "seq"] },
        { primary: false, unique: false, fields: ["owner_id", "owner_kind", "row_kind", "row_id", "seq"] },
        { primary: false, unique: true, fields: ["owner_id", "owner_kind", "event_id"] },
      ]);
      writeFileSync(join(dir, "schema.json"), JSON.stringify({ columns, indexes }) + "\n");
    });
    await emit("ACTIVITY.tenancy", async () => {
      const rls = (await database.worker.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='app.activity_changes'::regclass")).rows[0];
      assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
      const observer = await database.worker.connect();
      try {
        // Compare roles at one actual MVCC cut, even if the background relay appends during inspection.
        await observer.query("begin isolation level repeatable read read only");
        const snapshot = (await observer.query("select pg_export_snapshot() as snapshot")).rows[0].snapshot as string;
        assert(/^[0-9A-F-]+$/.test(snapshot));
        const all = (await observer.query("select * from app.activity_changes order by owner_kind,owner_id,seq")).rows;
        const feeds = [...new Map(all.map((r) => [JSON.stringify([r.owner_kind, r.owner_id]), r])).values()];
        assert(feeds.length >= 2 && feeds.some((r) => r.owner_kind === "person") && feeds.some((r) => r.owner_kind === "organization"));
        const evidence = [];
        for (const feed of feeds) {
          const client = await database.tenant.connect();
          try {
            await client.query("begin isolation level repeatable read read only");
            await client.query(`set transaction snapshot '${snapshot}'`);
            await client.query("select set_config('app.owner_kind',$1,true),set_config('app.owner_id',$2,true)", [feed.owner_kind, feed.owner_id]);
            const actual = (await client.query("select * from app.activity_changes order by owner_kind,owner_id,seq")).rows;
            assert.deepEqual(actual, all.filter((r) => r.owner_kind === feed.owner_kind && r.owner_id === feed.owner_id));
            await client.query("commit");
            assert.equal((await client.query("select * from app.activity_changes")).rowCount, 0);
            evidence.push({ owner_kind: feed.owner_kind, owner_id: feed.owner_id, rows: actual.length });
          } finally { await client.query("rollback"); client.release(); }
        }
        writeFileSync(join(dir, "tenancy.json"), JSON.stringify(evidence) + "\n");
      } finally { await observer.query("rollback"); observer.release(); }
    });
    await emit("ACTIVITY.writer-acl", async () => {
      const privileges = (await database.worker.query(`select r as role,
        has_table_privilege(r,'app.activity_changes','SELECT') as read,
        has_table_privilege(r,'app.activity_changes','INSERT') as insert,
        has_table_privilege(r,'app.activity_changes','UPDATE') as update,
        has_table_privilege(r,'app.activity_changes','DELETE') as delete,
        has_table_privilege(r,'app.activity_changes','TRUNCATE') as truncate
        from unnest(array['capxul_core','capxul_worker','capxul_ponder']) r order by r`)).rows;
      assert.deepEqual(privileges, [
        { role: "capxul_core", read: true, insert: false, update: false, delete: false, truncate: false },
        { role: "capxul_ponder", read: false, insert: false, update: false, delete: false, truncate: false },
        { role: "capxul_worker", read: true, insert: true, update: false, delete: false, truncate: false },
      ]);
      writeFileSync(join(dir, "writer-acl.json"), JSON.stringify(privileges) + "\n");
    });
  } catch { failed = true; }
  finally { await db?.close(); }
  for (const name of checks.filter((name) => !seen.has(name))) await emit(name, async () => { throw new Error("prerequisite failed"); });
  process.exitCode = failed ? 1 : 0;
}

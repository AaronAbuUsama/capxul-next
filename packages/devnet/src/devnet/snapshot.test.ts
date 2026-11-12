import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { composeBench, psqlAdmin, readSnapshot, restoreSnapshot, saveSnapshot, type Options, type Runtime, type World } from "./door.ts";

const maintenance = process.env.WORLD_SNAPSHOT_PG;
test("whole database cut restores independently, fences failures and retains abandoned state", { skip: !maintenance }, async () => {
  const prefix = `test_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const sourceDb = `${prefix}_source`, restoredDb = `${prefix}_restored`, role = `${prefix}_tenant`, ponder = `${prefix}_ponder`;
  const execute = psqlAdmin(maintenance!), owned = new Set<string>();
  const admin = async (sql: string) => {
    const rows = await execute(sql);
    const created = /^CREATE DATABASE "([^"]+)"/.exec(sql);
    if (created) owned.add(created[1]!);
    const renamed = /^ALTER DATABASE "([^"]+)" RENAME TO "([^"]+)"/.exec(sql);
    if (renamed) { owned.delete(renamed[1]!); owned.add(renamed[2]!); }
    const dropped = /^DROP DATABASE "([^"]+)"/.exec(sql);
    if (dropped) owned.delete(dropped[1]!);
    return rows;
  };
  const query = (database: string, sql: string) => {
    const url = new URL(maintenance!); url.pathname = `/${database}`;
    return psqlAdmin(url.toString())(sql);
  };
  const dir = await mkdtemp(join(tmpdir(), "capxul-snapshot-"));
  const source: World = { id: "source", kind: "simulated", database: sourceDb, stateDir: join(dir, "source"), epoch: 7,
    sites: [{ company: "harbourline", name: "harbourline-source.localhost" }] };
  const target: World = { ...source, id: "restored", database: restoredDb, stateDir: join(dir, "restored"), epoch: 1,
    sites: [{ company: "harbourline", name: "harbourline-restored.localhost" }] };
  const paused = new Set<string>(), resumed = new Map<string, number>();
  let failBackup = false, failRestore = false, sourceRunning = true;
  const runtime: Runtime = {
    async running() { return sourceRunning; },
    async quiesce(w) { paused.add(w.id); if (!sourceRunning) return;
      return { nowMs: 1772442000000, clockMode: "stopped", rate: 1, recordSeq: 8, recordHead: "a".repeat(64), heads: [{ org_id: "harbourline", id: 8, hash: "b".repeat(64) }] }; },
    async backup(site, directory) {
      assert(paused.has("source"));
      if (failBackup) throw new Error("seeded backup fault");
      await writeFile(join(directory, "database.sql.gz"), "MariaDB cut: 125.50 settled");
      await writeFile(join(directory, "site_config.json"), JSON.stringify({ site: site.name, encryption_key: "test-key" }));
      await writeFile(join(directory, "private.tar"), "invoice file");
    },
    async restore(site, directory) {
      if (failRestore) throw new Error("seeded site restore fault");
      assert.equal(await readFile(join(directory, "database.sql.gz"), "utf8"), "MariaDB cut: 125.50 settled");
    },
    async rewrite(w, manifest, abandoned) {
      assert(paused.has(w.id));
      assert.equal(manifest.cut.recordSeq, 8);
      const [row] = await query(w.database, "SELECT row_to_json(t) FROM app.payment t WHERE company='harbourline'");
      assert.equal(row!.amount, 125.5);
      if (w.id === "source") {
        assert.equal(w.epoch, 8);
        assert(abandoned);
        await admin(`ALTER DATABASE "${abandoned}" ALLOW_CONNECTIONS true`);
        const [branch] = await query(abandoned, "SELECT row_to_json(t) FROM app.payment t WHERE company='harbourline'");
        assert.equal(branch!.amount, 999);
        await admin(`ALTER DATABASE "${abandoned}" ALLOW_CONNECTIONS false`);
      }
    },
    async resume(w) { if (w.id === source.id) sourceRunning = true; paused.delete(w.id); resumed.set(w.id, (resumed.get(w.id) ?? 0) + 1); },
    async hold(w) { paused.add(w.id); },
  };
  const options: Options = { root: join(dir, "snapshots"), codeVersion: "fixture-v1", admin, runtime };
  try {
    await admin(`CREATE ROLE "${role}"`);
    await admin(`CREATE ROLE "${ponder}"`);
    await admin(`CREATE DATABASE "${sourceDb}"`);
    await admin(`REVOKE ALL ON DATABASE "${sourceDb}" FROM PUBLIC; GRANT CONNECT ON DATABASE "${sourceDb}" TO "${role}";
      GRANT CONNECT, CREATE ON DATABASE "${sourceDb}" TO "${ponder}"`);
    await query(sourceDb, `CREATE SCHEMA app; CREATE SCHEMA ponder; CREATE SCHEMA devnet;
      CREATE TABLE app.payment(company text, amount numeric(14,2), ack bigint);
      INSERT INTO app.payment VALUES ('harbourline',125.50,42),('otherco',19.25,3);
      ALTER TABLE app.payment ENABLE ROW LEVEL SECURITY;
      CREATE POLICY company ON app.payment USING (company=current_setting('app.company',true));
      GRANT USAGE ON SCHEMA app TO "${role}"; GRANT SELECT ON app.payment TO "${role}";
      CREATE TABLE ponder.checkpoint(height bigint); INSERT INTO ponder.checkpoint VALUES(8701);
      CREATE TABLE devnet.faults(armed boolean); INSERT INTO devnet.faults VALUES(false)`);
    await mkdir(source.stateDir);
    // Larger than last night's 11,414,278-byte RPC response; disk transport has no RPC-size ceiling.
    await writeFile(join(source.stateDir, "anvil-state.json"), Buffer.alloc(12 * 1024 * 1024, 0x61));
    await writeFile(join(source.stateDir, "deployment.json"), '{"chainId":84532}');
    await mkdir(join(source.stateDir, "site-service"));
    const intent = { org: "harbourline", name: "Harbour Line", safe: "0x1234", adminEmail: "admin@harbourline.test", world: source.id, site: source.sites[0]!.name };
    await writeFile(join(source.stateDir, "site-service", `${intent.site}.json`), JSON.stringify(intent));
    const manifest = await saveSnapshot(options, source, "paid");
    assert.equal(manifest.files["state/anvil-state.json"]!.bytes, 12582912);
    assert.equal(paused.size, 0);
    await assert.rejects(saveSnapshot(options, source, "paid"));
    sourceRunning = false;
    await assert.rejects(saveSnapshot(options, source, "stopped"), /source world must be running/);
    assert.equal(await runtime.running(source), false, "refused save must not activate a stopped world");
    assert.equal(paused.size, 0);
    assert(!(await readdir(options.root)).includes("stopped"));
    sourceRunning = true;
    await query(sourceDb, "UPDATE app.payment SET amount=999 WHERE company='harbourline'; UPDATE ponder.checkpoint SET height=9000");
    await restoreSnapshot(options, "paid", target);
    const [payment] = await query(restoredDb, "SELECT row_to_json(p) FROM app.payment p WHERE company='harbourline'");
    assert.deepEqual(payment, { company: "harbourline", amount: 125.5, ack: 42 });
    const [checkpoint] = await query(restoredDb, "SELECT row_to_json(c) FROM ponder.checkpoint c");
    assert.equal(checkpoint!.height, 8701);
    const [fault] = await query(restoredDb, "SELECT row_to_json(f) FROM devnet.faults f");
    assert.equal(fault!.armed, false);
    const [visible] = await query(restoredDb, `SET ROLE "${role}"; SET app.company='harbourline'; SELECT row_to_json(t) FROM (SELECT count(*)::int AS n FROM app.payment) t`);
    assert.equal(visible!.n, 1, "RLS and table grants survive clone");
    const [acl] = await admin(`SELECT row_to_json(t) FROM (SELECT has_database_privilege('${role}','${restoredDb}','CONNECT') AS connects, has_database_privilege('${role}','${restoredDb}','CREATE') AS creates) t`);
    assert.deepEqual(acl, { connects: true, creates: false });
    await query(restoredDb, `SET ROLE "${ponder}"; CREATE SCHEMA IF NOT EXISTS ponder`);
    await query(restoredDb, "UPDATE app.payment SET amount=17 WHERE company='harbourline'");
    const [unchanged] = await query(sourceDb, "SELECT row_to_json(p) FROM app.payment p WHERE company='harbourline'");
    assert.equal(unchanged!.amount, 999);
    assert.equal((await readFile(join(target.stateDir, "anvil-state.json"))).length, 12582912);
    const restoredIntent = JSON.parse(await readFile(join(target.stateDir, "site-service", `${target.sites[0]!.name}.json`), "utf8"));
    assert.deepEqual(restoredIntent, { ...intent, world: target.id, site: target.sites[0]!.name });
    assert.deepEqual(await readdir(join(target.stateDir, "site-service")), [`${target.sites[0]!.name}.json`]);
    await writeFile(join(source.stateDir, "site-service", "abandoned.json"), "post-cut intent");
    await restoreSnapshot(options, "paid", source);
    assert.equal((await query(sourceDb, "SELECT row_to_json(p) FROM app.payment p WHERE company='harbourline'"))[0]!.amount, 125.5);
    assert.deepEqual(await readdir(join(source.stateDir, "site-service")), [`${intent.site}.json`]);
    assert.deepEqual(JSON.parse(await readFile(join(source.stateDir, "site-service", `${intent.site}.json`), "utf8")), intent);
    assert.equal(resumed.get("source"), 2);

    failBackup = true;
    await assert.rejects(saveSnapshot(options, source, "broken"), /seeded backup fault/);
    assert.equal(paused.size, 0, "failed save resumes source");
    assert(!(await readdir(options.root)).includes("broken"));
    failBackup = false;
    await assert.rejects(readSnapshot({ ...options, codeVersion: "changed" }, "paid"), /version/);
    await assert.rejects(restoreSnapshot(options, "paid", { ...target, sites: [] }), /every company/);
    await assert.rejects(restoreSnapshot(options, "paid", { ...target, stateDir: source.stateDir }), /own database, directory and sites/);
    await assert.rejects(restoreSnapshot(options, "paid", { ...target, sites: source.sites }), /own database, directory and sites/);
    await writeFile(join(options.root, "paid", "sites", "harbourline", "private.tar"), "tampered file");
    const starts = resumed.get("restored");
    await assert.rejects(restoreSnapshot(options, "paid", target), /SHA-256/);
    assert.equal(resumed.get("restored"), starts, "corruption refuses before target stop/start");
    await writeFile(join(options.root, "paid", "sites", "harbourline", "private.tar"), "invoice file");
    failRestore = true;
    const failedTarget = { ...target, id: "failed", database: `${prefix}_failed`, stateDir: join(dir, "failed"), sites: [{ company: "harbourline", name: "failed.localhost" }] };
    await assert.rejects(restoreSnapshot(options, "paid", failedTarget), /seeded site restore fault/);
    assert(paused.has("failed"));
    assert.equal(resumed.get("failed"), undefined, "failed restore never serves a mixed cut");
    assert((await readdir(failedTarget.stateDir)).includes("restore-pending.json"));
  } finally {
    for (const db of owned) await admin(`DROP DATABASE "${db}" WITH (FORCE)`);
    await admin(`DROP ROLE IF EXISTS "${role}"`);
    await admin(`DROP ROLE IF EXISTS "${ponder}"`);
    await rm(dir, { recursive: true, force: true });
  }
});

// Run as a host UID other than frappe's 1000, against an already configured disposable production bench/site.
const nativeBench = process.env.WORLD_SNAPSHOT_BENCH;
test("native site backup crosses the host UID boundary without exposing archives", { skip: !nativeBench }, async () => {
  assert.notEqual(process.getuid!(), 1000, "run this control as root or another non-frappe host UID");
  const { composeArgs, site } = JSON.parse(nativeBench!) as { composeArgs: string[]; site: string };
  const bench = composeBench(composeArgs);
  const root = await mkdtemp(join(tmpdir(), "capxul-native-backup-"));
  const directory = join(root, "site");
  await mkdir(directory, { mode: 0o755 });
  try {
    await bench.pause();
    await bench.backup({ company: "harbourline", name: site }, directory);
    const files = await readdir(directory);
    assert(files.some((file) => file.endsWith("-database.sql.gz") || file.endsWith("-database-enc.sql.gz")));
    assert(files.some((file) => file.endsWith("-files.tar") || file.endsWith("-files-enc.tar")));
    assert(files.some((file) => file.endsWith("-private-files.tar") || file.endsWith("-private-files-enc.tar")));
    assert(JSON.parse(await readFile(join(directory, "original-site-config.json"), "utf8")).encryption_key);
    for (const file of [directory, ...files.map((file) => join(directory, file))]) {
      const info = await stat(file);
      assert.equal(info.uid, process.getuid!(), "the host caller must retain archive ownership");
      assert.equal(info.mode & 0o077, 0, "no group/other access to keys or archives");
      assert(info.isDirectory() || (await readFile(file)).length > 0);
    }
    await bench.resume();
    const output = execFileSync("docker", ["compose", ...composeArgs, "ps", "--all", "--format", "json"], { encoding: "utf8" });
    const rows = (output.trim().startsWith("[") ? JSON.parse(output) : output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))) as { Service: string; State: string; Health: string }[];
    for (const service of ["backend", "websocket", "queue-short", "queue-long", "scheduler", "frontend"]) {
      const row = rows.find((row) => row.Service === service);
      assert.equal(row?.State, "running", `${service} must be running when resume returns`);
      assert.equal(row?.Health, "healthy", `${service} must be healthy when resume returns`);
    }
    assert.equal(bench.ownsPause(), false);
  } finally {
    if (bench.ownsPause()) await bench.resume();
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import pg from "pg";
import { Database } from "../src/platform/db.ts";
import { deliver, enqueue, signature } from "../src/plugs/door.ts";

const url = process.env.PLUGS_ROLES_ADMIN_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("PLUGS_ROLES_ADMIN_URL must identify a loopback test Postgres whose admin may create plugs_migrate_test");
}

test("hat ACKs settle on the real migrate path, which composes neither the transition outbox nor role tables", { timeout: 60_000 }, async () => {
  const secret = "migrate-ack-test-only", at = 978307200357;
  const receiver = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString(); assert.equal(req.headers["x-capxul-signature"], signature(raw, secret));
    const b = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: { applied: true, duplicate: false, last_seq: b.seq, map_version: "immutable-map-v1" } }));
  });
  await new Promise<void>((done) => receiver.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  await admin.query("drop database if exists plugs_migrate_test"); await admin.query("create database plugs_migrate_test");
  const as_ = (role: string, password: string) => { const u = new URL(url); u.username = role; u.password = password; u.pathname = "/plugs_migrate_test"; return u.href; };
  const owner = as_(new URL(url).username, new URL(url).password);
  const run = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", new URL("../src/migrate.ts", import.meta.url).pathname], {
    env: { ...process.env, PG_ADMIN_URL: owner, DATABASE_URL: as_("capxul_core", "test-only"), WORKER_DATABASE_URL: as_("capxul_worker", "test-only"),
      PONDER_DATABASE_URL: as_("capxul_ponder", "test-only"), CAPXUL_WORLD: "migrate-test" }, stdio: "ignore" });
  assert.equal((await once(run, "exit"))[0], 0, "migrate.ts must succeed on a fresh database");
  const fresh = new pg.Client({ connectionString: owner }); await fresh.connect();
  const db = new Database(as_("capxul_core", "test-only"), as_("capxul_worker", "test-only"));
  try {
    await fresh.query("update app.world set clock=$1", [{ nowMs: at, clockMode: "stopped", rate: 1 }]);
    await fresh.query("insert into app.organizations(org_id,name,safe,site,admin_email,token,released) values ('real','R','safe-r','r.test','r@test','asset',true)");
    await db.transaction("real", async (sql) => {
      await enqueue(sql, "real", "84532:0xlegacy:1:hat_granted", "hat_granted", {}, "tr_legacy");
      await enqueue(sql, "real", "role:projected-elsewhere", "hat_granted", {}, "tr_role");
    }, true);
    await deliver(db, "real", origin, secret); await deliver(db, "real", origin, secret);
    assert.deepEqual((await fresh.query("select state from app.site_events where org_id='real' order by seq")).rows, [{ state: "applied" }, { state: "applied" }]);
    assert.equal((await fresh.query("select last_ack::int from app.organizations where org_id='real'")).rows[0].last_ack, 2);
  } finally {
    await db.close(); await fresh.end();
    await admin.query("drop database if exists plugs_migrate_test with (force)"); await admin.end();
    receiver.closeAllConnections(); await new Promise<void>((done) => receiver.close(() => done()));
  }
});

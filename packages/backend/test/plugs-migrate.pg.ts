import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import pg from "pg";
import { Database } from "../src/platform/db.ts";
import { deferDelivery, deliver, DeliveryRefused, enqueue, signature } from "../src/plugs/door.ts";
import { serveOrganization } from "../src/server.ts";

const url = process.env.PLUGS_ROLES_ADMIN_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("PLUGS_ROLES_ADMIN_URL must identify a loopback test Postgres whose admin may create plugs_migrate_test");
}
// Roles are cluster-wide and migrate.ts sets their passwords from these URLs. An existing role must come with its
// existing credentials (PLUGS_MIGRATE_CORE/WORKER/PONDER) so they are kept; only a missing role gets a fresh one.
const roles = [["capxul_core", "PLUGS_MIGRATE_CORE"], ["capxul_worker", "PLUGS_MIGRATE_WORKER"], ["capxul_ponder", "PLUGS_MIGRATE_PONDER"]] as const;
const database = (href: string) => { const u = new URL(href); u.pathname = "/plugs_migrate_test"; return u.href; };

test("plugs delivery on the real migrate path: legacy and role ACKs, guarded backoff, per-organization isolation", { timeout: 60_000 }, async (t) => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  const existing = new Set((await admin.query("select rolname from pg_roles where rolname=any($1)", [roles.map(([role]) => role)])).rows.map((r) => r.rolname));
  for (const [role, env] of roles) if (existing.has(role) && !process.env[env]) {
    await admin.end(); throw new Error(`${env} must supply existing ${role} credentials; refusing before any write`);
  }
  const login: Record<string, string> = {}, created: string[] = [];
  for (const [role, env] of roles) {
    if (existing.has(role)) {
      const supplied = new URL(process.env[env]!);
      assert.equal(supplied.host, new URL(url).host, `${env} must use the same test Postgres`);
      assert.equal(supplied.username, role);
      // Prove the supplied credentials before any write; migrate.ts would otherwise set the role to a wrong guess.
      const check = new URL(supplied.href); check.pathname = new URL(url).pathname;
      const client = new pg.Client({ connectionString: check.href });
      try { await client.connect(); } catch (error) { await admin.end(); throw new Error(`${env} does not log in as ${role}; refusing before any write`, { cause: error }); }
      await client.end();
      // A trust/peer cluster accepts any password, so logging in proves nothing and migrate.ts would reset the shared password.
      check.password = randomBytes(18).toString("hex");
      const probe = new pg.Client({ connectionString: check.href });
      const unchecked = await probe.connect().then(() => true, () => false); await probe.end().catch(() => {});
      if (unchecked) { await admin.end(); throw new Error(`the cluster accepts any password for ${role}; refusing to migrate an existing role before any write`); }
      login[role] = database(supplied.href);
    } else {
      const password = randomBytes(24).toString("hex");
      await admin.query(`create role ${role} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password '${password}'`);
      created.push(role);
      const u = new URL(url); u.username = role; u.password = password; login[role] = database(u.href);
    }
  }
  const secret = "migrate-ack-test-only", at = 978307200357;
  const refuse = new Set<string>();
  const receiver = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString(); assert.equal(req.headers["x-capxul-signature"], signature(raw, secret));
    const b = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    // A refused org gets an acknowledgement of an older sequence: a settlement refusal after the site call.
    res.end(JSON.stringify({ message: { applied: true, duplicate: false, last_seq: refuse.has(b.org) ? 0 : b.seq, map_version: "immutable-map-v1" } }));
  });
  await new Promise<void>((done) => receiver.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;
  let fresh: pg.Client | undefined, db: Database | undefined;
  try {
    await admin.query("drop database if exists plugs_migrate_test"); await admin.query("create database plugs_migrate_test");
    const owner = database(url);
    const run = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", new URL("../src/migrate.ts", import.meta.url).pathname], {
      env: { ...process.env, PG_ADMIN_URL: owner, DATABASE_URL: login.capxul_core, WORKER_DATABASE_URL: login.capxul_worker,
        PONDER_DATABASE_URL: login.capxul_ponder, CAPXUL_WORLD: "migrate-test" }, stdio: "ignore" });
    assert.equal((await once(run, "exit"))[0], 0, "migrate.ts must succeed on a fresh database");
    // Run against a password-checking (scram) cluster: the credentials that existed before still log in afterwards.
    for (const [role] of roles) {
      const client = new pg.Client({ connectionString: login[role] }); await client.connect();
      try { assert.equal((await client.query("select current_user as role")).rows[0].role, role); } finally { await client.end(); }
    }
    const sql = fresh = new pg.Client({ connectionString: owner }); await sql.connect();
    const core = db = new Database(login.capxul_core!, login.capxul_worker!);
    const org = async (id: string) => sql.query("insert into app.organizations(org_id,name,safe,site,admin_email,token,released) values ($1,$1,$1,$1,'o@test','asset',true)", [id]);
    const events = async (id: string) => (await sql.query("select seq::int,state,attempts,last_error is not null as failed from app.site_events where org_id=$1 order by seq", [id])).rows;
    const backoff = async (id: string) => (await sql.query("select last_ack::int,failures,retry_at is not null as waiting from app.organizations where org_id=$1", [id])).rows[0];
    {
      await sql.query("update app.world set clock=$1", [{ nowMs: at, clockMode: "stopped", rate: 1 }]);

      await t.test("legacy and role-keyed hat ACKs settle without the composed transition outbox", async () => {
        await org("real");
        await core.transaction("real", async (tx) => {
          await enqueue(tx, "real", "84532:0xlegacy:1:hat_granted", "hat_granted", {}, "tr_legacy");
          await enqueue(tx, "real", "role:projected-elsewhere", "hat_granted", {}, "tr_role");
        }, true);
        await deliver(core, "real", origin, secret); await deliver(core, "real", origin, secret);
        assert.deepEqual((await events("real")).map((e) => e.state), ["applied", "applied"]);
        assert.equal((await backoff("real")).last_ack, 2);
      });

      await t.test("backoff after a refusal is not charged once another instance delivered that event", async () => {
        await org("raced");
        await core.transaction("raced", async (tx) => {
          await enqueue(tx, "raced", "raced-1", "hat_revoked", {}, "tr_r1"); await enqueue(tx, "raced", "raced-2", "hat_revoked", {}, "tr_r2");
        }, true);
        refuse.add("raced");
        const error = await deliver(core, "raced", origin, secret).then(() => null, (e) => e);
        assert.ok(error instanceof DeliveryRefused); assert.equal(error.seq, 1);
        refuse.delete("raced");
        await deliver(core, "raced", origin, secret); // the other instance
        await deferDelivery(core, "raced", error);
        assert.deepEqual(await events("raced"), [{ seq: 1, state: "applied", attempts: 1, failed: false }, { seq: 2, state: "pending", attempts: 0, failed: false }]);
        assert.deepEqual(await backoff("raced"), { last_ack: 1, failures: 0, waiting: false });
        await deferDelivery(core, "raced", new DeliveryRefused(2, new Error("site did not acknowledge sequence 2")));
        assert.deepEqual((await events("raced"))[1], { seq: 2, state: "pending", attempts: 1, failed: true }, "the head event is still charged");
        assert.deepEqual(await backoff("raced"), { last_ack: 1, failures: 1, waiting: true });
      });

      await t.test("one organization's refused delivery does not throw out of the worker or stop the next organization", async () => {
        await org("a-bad"); await org("b-good");
        for (const id of ["a-bad", "b-good"]) await core.transaction(id, (tx) => enqueue(tx, id, `${id}-1`, "hat_revoked", {}, `tr_${id}`), true);
        refuse.add("a-bad");
        const config = { chainId: 84532, finality: 0, frappe: origin, secret };
        const consumed = new Map<string, { failures: number; until: number }>();
        for (const id of ["a-bad", "b-good"]) await serveOrganization(core, config, id, true, consumed); // no Ponder views: consume fails too, and is caught
        assert.equal(consumed.get("a-bad")?.failures, 1); assert.ok(consumed.get("a-bad")!.until > Date.now(), "a failed consume backs off");
        assert.deepEqual(await events("a-bad"), [{ seq: 1, state: "pending", attempts: 1, failed: true }]);
        assert.deepEqual(await backoff("a-bad"), { last_ack: 0, failures: 1, waiting: true });
        assert.deepEqual(await events("b-good"), [{ seq: 1, state: "applied", attempts: 1, failed: false }]);
        await serveOrganization(core, config, "a-bad", true, consumed);
        assert.equal((await events("a-bad"))[0].attempts, 1, "a deferred site is not offered again before its retry time");
        assert.equal(consumed.get("a-bad")?.failures, 1, "consume is not retried before its backoff ends");
        consumed.get("a-bad")!.until = 0; await serveOrganization(core, config, "a-bad", true, consumed);
        assert.equal(consumed.get("a-bad")?.failures, 2, "after the backoff it tries again and doubles the wait");
      });
    }
  } finally {
    await db?.close(); await fresh?.end();
    await admin.query("drop database if exists plugs_migrate_test with (force)");
    // Leave the cluster as found: roles this run created would make the next run (or roles.pg.ts) refuse.
    for (const role of created.reverse()) await admin.query(`drop role if exists ${role}`);
    await admin.end();
    receiver.closeAllConnections(); await new Promise<void>((done) => receiver.close(() => done()));
  }
});

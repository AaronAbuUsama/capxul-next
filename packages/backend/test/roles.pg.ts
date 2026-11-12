import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import pg from "pg";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { migrateRoleProjections, recordRoleGrant, transitionRoleGrant, readRoles, type GrantInput, type RoleOccurrence } from "../src/plugs/door.ts";

const url = process.env.PLUGS_ROLES_ADMIN_URL;
if (!url || new URL(url).pathname !== "/plugs_roles_test" || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("PLUGS_ROLES_ADMIN_URL must identify a fresh dedicated loopback plugs_roles_test database");
}

test("role projections retain caller atomicity, exact occurrences, shared roles and canonical owner isolation", { timeout: 30_000 }, async (t) => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  await admin.query(`create role capxul_core login nosuperuser nobypassrls;
    create role capxul_worker login nosuperuser nobypassrls; create role capxul_ponder login nosuperuser nobypassrls`);
  await admin.query(readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8"));
  await admin.query(`grant usage on schema app to capxul_core,capxul_worker;
    grant select,insert,update on app.organizations,app.site_events to capxul_worker;
    grant select,insert on app.records to capxul_worker; grant usage on all sequences in schema app to capxul_worker;
    insert into app.organizations(org_id,name,safe,site,admin_email,token)
      values ('org-a','A','safe-a','a.test','a@example.test','asset-a'),('org-b','B','safe-b','b.test','b@example.test','asset-b')`);
  await migrateOutbox(admin); await migrateRoleProjections(admin); await migrateRoleProjections(admin);
  const roleUrl = (role: string) => { const u = new URL(url); u.username = role; return u.href; };
  const db = new Database(roleUrl("capxul_core"), roleUrl("capxul_worker"));
  const input: GrantInput = {
    org_id: "org-a", grant_id: "grant-731", person_id: "person-canonical-42", address: "0x" + "1".repeat(40),
    email: "first@example.test", name: "First Person", hat: "accounts", department: "Operations",
    roles: ["Shared", "Accounts User"], map_version: "shipped-map-7", chain_tx_hash: "0x" + "a".repeat(64), chain_log_index: 3,
  };
  const context = (id: string, offset = 0): RoleOccurrence => ({ id, at: 946684800123 + offset, trace_id: "tr_role731", actor: null });
  const write = <T>(run: (sql: Parameters<typeof recordRoleGrant>[0]) => Promise<T>) => db.transaction("org-a", run, true);
  const change = (id: string, action: Parameters<typeof transitionRoleGrant>[3], occurrence: string, offset: number) =>
    write((sql) => transitionRoleGrant(sql, "org-a", id, action, context(occurrence, offset)));
  const counts = async () => (await admin.query(`select
    (select count(*)::int from app.role_grants) grants, (select count(*)::int from app.site_users) users,
    (select count(*)::int from app.site_events) deliveries, (select count(*)::int from app.transition_outbox) events,
    (select next_seq::int from app.organizations where org_id='org-a') next`)).rows[0];
  try {
    await t.test("caller rollback removes user, grant, delivery, cursor increment and exact transition", async () => {
      await assert.rejects(write(async (sql) => { await recordRoleGrant(sql, input, context("birth-731")); throw new Error("abort-source"); }), /abort-source/);
      assert.deepEqual(await counts(), { grants: 0, users: 0, deliveries: 0, events: 0, next: 1 });
      assert.equal((await admin.query("select * from app.records")).rowCount, 0);
    });
    await t.test("concurrent source retries make one identity; conflicting replay cannot rewrite it", async () => {
      const born = await Promise.all([write((sql) => recordRoleGrant(sql, input, context("birth-731"))), write((sql) => recordRoleGrant(sql, input, context("birth-731")))]);
      assert.deepEqual(born[0], born[1]);
      assert.deepEqual(await counts(), { grants: 1, users: 1, deliveries: 1, events: 1, next: 2 });
      assert.equal(born[0]!.created_at, 946684800123);
      await assert.rejects(write((sql) => recordRoleGrant(sql, { ...input, person_id: "forged-person" }, context("birth-731"))), /IDEMPOTENCY_CONFLICT/);
      await assert.rejects(write((sql) => recordRoleGrant(sql, input, context("birth-731", 9))), /IDEMPOTENCY_CONFLICT/);
      const e = (await admin.query("select event from app.transition_outbox")).rows[0].event;
      assert.deepEqual(e, { id: JSON.stringify(["plugs.role-grant", "org-a", "birth-731"]), name: "role_grant_transitioned", machine: "role-grant",
        entity_id: "grant-731", owner_kind: "organization", owner_id: "org-a", actor: null, trace_id: "tr_role731", at: 946684800123,
        props: { from: null, to: "pending", transition: "record", org_id: "org-a", hat: "accounts", department: "Operations", roles: 2 } });
      assert.equal((await admin.query("select at from app.records")).rows[0].at.getTime(), 946684800123);
    });
    await t.test("native map guard, failure recovery, overlap and old occurrence replay preserve authority", async () => {
      await assert.rejects(change(input.grant_id, { transition: "apply", map_version: "other-map" }, "apply-a", 17), /PROVIDER_RESPONSE_INVALID/);
      assert.equal((await change(input.grant_id, { transition: "fail", failure: "Employee unavailable" }, "fail-a", 19)).failure, "Employee unavailable");
      await change(input.grant_id, { transition: "apply", map_version: "shipped-map-7" }, "apply-a", 23);
      await write((sql) => recordRoleGrant(sql, { ...input, grant_id: "grant-832", hat: "projects", roles: ["Shared", "Projects User", "Task User"],
        email: "changed@example.test", chain_log_index: 4 }, context("birth-832", 29)));
      await change("grant-832", { transition: "apply", map_version: "shipped-map-7" }, "apply-b", 31);
      assert.deepEqual((await write((sql) => readRoles(sql, "org-a", input.person_id))).roles, ["Accounts User", "Projects User", "Shared", "Task User"]);
      const nativeIdentity = (await admin.query("select data->>'person_email' as email from app.site_events where event_key='birth-832'")).rows[0];
      assert.equal(nativeIdentity.email, "first@example.test", "email changes retain the hat-created native user identity");
      await change(input.grant_id, { transition: "revoke" }, "revoke-a", 41);
      const before = await counts();
      assert.equal((await change(input.grant_id, { transition: "apply", map_version: "shipped-map-7" }, "apply-a", 23)).status, "revoked");
      await write((sql) => recordRoleGrant(sql, input, context("birth-731")));
      assert.deepEqual(await counts(), before);
      assert.deepEqual((await write((sql) => readRoles(sql, "org-a", input.person_id))).roles, ["Projects User", "Shared", "Task User"]);
      await assert.rejects(change(input.grant_id, { transition: "apply", map_version: "shipped-map-7" }, "late-apply", 47), /WRONG_STATE/);
      await assert.rejects(change("grant-832", { transition: "retire" }, "bad-retire", 49), /WRONG_STATE/);
      await change("grant-832", { transition: "revoke" }, "revoke-b", 53);
      assert.deepEqual((await write((sql) => readRoles(sql, "org-a", input.person_id))).roles, []);
      assert.equal((await admin.query("select status from app.site_users")).rows[0].status, "disabled");
      await write((sql) => recordRoleGrant(sql, { ...input, grant_id: "grant-933", chain_log_index: 5 }, context("birth-933", 59)));
      await write((sql) => recordRoleGrant(sql, { ...input, grant_id: "grant-1044", chain_log_index: 6 }, context("birth-1044", 61)));
      await change("grant-1044", { transition: "apply", map_version: "shipped-map-7" }, "apply-d", 63);
      await change("grant-933", { transition: "retire" }, "retire-c", 65);
      assert.equal((await admin.query("select 1 from app.site_events where event_key='retire-c'")).rowCount, 0, "retiring an old occurrence cannot remove the newer same-hat native grant");
      assert.deepEqual((await write((sql) => readRoles(sql, "org-a", input.person_id))).roles, ["Accounts User", "Shared"]);
      await assert.rejects(change("grant-933", { transition: "apply", map_version: "shipped-map-7" }, "late-c", 67), /WRONG_STATE/);
      await change("grant-1044", { transition: "revoke" }, "revoke-d", 69);
      const user = (await admin.query("select created_by_grant_id,frappe_user,status from app.site_users")).rows[0];
      assert.deepEqual(user, { created_by_grant_id: "grant-731", frappe_user: "first@example.test", status: "disabled" });
      const events = (await admin.query("select event from app.transition_outbox order by seq")).rows.map((r) => r.event);
      assert.deepEqual(events.map((e) => [e.props.from, e.props.to, e.props.transition, e.props.roles, e.at - 946684800123]), [
        [null, "pending", "record", 2, 0], ["pending", "failed", "fail", 2, 19], ["failed", "applied", "apply", 2, 23],
        [null, "pending", "record", 3, 29], ["pending", "applied", "apply", 3, 31], ["applied", "revoked", "revoke", 2, 41],
        ["applied", "revoked", "revoke", 3, 53], [null, "pending", "record", 2, 59], [null, "pending", "record", 2, 61],
        ["pending", "applied", "apply", 2, 63], ["pending", "revoked", "retire", 2, 65], ["applied", "revoked", "revoke", 2, 69],
      ]);
      assert.equal(JSON.stringify(events).includes("Employee unavailable"), false, "failure details stay out of transition props");
    });
    await t.test("exact organization owner scope is required; tenant and Ponder cannot write", async () => {
      const read = (owner: { kind: "person" | "organization"; id: string }) => db.ownerTransaction(owner, (sql) => readRoles(sql, "org-a", input.person_id));
      assert.equal((await read({ kind: "organization", id: "org-a" })).grants.length, 4);
      for (const owner of [{ kind: "organization", id: "org-b" }, { kind: "person", id: "org-a" }] as const) {
        assert.deepEqual(await read(owner), { person: input.person_id, frappeUser: null, grants: [], roles: [] });
      }
      assert.equal((await db.tenant.query("select * from app.role_grants")).rowCount, 0, "owner scope cannot leak from the previous transaction");
      await assert.rejects(db.ownerTransaction({ kind: "organization", id: "org-a" }, (sql) => sql.query("update app.role_grants set status='applied'")), /permission denied/);
      await assert.rejects(db.worker.query("delete from app.role_grants"), /permission denied/);
      assert.equal((await admin.query("select has_table_privilege('capxul_ponder','app.role_grants','INSERT') as allowed")).rows[0].allowed, false);
    });
    await t.test("process death after SQL effects before commit leaves no grant, user, delivery or event", async () => {
      const crash = { ...input, org_id: "org-b", grant_id: "crash-grant", person_id: "crash-person" };
      const source = `import pg from 'pg'; import {recordRoleGrant} from ${JSON.stringify(new URL("../src/plugs/door.ts", import.meta.url).href)};
        const sql=new pg.Client({connectionString:process.env.PLUGS_ROLE_WORKER_URL}); await sql.connect(); await sql.query('begin');
        await recordRoleGrant(sql,${JSON.stringify(crash)},${JSON.stringify(context("crash-source", 71))});
        process.send('source-before-commit'); await new Promise(()=>{});`;
      const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", source], {
        cwd: new URL("..", import.meta.url), env: { ...process.env, PLUGS_ROLE_WORKER_URL: roleUrl("capxul_worker") }, stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const [phase] = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error("child exited before source boundary"); })]);
      assert.equal(phase, "source-before-commit"); const ended = once(child, "exit"); child.kill("SIGKILL"); await ended;
      assert.equal((await admin.query("select * from app.site_users where org_id='org-b'")).rowCount, 0);
      assert.equal((await admin.query("select * from app.site_events where org_id='org-b'")).rowCount, 0);
      assert.equal((await admin.query("select * from app.transition_outbox where event->>'owner_id'='org-b'")).rowCount, 0);
      assert.equal((await admin.query("select next_seq::int as next from app.organizations where org_id='org-b'")).rows[0].next, 1);
    });
  } finally { await db.close(); await admin.end(); }
});

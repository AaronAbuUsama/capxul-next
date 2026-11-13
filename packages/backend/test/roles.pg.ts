import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import pg from "pg";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { deferDelivery, deliver, enqueue, resend, retryParked, signature, migrateRoleProjections, recordRoleGrant, transitionRoleGrant, readRoles, type GrantInput, type RoleOccurrence } from "../src/plugs/door.ts";

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
    grant select on app.world to capxul_worker;
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
      await assert.rejects(write((sql) => recordRoleGrant(sql, input, context("birth-731-again"))), /IDEMPOTENCY_CONFLICT/, "a new occurrence id cannot add a second birth");
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
      const nativeIdentity = (await admin.query("select data->>'person_email' as email from app.site_events where event_key='role:birth-832'")).rows[0];
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
      await write((sql) => recordRoleGrant(sql, { ...input, grant_id: "grant-933", department: null, chain_log_index: 5 }, context("birth-933", 59)));
      await write((sql) => recordRoleGrant(sql, { ...input, grant_id: "grant-1044", department: "", chain_log_index: 6 }, context("birth-1044", 61)));
      await change("grant-1044", { transition: "apply", map_version: "shipped-map-7" }, "apply-d", 63);
      await change("grant-933", { transition: "retire" }, "retire-c", 65);
      assert.equal((await admin.query("select 1 from app.site_events where event_key='role:retire-c'")).rowCount, 0, "retiring an old occurrence cannot remove the newer same-hat native grant");
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
    await t.test("empty and null departments share native identity in either grant order and on replay", async () => {
      const old = { ...input, grant_id: "grant-1155", department: "", chain_log_index: 7 };
      const newer = { ...input, grant_id: "grant-1266", department: null, chain_log_index: 8 };
      const born = await write((sql) => recordRoleGrant(sql, old, context("birth-1155", 71)));
      assert.equal(born.department, null);
      // Fixture the preceding implementation's representation; committed history must not be rewritten.
      await admin.query("update app.role_grants set department='' where grant_id=$1", [old.grant_id]);
      await admin.query("update app.transition_outbox set event=jsonb_set(event,'{props,department}',to_jsonb(''::text)) where event->>'entity_id'=$1", [old.grant_id]);
      const history = (await admin.query("select event from app.transition_outbox where event->>'entity_id'=$1", [old.grant_id])).rows[0].event;
      await change(old.grant_id, { transition: "apply", map_version: "shipped-map-7" }, "apply-e", 73);
      await write((sql) => recordRoleGrant(sql, newer, context("birth-1266", 75)));
      await change(newer.grant_id, { transition: "apply", map_version: "shipped-map-7" }, "apply-f", 77);
      const before = await counts();
      await write((sql) => recordRoleGrant(sql, { ...old, department: null }, context("birth-1155", 71)));
      assert.deepEqual(await counts(), before);
      assert.deepEqual((await admin.query("select event from app.transition_outbox where id=$1", [history.id])).rows[0].event, history);
      await change(old.grant_id, { transition: "revoke" }, "revoke-e", 79);
      assert.equal((await admin.query("select 1 from app.site_events where event_key='role:revoke-e'")).rowCount, 0);
      assert.deepEqual((await write((sql) => readRoles(sql, "org-a", input.person_id))).roles, ["Accounts User", "Shared"]);
      await change(newer.grant_id, { transition: "revoke" }, "revoke-f", 81);
      assert.deepEqual((await write((sql) => readRoles(sql, "org-a", input.person_id))).roles, []);
    });
    await t.test("exact organization owner scope is required; tenant and Ponder cannot write", async () => {
      const read = (owner: { kind: "person" | "organization"; id: string }) => db.ownerTransaction(owner, (sql) => readRoles(sql, "org-a", input.person_id));
      assert.equal((await read({ kind: "organization", id: "org-a" })).grants.length, 6);
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
    await t.test("delivery and repair atomically settle authority at stored world time, never swallow SQL validation failures", async () => {
      const at = 978307200357, secret = "role-ack-test-only";
      let parked = false, wrongMap = false, unavailable = false;
      const seen = new Set<string>();
      const receiver = createServer(async (req, res) => {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString(); assert.equal(req.headers["x-capxul-signature"], signature(raw, secret));
        const b = JSON.parse(raw); const repair = req.url?.endsWith("retry_parked_event");
        if (unavailable) { res.writeHead(503); res.end(); return; }
        const duplicate = seen.has(b.event_key); seen.add(b.event_key);
        const seq = repair ? 1 : b.seq;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ message: parked && !repair
          ? { applied: false, duplicate: false, parked: true, last_seq: seq, error: "native role missing" }
          : { applied: repair || !duplicate, duplicate: !repair && duplicate, last_seq: seq, map_version: wrongMap ? "other-map" : input.map_version } }));
      });
      await new Promise<void>((done) => receiver.listen(0, "127.0.0.1", done));
      const origin = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;
      await admin.query("insert into app.world(world_id,clock) values ('roles-test',$1)", [{ nowMs: at, clockMode: "stopped", rate: 1 }]);
      const setup = async (org: string) => {
        await admin.query("insert into app.organizations(org_id,name,safe,site,admin_email,token,released) values ($1,$1,$1,$1,'role@test','asset',true)", [org]);
        await db.transaction(org, (sql) => recordRoleGrant(sql, { ...input, org_id: org, grant_id: org }, context(org)), true);
      };
      const state = async (org: string) => (await admin.query(`select e.state,e.attempts,o.last_ack,o.failures,g.status,g.updated_at,
        (select count(*)::int from app.transition_outbox where event->>'owner_id'=$1) events,
        (select count(*)::int from app.records where org_id=$1) records
        from app.organizations o join app.site_events e using(org_id) join app.role_grants g using(org_id) where o.org_id=$1`, [org])).rows[0];
      try {
        await setup("ack-clock"); const before = await state("ack-clock");
        for (const clock of [{}, { nowMs: "wrong", clockMode: "stopped", rate: 1 }, { nowMs: at, clockMode: "running", rate: 1 }]) {
          await admin.query("update app.world set clock=$1", [clock]);
          await assert.rejects(deliver(db, "ack-clock", origin, secret), /INVALID_CLOCK|UNSUPPORTED_CLOCK/);
          assert.deepEqual(await state("ack-clock"), before, "ACK/cursor/attempt/state/outbox/record must all roll back");
        }
        await admin.query("delete from app.world");
        await assert.rejects(deliver(db, "ack-clock", origin, secret), /INVALID_CLOCK/);
        assert.deepEqual(await state("ack-clock"), before);
        await admin.query("insert into app.world(world_id,clock) values ('roles-test',$1)", [{ nowMs: at, clockMode: "stopped", rate: 1 }]);
        wrongMap = true;
        await assert.rejects(deliver(db, "ack-clock", origin, secret), /PROVIDER_RESPONSE_INVALID/);
        assert.deepEqual(await state("ack-clock"), before);
        wrongMap = false; await deliver(db, "ack-clock", origin, secret);
        assert.equal((await state("ack-clock")).status, "applied");
        assert.equal((await state("ack-clock")).updated_at, at);
        const applied = (await admin.query("select event from app.transition_outbox where event->>'entity_id'='ack-clock' and event->'props'->>'transition'='apply'")).rows[0].event;
        assert.equal(applied.at, at); assert.equal((await admin.query("select at from app.records where org_id='ack-clock' order by id desc limit 1")).rows[0].at.getTime(), at);
        const replay = async (status: string) => {
          await db.transaction("ack-clock", (sql) => resend(sql, "ack-clock", 1), true);
          const beforeReplay = await state("ack-clock");
          const original = (await admin.query("select * from app.role_grants where org_id='ack-clock'")).rows;
          const saved = (await admin.query("select event from app.transition_outbox where event->>'owner_id'='ack-clock' order by id")).rows;
          for (const clock of [null, {}, { nowMs: at, clockMode: "running", rate: 1 }]) {
            await admin.query("delete from app.world");
            if (clock) await admin.query("insert into app.world(world_id,clock) values ('roles-test',$1)", [clock]);
            await assert.rejects(deliver(db, "ack-clock", origin, secret), /INVALID_CLOCK|UNSUPPORTED_CLOCK/);
            assert.deepEqual(await state("ack-clock"), beforeReplay, `${status} replay must validate clock before committing ACK`);
          }
          await admin.query("update app.world set clock=$1", [{ nowMs: at + 100, clockMode: "stopped", rate: 1 }]);
          await deliver(db, "ack-clock", origin, secret);
          assert.equal((await state("ack-clock")).status, status);
          assert.equal((await state("ack-clock")).events, beforeReplay.events, "historical ACK adds no authority event");
          assert.equal((await admin.query("select at from app.records where org_id='ack-clock' order by id desc limit 1")).rows[0].at.getTime(), at + 100);
          assert.deepEqual((await admin.query("select * from app.role_grants where org_id='ack-clock'")).rows, original);
          assert.deepEqual((await admin.query("select event from app.transition_outbox where event->>'owner_id'='ack-clock' order by id")).rows, saved);
        };
        await replay("applied");
        await db.transaction("ack-clock", (sql) => transitionRoleGrant(sql, "ack-clock", "ack-clock", { transition: "revoke" }, context("ack-revoke", 101)), true);
        await replay("revoked");
        assert.equal((await admin.query("select status from app.role_grants where org_id='ack-clock'")).rows[0].status, "revoked");
        assert.deepEqual((await admin.query("select event from app.transition_outbox where id=$1", [applied.id])).rows[0].event, applied);

        await setup("ack-conflict");
        const id = JSON.stringify(["plugs.role-grant", "ack-conflict", JSON.stringify(["native-ack", "role:ack-conflict", "apply"])]);
        await admin.query("insert into app.transition_outbox(id,event,host_enqueued_at) values ($1,$2,1)", [id, { ...applied, id, owner_id: "ack-conflict", entity_id: "conflicting-source" }]);
        const conflictBefore = await state("ack-conflict");
        await assert.rejects(deliver(db, "ack-conflict", origin, secret), /IDEMPOTENCY_CONFLICT/);
        assert.deepEqual(await state("ack-conflict"), conflictBefore, "semantic emission refusal after grant/ACK writes must escape retry catch");

        await setup("ack-repair"); parked = true; await deliver(db, "ack-repair", origin, secret); parked = false;
        const failed = await state("ack-repair"); assert.equal(failed.state, "parked"); assert.equal(failed.status, "failed");
        assert.equal((await admin.query("select failure from app.role_grants where org_id='ack-repair'")).rows[0].failure, "native role missing");
        const repair = () => db.transaction("ack-repair", (sql) => retryParked(sql, "ack-repair", "role:ack-repair", origin, secret), true);
        await admin.query("update app.world set clock='{}'"); await assert.rejects(repair(), /INVALID_CLOCK/);
        assert.deepEqual(await state("ack-repair"), failed);
        await admin.query("update app.world set clock=$1", [{ nowMs: at + 77, clockMode: "stopped", rate: 1 }]);
        wrongMap = true; await assert.rejects(repair(), /PROVIDER_RESPONSE_INVALID/); wrongMap = false;
        assert.deepEqual(await state("ack-repair"), failed);
        await repair(); const repaired = await state("ack-repair");
        assert.equal(repaired.status, "applied"); assert.equal(repaired.state, "applied"); assert.equal(repaired.updated_at, at + 77);
        await repair(); assert.deepEqual(await state("ack-repair"), repaired);

        await setup("repair-history"); parked = true; await deliver(db, "repair-history", origin, secret); parked = false;
        await db.transaction("repair-history", sql => transitionRoleGrant(sql, "repair-history", "repair-history", { transition: "revoke" }, context("repair-revoke", at + 80)), true);
        const historical = await state("repair-history");
        const grant = (await admin.query("select * from app.role_grants where org_id='repair-history'")).rows;
        const saved = (await admin.query("select event from app.transition_outbox where event->>'owner_id'='repair-history' order by id")).rows;
        const repairHistory = () => db.transaction("repair-history", sql => retryParked(sql, "repair-history", "role:repair-history", origin, secret), true);
        for (const clock of [null, {}, { nowMs: at, clockMode: "running", rate: 1 }]) {
          await admin.query("delete from app.world");
          if (clock) await admin.query("insert into app.world(world_id,clock) values ('roles-test',$1)", [clock]);
          await assert.rejects(repairHistory(), /INVALID_CLOCK|UNSUPPORTED_CLOCK/);
          assert.deepEqual(await state("repair-history"), historical);
        }
        await admin.query("update app.world set clock=$1", [{ nowMs: at + 99, clockMode: "stopped", rate: 1 }]);
        await repairHistory();
        assert.equal((await admin.query("select at from app.records where org_id='repair-history' order by id desc limit 1")).rows[0].at.getTime(), at + 99);
        assert.deepEqual((await admin.query("select * from app.role_grants where org_id='repair-history'")).rows, grant);
        assert.deepEqual((await admin.query("select event from app.transition_outbox where event->>'owner_id'='repair-history' order by id")).rows, saved);

        await admin.query("insert into app.organizations(org_id,name,safe,site,admin_email,token,released) values ('legacy-ack','Legacy','safe','legacy.test','legacy@test','asset',true)");
        await db.transaction("legacy-ack", sql => enqueue(sql, "legacy-ack", "legacy", "hat_granted", {}, "legacy"), true);
        await admin.query("update app.world set clock='{}'");
        await deliver(db, "legacy-ack", origin, secret);
        assert.equal((await admin.query("select state from app.site_events where org_id='legacy-ack'")).rows[0].state, "applied");
        assert.equal((await admin.query("select * from app.role_grants where org_id='legacy-ack'")).rowCount, 0);

        await admin.query("update app.world set clock=$1", [{ nowMs: at + 100, clockMode: "stopped", rate: 1 }]);
        await setup("ack-unavailable"); unavailable = true; await deliver(db, "ack-unavailable", origin, secret);
        const retry = await state("ack-unavailable"); assert.equal(retry.state, "pending"); assert.equal(retry.status, "pending"); assert.equal(retry.failures, 1);

        // A settlement refusal rolls the delivery back; the separate backoff then holds this site without spinning.
        unavailable = false; await setup("ack-deferred"); wrongMap = true;
        const error = await deliver(db, "ack-deferred", origin, secret).then(() => null, (e) => e);
        assert.match(String(error?.message), /PROVIDER_RESPONSE_INVALID/);
        await deferDelivery(db, "ack-deferred", error);
        const deferred = await state("ack-deferred");
        assert.equal(deferred.state, "pending"); assert.equal(deferred.failures, 1); assert.equal(deferred.attempts, 1);
        assert.match((await admin.query("select last_error from app.site_events where org_id='ack-deferred'")).rows[0].last_error, /PROVIDER_RESPONSE_INVALID/);
        await deliver(db, "ack-deferred", origin, secret);
        assert.deepEqual(await state("ack-deferred"), deferred, "a deferred site is not offered again before its retry time");
        wrongMap = false;

      } finally { receiver.closeAllConnections(); await new Promise<void>((done) => receiver.close(() => done())); }
    });
  } finally { await db.close(); await admin.end(); }
});

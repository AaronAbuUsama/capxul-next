import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import pg from "pg";
import { Database, transaction } from "../src/platform/db.ts";
import { consume, emit, hasPending, migrateOutbox, readEvent, relay, type TransitionEvent } from "../src/platform/outbox.ts";

// Explicit standalone PG control, not part of the Ponder/v4 fixture suite's *.test.ts glob.
const url = process.env.OUTBOX_TEST_ADMIN_URL;
if (!url || new URL(url).pathname !== "/outbox_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("OUTBOX_TEST_ADMIN_URL must name a dedicated loopback outbox_test database");
}

test("committed runtime outbox: rollback, crash retry, concurrency, exact identity and person/org RLS", { timeout: 30_000 }, async (t) => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  const roleUrl = (role: string) => { const u = new URL(url); u.username = role; return u.href; };
  await admin.query(`create role capxul_core login nosuperuser nobypassrls;
    create role capxul_worker login nosuperuser nobypassrls; create schema app;
    grant usage on schema app to capxul_core,capxul_worker`);
  await migrateOutbox(admin);
  await admin.query(`create table app.outbox_source_probe (id text primary key);
    create table app.outbox_effect_probe (consumer text,event_id text,primary key(consumer,event_id));
    grant select,insert on app.outbox_source_probe,app.outbox_effect_probe to capxul_worker`);
  const db = new Database(roleUrl("capxul_core"), roleUrl("capxul_worker"));
  const event = (id: string, owner_kind: TransitionEvent["owner_kind"] = "person", owner_id: string | null = "person-a"): TransitionEvent => ({
    id, name: "request_transitioned", machine: "request", entity_id: "req-731", owner_kind, owner_id, actor: "person-a",
    trace_id: "trace-731", at: 1_234_567,
    props: { from: null, to: "open", transition: "issue", request_id: "req-731", owner_kind: "person", owner_id: "person-a", kind: "invoice", payer_kind: "none" },
  });
  // A stopped world far from the host's clock, so a world ACK instant and a host stamp cannot be mistaken for each other.
  const WORLD = Date.UTC(2031, 0, 2, 3, 4, 5), world = async () => WORLD, testStarted = Date.now();
  const effect = async (sql: Parameters<typeof consume>[0], e: TransitionEvent) => {
    await sql.query("insert into app.outbox_effect_probe values ('notices',$1)", [e.id]);
  };
  try {
    await t.test("source mutation and emitted event roll back together", async () => {
      await assert.rejects(db.transaction("", async (sql) => {
        await sql.query("insert into app.outbox_source_probe values ('rolled-back')");
        await emit(sql, event("rolled-back")); throw new Error("source failed after emit");
      }, true), /source failed/);
      assert.equal((await admin.query("select * from app.outbox_source_probe")).rowCount, 0);
      assert.equal(await readEvent(admin, "rolled-back"), null);
      await db.transaction("", async (sql) => {
        await sql.query("insert into app.outbox_source_probe values ('committed')"); await emit(sql, event("committed"));
      }, true);
      assert.deepEqual(await readEvent(admin, "committed"), event("committed"));
      assert.equal((await admin.query("select * from app.outbox_source_probe")).rowCount, 1);
    });
    await t.test("exact retries deduplicate and changed envelopes cannot overwrite history", async () => {
      await db.transaction("", (sql) => emit(sql, event("committed")), true);
      await assert.rejects(db.transaction("", (sql) => emit(sql, { ...event("committed"), at: 1_234_568 }), true), /IDEMPOTENCY_CONFLICT/);
      assert.equal((await admin.query("select * from app.transition_outbox")).rowCount, 1);
      assert.deepEqual(await readEvent(admin, "committed"), event("committed"));
    });
    await t.test("consumer effect and ACK roll back on error, then retry once under concurrent relays", async () => {
      assert.equal(await relay(db, "notices", ["request_transitioned"], async (sql, e) => { await effect(sql, e); throw new Error("handler failed"); }, world), 0);
      assert.equal((await admin.query("select * from app.outbox_effect_probe")).rowCount, 0);
      assert.equal((await admin.query("select * from app.transition_acks")).rowCount, 0);
      assert.deepEqual((await admin.query("select consumer,event_id,attempts,last_error from app.transition_failures")).rows,
        [{ consumer: "notices", event_id: "committed", attempts: 1, last_error: "Error" }]);
      const counts = await Promise.all([relay(db, "notices", ["request_transitioned"], effect, world), relay(db, "notices", ["request_transitioned"], effect, world)]);
      assert.equal(counts.reduce((a, b) => a + b), 1);
      assert.equal((await admin.query("select * from app.outbox_effect_probe")).rowCount, 1);
      assert.equal((await admin.query("select * from app.transition_acks where consumer='notices'")).rowCount, 1);
      assert.equal(await relay(db, "notices", ["request_transitioned"], effect, world), 0);
      assert.equal((await admin.query("select * from app.transition_failures")).rowCount, 0, "a delivered event clears its failure");
      // runtime.outbox-host-stamps: the ACK's acked_at is the relay's world instant; both host stamps are RealTime.
      const stamps = (await admin.query(`select (extract(epoch from a.acked_at)*1000)::float8 as acked, a.host_acked_at::float8 as host_acked,
        o.host_enqueued_at::float8 as host_enqueued from app.transition_acks a join app.transition_outbox o on o.id=a.event_id
        where a.consumer='notices' and a.event_id='committed'`)).rows[0];
      assert.equal(stamps.acked, WORLD, "acked_at is the world instant the relay read, not the database host clock");
      assert(stamps.host_enqueued >= testStarted && stamps.host_enqueued <= stamps.host_acked && stamps.host_acked <= Date.now(),
        "host stamps are the host clock, enqueue before ACK");
      assert.notEqual(stamps.host_acked, stamps.acked);
      assert.equal(await relay(db, "activity", ["request_transitioned"], async (sql, e) => {
        await sql.query("insert into app.outbox_effect_probe values ('activity',$1)", [e.id]);
      }, world), 1, "each consumer has its own ACK");
    });
    await t.test("process death after effect+ACK but before commit leaves both retryable", async () => {
      await db.transaction("", (sql) => emit(sql, event("crash")), true);
      const source = `import pg from 'pg'; import {consume} from ${JSON.stringify(new URL("../src/platform/outbox.ts", import.meta.url).href)};
        const client=new pg.Client({connectionString:process.env.OUTBOX_WORKER_URL}); await client.connect(); await client.query('begin');
        await consume(client,'crash-consumer','crash',async(sql,e)=>{await sql.query("insert into app.outbox_effect_probe values ('crash-consumer',$1)",[e.id]);},${WORLD});
        process.send('acked-before-commit'); await new Promise(()=>{});`;
      const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", source], {
        cwd: new URL("..", import.meta.url), env: { ...process.env, OUTBOX_WORKER_URL: roleUrl("capxul_worker") }, stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const [phase] = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error("crash child exited before ACK boundary"); })]);
      assert.equal(phase, "acked-before-commit"); const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
      assert.equal((await admin.query("select * from app.outbox_effect_probe where consumer='crash-consumer'")).rowCount, 0);
      assert.equal((await admin.query("select * from app.transition_acks where consumer='crash-consumer'")).rowCount, 0);
      assert.equal(await db.transaction("", (sql) => consume(sql, "crash-consumer", "crash", async (s, e) => {
        await s.query("insert into app.outbox_effect_probe values ('crash-consumer',$1)", [e.id]);
      }, WORLD), true), true);
      assert.equal(await db.transaction("", (sql) => consume(sql, "crash-consumer", "crash", async () => { throw new Error("replay invoked effect"); }, WORLD), true), false);
    });
    await t.test("personal, organization and pre-principal events need no organization FK and stay scoped", async () => {
      await db.transaction("", async (sql) => {
        await emit(sql, event("org-a", "organization", "org-a")); await emit(sql, event("org-b", "organization", "org-b"));
        await emit(sql, event("person-b", "person", "person-b")); await emit(sql, event("unlisted", null, null));
      }, true);
      const client = await db.tenant.connect();
      try {
        await db.ownerTransaction({ kind: "person", id: "person-a" }, async (sql) => {
          assert.equal((await sql.query("select current_setting('app.person_id',true) as id")).rows[0].id, "");
          assert.equal(await readEvent(sql, "org-a"), null); assert.equal(await readEvent(sql, "person-b"), null);
          assert.equal(await readEvent(sql, "unlisted"), null);
          assert.deepEqual(await readEvent(sql, "committed"), event("committed"));
          await emit(sql, event("personal-source"));
        });
        await db.ownerTransaction({ kind: "organization", id: "org-a" }, async (sql) => {
          assert.deepEqual(await readEvent(sql, "org-a"), event("org-a", "organization", "org-a"));
          assert.equal(await readEvent(sql, "committed"), null);
          assert.equal(await readEvent(sql, "org-b"), null);
          await emit(sql, event("organization-source", "organization", "org-a"));
        });
        await assert.rejects(db.ownerTransaction({ kind: "person", id: "person-b" }, (sql) => emit(sql, event("cross-person"))), /row-level security/);
        await assert.rejects(transaction(client, "org-a", (sql) => emit(sql, event("cross-org", "organization", "org-b"))), /row-level security/);
        await assert.rejects(db.ownerTransaction({ kind: "person", id: "org-a" }, (sql) => emit(sql, event("wrong-kind", "organization", "org-a"))), /row-level security/);
        await assert.rejects(client.query("update app.transition_outbox set event=event"), /permission denied/);
        await assert.rejects(db.worker.query("delete from app.transition_outbox"), /permission denied/);
        await assert.rejects(client.query("insert into app.transition_acks values ('forged','committed',now(),1)"), /permission denied/);
      } finally { client.release(); }
    });
    await t.test("a poison event rolls back alone: later events deliver, only its code is kept, and it retries after fresh ones", async () => {
      const name = "poison_transitioned";
      await db.transaction("", async (sql) => { await emit(sql, { ...event("poison"), name }); await emit(sql, { ...event("healthy"), name }); }, true);
      const seen: string[] = [];
      const handler = async (sql: Parameters<typeof consume>[0], e: TransitionEvent) => {
        seen.push(e.id);
        await sql.query("insert into app.outbox_effect_probe values ('poison-reader',$1)", [e.id]);
        if (e.id === "poison") throw new Error("NOT_FOUND: payment row pay-731 for person-a@example.test");
      };
      assert.equal(await relay(db, "poison-reader", [name], handler, world), 1);
      assert.deepEqual(seen, ["poison", "healthy"], "the healthy event after the poison one is still delivered in the same batch");
      assert.deepEqual((await admin.query("select event_id from app.outbox_effect_probe where consumer='poison-reader'")).rows, [{ event_id: "healthy" }]);
      assert.deepEqual((await admin.query("select event_id from app.transition_acks where consumer='poison-reader'")).rows, [{ event_id: "healthy" }]);
      assert.deepEqual((await admin.query("select event_id,attempts,last_error from app.transition_failures where consumer='poison-reader'")).rows,
        [{ event_id: "poison", attempts: 1, last_error: "NOT_FOUND" }], "the code only, not the message's data");
      await db.transaction("", (sql) => emit(sql, { ...event("fresh"), name }), true);
      seen.length = 0;
      assert.equal(await relay(db, "poison-reader", [name], handler, world), 1);
      assert.deepEqual(seen, ["fresh", "poison"], "a failed event is retried after fresher ones");
      assert.equal((await admin.query("select attempts from app.transition_failures where event_id='poison'")).rows[0].attempts, 2);
    });
    await t.test("permanent poison events beyond the batch limit never starve a later event that fails once", async () => {
      const name = "starve_transitioned";
      await db.transaction("", async (sql) => {
        for (const id of ["stuck-1", "stuck-2", "stuck-3", "late-row"]) await emit(sql, { ...event(id), name });
      }, true);
      let lateTries = 0;
      const handler = async (_sql: Parameters<typeof consume>[0], e: TransitionEvent) => {
        if (e.id.startsWith("stuck-")) throw new Error("NOT_FOUND: payment row");
        if (e.id === "late-row" && lateTries++ === 0) throw new Error("NOT_FOUND: payment row not committed yet");
      };
      for (let i = 0; i < 6; i++) await relay(db, "starve-reader", [name], handler, world, 2);
      assert.deepEqual((await admin.query("select event_id from app.transition_acks where consumer='starve-reader'")).rows, [{ event_id: "late-row" }],
        "the event that failed once is retried and delivered although three poison events outnumber the batch");
      assert.equal((await admin.query("select count(*)::int as n from app.transition_failures where consumer='starve-reader'")).rows[0].n, 3);
    });
    await t.test("a source committing behind another delivered sequence is not lost", async () => {
      const late = await db.worker.connect(); await late.query("begin");
      try {
        await emit(late, { ...event("late"), name: "late_transitioned" });
        await db.transaction("", (sql) => emit(sql, { ...event("early"), name: "late_transitioned" }), true);
        const seen: string[] = [];
        assert.equal(await relay(db, "late-reader", ["late_transitioned"], async (_sql, e) => { seen.push(e.id); }, world), 1);
        await late.query("commit");
        assert.equal(await relay(db, "late-reader", ["late_transitioned"], async (_sql, e) => { seen.push(e.id); }, world), 1);
        assert.deepEqual(seen, ["early", "late"]);
      } finally { await late.query("rollback"); late.release(); }
    });
    await t.test("readiness includes beyond-batch and lock-busy envelopes until their ACK commits", async () => {
      const names = ["readiness_transitioned"], consumer = "readiness";
      assert.equal(await hasPending(db.worker,consumer,names),false);
      await db.transaction("",async (sql) => {
        for (let n=0;n<101;n++) await emit(sql,{ ...event(`ready-${n}`), name: names[0]! });
      },true);
      assert.equal(await relay(db,consumer,names,async () => {},world),100);
      assert.equal(await hasPending(db.worker,consumer,names),true,"one full relay batch leaves the 101st envelope pending");
      const held = await db.worker.connect();
      try {
        await held.query("begin");
        assert.equal(await consume(held,consumer,"ready-100",async () => {},WORLD),true);
        assert.equal(await hasPending(held,consumer,names),false,"passed Sql sees its own uncommitted ACK");
        assert.equal(await relay(db,consumer,names,async () => {},world),0,"another relay skips the busy event");
        assert.equal(await hasPending(db.worker,consumer,names),true,"readiness must not skip its busy uncommitted ACK");
        await held.query("rollback");
        assert.equal(await hasPending(db.worker,consumer,names),true,"rolled-back ACK leaves work pending");
        await held.query("begin");
        await consume(held,consumer,"ready-100",async () => {},WORLD);
        await held.query("commit");
      } finally { await held.query("rollback"); held.release(); }
      assert.equal(await hasPending(db.worker,consumer,names),false,"only committed ACK closes readiness");
      assert.equal(await hasPending(db.worker,"another-consumer",names),true,"ACKs belong to their consumer");
      await db.transaction("",(sql) => emit(sql,{ ...event("ready-other"), name: "other_transitioned" }),true);
      assert.equal(await hasPending(db.worker,consumer,names),false,"unrelated envelope names do not block readiness");
      assert.equal(await hasPending(db.worker,consumer,["other_transitioned"]),true);
      assert.equal(await hasPending(db.worker,consumer,[]),false);
      await assert.rejects(db.ownerTransaction({ kind: "person", id: "person-a" },(sql) => hasPending(sql,consumer,names)),/permission denied/,
        "the reader must not elevate caller visibility or add tenant ACK grants");
    });
  } finally { await db.close(); await admin.end(); }
});

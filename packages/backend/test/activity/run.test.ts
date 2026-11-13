import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrateActivity, note, paymentTransitions, type Owner } from "../../src/activity/door.ts";
import { Database } from "../../src/platform/db.ts";
import { consume, emit, migrateOutbox, readEvent, relay, type TransitionEvent } from "../../src/platform/outbox.ts";

const url = process.env.ACTIVITY_TEST_ADMIN_URL;
// The relay's world instant for ACKs (runtime.outbox-host-stamps); a fixed stopped clock.
const WORLD = 1_900_000_000_000, world = async () => WORLD;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname) || new URL(url).pathname !== "/activity_test") {
  throw new Error("ACTIVITY_TEST_ADMIN_URL must name a dedicated loopback activity_test database; this is component proof, not selected-stack acceptance");
}
const connect = async (role?: string) => {
  const client = new pg.Client({ connectionString: url }); await client.connect();
  if (role) await client.query(`set role ${role}`);
  return client;
};
const event = (id: string, transition = "open", owner: Owner = { kind: "person", id: "same" }, payment = "internal"): TransitionEvent => ({
  id, at: 1234567890123, name: "payment_transitioned", machine: "payment", entity_id: payment,
  owner_kind: owner.kind, owner_id: owner.id, actor: "different-actor", trace_id: `trace-${id}`,
  props: { owner_kind: owner.kind, owner_id: owner.id, payment_id: payment, transition,
    from: null, to: "prepared", command_id: null, route: "personal", outcome: null },
});
async function apply(e: TransitionEvent, rollback = false) {
  const c = await connect("capxul_worker");
  try { await c.query("begin"); await note(c, e); await c.query(rollback ? "rollback" : "commit"); }
  finally { await c.end(); }
}

if (process.argv[2] === "crash-worker") {
  const c = await connect("capxul_worker"), e = JSON.parse(process.argv[3]!) as TransitionEvent;
  await c.query("begin");
  if (process.argv[5] === "outbox") await consume(c, "activity.changes", e.id, note, WORLD);
  else await note(c, e);
  if (process.argv[4] === "after-commit") await c.query("commit");
  process.send!("boundary"); // The parent kills this real process with its transaction/connection still live.
  await new Promise(() => {});
} else {
  test("Postgres activity: isolated feeds, gapless concurrent commits, redelivery and process death", { timeout: 30_000 }, async (t) => {
    const admin = await connect();
    try {
      assert.equal((await admin.query("select current_database() as name")).rows[0].name, "activity_test");
      await admin.query(`create schema app;
        create role capxul_core nosuperuser nobypassrls;
        create role capxul_worker nosuperuser nobypassrls;
        create role capxul_ponder nosuperuser nobypassrls;
        grant usage on schema app to capxul_core,capxul_worker,capxul_ponder;
        create table app.payments(owner_kind text,owner_id text,id text,payee_kind text,payee_id text);
        grant select on app.payments to capxul_worker;
        insert into app.payments values
          ('person','same','internal','organization','same'),
          ('person','same','self','person','same'),
          ('person','same','outside',null,null),
          ('organization','same','reciprocal','person','same');`);
      await migrateActivity(admin);
      await migrateActivity(admin);
      await migrateOutbox(admin);
      const rows = async () => (await admin.query("select * from app.activity_changes order by owner_kind,owner_id,seq")).rows;
      await t.test("migration has exactly the declared fields, nullability, key and two indexes", async () => {
        const columns = (await admin.query(`select column_name,data_type,is_nullable from information_schema.columns
          where table_schema='app' and table_name='activity_changes' order by ordinal_position`)).rows;
        assert.deepEqual(columns, [
          ["owner_id", "text", "NO"], ["owner_kind", "text", "NO"], ["seq", "bigint", "NO"],
          ["row_kind", "text", "NO"], ["row_id", "text", "NO"], ["change", "text", "NO"],
          ["transition", "text", "NO"], ["from", "text", "YES"], ["to", "text", "NO"],
          ["event_id", "text", "NO"], ["changed_at", "double precision", "NO"],
        ].map(([column_name, data_type, is_nullable]) => ({ column_name, data_type, is_nullable })));
        const indexes = (await admin.query(`select i.indisprimary as primary,i.indisunique as unique,
          array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,n)
            join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum order by k.n) as fields
          from pg_index i where i.indrelid='app.activity_changes'::regclass order by i.indisprimary desc,i.indisunique`)).rows;
        assert.deepEqual(indexes, [
          { primary: true, unique: true, fields: ["owner_id", "owner_kind", "seq"] },
          { primary: false, unique: false, fields: ["owner_id", "owner_kind", "row_kind", "row_id", "seq"] },
          { primary: false, unique: true, fields: ["owner_id", "owner_kind", "event_id"] },
        ]);
      });
      await t.test("all eleven handlers, reordered first arrival, duplicate identity and distinct owner kinds", async () => {
        // Out-of-order delivery: settle arrives before open; `new` is a feed fact, not the transition name.
        for (const tr of ["settle", ...paymentTransitions.filter((v) => v !== "settle")]) await apply(event(`event-${tr}`, tr));
        const before = await rows();
        for (const tr of paymentTransitions) await apply(event(`event-${tr}`, tr));
        assert.deepEqual(await rows(), before);
        for (const kind of ["person", "organization"]) {
          const feed = before.filter((r) => r.owner_kind === kind);
          assert.equal(feed.length, 11);
          assert.deepEqual(feed.map((r) => r.seq), Array.from({ length: 11 }, (_, i) => String(i + 1)));
          assert.deepEqual(feed.map((r) => r.change), ["new", ...Array(10).fill("updated")]);
          assert.equal(feed[0].transition, "settle"); assert.equal(feed[0].changed_at, 1234567890123);
        }
        await apply(event("self", "open", undefined, "self"));
        await apply(event("outside", "open", undefined, "outside"));
        assert.equal((await rows()).filter((r) => r.event_id === "self").length, 1);
        assert.equal((await rows()).filter((r) => r.event_id === "outside").length, 1);
      });
      await t.test("RLS denies foreign and unset owners; no tenant, worker or Ponder updates/deletes", async () => {
        const tenant = await connect("capxul_core");
        try {
          assert.equal((await tenant.query("select * from app.activity_changes")).rowCount, 0);
          await tenant.query("begin");
          await tenant.query("select set_config('app.owner_kind','person',true),set_config('app.owner_id','same',true)");
          const own = (await tenant.query("select * from app.activity_changes")).rows;
          assert.equal(own.length, 13); assert(own.every((r) => r.owner_kind === "person"));
          assert.equal((await tenant.query("select * from app.activity_changes where owner_kind='organization'")).rowCount, 0);
          await tenant.query("commit");
          assert.equal((await tenant.query("select * from app.activity_changes")).rowCount, 0, "transaction-local identity must not leak");
        } finally { await tenant.end(); }
        for (const role of ["capxul_core", "capxul_worker", "capxul_ponder"]) {
          const c = await connect(role);
          try {
            for (const mutation of ["update app.activity_changes set change='updated'", "delete from app.activity_changes"]) {
              await assert.rejects(c.query(mutation), { code: "42501" });
            }
            if (role !== "capxul_worker") await assert.rejects(c.query(`insert into app.activity_changes
              values ('intruder','person',1,'payment','wrong','new','open',null,'prepared','forged',1)`), { code: "42501" });
          } finally { await c.end(); }
        }
      });
      await t.test("rollback and competing reciprocal workflows leave no gaps or deadlocks", async () => {
        await apply(event("rolled-back"), true);
        await Promise.all(Array.from({ length: 30 }, (_, i) => apply(i % 2
          ? event(`concurrent-${i}`) : event(`concurrent-${i}`, "open", { kind: "organization", id: "same" }, "reciprocal"))));
        await Promise.all(Array.from({ length: 8 }, () => apply(event("same-concurrent-key"))));
        const all = await rows(); assert(!all.some((r) => r.event_id === "rolled-back"));
        assert.equal(all.filter((r) => r.event_id === "same-concurrent-key").length, 2);
        for (const kind of ["person", "organization"]) {
          const feed = all.filter((r) => r.owner_kind === kind);
          assert.deepEqual(feed.map((r) => r.seq), Array.from({ length: feed.length }, (_, i) => String(i + 1)));
        }
      });
      await t.test("a pending earlier append cannot be overtaken by a reader's next sequence", async () => {
        const c = await connect("capxul_worker"); await c.query("begin");
        try {
          await note(c, event("slow-first"));
          const before = await rows();
          const later = apply(event("fast-second"));
          await c.query("commit"); await later;
          const feed = (await rows()).filter((r) => r.owner_kind === "person");
          const cursor = before.filter((r) => r.owner_kind === "person").at(-1)!.seq;
          assert.deepEqual(feed.filter((r) => BigInt(r.seq) > BigInt(cursor)).map((r) => r.event_id), ["slow-first", "fast-second"]);
        } finally { await c.end(); }
      });
      await t.test("SIGKILL before commit rolls back both sides; after commit redelivery changes nothing", async () => {
        for (const boundary of ["before-commit", "after-commit"]) {
          const e = event(`kill-${boundary}`), before = await rows();
          const child = fork(fileURLToPath(import.meta.url), ["crash-worker", JSON.stringify(e), boundary], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
          try { assert.deepEqual(await once(child, "message"), ["boundary", undefined]); }
          finally { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
          const killed = await rows();
          if (boundary === "before-commit") assert.deepEqual(killed, before);
          else assert.equal(killed.length, before.length + 2);
          await apply(e); const completed = await rows();
          assert.equal(completed.length, before.length + 2);
          await apply(e); assert.deepEqual(await rows(), completed);
        }
      });
      await t.test("late movement is one side, remains noted once across remove/restore", async () => {
        const movement: TransitionEvent = { id: "movement-event", at: 1234567890124, name: "movement_transitioned",
          machine: "movement", entity_id: `84532:0x${"a".repeat(64)}:7:in`,
          owner_kind: "organization", owner_id: "same", actor: null, trace_id: "movement-trace",
          props: { owner_kind: "organization", owner_id: "same", transition: "record", from: null, to: "recorded",
            chain_id: 84532, tx_hash: `0x${"a".repeat(64)}`, log_index: 7, side: "in" } };
        await apply(movement); const before = await rows();
        await apply(movement);
        await apply({ ...movement, id: "remove", props: { ...movement.props, transition: "remove", from: "recorded", to: "removed" } });
        await apply({ ...movement, id: "restore", props: { ...movement.props, transition: "restore", from: "removed" } });
        assert.deepEqual(await rows(), before);
        const row = before.find((r) => r.event_id === "movement-event")!;
        assert.equal(row.row_id, `84532:0x${"a".repeat(64)}:7:in`); assert.equal(row.change, "new");
        await apply({ ...movement, id: "other-owner", owner_kind: "person", owner_id: "other",
          props: { ...movement.props, owner_kind: "person", owner_id: "other" } });
        const tenant = await connect("capxul_core");
        try {
          await tenant.query("begin");
          await tenant.query("select set_config('app.owner_kind','person',true),set_config('app.owner_id','other',true)");
          assert.deepEqual((await tenant.query("select event_id from app.activity_changes")).rows, [{ event_id: "other-owner" }]);
          await tenant.query("commit");
        } finally { await tenant.end(); }
      });
      await t.test("canonical relay commits both feeds and ACK together, retrying after failure and process death", async () => {
        const roleUrl = (role: string) => { const u = new URL(url!); u.username = role; return u.href; };
        await admin.query("alter role capxul_core login; alter role capxul_worker login");
        const db = new Database(roleUrl("capxul_core"), roleUrl("capxul_worker"));
        const names = ["payment_transitioned", "movement_transitioned"];
        const ack = async (id: string) => (await admin.query(
          "select 1 from app.transition_acks where consumer='activity.changes' and event_id=$1", [id])).rowCount;
        const publish = (e: TransitionEvent) => db.transaction("", (sql) => emit(sql, e), true);
        try {
          const before = await rows(), e = event("canonical-retry");
          await assert.rejects(db.transaction("", async (sql) => {
            await emit(sql, event("source-rollback")); throw new Error("source rolled back");
          }, true), /source rolled back/);
          assert.equal(await readEvent(admin, "source-rollback"), null);
          await publish(e);
          assert.deepEqual(await rows(), before, "source commit is separate from Activity delivery");
          // A failing event rolls back alone and is recorded by its code (runtime.outbox-poison-event).
          assert.equal(await relay(db, "activity.changes", names, async (sql, source) => {
            await note(sql, source); throw new Error("WRONG_STATE: failed after both appends");
          }, world), 0);
          assert.deepEqual(await rows(), before); assert.equal(await ack(e.id), 0);
          assert.deepEqual((await admin.query("select attempts,last_error from app.transition_failures where consumer='activity.changes' and event_id=$1", [e.id])).rows,
            [{ attempts: 1, last_error: "WRONG_STATE" }]);
          assert.deepEqual(await readEvent(admin, e.id), e, "consumer cannot change the source envelope");
          const counts = await Promise.all([relay(db, "activity.changes", names, note, world), relay(db, "activity.changes", names, note, world)]);
          assert.equal(counts.reduce((a, b) => a + b), 1);
          const completed = await rows();
          assert.equal(completed.length, before.length + 2); assert.equal(await ack(e.id), 1);
          assert(completed.filter((r) => r.event_id === e.id).every((r) => r.changed_at === e.at));
          assert.equal(await relay(db, "activity.changes", names, note, world), 0);
          assert.deepEqual(await rows(), completed);
          const movement: TransitionEvent = { ...event("outbox-movement"), name: "movement_transitioned", machine: "movement",
            entity_id: "84532:0xabc:17:out", props: { owner_kind: "person", owner_id: "same", transition: "record",
              from: null, to: "recorded", chain_id: 84532, tx_hash: "0xabc", log_index: 17, side: "out" } };
          await publish(movement); assert.equal(await relay(db, "activity.changes", names, note, world), 1);
          const withMovement = await rows();
          const change = withMovement.find((r) => r.event_id === movement.id)!;
          assert.equal(change.row_id, movement.entity_id); assert.equal(change.row_kind, "movement");
          assert.equal(change.change, "new"); assert.equal(await ack(movement.id), 1);
          for (const transition of ["remove", "restore"]) {
            const source = { ...movement, id: `outbox-movement-${transition}`,
              props: { ...movement.props, transition, from: transition === "remove" ? "recorded" : "removed", to: transition === "remove" ? "removed" : "recorded" } };
            await publish(source); assert.equal(await relay(db, "activity.changes", names, note, world), 1);
            assert.equal(await ack(source.id), 1); assert.deepEqual(await rows(), withMovement);
          }
          for (const boundary of ["before-commit", "after-commit"]) {
            const source = event(`outbox-kill-${boundary}`), prior = await rows();
            await publish(source);
            const child = fork(fileURLToPath(import.meta.url), ["crash-worker", JSON.stringify(source), boundary, "outbox"],
              { stdio: ["ignore", "ignore", "inherit", "ipc"] });
            try { assert.deepEqual(await once(child, "message"), ["boundary", undefined]); }
            finally { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
            if (boundary === "before-commit") {
              assert.deepEqual(await rows(), prior); assert.equal(await ack(source.id), 0);
              assert.equal(await relay(db, "activity.changes", names, note, world), 1);
            } else {
              assert.equal((await rows()).length, prior.length + 2); assert.equal(await ack(source.id), 1);
              assert.equal(await relay(db, "activity.changes", names, note, world), 0);
            }
            const finished = await rows();
            assert.equal(finished.length, prior.length + 2); assert.equal(await ack(source.id), 1);
            assert.equal(await relay(db, "activity.changes", names, note, world), 0);
            assert.deepEqual(await rows(), finished); assert.deepEqual(await readEvent(admin, source.id), source);
          }
          const prior = await rows();
          for (const bad of [
            { ...event("wrong-owner"), owner_id: "foreign" },
            { ...event("wrong-name"), name: "unrelated_transitioned" },
            { ...event("wrong-machine"), machine: "unrelated" },
            { ...event("wrong-entity"), entity_id: "another-payment" },
            event("unknown-transition", "invented"), event("missing-payment", "open", undefined, "absent"),
            { ...movement, id: "bad-movement", props: { ...movement.props, side: "both" } },
          ]) {
            await publish(bad);
            await assert.rejects(db.transaction("", (sql) => consume(sql, "activity.changes", bad.id, note, WORLD), true), /ACTIVITY_/);
            assert.equal(await ack(bad.id), 0); assert.deepEqual(await rows(), prior);
          }
        } finally { await db.close(); }
      });
    } finally { await admin.end(); }
  });
}

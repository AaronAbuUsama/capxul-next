// Regression controls for Activity's selected-stack checks against a disposable Postgres: every check passes on a correct
// world and fails when one property is broken, then passes again after the repair. Component evidence, never acceptance.
// Run: ACTIVITY_PROOF_DATABASE=postgres://<admin>@127.0.0.1:<port>/activity_proof node --experimental-strip-types \
//   --no-warnings --test packages/evals/src/modules/activity/activity.native.test.ts
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { migrateActivity, note } from "../../../../backend/src/activity/door.ts";
import { Database } from "../../../../backend/src/devnet/door.ts";
import { consume, emit, migrateOutbox, readEvent, relay } from "../../../../backend/src/platform/outbox.ts";
import { constraints, crossOwner, schema, tenancy, writerAcl } from "./tables.ts";
import { idempotent, movementsNoted, resumed } from "./workflows.ts";

const CONSUMER = "activity.changes", NAMES = ["payment_transitioned", "movement_transitioned"];
const role = (admin: string, name: string) => { const u = new URL(admin); u.username = name; u.password = "proof"; return u.href; };
const runtime = (admin: string) => new Database(role(admin, "capxul_core"), role(admin, "capxul_worker"));

if (process.argv[2] === "activity-native-child") {
  // Effect only, then hold the transaction open: the state Runtime's resume fault leaves before the ACK insert.
  const db = runtime(process.argv[3]!), c = await db.worker.connect();
  await c.query("begin"); await note(c, (await readEvent(c, process.argv[4]!))!);
  process.send!("reached"); await new Promise(() => {});
}

const url = process.env.ACTIVITY_PROOF_DATABASE;
type Kind = "person" | "organization";
type Control = [name: string, broken: string, check: () => Promise<unknown>, revert: string];

/** A fresh `app` schema with Core's three roles, a minimal payments side, the real outbox and Activity's migration. */
async function fresh(payments: string): Promise<{ admin: Database; db: Database }> {
  const u = new URL(url!);
  assert(["127.0.0.1", "localhost"].includes(u.hostname));
  assert.equal(u.pathname, "/activity_proof", "only the disposable component database is accepted");
  const admin = new Database(u.href, u.href);
  await admin.worker.query(`drop schema if exists app cascade; do $$ begin
    if not exists (select 1 from pg_roles where rolname='capxul_core') then create role capxul_core login nosuperuser nobypassrls; end if;
    if not exists (select 1 from pg_roles where rolname='capxul_worker') then create role capxul_worker login nosuperuser nobypassrls; end if;
    if not exists (select 1 from pg_roles where rolname='capxul_ponder') then create role capxul_ponder login nosuperuser nobypassrls; end if; end $$;
    alter role capxul_core password 'proof'; alter role capxul_worker password 'proof';
    create schema app; grant usage on schema app to capxul_core,capxul_worker,capxul_ponder;
    create table app.payments(owner_kind text,owner_id text,id text,payee_kind text,payee_id text);
    grant select on app.payments to capxul_worker; insert into app.payments values ${payments};`);
  const c = await admin.worker.connect();
  try { await migrateOutbox(c); await migrateActivity(c); } finally { c.release(); }
  return { admin, db: runtime(u.href) };
}

let at = 1_700_000_000_000;
const pay = (db: Database, id: string, owner: [Kind, string], transition: string, from: string | null, to: string) =>
  db.transaction("", (sql) => emit(sql, { id: randomUUID(), name: "payment_transitioned", machine: "payment", entity_id: id,
    owner_kind: owner[0], owner_id: owner[1], actor: null, trace_id: randomUUID(), at: at += 1000,
    props: { from, to, transition, payment_id: id, owner_kind: owner[0], owner_id: owner[1], command_id: null, route: "budget", outcome: null } }), true);
// Receipt-ordinal log id 0 while the block log index is 3: the change log must copy entity_id, never rebuild it from props.
const move = (db: Database, transition: string, from: string | null, to: string, side: "in" | "out", owner: [Kind, string]) =>
  db.transaction("", (sql) => emit(sql, { id: randomUUID(), name: "movement_transitioned", machine: "movement",
    entity_id: `84532:0xabc:0:${side}`, owner_kind: owner[0], owner_id: owner[1], actor: null, trace_id: randomUUID(), at: at += 1000,
    props: { from, to, transition, owner_kind: owner[0], owner_id: owner[1], chain_id: 84532, tx_hash: "0xabc", log_index: 3, side } }), true);

test("Activity table, idempotency and Movement checks pass on a correct world and catch each broken property",
  { skip: !url, timeout: 120_000 }, async () => {
    const { admin, db } = await fresh("('organization','org-1','A','person','p-1'),('person','p-2','B',null,null),('organization','org-1','C','organization','org-2')");
    try {
      const runStart = new Date(Date.now() - 5_000).toISOString(), dir = mkdtempSync(join(tmpdir(), "activity-native-"));
      const owners: Record<string, [Kind, string]> = { A: ["organization", "org-1"], B: ["person", "p-2"], C: ["organization", "org-1"] };
      const plan: [string, string, string | null, string][] = [
        ["A", "open", null, "prepared"], ["A", "submit", "prepared", "submitted"], ["A", "settle", "submitted", "settled"],
        ["B", "open", null, "prepared"], ["B", "schedule", "prepared", "scheduled"], ["B", "come_due", "scheduled", "due"], ["B", "cancel", "due", "cancelled"],
        ["C", "open", null, "prepared"], ["C", "escrow", "prepared", "escrowed"], ["C", "lapse", "escrowed", "needs_retry"], ["C", "retry", "needs_retry", "prepared"],
        ["C", "submit", "prepared", "submitted"], ["C", "mismatch", "submitted", "mismatched"], ["C", "unsettle", "mismatched", "submitted"],
      ];
      for (const [id, transition, from, to] of plan) await pay(db, id, owners[id]!, transition, from, to);
      await move(db, "record", null, "recorded", "in", ["person", "p-2"]); await move(db, "record", null, "recorded", "out", ["organization", "org-1"]);
      await move(db, "remove", "recorded", "removed", "in", ["person", "p-2"]); await move(db, "restore", "removed", "recorded", "in", ["person", "p-2"]);
      assert.equal(await relay(db, CONSUMER, NAMES, note), plan.length + 4);
      const kinds = [...new Set(plan.map((p) => p[1]))];
      const all = async () => {
        await schema(db, dir); await constraints(db, dir, "native");
        await crossOwner(db, dir, await tenancy(db, dir)); await writerAcl(db, dir);
        for (const t of kinds) await idempotent(db, dir, t, runStart);
        await movementsNoted(db, dir, runStart);
      };
      await all();
      // A restored world's baseline: transitions acknowledged before this run, never noted. Checks scoped to this run ignore them.
      const baseline = [await move(db, "record", null, "recorded", "out", ["person", "p-2"]),
        await pay(db, "B", ["person", "p-2"], "settle", "due", "settled")];
      await admin.worker.query(`insert into app.transition_acks (consumer,event_id,acked_at)
        select $1,id,now()-interval '1 hour' from unnest($2::text[]) id`, [CONSUMER, baseline.map((e) => e.id)]);
      await all();
      const probe = (where: string) => [`create table app.probe as select * from app.activity_changes where ${where}; delete from app.activity_changes where ${where}`,
        "insert into app.activity_changes select * from app.probe; drop table app.probe"] as const;
      const future = () => new Date(Date.now() + 60_000).toISOString();
      const submitAcks = "event_id in (select id from app.transition_outbox where event->'props'->>'transition'='submit')";
      const controls: Control[] = [
        ["extra index", "create index probe_extra on app.activity_changes(row_id)", () => schema(db, dir), "drop index app.probe_extra"],
        ["runtime-owned table", "alter table app.activity_changes owner to capxul_worker", () => schema(db, dir),
          "alter table app.activity_changes owner to current_user; grant select on app.activity_changes to capxul_core; grant select,insert on app.activity_changes to capxul_worker"],
        ["dropped change check", "alter table app.activity_changes drop constraint activity_changes_change_check", () => constraints(db, dir, "c"),
          "alter table app.activity_changes add constraint activity_changes_change_check check (change in ('new','updated'))"],
        ["dropped event key", "drop index app.activity_changes_by_owner_event", () => constraints(db, dir, "c"),
          "create unique index activity_changes_by_owner_event on app.activity_changes (owner_id,owner_kind,event_id)"],
        ["leaky read policy", "drop policy activity_read on app.activity_changes; create policy activity_read on app.activity_changes for select to capxul_core using (true)",
          () => tenancy(db, dir), "drop policy activity_read on app.activity_changes; create policy activity_read on app.activity_changes for select to capxul_core using (owner_kind=current_setting('app.owner_kind',true) and owner_id=current_setting('app.owner_id',true))"],
        ["tenant may insert", "grant insert on app.activity_changes to capxul_core; create policy probe_ins on app.activity_changes for insert to capxul_core with check (true)",
          async () => crossOwner(db, dir, await tenancy(db, dir)), "drop policy probe_ins on app.activity_changes; revoke insert on app.activity_changes from capxul_core"],
        ["tenant may delete own", "grant delete on app.activity_changes to capxul_core", async () => crossOwner(db, dir, await tenancy(db, dir)),
          "revoke delete on app.activity_changes from capxul_core"],
        ["worker may update", "grant update on app.activity_changes to capxul_worker", () => writerAcl(db, dir), "revoke update on app.activity_changes from capxul_worker"],
        ["ACK without append", probe("transition='settle'")[0], () => idempotent(db, dir, "settle", runStart), probe("")[1]],
        ["wrong first-arrival", "update app.activity_changes set change='updated' where transition='open' and row_id='B'",
          () => idempotent(db, dir, "open", runStart), "update app.activity_changes set change='new' where transition='open' and row_id='B'"],
        ["payee feed missing", probe("owner_id='org-2' and transition='escrow'")[0], () => idempotent(db, dir, "escrow", runStart), probe("")[1]],
        ["no such transition acked", "create table app.probe_acks as select * from app.transition_acks a where exists (select 1 from app.transition_outbox o where o.id=a.event_id and o.event->'props'->>'transition'='come_due'); delete from app.transition_acks a using app.probe_acks p where a.consumer=p.consumer and a.event_id=p.event_id",
          () => idempotent(db, dir, "come_due", runStart), "insert into app.transition_acks select * from app.probe_acks; drop table app.probe_acks"],
        ["acked before the run (restored baseline)", `update app.transition_acks set acked_at=acked_at-interval '1 hour' where ${submitAcks}`,
          () => idempotent(db, dir, "submit", runStart), `update app.transition_acks set acked_at=acked_at+interval '1 hour' where ${submitAcks}`],
        ["run started after every ACK", "select 1", () => idempotent(db, dir, "retry", future()), "select 1"],
        ["movement record not appended", probe("row_kind='movement' and owner_id='p-2'")[0], () => movementsNoted(db, dir, runStart), probe("")[1]],
        ["movement remove appended", "insert into app.activity_changes select c.owner_id,c.owner_kind,c.seq+100,c.row_kind,c.row_id,'updated','remove','recorded','removed',o.id,c.changed_at from app.activity_changes c, app.transition_outbox o where c.row_kind='movement' and c.owner_id='p-2' and o.event->'props'->>'transition'='remove'",
          () => movementsNoted(db, dir, runStart), "delete from app.activity_changes where transition='remove'"],
        ["movement row id rebuilt from props", "update app.activity_changes set row_id='84532:0xabc:3:out' where row_kind='movement' and owner_id='org-1'",
          () => movementsNoted(db, dir, runStart), "update app.activity_changes set row_id='84532:0xabc:0:out' where row_kind='movement' and owner_id='org-1'"],
        ["no movement record in the run", "select 1", () => movementsNoted(db, dir, future()), "select 1"],
      ];
      for (const [name, broken, check, revert] of controls) {
        await admin.worker.query(broken);
        await assert.rejects(check(), Error, `control "${name}" was not detected`);
        await admin.worker.query(revert);
        await all();
      }
    } finally { await db.close(); await admin.close(); }
  });

test("Activity resume check passes after a real SIGKILL between the appender and its ACK, and catches each broken property",
  { skip: !url, timeout: 120_000 }, async () => {
    const { admin, db } = await fresh("('organization','org-1','A','person','p-1')");
    try {
      const dir = mkdtempSync(join(tmpdir(), "activity-native-resume-"));
      await pay(db, "A", ["organization", "org-1"], "open", null, "prepared"); await relay(db, CONSUMER, NAMES, note);
      const after = Number((await admin.worker.query("select max(seq) as s from app.transition_outbox")).rows[0].s);
      const submit = await pay(db, "A", ["organization", "org-1"], "submit", "prepared", "submitted");
      const child = fork(fileURLToPath(import.meta.url), ["activity-native-child", url!, submit.id], { execArgv: ["--experimental-strip-types", "--no-warnings"] });
      await once(child, "message"); child.kill("SIGKILL"); await once(child, "exit");
      const killedAt = Date.now();
      await new Promise((done) => setTimeout(done, 50));
      const noted = async () => (await admin.worker.query("select count(*)::int as n from app.activity_changes where event_id=$1", [submit.id])).rows[0].n;
      assert.equal(await noted(), 0, "the killed effect rolled back");
      const fault = { consumer: CONSUMER, eventId: submit.id, event: "payment_transitioned", transition: "submit", reachedAt: killedAt - 1,
        killed: { pid: child.pid!, signal: "SIGKILL", at: killedAt }, restarted: { pid: process.pid, readyAt: Date.now() } };
      const ok = { fault, after, driven: submit.id };
      // The restarted relay redelivers late: the check must wait for it, not read straight after /ready.
      const late = new Promise((done) => setTimeout(done, 1500)).then(() => relay(db, CONSUMER, NAMES, note));
      await resumed(db, dir, "submit", ok); assert.equal(await late, 1);
      const unacked = [`create table app.probe as select * from app.transition_acks where event_id='${submit.id}'; delete from app.transition_acks where event_id='${submit.id}'`,
        "insert into app.transition_acks select * from app.probe; drop table app.probe"] as const;
      const controls: Control[] = [
        ["wrong kind under test", "select 1", () => resumed(db, dir, "settle", ok), "select 1"],
        ["ACK predates the kill", "select 1", () => resumed(db, dir, "submit", { ...ok, fault: { ...fault, killed: { ...fault.killed, at: Date.now() + 60_000 } } }), "select 1"],
        ["other consumer", "select 1", () => resumed(db, dir, "submit", { ...ok, fault: { ...fault, consumer: "notices" } }), "select 1"],
        ["faulted event predates the arm", "select 1", () => resumed(db, dir, "submit", { ...ok, after: after + 100 }), "select 1"],
        ["fault held another event than the drive's", "select 1", () => resumed(db, dir, "submit", { ...ok, driven: "some-other-event" }), "select 1"],
        ["trigger on transition_acks", "create function app.probe_t() returns trigger language plpgsql as $$ begin return new; end $$; create trigger probe_t before insert on app.transition_acks for each row execute function app.probe_t()",
          () => resumed(db, dir, "submit", ok), "drop trigger probe_t on app.transition_acks; drop function app.probe_t()"],
        ["ACK clock source changed", "alter table app.transition_acks alter column acked_at set default '2000-01-01'::timestamptz",
          () => resumed(db, dir, "submit", ok), "alter table app.transition_acks alter column acked_at set default now()"],
        ["seq gap in a holding feed", "update app.activity_changes set seq=seq+10 where owner_id='p-1' and transition='submit'",
          () => resumed(db, dir, "submit", ok), "update app.activity_changes set seq=seq-10 where owner_id='p-1' and transition='submit'"],
        ["payee feed missing", "create table app.probe as select * from app.activity_changes where owner_id='p-1' and transition='submit'; delete from app.activity_changes where owner_id='p-1' and transition='submit'",
          () => resumed(db, dir, "submit", ok), "insert into app.activity_changes select * from app.probe; drop table app.probe"],
        ["event never acknowledged within 30 s", unacked[0], () => resumed(db, dir, "submit", ok), unacked[1]],
      ];
      for (const [name, broken, check, revert] of controls) {
        await admin.worker.query(broken);
        await assert.rejects(check(), Error, `control "${name}" was not detected`);
        await admin.worker.query(revert);
        await resumed(db, dir, "submit", ok);
      }
      const c = await db.worker.connect();
      try { assert.equal(await consume(c, CONSUMER, submit.id, note), false, "the redelivered event is consumed once"); } finally { c.release(); }
    } finally { await db.close(); await admin.close(); }
  });

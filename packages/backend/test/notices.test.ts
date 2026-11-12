import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Database } from "../src/platform/db.ts";
import { deliverDue, planDelivery, recordOutcome, type Emit } from "../src/notices/delivery.ts";
import type { Intent } from "../src/notices/templates.ts";
import { finishDue, prepareDue, schedule } from "../src/notices/workflows.ts";
import type { Sql } from "../src/platform/db.ts";
import type { TransitionEvent } from "../src/platform/outbox.ts";
import { readNotices } from "../src/notices/door.ts";

if (process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("notices tests require an explicitly disposable migrated Postgres world");
const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
test.after(() => db.close());
const instant = 1_800_000_000_000;
const intent = (id: string): Intent => ({
  recipient: `${id}@notices.test`, notice_id: `beta-welcome:${id}`, template: "beta-welcome",
  subject_kind: "admission", subject_id: id, cause: "admit", person_id: null, org_id: null, trace_id: id,
  facts: { quickstart: "https://capxul.test/start", chat: "https://capxul.test/chat", support: "help@capxul.test" },
});
const failure = (code: "PROVIDER_ERROR" | "RATE_LIMITED" | "INVALID_INPUT") => ({ error: { code, message: `classified ${code}` } });
const read = (i: Intent) => db.transaction("", async (sql) => {
  await sql.query("select set_config('app.email',$1,true)", [i.recipient.trim().toLowerCase()]);
  return (await sql.query("select * from app.notices where notice_id=$1", [i.notice_id])).rows[0];
});

test("delivery births only after a classified outcome, guards stale retries and retains the last error", async () => {
  const i = intent(randomUUID());
  const events: unknown[] = [];
  const emit: Emit = async (_sql, props) => { events.push(props); };
  await db.transaction("", (sql) => planDelivery(sql, { ...i, recipient: `  ${i.recipient.toUpperCase()}  ` }, instant), true);
  assert.equal(await read(i), undefined);
  const apply = (expected: number, outcome: Parameters<typeof recordOutcome>[4], at: number) =>
    db.transaction("", (sql) => recordOutcome(sql, i.recipient, i.notice_id, expected, outcome, at, emit), true);
  assert.equal((await apply(0, failure("PROVIDER_ERROR"), instant))?.transition, "hold");
  assert.equal((await read(i)).next_attempt_at, instant + 60_000);
  assert.equal(await apply(1, { id: "too-early" }, instant + 59_999), null);
  assert.equal((await apply(1, failure("RATE_LIMITED"), instant + 60_000))?.transition, "defer");
  assert.equal((await read(i)).next_attempt_at, instant + 300_000);
  assert.equal(await apply(1, { id: "stale" }, instant + 300_000), null);
  assert.equal((await apply(2, { id: "mail-accepted" }, instant + 300_000))?.transition, "deliver");
  const row = await read(i);
  assert.equal(row.status, "sent"); assert.equal(row.attempts, 3); assert.equal(row.mail_id, "mail-accepted");
  assert.equal(row.next_attempt_at, null); assert.deepEqual(row.last_error, failure("RATE_LIMITED").error);
  assert.equal(row.created_at, instant); assert.equal(row.updated_at, instant + 300_000);
  assert.deepEqual(row.facts, i.facts);
  assert.equal(await apply(3, failure("PROVIDER_ERROR"), instant + 400_000), null);
  assert.equal(await apply(0, failure("INVALID_INPUT"), instant + 400_000), null);
  assert.equal(events.length, 3);
  assert(!JSON.stringify(events).includes(i.recipient)); assert(!JSON.stringify(events).includes("quickstart"));
});

test("first acceptance, first refusal, retry refusal and exhausted retries have distinct terminal outcomes", async () => {
  for (const [outcomes, expected] of [
    [[{ id: "direct" }], ["send"]], [[failure("INVALID_INPUT")], ["refuse"]],
    [[failure("RATE_LIMITED"), failure("INVALID_INPUT")], ["hold", "fail"]],
    [[failure("PROVIDER_ERROR"), failure("PROVIDER_ERROR"), failure("PROVIDER_ERROR")], ["hold", "defer", "fail"]],
  ] as const) {
    const i = intent(randomUUID()), transitions: string[] = [];
    await db.transaction("", (sql) => planDelivery(sql, i, instant), true);
    for (const [n, result] of outcomes.entries()) {
      await db.transaction("", (sql) => recordOutcome(sql, i.recipient, i.notice_id, n, result, instant + [0,60_000,300_000][n]!,
        async (_sql, event) => { transitions.push(event.transition); }), true);
    }
    assert.deepEqual(transitions, expected);
    const row = await read(i); assert.equal(row.attempts, outcomes.length); assert.equal(row.next_attempt_at, null);
    assert.equal(row.status, "id" in outcomes[0] ? "sent" : "failed");
  }
});

test("mailbox RLS does not admit a company's other recipient, anonymous sessions, writes or Ponder", async () => {
  const a = intent(randomUUID()), b = intent(randomUUID());
  for (const i of [a,b]) await db.transaction("", async (sql) => {
    await planDelivery(sql, i, instant); await recordOutcome(sql, i.recipient, i.notice_id, 0, { id: i.notice_id }, instant, async () => {});
  }, true);
  await db.transaction("", async (sql) => {
    assert.equal((await sql.query("select * from app.notices where notice_id=any($1)", [[a.notice_id,b.notice_id]])).rowCount, 0);
    await sql.query("select set_config('app.email',$1,true)", [a.recipient]);
    assert.deepEqual((await sql.query("select recipient from app.notices where notice_id=any($1)", [[a.notice_id,b.notice_id]])).rows, [{ recipient: a.recipient }]);
  });
  for (const system of [false,true]) {
    for (const statement of ["update app.notices set attempts=1", "delete from app.notices", "insert into app.notices select * from app.notices"]) {
      await assert.rejects(db.transaction("", (sql) => sql.query(statement), system), /permission denied/);
    }
  }
  const acl = (await db.tenant.query("select has_table_privilege('capxul_ponder','app.notices','select') as allowed")).rows[0];
  assert.equal(acl.allowed, false);
});

test("delivery schema is exact and named cross-mailbox queries filter before limiting", async () => {
  const columns = (await db.tenant.query(`select column_name,data_type,is_nullable from information_schema.columns
    where table_schema='app' and table_name='notices' order by ordinal_position`)).rows;
  assert.deepEqual(columns.map((r) => [r.column_name,r.data_type,r.is_nullable]), [
    ["recipient","text","NO"], ["notice_id","text","NO"], ["template","text","NO"],
    ["subject_kind","text","NO"], ["subject_id","text","NO"], ["cause","text","NO"],
    ["person_id","text","YES"], ["org_id","text","YES"], ["facts","jsonb","NO"],
    ["status","text","NO"], ["attempts","integer","NO"], ["last_error","jsonb","YES"],
    ["mail_id","text","YES"], ["next_attempt_at","double precision","YES"],
    ["created_at","double precision","NO"], ["updated_at","double precision","NO"],
  ]);
  const indexes = (await db.tenant.query(`select indexrelid::regclass::text as name,indisprimary as primary,
    array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,ord)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum order by k.ord) as fields
    from pg_index i where indrelid='app.notices'::regclass order by indexrelid::regclass::text`)).rows;
  assert.deepEqual(indexes, [
    { name: "app.by_changed", primary: false, fields: ["updated_at"] },
    { name: "app.by_recipient_changed", primary: false, fields: ["recipient","updated_at"] },
    { name: "app.by_template_changed", primary: false, fields: ["template","updated_at"] },
    { name: "app.notices_pkey", primary: true, fields: ["recipient","notice_id"] },
  ]);
  const id = randomUUID(), older = intent(`${id}-old`), newer = intent(`${id}-new`);
  const mailbox = `${id}@filter.test`;
  await db.transaction("", async (sql) => {
    await planDelivery(sql, { ...older, recipient: mailbox, template: "invoice-paid" }, instant);
    await recordOutcome(sql, mailbox, older.notice_id, 0, { id: "old" }, instant, async () => {});
    // More than the normal 200-row page separates the old template from the newest records.
    for (let n=0; n<201; n++) {
      await planDelivery(sql, { ...newer, recipient: mailbox, notice_id: `${newer.notice_id}:${n}` }, instant+n+1);
      await recordOutcome(sql, mailbox, `${newer.notice_id}:${n}`, 0, { id: `new-${n}` }, instant+n+1, async () => {});
    }
    const filtered = await readNotices(sql, { template: "invoice-paid", to: ` ${mailbox.toUpperCase()} `, limit: 1 });
    assert.deepEqual(filtered.map((r) => r.notice_id), [older.notice_id]);
    const latest = await readNotices(sql, { to: mailbox, limit: 1 });
    assert.deepEqual(latest.map((r) => r.notice_id), [`${newer.notice_id}:200`]);
    assert.equal((await sql.query("select * from app.notices where recipient=$1", [mailbox])).rowCount, 0,
      "named query access must not bypass ordinary mailbox RLS");
  }, true);
  for (const query of ["select * from app.notices_by_changed()", "select * from app.notices_by_template_changed('invoice-paid')"])
    await assert.rejects(db.transaction("", (sql) => sql.query(query)), /permission denied/);
});

test("failed event persistence rolls back the outcome; accepted mail replays the same provider key", async () => {
  const i = intent(randomUUID()); await db.transaction("", (sql) => planDelivery(sql, i, instant), true);
  const accepted = new Map<string,string>(); let calls = 0;
  const mail = { async send(message: { idempotencyKey: string }) {
    calls++; if (!accepted.has(message.idempotencyKey)) accepted.set(message.idempotencyKey, randomUUID());
    return { id: accepted.get(message.idempotencyKey)! };
  } };
  await assert.rejects(deliverDue(db, mail, async () => instant, async () => { throw new Error("outbox unavailable"); }), /outbox unavailable/);
  assert.equal(await read(i), undefined);
  assert.equal(await deliverDue(db, mail, async () => instant, async () => {}), 1);
  assert.equal(calls, 2); assert.equal(accepted.size, 1); assert.equal((await read(i)).attempts, 1);
  assert.equal(await deliverDue(db, mail, async () => instant, async () => {}), 0);
});

test("concurrent workers serialize one mail attempt without a nested pool checkout", async () => {
  const i = intent(randomUUID()); await db.transaction("", (sql) => planDelivery(sql, i, instant), true);
  let calls = 0;
  const mail = { async send() { calls++; return { id: "serialized" }; } };
  await Promise.all(Array.from({ length: 8 }, () => deliverDue(db, mail, async () => instant, async () => {})));
  assert.equal(calls, 1); assert.equal((await read(i)).attempts, 1);
});

test("durable reminders visit every stop and a different payment/owner cannot wake them", async () => {
  const id = randomUUID(), payment = `payment_${id}`;
  const event: TransitionEvent = { id, name: "payment_transitioned", machine: "payment", entity_id: payment,
    owner_kind: "person", owner_id: "owner-A", actor: null, trace_id: id, at: instant,
    props: { transition: "escrow", from: "submitted", to: "escrowed", payment_id: payment } };
  await db.transaction("", (sql) => schedule(sql, event), true);
  await db.transaction("", (sql) => schedule(sql, { ...event, id: randomUUID(), name: "proposal_transitioned", machine: "proposal",
    owner_kind: "organization", owner_id: "company-A", props: { transition: "propose" } }), true);
  const stops: number[] = [];
  const resolve = async (sql: Sql, workflow: string, source: TransitionEvent, days: number | null) => {
    const context = (await sql.query(`select current_setting('app.org_id') as org,
      current_setting('app.owner_kind') as kind,current_setting('app.owner_id') as id`)).rows[0];
    assert.deepEqual(context, { org: source.owner_kind === "organization" ? source.owner_id : "", kind: source.owner_kind, id: source.owner_id });
    if (workflow.endsWith("money-reminders")) stops.push(days!);
    return { intents: [] };
  };
  await prepareDue(db, async () => instant, resolve); await finishDue(db, async () => instant);
  assert.deepEqual(stops, []);
  const moved = { ...event, id: randomUUID(), props: { transition: "settle", to: "settled", payment_id: "different" }, entity_id: "different" };
  await db.transaction("", (sql) => schedule(sql, moved), true);
  await db.transaction("", (sql) => schedule(sql, { ...moved, entity_id: payment, owner_id: "owner-B", props: { ...moved.props,payment_id: payment } }), true);
  await db.transaction("", (sql) => schedule(sql, { ...moved, id: randomUUID(), entity_id: payment }), true);
  assert.equal((await db.worker.query("select finished_at from app.notice_workflows where workflow='notices.payments.money-reminders' and event_id=$1",[id])).rows[0].finished_at,null,
    "the declared payment_id signal key, not generic envelope entity metadata, controls wake correlation");
  // A month warp does not skip the intermediate durable stops.
  for (let n=0; n<3; n++) { await prepareDue(db, async () => instant + 30*86_400_000, resolve); await finishDue(db, async () => instant + 30*86_400_000); }
  assert.deepEqual(stops, [3,10,30]);
  const otherPayment = `payment_${randomUUID()}`;
  const other = { ...event, id: randomUUID(), entity_id: otherPayment, props: { ...event.props,payment_id: otherPayment } };
  await db.transaction("", (sql) => schedule(sql, other), true);
  await db.transaction("", (sql) => schedule(sql, { ...other, id: randomUUID(), props: { transition: "cancel", to: "cancelled",payment_id: otherPayment } }), true);
  const job = (await db.worker.query("select finished_at from app.notice_workflows where workflow='notices.payments.money-reminders' and event_id=$1", [other.id])).rows[0];
  assert.equal(job.finished_at, instant);
});

test("source SQL failures keep healthy recipients, back off five retries, and stop at the preparation deadline", async () => {
  const bad = intent(randomUUID()), good = intent(randomUUID()), prefix = randomUUID();
  const source = (id: string, entity: string, at = instant): TransitionEvent => ({ id: `${prefix}:${id}`,
    name: "proposal_transitioned", machine: "proposal", entity_id: entity, owner_kind: "organization", owner_id: "company",
    actor: null, trace_id: prefix, at, props: { transition: "propose" } });
  const broken = source("a","broken"), healthy = source("z","healthy"), expired = source("b","expired",instant-300_000);
  await db.transaction("", async (sql) => { for (const e of [broken,healthy,expired]) await schedule(sql,e); },true);
  let expiredReads = 0;
  const resolve = async (sql: Sql, _workflow: string, e: TransitionEvent) => {
    if (e.entity_id === "expired") expiredReads++;
    if (e.entity_id === "broken") {
      await planDelivery(sql,bad,instant);
      await sql.query("select 1/0"); // A real SQL error, not just a rejected JavaScript callback.
    }
    return { intents: e.entity_id === "healthy" ? [good] : [] };
  };
  const job = async (e: TransitionEvent) => (await db.worker.query("select * from app.notice_workflows where event_id=$1",[e.id])).rows[0];
  const offsets = [0,1000,3000,7000,15000,31000];
  for (const [n,offset] of offsets.entries()) {
    await prepareDue(db,async () => instant+offset,resolve);
    const row = await job(broken); assert.equal(row.failures,n+1);
    assert.equal(row.failed_at,n === 5 ? instant+offset : null);
    assert.equal(row.retry_at,n === 5 ? null : instant+offset+1000*2**n);
    if (n < 5) {
      await prepareDue(db,async () => row.retry_at-1,resolve);
      assert.equal((await job(broken)).failures,n+1,"a retry must not run a millisecond early");
    }
  }
  assert.equal((await job(broken)).last_error,"source preparation failed");
  assert.equal((await job(expired)).last_error,"preparation deadline exceeded"); assert.equal(expiredReads,0);
  assert.equal((await db.worker.query("select * from app.notice_attempts where notice_id=$1",[bad.notice_id])).rowCount,0);
  assert((await job(healthy)).checkpoint,"a failed source must not erase the healthy recipient checkpoint");
  await deliverDue(db,{ async send() { return { id: "healthy-mail" }; } },async () => instant,async () => {});
  assert.equal((await read(good)).status,"sent");
  await prepareDue(db,async () => instant+60_000,resolve);
  assert.equal((await job(broken)).failures,6,"exhausted source retries stay stopped");
});

test("SIGKILL after provider acceptance resumes the original intent and emits one canonical event", { timeout: 15_000 }, async () => {
  const i = intent(randomUUID()); await db.transaction("", (sql) => planDelivery(sql, i, instant), true);
  const messages: unknown[] = [], accepted = new Map<string,string>();
  let confirm!: () => void;
  const taken = new Promise<void>((done) => { confirm = done; });
  const receiver = createServer(async (req,res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const message = JSON.parse(Buffer.concat(chunks).toString()); messages.push(message);
    if (!accepted.has(message.idempotencyKey)) accepted.set(message.idempotencyKey, randomUUID());
    if (messages.length === 1) { confirm(); return; } // Taken, but the worker never sees the response.
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: accepted.get(message.idempotencyKey) }));
  });
  await new Promise<void>((done) => receiver.listen(0, "127.0.0.1", done));
  const address = receiver.address(); assert(address && typeof address === "object");
  const start = () => spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./fixtures/notices-worker.ts", import.meta.url))], {
    env: { ...process.env, NOTICE_TEST_MAIL_URL: `http://127.0.0.1:${address.port}`, NOTICE_TEST_NOW: String(instant) }, stdio: ["ignore","pipe","pipe"],
  });
  const exit = (worker: ReturnType<typeof start>) => new Promise<{ code: number | null; signal: string | null }>((done,reject) => {
    worker.once("error", reject);
    worker.once("exit", (code,signal) => done({ code,signal }));
  });
  const child = start(); let restarted: ReturnType<typeof start> | undefined;
  const childExit = exit(child);
  try {
    await Promise.race([taken, childExit.then(({ code,signal }) => { throw new Error(`worker exited before provider acceptance (${code ?? signal})`); })]);
    child.kill("SIGKILL"); assert.equal((await childExit).signal, "SIGKILL");
    assert.equal(await read(i), undefined, "a provider acceptance is not yet a committed delivery outcome");
    restarted = start();
    const { code } = await exit(restarted);
    assert.equal(code, 0); assert.equal(messages.length, 2); assert.deepEqual(messages[1], messages[0]); assert.equal(accepted.size, 1);
    assert.equal((messages[0] as { template?: string }).template, i.template, "the local sink must receive the template tag for filtering");
    const row = await read(i); assert.equal(row.attempts, 1); assert.equal(row.status, "sent");
    assert.deepEqual(row.facts, i.facts); assert.equal(row.mail_id, [...accepted.values()][0]);
    const events = (await db.worker.query("select event from app.transition_outbox where event->>'name'='notice_transitioned' and event->'props'->>'notice_id'=$1", [i.notice_id])).rows;
    assert.equal(events.length, 1); assert.equal(events[0].event.trace_id, i.trace_id); assert.equal(events[0].event.props.transition, "send");
    assert(!JSON.stringify(events).includes(i.recipient));
  } finally {
    for (const worker of [child,restarted]) if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
    receiver.closeAllConnections(); await new Promise<void>((done) => receiver.close(() => done()));
  }
});

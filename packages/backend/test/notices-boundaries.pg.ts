// Delivery isolation, preparation lock order and event owner (PR68 review, 13 November 2026).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Database } from "../src/platform/db.ts";
import { deliverDue, planDelivery } from "../src/notices/delivery.ts";
import type { Intent } from "../src/notices/templates.ts";
import { prepareDue, schedule } from "../src/notices/workflows.ts";
import type { Sql } from "../src/platform/db.ts";
import type { TransitionEvent } from "../src/platform/outbox.ts";
import { deliverNotices } from "../src/notices/door.ts";
import { updateWorldClock, worldNow } from "../src/devnet/door.ts";

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
const read = (i: Intent) => db.transaction("", async (sql) => {
  await sql.query("select set_config('app.email',$1,true)", [i.recipient.trim().toLowerCase()]);
  return (await sql.query("select * from app.notices where notice_id=$1", [i.notice_id])).rows[0];
});

test("an unclassified Mail failure on one row does not starve the rows sorted after it", async () => {
  const first = { ...intent(randomUUID()) }, later = intent(randomUUID());
  await db.transaction("", (sql) => planDelivery(sql, first, instant - 1), true);
  await db.transaction("", (sql) => planDelivery(sql, later, instant), true);
  const sent: string[] = [];
  const mail = { async send(m: { to: string }) {
    if (m.to === first.recipient) throw new Error("socket hang up"); // not a classified MailError
    sent.push(m.to); return { id: "later-mail" };
  } };
  await assert.rejects(deliverDue(db, mail, async () => instant, async () => {}), /socket hang up/);
  assert.deepEqual(sent.filter((to) => to === later.recipient), [later.recipient]);
  assert.equal((await read(later)).status, "sent");
  assert.equal(await read(first), undefined, "an unclassified failure is not a delivery outcome");
});

test("preparation holds no dispatch boundary across source reads, and a stop committed meanwhile wins", { timeout: 15_000 }, async () => {
  const id = randomUUID(), payment = `payment_${id}`;
  const escrow: TransitionEvent = { id, name: "payment_transitioned", machine: "payment", entity_id: payment,
    owner_kind: "person", owner_id: `owner-${id}`, actor: null, trace_id: id, at: instant - 3 * 86_400_000,
    props: { transition: "escrow", from: "submitted", to: "escrowed", payment_id: payment } };
  await db.transaction("", (sql) => schedule(sql, escrow), true);
  const reminder = intent(randomUUID());
  let entered!: () => void, release!: () => void;
  const inside = new Promise<void>((done) => { entered = done; }), gate = new Promise<void>((done) => { release = done; });
  const resolve = async (_sql: Sql, workflow: string) => {
    if (!workflow.endsWith("money-reminders")) return { intents: [] };
    entered(); await gate; // a slow chain-RPC read
    return { intents: [reminder] };
  };
  const preparing = prepareDue(db, async () => instant, resolve);
  await inside;
  // Before the fix the boundary was held here, so this source wake waited for the RPC.
  const stop = { ...escrow, id: randomUUID(), at: instant, props: { transition: "settle", from: "escrowed", to: "settled", payment_id: payment } };
  const stopping = db.transaction("", (sql) => schedule(sql, stop), true);
  try {
    await Promise.race([stopping, new Promise((_, reject) => setTimeout(() => reject(new Error("schedule stalled behind source preparation")), 2_000))]);
  } finally { release(); await preparing; await stopping; }
  const job = (await db.worker.query("select checkpoint,finished_at from app.notice_workflows where workflow='notices.payments.money-reminders' and event_id=$1", [id])).rows[0];
  assert.equal(job.finished_at, instant); assert.equal(job.checkpoint, null);
  assert.equal((await db.worker.query("select 1 from app.notice_attempts where notice_id=$1", [reminder.notice_id])).rowCount, 0,
    "the plan resolved before the stop is discarded, never checkpointed");
});

test("a notice's transition is in its recipient person's scope, and an outside mailbox's is in no Organization's", async () => {
  const previous = (await db.worker.query("select clock from app.world")).rows[0].clock;
  await updateWorldClock(db, { nowMs: instant, rate: 1, clockMode: "stopped" });
  try {
    const payee = { ...intent(randomUUID()), person_id: `person-${randomUUID()}`, org_id: "payer-company" };
    const outside = { ...intent(randomUUID()), person_id: null, org_id: "payer-company" };
    for (const i of [payee, outside]) await db.transaction("", (sql) => planDelivery(sql, i, instant), true);
    await deliverNotices(db, { async send() { return { id: randomUUID() }; } }, worldNow);
    const owner = async (i: Intent) => (await db.worker.query(`select event->>'owner_kind' as kind,event->>'owner_id' as id from app.transition_outbox
      where event->>'name'='notice_transitioned' and event->'props'->>'notice_id'=$1`, [i.notice_id])).rows;
    assert.deepEqual(await owner(payee), [{ kind: "person", id: payee.person_id }]);
    assert.deepEqual(await owner(outside), [{ kind: null, id: null }]);
  } finally { await db.worker.query("update app.world set clock=$1", [previous]); }
});

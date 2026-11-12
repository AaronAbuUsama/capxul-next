import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Database } from "../src/platform/db.ts";
import { emit, type TransitionEvent } from "../src/platform/outbox.ts";
import { noticesWorker, readNotices, type Sources } from "../src/notices/door.ts";

if (process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("notices tests require an explicitly disposable migrated Postgres world");
const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
test.after(() => db.close());
const instant = 1_800_000_000_000;

test("worker commits source ACK and recipients before Mail and replay keeps one outcome", async () => {
  const id = randomUUID(), recipient = `${id}@notices.test`;
  const event: TransitionEvent = { id, name: "waitlist_entry_transitioned", machine: "waitlist-entry", entity_id: id,
    owner_kind: null, owner_id: null, actor: null, trace_id: id, at: instant,
    props: { from: null, to: "admitted", transition: "admit_unlisted", person_id: null, via: "operator", referred: false } };
  await db.transaction("", (sql) => emit(sql,event), true);
  // Source projection is injected: this controls the real dispatcher boundary, not Accounts acceptance.
  const unused = (): never => { throw new Error("unexpected source read"); };
  const sources: Sources = { admission: async () => ({ email: recipient, admitted_by: "operator", referrer_email: null, referral_rewarded_with_invite: false }),
    principal: unused, principalBySafe: unused, principalByEmail: unused, partyName: unused, organization: unused,
    proposal: unused, officerChange: unused, payment: unused, commandPayments: unused, hatWearers: unused, request: unused, safeOwners: unused };
  let sent = 0;
  const tick = noticesWorker(db,{ async send(message) {
    sent++;
    assert.equal(message.to,recipient);
    assert.equal(message.idempotencyKey,JSON.stringify([recipient,`beta-welcome:${id}`]));
    assert.equal((await db.worker.query("select 1 from app.transition_acks where consumer='notices' and event_id=$1",[id])).rowCount,1);
    const checkpoint = (await db.worker.query("select checkpoint from app.notice_workflows where event_id=$1",[id])).rows[0].checkpoint;
    assert.deepEqual(checkpoint.targets,[{ recipient, notice_id: `beta-welcome:${id}` }]);
    return { id: "committed-mail" };
  } },sources,{ quickstart: "https://capxul.test/start", chat: "https://capxul.test/chat", support: "support@capxul.test",
    signup: "https://capxul.test/signup", approval: unused, explorer: unused },async () => instant);
  assert(await tick() > 0);
  await db.transaction("",(sql) => emit(sql,event),true);
  assert.equal(await tick(),0);
  assert.equal(sent,1);
  const deliveries = await db.transaction("",(sql) => readNotices(sql,{ to: recipient }),true);
  assert.equal(deliveries.length,1); assert.equal(deliveries[0]!.status,"sent"); assert.equal(deliveries[0]!.mail_id,"committed-mail");
  const outcomes = (await db.worker.query("select event from app.transition_outbox where event->>'name'='notice_transitioned' and event->>'trace_id'=$1",[id])).rows;
  assert.equal(outcomes.length,1); assert.equal(outcomes[0].event.props.transition,"send");
  assert.equal((await db.worker.query("select finished_at from app.notice_workflows where event_id=$1",[id])).rows[0].finished_at,instant);
});

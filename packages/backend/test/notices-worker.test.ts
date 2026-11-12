import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Database } from "../src/platform/db.ts";
import { emit, type TransitionEvent } from "../src/platform/outbox.ts";
import { noticesWorker, readNotices, type Sources } from "../src/notices/door.ts";
import { deliverDue, planDelivery } from "../src/notices/delivery.ts";
import { resendMail } from "../src/shared/door.ts";
import { createResolver } from "../src/notices/resolve.ts";
import { prepareDue, schedule } from "../src/notices/workflows.ts";

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

test("Mail accepts valid long recipients at the key boundary and replay retains the complete identity", async () => {
  const emittedKeys: string[] = [], seed = randomUUID();
  for (const [n,[localLength,rawLength]] of ([[60,256],[61,257],[64,260],[64,260]] as const).entries()) {
    const recipient = `${seed}${"a".repeat(localLength-seed.length)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(11)}`;
    const id = `${seed.slice(0,-1)}${n}`, notice = `beta-welcome:${id}`, raw = JSON.stringify([recipient,notice]);
    assert.equal(raw.length,rawLength);
    await db.transaction("",(sql) => planDelivery(sql,{ recipient, notice_id: notice, template: "beta-welcome",
      subject_kind: "admission", subject_id: id, cause: "admit", person_id: null, org_id: null, trace_id: id,
      facts: { quickstart: "https://capxul.test/start", chat: "https://capxul.test/chat", support: "support@capxul.test" } },instant),true);
    const keys: string[] = [];
    const mail = resendMail({ environment: "staging", allowedRecipients: [recipient], from: "sender@capxul.test", apiKey: "local-not-live",
      transport: async (_url,init) => {
        keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
        return Response.json({ id: `accepted-${id}` });
      } });
    await assert.rejects(deliverDue(db,mail,async () => instant,async () => { throw new Error("retained outcome lost"); }),/retained outcome lost/);
    assert(!(await db.transaction("",(sql) => readNotices(sql,{ to: recipient }),true)).some((row) => row.notice_id === notice));
    await deliverDue(db,mail,async () => instant,async () => {});
    const rows = (await db.transaction("",(sql) => readNotices(sql,{ to: recipient }),true)).filter((row) => row.notice_id === notice);
    assert.equal(rows.length,1); assert.equal(rows[0]!.status,"sent"); assert.equal(rows[0]!.attempts,1);
    assert.equal(rows[0]!.recipient,recipient); assert.equal(rows[0]!.notice_id,notice); assert.equal(rows[0]!.mail_id,`accepted-${id}`);
    assert.equal(keys.length,2); assert.equal(keys[0],keys[1]);
    if (rawLength === 256) assert.equal(keys[0],raw,"existing in-limit keys must not change on retry");
    else assert.match(keys[0]!,/^notice:[0-9a-f]{64}$/);
    emittedKeys.push(keys[0]!);
  }
  assert.equal(new Set(emittedKeys).size,4,"identities differing only after character 256 must not collide");
});

test("resume stops unstarted reminders after collection/refund but replays accepted lost outcomes", async () => {
  for (const backlog of [0,101]) for (const outcome of ["collected","refunded"] as const) for (const started of [false,true]) {
    const id = randomUUID(), recipient = `${id}@reminders.test`, at = instant + 3*86_400_000;
    const event: TransitionEvent = { id, name: "payment_transitioned", machine: "payment", entity_id: id,
      owner_kind: "person", owner_id: id, actor: null, trace_id: id, at: instant,
      props: { transition: "escrow", from: "submitted", to: "escrowed", payment_id: id } };
    let status = "escrowed";
    const unused = (): never => { throw new Error("unexpected source read"); };
    const sources: Sources = { admission: unused, principal: unused, principalBySafe: unused, principalByEmail: unused,
      partyName: unused, organization: unused, proposal: unused, officerChange: unused, commandPayments: unused,
      hatWearers: unused, request: unused, safeOwners: unused,
      payment: async () => ({ id, owner_kind: "person", owner_id: id, command_id: null, chain_id: 1,
        route: "claim_escrow", status, outcome, pay_at: null, budget_id: null, payer_label: "Sender",
        payee_kind: null, payee_id: null, payee_mailbox: recipient, amount_raw: "12345", decimals: 2,
        asset: "USD", escrow_address: "0x123", shortfall: null }) };
    const links = { quickstart: "https://capxul.test/start", chat: "https://capxul.test/chat", support: "support@capxul.test",
      signup: "https://capxul.test/signup", approval: unused, explorer: () => "https://capxul.test/escrow" };
    const resolve = createResolver(sources,links);
    await db.transaction("",(sql) => schedule(sql,event),true);
    // This is the committed worker boundary before Mail; the initial notice is not under test.
    await prepareDue(db,async () => at,(sql,w,e,days) => w.endsWith("money-reminders") ? resolve(sql,w,e,days) : Promise.resolve({ intents: [] }));
    const accepted = new Map<string,string>(); let calls = 0, refunds = 0;
    const mail = { async send(message: { idempotencyKey: string; template?: string }) {
      if (message.template === "money-taken-back") { refunds++; return { id: `refund-${id}` }; }
      calls++; if (!accepted.has(message.idempotencyKey)) accepted.set(message.idempotencyKey,`accepted-${id}`);
      return { id: accepted.get(message.idempotencyKey)! };
    } };
    if (started) await assert.rejects(deliverDue(db,mail,async () => at,async () => { throw new Error("outcome not committed"); }),/outcome not committed/);
    status = outcome === "collected" ? "settled" : "cancelled";
    await db.transaction("",async (sql) => {
      for (let n=0;n<backlog;n++) {
        const filler = randomUUID();
        await emit(sql,{ ...event, id: filler, entity_id: filler, at,
          props: { from: "authorizing", to: "submitted", transition: "submit", payment_id: filler } });
      }
    },true);
    await db.transaction("",(sql) => emit(sql,{ ...event, id: randomUUID(), at,
      props: { from: "escrowed", to: status, transition: outcome === "collected" ? "settle" : "cancel", payment_id: id } }),true);
    const tick = noticesWorker(db,mail,sources,links,async () => at);
    const acks = async () => Number((await db.worker.query("select count(*) as n from app.transition_acks where consumer='notices'")).rows[0].n);
    const before = await acks();
    await tick();
    assert.equal(await acks()-before,Math.min(backlog+1,100),"one worker tick must keep the bounded source batch");
    if (!started) assert.equal(calls,0,`${outcome}, backlog ${backlog}: first resume must not dispatch ahead of the committed stop`);
    let progress = 1, ticks = 0;
    while (progress && ticks++ < 5) progress = await tick();
    assert.equal(progress,0,"bounded ticks must drain the source backlog and converge");
    assert.equal(calls,started ? 2 : 0,`${outcome}, backlog ${backlog}: only an already-dispatched identity may replay`);
    assert.equal(accepted.size,started ? 1 : 0);
    assert.equal(refunds,outcome === "refunded" ? 1 : 0,"the separate refund notice must still send");
    const rows = await db.transaction("",(sql) => readNotices(sql,{ to: recipient, template: "money-waiting-reminder" }),true);
    assert.equal(rows.length,started ? 1 : 0);
    if (started) { assert.equal(rows[0]!.mail_id,`accepted-${id}`); assert.equal(rows[0]!.attempts,1); }
    assert.equal(await tick(),0,"stopped targets must not remain due on every resume");
  }
});

test("shared payer reminder survives one stopped payment and a canceled never-started batch can rearm", async () => {
  for (const stopAll of [false,true]) {
    const id = randomUUID(), recipient = `${id}@payer.test`, at = instant + 10*86_400_000;
    const event = (payment: string): TransitionEvent => ({ id: payment, name: "payment_transitioned", machine: "payment",
      entity_id: payment, owner_kind: "person", owner_id: id, actor: null, trace_id: id, at: instant,
      props: { transition: "escrow", to: "escrowed", payment_id: payment } });
    const a = event(randomUUID()), b = event(randomUUID()), c = event(randomUUID());
    const prepare = () => prepareDue(db,async () => at,async (_sql,w,e) => ({ intents: w.endsWith("money-reminders") ? [{
      recipient, notice_id: `money-uncollected:${id}:10`, template: "money-uncollected", subject_kind: "payment",
      subject_id: e.entity_id, cause: "stop", person_id: id, org_id: null, trace_id: id,
      facts: { amount: "123.45", asset: "USD", days: 10, mailbox: "payee@test.example", payments: e.entity_id },
    }] : [] }));
    for (const e of [a,b]) await db.transaction("",(sql) => schedule(sql,e),true);
    await prepare();
    for (const e of stopAll ? [a,b] : [a]) await db.transaction("",(sql) => schedule(sql,{ ...e, id: randomUUID(), at,
      props: { transition: "settle", to: "settled", payment_id: e.entity_id } }),true);
    let calls = 0;
    const mail = { async send() { calls++; return { id: `batch-${id}` }; } };
    await deliverDue(db,mail,async () => at,async () => {});
    assert.equal(calls,stopAll ? 0 : 1,"any remaining live workflow still needs the shared target");
    if (stopAll) {
      await db.transaction("",(sql) => schedule(sql,c),true);
      await prepare();
      await deliverDue(db,mail,async () => at,async () => {});
      assert.equal(calls,1,"a new live checkpoint rearms only a never-started canceled identity");
    }
    const rows = await db.transaction("",(sql) => readNotices(sql,{ to: recipient }),true);
    assert.equal(rows.length,1); assert.equal(rows[0]!.attempts,1); assert.equal(rows[0]!.mail_id,`batch-${id}`);
    if (stopAll) assert.equal(rows[0]!.facts.payments,c.entity_id,"rearmed work must use the new live batch facts");
    for (const e of [a,b,c]) await db.transaction("",(sql) => schedule(sql,{ ...e, id: randomUUID(), at,
      props: { transition: "settle", to: "settled", payment_id: e.entity_id } }),true);
  }
});

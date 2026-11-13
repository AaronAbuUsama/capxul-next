import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { encodeFunctionData, type Abi, type Hex } from "viem";
import { connect, send } from "../../devnet/src/modules/chain/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { migrateApprovals } from "../src/approvals/door.ts";
import { migrateOutbox, relay } from "../src/platform/outbox.ts";
import { Database } from "../src/platform/db.ts";
import { listPaymentWork, migratePayments, onApprovalTransition, prepareCommand, readPayment, reconcilePayment, wakePaymentChain,
  type PrepareCommand, type PrepareContext } from "../src/payments/door.ts";

if (!process.env.CORE_PROOF_DIR || process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("payment work controls require a named fresh disposable Ponder/v4 world");

test("durable payment work recovers actual reservation, day-ahead and cancellation without a synthetic send", async () => {
  const fixture = JSON.parse(await readFile(`${process.env.CORE_PROOF_DIR}/fixture.json`, "utf8"));
  const artifacts = JSON.parse(await readFile(new URL("../../contracts/abi/abi.json", import.meta.url), "utf8"));
  const record = JSON.parse(await readFile(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const chain = await connect(process.env.RPC_URL!);
  const block = await chain.client.getBlock(), at = Number(block.timestamp) * 1000, payAt = at + 172_800_000;
  const adminUrl = new URL(process.env.PG_ADMIN_URL!); adminUrl.pathname = new URL(process.env.DATABASE_URL!).pathname;
  const admin = new pg.Client({ connectionString: adminUrl.href });
  const sql = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL! });
  const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
  const owner = { kind: "organization", id: `work-${crypto.randomUUID()}` } as const;
  const context: PrepareContext = { owner, approval: { person_id: "wearer", sender: testKey("second").address,
    site_url: "https://component.invalid", now: new Date(at) }, payments: record.contracts.Payments.address,
    budgets: record.contracts.Budgets.address, deadline: at + 3_600_000, traceId: owner.id };
  const budgetAbi = artifacts.contracts.Budgets.abi as Abi;
  await admin.connect(); await sql.connect();
  try {
    await admin.query("begin"); await migrateApprovals(admin); await migrateOutbox(admin); await migratePayments(admin); await admin.query("commit");
    await sql.query("begin");
    await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at) values
      ($1,'organization','active',$2,'organization',$1,$3,$3),($4,'address','outside',$5,null,null,$3,$3)`,
    [owner.id, fixture.safe.toLowerCase(), at, `${owner.id}-payee`, testKey("payee").address.toLowerCase()]);
    const input: PrepareCommand = { owner_kind: owner.kind, owner_id: owner.id, requested_by: "wearer", request_key: "native-work",
      purpose: "request", route: "budget", payer_safe: fixture.safe, payer_label: "Company", budget_id: fixture.department,
      chain_id: chain.chainId, funding: { raw: String(await chain.client.readContract({ address: context.budgets as Hex,
        abi: budgetAbi, functionName: "leftOf", args: [BigInt(fixture.department)] })), block_number: Number(block.number), of: "budget_left" },
      items: [{ payee_party_id: `${owner.id}-payee`, payee_safe: testKey("payee").address, payee_label: "Supplier", payee_kind: null,
        payee_id: null, token_address: fixture.token, asset: "USDC", decimals: 6, amount_raw: "1234567", kind: 1,
        document_id: null, document_hash: fixture.documentHash }], summary: "Durable scheduled payment", pay_at: payAt, not_after: null, resume: false };
    await sql.query("savepoint birth");
    await prepareCommand(sql, input, context);
    assert((await listPaymentWork(sql, { at, limit: 100 })).some((w) => w.owner_id === owner.id));
    await sql.query("rollback to savepoint birth");
    assert(!(await listPaymentWork(sql, { at, limit: 100 })).some((w) => w.owner_id === owner.id));
    const born = await prepareCommand(sql, input, context), id = born.payment_ids[0]!;
    const calls = (await sql.query("select calls from app.approvals where approval_id=$1", [born.approval_id])).rows[0].calls;
    await sql.query("commit");
    const run = (now: number) => db.ownerTransaction(owner, (same) => reconcilePayment(same, owner, id,
      { chainId: chain.chainId, finality: 0 }, { at: now, traceId: owner.id }), true);
    await run(at);
    assert(!(await listPaymentWork(sql, { at, limit: 100 })).some((w) => w.payment_id === id), "no event means a persisted wait, not a busy sweep");
    await relay(db, "payments.lifecycle.carrier", ["approval_transitioned"], onApprovalTransition);
    assert((await listPaymentWork(sql, { at, limit: 100 })).some((w) => w.payment_id === id), "late committed source wake is not lost");
    await run(at);
    await send(chain, { from: testKey("second").key, to: context.budgets as Hex, data: calls[0].data });
    let reservation;
    const payment = await readPayment(sql, owner, id);
    for (let n = 0; n < 200; n++) {
      reservation = (await sql.query("select * from app.chain_logs where event='PaymentScheduled' and args->>'jobNonce'=$1", [payment!.job_nonce])).rows[0];
      if (reservation) break;
      await setTimeout(100);
    }
    assert(reservation, "reservation must come from native execution and Ponder");
    await db.transaction("", (same) => wakePaymentChain(same, chain.chainId, at), true);
    const scheduled = await run(at);
    assert.equal(scheduled.payment?.status, "scheduled");
    assert.equal(scheduled.payment.scheduled_id, reservation.args.scheduledId);
    assert.equal((await run(payAt - 86_400_001)).payment?.status, "scheduled");
    const due = await run(payAt - 86_400_000);
    assert.equal(due.payment?.status, "due"); assert.equal(due.payment.shortfall, null);
    const blocked = await run(payAt);
    assert.equal(blocked.blocked, "budget_executor"); assert.equal(blocked.payment?.status, "due");
    await send(chain, { from: testKey("second").key, to: context.budgets as Hex,
      data: encodeFunctionData({ abi: budgetAbi, functionName: "cancel", args: [BigInt(reservation.args.scheduledId)] }) });
    let cancellation;
    for (let n = 0; n < 200; n++) {
      cancellation = (await sql.query("select * from app.chain_logs where event='ScheduleCancelled' and args->>'scheduledId'=$1", [reservation.args.scheduledId])).rows[0];
      if (cancellation) break;
      await setTimeout(100);
    }
    assert(cancellation);
    await db.transaction("", (same) => wakePaymentChain(same, chain.chainId, payAt), true);
    assert.equal((await run(payAt)).payment?.outcome, "budget_cancelled");
    assert.equal((await run(payAt)).payment?.status, "cancelled");
    assert(!(await listPaymentWork(sql, { at: payAt, limit: 100 })).some((w) => w.payment_id === id));
    const events = (await sql.query("select event from app.transition_outbox where event->>'entity_id'=$1 order by seq", [id])).rows.map((r) => r.event);
    assert.deepEqual(events.map((e) => e.props.transition), ["open", "schedule", "come_due", "cancel"]);
    assert.equal(events[2].at, payAt - 86_400_000);
    assert(events.every((e) => e.owner_id === owner.id && e.props.owner_id === owner.id));
    const tenant = await db.tenant.connect();
    try { await assert.rejects(listPaymentWork(tenant, { at: payAt, limit: 10 }), { code: "42501" }); }
    finally { tenant.release(); }
  } finally {
    await sql.query("rollback"); await admin.query("rollback");
    await admin.query("delete from app.transition_acks where event_id in (select id from app.transition_outbox where event->>'trace_id'=$1)", [owner.id]);
    await admin.query("delete from app.transition_outbox where event->>'trace_id'=$1", [owner.id]);
    await admin.query("delete from app.approval_carriers where approval_id in (select approval_id from app.approvals where org_id=$1)", [owner.id]);
    await admin.query("delete from app.approvals where org_id=$1", [owner.id]);
    await admin.query("delete from app.payment_processes where owner_id=$1", [owner.id]);
    await admin.query("delete from app.payments where owner_id=$1", [owner.id]);
    await admin.query("delete from app.payment_commands where owner_id=$1", [owner.id]);
    await admin.query("delete from app.parties where owner_id=$1 or party_id=$2", [owner.id, `${owner.id}-payee`]);
    await db.close(); await sql.end(); await admin.end();
  }
});

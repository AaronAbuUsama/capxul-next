import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { createTestClient, defineChain, http, type Abi, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { connect, send } from "../../devnet/src/modules/chain/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { migrateApprovals } from "../src/approvals/door.ts";
import { migrate as migrateBooks } from "../src/books/door.ts";
import { migrateOutbox, relay } from "../src/platform/outbox.ts";
import { Database } from "../src/platform/db.ts";
import { budgetsExecutor, migrateServiceSigner } from "../src/shared/door.ts";
import { EXECUTE_RETRY_MS, executeOnce, listPaymentWork, migratePayments, onApprovalTransition, prepareCommand, readPayment,
  reconcilePayment, recordExecution, wakePaymentChain, type PrepareCommand, type PrepareContext } from "../src/payments/door.ts";

if (!process.env.CORE_PROOF_DIR || process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("payment execute controls require a named fresh disposable Ponder/v4 world");

// A dedicated public Anvil account (index 12): not a Director, relayer, claim role, bundler canary or Shared's executor test key.
const executorAccount = (() => {
  const bytes = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 12 }).getHdKey().privateKey!;
  return privateKeyToAccount(`0x${Buffer.from(bytes).toString("hex")}`);
})();

async function until<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  for (let n = 0; n < 200; n++) { const row = await read(); if (row) return row; await setTimeout(100); }
  throw new Error(`${what} never reached Ponder`);
}

test("a budget's dated Payment on its day: refused before the chain's day, executed once by key, submitted, settled from PaymentSent", { timeout: 180_000 }, async () => {
  const fixture = JSON.parse(await readFile(`${process.env.CORE_PROOF_DIR}/fixture.json`, "utf8"));
  const artifacts = JSON.parse(await readFile(new URL("../../contracts/abi/abi.json", import.meta.url), "utf8"));
  const record = JSON.parse(await readFile(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const chain = await connect(process.env.RPC_URL!);
  const control = createTestClient({ mode: "anvil", transport: http(process.env.RPC_URL!) });
  const block = await chain.client.getBlock(), at = Number(block.timestamp) * 1000, payAt = at + 172_800_000;
  const adminUrl = new URL(process.env.PG_ADMIN_URL!); adminUrl.pathname = new URL(process.env.DATABASE_URL!).pathname;
  const admin = new pg.Client({ connectionString: adminUrl.href });
  const sql = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL! });
  const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
  const owner = { kind: "organization", id: `execute-${crypto.randomUUID()}` } as const;
  const budgets = record.contracts.Budgets.address as Hex;
  const context: PrepareContext = { owner, approval: { person_id: "wearer", sender: testKey("second").address,
    site_url: "https://component.invalid", now: new Date(at) }, payments: record.contracts.Payments.address,
    budgets, deadline: at + 3_600_000, traceId: owner.id };
  const budgetAbi = artifacts.contracts.Budgets.abi as Abi;
  const executor = budgetsExecutor({ worker: db.worker, rpcUrl: process.env.RPC_URL!, account: executorAccount, budgets,
    chain: defineChain({ id: chain.chainId, name: "devnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [process.env.RPC_URL!] } } }) });
  await admin.connect(); await sql.connect();
  try {
    await admin.query("begin");
    await migrateApprovals(admin); await migrateOutbox(admin); await migratePayments(admin); await migrateBooks(admin); await migrateServiceSigner(admin);
    await admin.query("commit");
    await send(chain, { from: testKey("deployer").key, to: executorAccount.address, data: "0x", value: 10n ** 18n });
    await sql.query("begin");
    await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at) values
      ($1,'organization','active',$2,'organization',$1,$3,$3),($4,'address','outside',$5,null,null,$3,$3)`,
    [owner.id, fixture.safe.toLowerCase(), at, `${owner.id}-payee`, testKey("payee").address.toLowerCase()]);
    const input: PrepareCommand = { owner_kind: owner.kind, owner_id: owner.id, requested_by: "wearer", request_key: "native-execute",
      purpose: "request", route: "budget", payer_safe: fixture.safe, payer_label: "Company", budget_id: fixture.department,
      chain_id: chain.chainId, funding: { raw: String(await chain.client.readContract({ address: budgets,
        abi: budgetAbi, functionName: "leftOf", args: [BigInt(fixture.department)] })), block_number: Number(block.number), of: "budget_left" },
      items: [{ payee_party_id: `${owner.id}-payee`, payee_safe: testKey("payee").address, payee_label: "Supplier", payee_kind: null,
        payee_id: null, token_address: fixture.token, asset: "USDC", decimals: 6, amount_raw: "765432", kind: 1,
        document_id: null, document_hash: fixture.documentHash }], summary: "Dated budget payment", pay_at: payAt, not_after: null, resume: false };
    const born = await prepareCommand(sql, input, context), id = born.payment_ids[0]!;
    const calls = (await sql.query("select calls from app.approvals where approval_id=$1", [born.approval_id])).rows[0].calls;
    await sql.query("commit");
    const run = (now: number) => db.ownerTransaction(owner, (same) => reconcilePayment(same, owner, id,
      { chainId: chain.chainId, finality: 0 }, { at: now, traceId: owner.id }), true);
    await relay(db, "payments.lifecycle.carrier", ["approval_transitioned"], onApprovalTransition);
    // The held carrier's reservation, sent by the budget's wearer as approvals would.
    await send(chain, { from: testKey("second").key, to: budgets, data: calls[0].data });
    const payment = (await readPayment(sql, owner, id))!;
    await until(async () => (await sql.query("select 1 from app.chain_logs where event='PaymentScheduled' and args->>'jobNonce'=$1", [payment.job_nonce])).rows[0], "PaymentScheduled");
    await db.transaction("", (same) => wakePaymentChain(same, chain.chainId, at), true);
    assert.equal((await run(at)).payment?.status, "scheduled");
    assert.equal((await run(payAt - 86_400_000)).payment?.status, "due");

    // World day reached, chain day not: the simulation refuses, nothing is recorded, the same attempt waits an hour.
    const first = await run(payAt);
    assert.equal(first.payment?.status, "due");
    assert(first.execute, "a budget's dated Payment on its day asks for Budgets.execute");
    assert.equal(first.execute.key, `budget-execute:${chain.chainId}:${first.payment.scheduled_id}:0`);
    const refused = await executeOnce(executor, first.execute);
    assert.deepEqual(refused, { kind: "refused", revert: "NotDue" });
    assert.deepEqual(await executor.lookup({ key: first.execute.key }), { hash: null, receipt: null });
    await db.ownerTransaction(owner, (same) => recordExecution(same, first.execute!, refused, { at: payAt, traceId: owner.id }), true);
    assert(!(await listPaymentWork(sql, { at: payAt + EXECUTE_RETRY_MS - 1, limit: 1000 })).some((w) => w.payment_id === id), "refusal waits an hour");
    assert.equal((await run(payAt + EXECUTE_RETRY_MS - 1)).execute, null);

    // The chain reaches the day; an hour later the same attempt is sent once, its receipt read by key, and the Payment submitted.
    await control.setNextBlockTimestamp({ timestamp: BigInt(Math.floor(payAt / 1000)) + 60n });
    await control.mine({ blocks: 1 });
    const later = payAt + EXECUTE_RETRY_MS;
    const second = await run(later);
    assert.equal(second.execute?.key, first.execute.key, "a simulation refusal never consumes the attempt");
    let paid = await executeOnce(executor, second.execute!);
    for (let n = 0; paid.kind === "pending" && n < 40; n++) { await setTimeout(250); paid = await executeOnce(executor, second.execute!); }
    assert.equal(paid.kind, "paid");
    assert(paid.kind === "paid" && paid.receipt.paymentId?.toLowerCase() === payment.chain_payment_id.toLowerCase());
    const again = await executeOnce(executor, second.execute!);
    assert(again.kind === "paid" && again.receipt.hash === paid.receipt.hash, "the key is looked up, never sent twice");
    const sends = (await sql.query("select count(*)::int as n from app.service_signer_sends where request_key=$1", [second.execute!.key])).rows[0].n;
    assert.equal(sends, 1);
    const submitted = await db.ownerTransaction(owner, (same) => recordExecution(same, second.execute!, paid, { at: later, traceId: owner.id }), true);
    assert.equal(submitted?.status, "submitted");
    // A stale answer for the same attempt changes nothing.
    assert.equal((await db.ownerTransaction(owner, (same) => recordExecution(same, second.execute!, refused, { at: later, traceId: owner.id }), true))?.status, "submitted");

    // Settlement only from the indexed PaymentSent the execute caused.
    const fact = await until(async () => (await sql.query("select * from app.chain_payments where payment_id=$1", [payment.chain_payment_id.toLowerCase()])).rows[0], "PaymentSent");
    assert.equal(fact.tx_hash, paid.kind === "paid" ? paid.receipt.hash.toLowerCase() : "");
    await db.transaction("", (same) => wakePaymentChain(same, chain.chainId, later), true);
    const settled = await run(later);
    assert.equal(settled.payment?.status, "settled");
    assert.equal(settled.execute, null);
    const events = (await sql.query("select event from app.transition_outbox where event->>'entity_id'=$1 order by seq", [id])).rows.map((r) => r.event);
    assert.deepEqual(events.map((e) => e.props.transition), ["open", "schedule", "come_due", "submit", "settle"]);
    assert.equal(events[3].at, later);
  } finally {
    await sql.query("rollback").catch(() => {});
    await admin.query("rollback").catch(() => {});
    await admin.query("delete from app.transition_acks where event_id in (select id from app.transition_outbox where event->>'trace_id'=$1)", [owner.id]);
    await admin.query("delete from app.transition_outbox where event->>'trace_id'=$1", [owner.id]);
    await admin.query("delete from app.approval_carriers where approval_id in (select approval_id from app.approvals where org_id=$1)", [owner.id]);
    await admin.query("delete from app.approvals where org_id=$1", [owner.id]);
    await admin.query("delete from app.payment_processes where owner_id=$1", [owner.id]);
    // The settled Payment and its book facts stay in this disposable world; its Parties do not, so the fixture Safe has one owner.
    await admin.query("delete from app.parties where owner_id=$1 or party_id=$2", [owner.id, `${owner.id}-payee`]);
    await db.close(); await sql.end(); await admin.end();
  }
});

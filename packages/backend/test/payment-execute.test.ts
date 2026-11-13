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
import { EXECUTE_LOOKUP_MS, EXECUTE_RETRY_MS, executeOnce, listPaymentWork, migratePayments, onApprovalTransition, prepareCommand,
  readPayment, reconcilePayment, recordExecution, wakePaymentChain, type BudgetExecution, type ExecutionAnswer, type Payment,
  type PrepareCommand, type PrepareContext } from "../src/payments/door.ts";

if (!process.env.CORE_PROOF_DIR || process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("payment execute controls require a named fresh disposable Ponder/v4 world");

// A dedicated public Anvil account (index 12): not a Director, relayer, claim role, bundler canary or Shared's executor test key.
const executorAccount = (() => {
  const bytes = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 12 }).getHdKey().privateKey!;
  return privateKeyToAccount(`0x${Buffer.from(bytes).toString("hex")}`);
})();
type Owner = { kind: "organization"; id: string };

async function until<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  for (let n = 0; n < 200; n++) { const row = await read(); if (row) return row; await setTimeout(100); }
  throw new Error(`${what} never reached Ponder`);
}

async function world() {
  const fixture = JSON.parse(await readFile(`${process.env.CORE_PROOF_DIR}/fixture.json`, "utf8"));
  const artifacts = JSON.parse(await readFile(new URL("../../contracts/abi/abi.json", import.meta.url), "utf8"));
  const record = JSON.parse(await readFile(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const chain = await connect(process.env.RPC_URL!);
  const control = createTestClient({ mode: "anvil", transport: http(process.env.RPC_URL!) });
  const adminUrl = new URL(process.env.PG_ADMIN_URL!); adminUrl.pathname = new URL(process.env.DATABASE_URL!).pathname;
  const admin = new pg.Client({ connectionString: adminUrl.href });
  const sql = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL! });
  const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
  const budgets = record.contracts.Budgets.address as Hex, budgetAbi = artifacts.contracts.Budgets.abi as Abi;
  const executor = budgetsExecutor({ worker: db.worker, rpcUrl: process.env.RPC_URL!, account: executorAccount, budgets,
    chain: defineChain({ id: chain.chainId, name: "devnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [process.env.RPC_URL!] } } }) });
  await admin.connect(); await sql.connect();
  await admin.query("begin");
  await migrateApprovals(admin); await migrateOutbox(admin); await migratePayments(admin); await migrateBooks(admin); await migrateServiceSigner(admin);
  await admin.query("commit");
  if (await chain.client.getBalance({ address: executorAccount.address }) < 10n ** 17n)
    await send(chain, { from: testKey("deployer").key, to: executorAccount.address, data: "0x", value: 10n ** 18n });
  const run = (owner: Owner, id: string, now: number) => db.ownerTransaction(owner, (same) => reconcilePayment(same, owner, id,
    { chainId: chain.chainId, finality: 0 }, { at: now, traceId: owner.id }), true);
  const answer = (owner: Owner, execution: BudgetExecution, a: ExecutionAnswer, now: number) =>
    db.ownerTransaction(owner, (same) => recordExecution(same, execution, a, { at: now, traceId: owner.id }), true);
  const wake = (now: number) => db.transaction("", (same) => wakePaymentChain(same, chain.chainId, now), true);
  /** Looks the attempt up until its send is mined (Anvil automines), sending it once when nothing is recorded. */
  const executed = async (execution: BudgetExecution) => {
    let a = await executeOnce(executor, execution);
    for (let n = 0; a.kind === "pending" && n < 40; n++) { await setTimeout(250); a = await executeOnce(executor, execution); }
    return a;
  };
  /** A dated budget command, reserved on chain by the budget's wearer as its held approval would. */
  const dated = async (owner: Owner, amounts: string[], at: number, payAt: number) => {
    const block = await chain.client.getBlock();
    const context: PrepareContext = { owner, approval: { person_id: "wearer", sender: testKey("second").address,
      site_url: "https://component.invalid", now: new Date(at) }, payments: record.contracts.Payments.address,
      budgets, deadline: at + 3_600_000, traceId: owner.id };
    await sql.query("begin");
    await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at) values
      ($1,'organization','active',$2,'organization',$1,$3,$3),($4,'address','outside',$5,null,null,$3,$3)`,
    [owner.id, fixture.safe.toLowerCase(), at, `${owner.id}-payee`, testKey("payee").address.toLowerCase()]);
    const input: PrepareCommand = { owner_kind: owner.kind, owner_id: owner.id, requested_by: "wearer", request_key: "native-execute",
      purpose: "request", route: "budget", payer_safe: fixture.safe, payer_label: "Company", budget_id: fixture.department,
      chain_id: chain.chainId, funding: { raw: String(await chain.client.readContract({ address: budgets,
        abi: budgetAbi, functionName: "leftOf", args: [BigInt(fixture.department)] })), block_number: Number(block.number), of: "budget_left" },
      items: amounts.map((amount) => ({ payee_party_id: `${owner.id}-payee`, payee_safe: testKey("payee").address, payee_label: "Supplier",
        payee_kind: null, payee_id: null, token_address: fixture.token, asset: "USDC", decimals: 6, amount_raw: amount, kind: 1,
        document_id: null, document_hash: fixture.documentHash })), summary: "Dated budget payment", pay_at: payAt, not_after: null, resume: false };
    const born = await prepareCommand(sql, input, context);
    const calls = (await sql.query("select calls from app.approvals where approval_id=$1", [born.approval_id])).rows[0].calls;
    await sql.query("commit");
    await relay(db, "payments.lifecycle.carrier", ["approval_transitioned"], onApprovalTransition);
    for (const call of calls) await send(chain, { from: testKey("second").key, to: budgets, data: call.data });
    const payments: Payment[] = [];
    for (const id of born.payment_ids) {
      const payment = (await readPayment(sql, owner, id))!;
      await until(async () => (await sql.query("select 1 from app.chain_logs where event='PaymentScheduled' and args->>'jobNonce'=$1",
        [payment.job_nonce])).rows[0], "PaymentScheduled");
      payments.push(payment);
    }
    await wake(at);
    return payments;
  };
  const transitions = async (id: string) => (await sql.query("select event from app.transition_outbox where event->>'entity_id'=$1 order by seq",
    [id])).rows.map((r) => r.event);
  const sendRow = async (key: string) => (await sql.query("select hash,receipt from app.service_signer_sends where request_key=$1", [key])).rows;
  const cleanup = async (owner: Owner) => {
    await sql.query("rollback").catch(() => {});
    await admin.query("rollback").catch(() => {});
    await admin.query("delete from app.transition_acks where event_id in (select id from app.transition_outbox where event->>'trace_id'=$1)", [owner.id]);
    await admin.query("delete from app.transition_outbox where event->>'trace_id'=$1", [owner.id]);
    await admin.query("delete from app.approval_carriers where approval_id in (select approval_id from app.approvals where org_id=$1)", [owner.id]);
    await admin.query("delete from app.approvals where org_id=$1", [owner.id]);
    await admin.query("delete from app.payment_processes where owner_id=$1", [owner.id]);
    // The settled Payments and their book facts stay in this disposable world; their Parties do not, so the fixture Safe has one owner.
    await admin.query("delete from app.parties where owner_id=$1 or party_id=$2", [owner.id, `${owner.id}-payee`]);
    await db.close(); await sql.end(); await admin.end();
  };
  return { chain, control, sql, executor, run, answer, wake, executed, dated, transitions, sendRow, cleanup };
}

test("a budget's dated Payment on its day: refused before the chain's day, executed once by key, re-sent after a reorg drops it, settled from PaymentSent", { timeout: 240_000 }, async () => {
  const w = await world();
  const owner: Owner = { kind: "organization", id: `execute-${crypto.randomUUID()}` };
  try {
    const at = Number((await w.chain.client.getBlock()).timestamp) * 1000, payAt = at + 172_800_000;
    const [payment] = await w.dated(owner, ["765432"], at, payAt), id = payment!.id;
    assert.equal((await w.run(owner, id, at)).payment?.status, "scheduled");
    assert.equal((await w.run(owner, id, payAt - 86_400_000)).payment?.status, "due");

    // World day reached, chain day not: the simulation refuses, nothing is recorded, the same attempt waits an hour.
    const first = await w.run(owner, id, payAt);
    assert.equal(first.payment?.status, "due");
    assert(first.execute, "a budget's dated Payment on its day asks for Budgets.execute");
    assert.equal(first.execute.key, `budget-execute:${w.chain.chainId}:${first.payment.scheduled_id}:0`);
    const refused = await executeOnce(w.executor, first.execute);
    assert.deepEqual(refused, { kind: "refused", revert: "NotDue" });
    assert.deepEqual(await w.executor.lookup({ key: first.execute.key }), { hash: null, receipt: null });
    await w.answer(owner, first.execute, refused, payAt);
    assert(!(await listPaymentWork(w.sql, { at: payAt + EXECUTE_RETRY_MS - 1, limit: 1000 })).some((x) => x.payment_id === id), "refusal waits an hour");
    assert.equal((await w.run(owner, id, payAt + EXECUTE_RETRY_MS - 1)).execute, null);

    // The chain reaches the day; an hour later the same attempt is sent once, its receipt read by key, and the Payment submitted.
    await w.control.setNextBlockTimestamp({ timestamp: BigInt(Math.floor(payAt / 1000)) + 60n });
    await w.control.mine({ blocks: 1 });
    const checkpoint = await w.control.snapshot();
    const later = payAt + EXECUTE_RETRY_MS;
    const second = await w.run(owner, id, later);
    assert.equal(second.execute?.key, first.execute.key, "a simulation refusal never consumes the attempt");
    const paid = await w.executed(second.execute!);
    assert(paid.kind === "paid" && paid.receipt.paymentId?.toLowerCase() === payment!.chain_payment_id.toLowerCase());
    const again = await executeOnce(w.executor, second.execute!);
    assert(again.kind === "paid" && again.receipt.hash === paid.receipt.hash, "the key is looked up, never sent twice");
    assert.equal((await w.sendRow(second.execute!.key)).length, 1);
    assert.equal((await w.answer(owner, second.execute!, paid, later))?.status, "submitted");
    // A stale answer for the spent attempt changes nothing.
    assert.equal((await w.answer(owner, second.execute!, refused, later))?.status, "submitted");

    // The execute is reorged out and dropped: the Payment stays submitted, and its pay-day timer sends attempt 1 an hour later.
    await w.control.revert({ id: checkpoint }); await w.control.mine({ blocks: 3 });
    await until(async () => {
      const progress = (await w.sql.query("select indexed_block,ready from app.indexer_progress where chain_id=$1", [w.chain.chainId])).rows[0];
      const gone = !(await w.sql.query("select 1 from app.chain_payments where payment_id=$1", [payment!.chain_payment_id.toLowerCase()])).rowCount;
      return gone && progress?.ready && BigInt(progress.indexed_block) >= BigInt(paid.receipt.blockNumber) ? true : undefined;
    }, "the reorg");
    const hour = later + EXECUTE_RETRY_MS;
    assert.equal((await w.run(owner, id, hour - 1)).execute, null, "no early send");
    const third = await w.run(owner, id, hour);
    assert.equal(third.payment?.status, "submitted");
    assert.equal(third.execute?.key, `budget-execute:${w.chain.chainId}:${third.payment.scheduled_id}:1`);
    const repaid = await w.executed(third.execute!);
    assert(repaid.kind === "paid" && repaid.receipt.hash !== paid.receipt.hash, "a new attempt under a new key");
    assert.equal((await w.answer(owner, third.execute!, repaid, hour))?.status, "submitted");

    // Settlement only from the indexed PaymentSent the surviving execute caused.
    const fact = await until(async () => (await w.sql.query("select * from app.chain_payments where payment_id=$1",
      [payment!.chain_payment_id.toLowerCase()])).rows[0], "PaymentSent");
    assert.equal(fact.tx_hash, repaid.kind === "paid" ? repaid.receipt.hash.toLowerCase() : "");
    await w.wake(hour);
    const settled = await w.run(owner, id, hour);
    assert.equal(settled.payment?.status, "settled");
    assert.equal(settled.execute, null);
    const events = await w.transitions(id);
    assert.deepEqual(events.map((e) => e.props.transition), ["open", "schedule", "come_due", "submit", "settle"]);
    assert.equal(events[3].at, later);
  } finally { await w.cleanup(owner); }
});

test("an execute nobody looks up again never holds the executor lane, and a busy lane waits a minute", { timeout: 240_000 }, async () => {
  const w = await world();
  const owner: Owner = { kind: "organization", id: `execute-lane-${crypto.randomUUID()}` };
  try {
    const at = Number((await w.chain.client.getBlock()).timestamp) * 1000, payAt = at + 172_800_000;
    const [a, b] = await w.dated(owner, ["111111", "222222"], at, payAt);
    for (const p of [a!, b!]) {
      assert.equal((await w.run(owner, p.id, at)).payment?.status, "scheduled");
      assert.equal((await w.run(owner, p.id, payAt - 86_400_000)).payment?.status, "due");
    }
    await w.control.setNextBlockTimestamp({ timestamp: BigInt(Math.floor(payAt / 1000)) + 60n });
    await w.control.mine({ blocks: 1 });
    const runA = await w.run(owner, a!.id, payAt), runB = await w.run(owner, b!.id, payAt);
    assert(runA.execute && runB.execute);

    // Interval mining: A's execute is broadcast but unmined, so B finds the key's one lane busy and waits, unchanged.
    await w.control.setAutomine(false);
    try {
      const sentA = await executeOnce(w.executor, runA.execute);
      assert.equal(sentA.kind, "pending");
      assert.equal((await w.answer(owner, runA.execute, sentA, payAt))?.status, "due");
      const busy = await executeOnce(w.executor, runB.execute);
      assert.deepEqual(busy, { kind: "busy" });
      assert.equal((await w.answer(owner, runB.execute, busy, payAt))?.status, "due");
      assert.deepEqual(await w.executor.lookup({ key: runB.execute.key }), { hash: null, receipt: null });
      await w.control.mine({ blocks: 1 });
    } finally { await w.control.setAutomine(true); }

    // A settles from its indexed PaymentSent before anyone looks its send up again.
    await until(async () => (await w.sql.query("select 1 from app.chain_payments where payment_id=$1",
      [a!.chain_payment_id.toLowerCase()])).rows[0], "A's PaymentSent");
    await w.wake(payAt + 1_000);
    assert.equal((await w.run(owner, a!.id, payAt + 1_000)).payment?.status, "settled");
    assert.deepEqual((await w.sendRow(runA.execute.key)).map((r) => r.receipt), [null], "nobody read the settled Payment's send");
    assert.deepEqual((await w.transitions(a!.id)).map((e) => e.props.transition), ["open", "schedule", "come_due", "settle"]);

    // A minute later B's same attempt is sent: the executor reads A's receipt itself instead of refusing the lane forever.
    const bAt = payAt + EXECUTE_LOOKUP_MS;
    const again = await w.run(owner, b!.id, bAt);
    assert.equal(again.execute?.key, runB.execute.key, "a busy lane never consumes the attempt");
    const paidB = await w.executed(again.execute!);
    assert.equal(paidB.kind, "paid");
    assert.notEqual((await w.sendRow(runA.execute.key))[0].receipt, null, "A's receipt was kept when the lane was asked again");
    assert.equal((await w.answer(owner, again.execute!, paidB, bAt))?.status, "submitted");
  } finally { await w.cleanup(owner); }
});

import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { awaitIndexedBlock, IndexerError, readFactsOf } from "../src/shared/door.ts";

// Component control on a disposable loopback PG17 with Ponder's fact shapes; the selected-stack proof is the Shared runner's.
const url = process.env.INDEXER_TEST_ADMIN_URL;
if (!url || new URL(url).pathname !== "/indexer_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("INDEXER_TEST_ADMIN_URL must name a dedicated loopback indexer_test database");
}
const code = (value: string) => (error: unknown) => error instanceof IndexerError && error.code === value;

test("indexer awaitBlock and factsOf: finality, receipt order, decoding, one fact per log, and bounded waits", { timeout: 60_000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const chainId = 84532, tx = `0x${"ab".repeat(32)}`, other = `0x${"cd".repeat(32)}`, bh = `0x${"11".repeat(32)}`;
  const log = (ordinal: number, hash = tx, block = 100) => ({ log_id: `${chainId}:${hash}:${ordinal}`, chain_id: chainId, block_number: block,
    block_hash: bh, block_time: 1_800_000_000_000, tx_hash: hash, tx_log_ordinal: ordinal, log_index: 40 + ordinal });
  const columns = "log_id text primary key, chain_id int, block_number numeric, block_hash text, block_time numeric, tx_hash text, tx_log_ordinal int, log_index int";
  await pool.query(`create schema app;
    create table app.indexer_progress (chain_id int primary key, indexed_block numeric, indexed_block_hash text, indexed_block_time numeric,
      head_block numeric, head_seen_at numeric, ready boolean, build_id text, updated_at numeric);
    create table app.chain_payments (${columns}, payment_id text, sender text, recipient text, token text, amount numeric, kind int, document_hash text);
    create table app.transfers (${columns}, token text, "from" text, "to" text, amount numeric);
    create table app.user_operations (${columns}, user_op_hash text, sender text, paymaster text, nonce numeric, success boolean, actual_gas_cost numeric, actual_gas_used numeric);
    create table app.chain_logs (${columns}, contract text, event text, args jsonb)`);
  const progress = (indexed: number, head: number, ready = true) => pool.query(`insert into app.indexer_progress values ($1,$2,$3,1,$4,1,$5,'build-1',1)
    on conflict (chain_id) do update set indexed_block=excluded.indexed_block, head_block=excluded.head_block, ready=excluded.ready`, [chainId, indexed, bh, head, ready]);
  const insert = (table: string, row: Record<string, unknown>) => {
    const keys = Object.keys(row);
    return pool.query(`insert into app.${table} (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
  };
  const safe = `0x${"5a".repeat(20)}`, usdc = `0x${"0c".repeat(20)}`, payee = `0x${"9e".repeat(20)}`;
  // One real-shaped settlement in receipt order: Transfer (0), PaymentSent (1), UserOperationEvent (2), and an unrelated tx.
  await insert("transfers", { ...log(0), token: usdc, from: safe, to: payee, amount: "874750000" });
  await insert("chain_payments", { ...log(1), payment_id: `0x${"77".repeat(32)}`, sender: safe, recipient: payee, token: usdc, amount: "874750000", kind: 0, document_hash: `0x${"88".repeat(32)}` });
  await insert("user_operations", { ...log(2), user_op_hash: `0x${"99".repeat(32)}`, sender: safe, paymaster: `0x${"aa".repeat(20)}`, nonce: "7", success: true, actual_gas_cost: "1", actual_gas_used: "2" });
  await insert("chain_logs", { ...log(0, other), contract: "hats", event: "TransferSingle", args: { id: "1" } });
  const lookup = { chainId, txHash: tx.toUpperCase().replace("0X", "0x") as `0x${string}`, block: 100n, finalityDepth: 2 };
  try {
    await t.test("not final at the depth below both the indexed block and the head: null, so the caller waits", async () => {
      await progress(101, 120);
      assert.equal(await readFactsOf(pool, lookup), null, "100 + 2 > 101");
      await progress(130, 101);
      assert.equal(await readFactsOf(pool, lookup), null, "100 + 2 > the head Ponder last saw");
    });
    await t.test("final: every fact of that one transaction, in receipt order, decoded as its event", async () => {
      await progress(102, 102);
      const facts = await readFactsOf(pool, lookup);
      assert.deepEqual(facts!.map((f) => [f.kind, f.txLogOrdinal]), [["transfer", 0], ["payment", 1], ["userOperation", 2]]);
      const [transfer, payment, op] = facts!;
      assert.equal(transfer?.kind === "transfer" && transfer.amount, "874750000");
      assert.equal(payment?.kind === "payment" && payment.recipient, payee);
      assert.equal(op?.kind === "userOperation" && op.success, true);
      assert.deepEqual(await readFactsOf(pool, { ...lookup, txHash: `0x${"ee".repeat(32)}` }), [], "a final transaction with no indexed facts is an empty answer, not null");
    });
    await t.test("two facts on one log, or a fact that does not decode, is PROVIDER_RESPONSE_INVALID", async () => {
      await insert("chain_logs", { ...log(1), log_id: `${chainId}:${tx}:1-dup`, contract: "payments", event: "PaymentSent", args: {} });
      await assert.rejects(readFactsOf(pool, lookup), code("PROVIDER_RESPONSE_INVALID"), "a second fact claims receipt ordinal 1");
      await pool.query("delete from app.chain_logs where log_id like '%-dup'");
      await pool.query("update app.transfers set \"to\"='not-an-address'");
      await assert.rejects(readFactsOf(pool, lookup), code("PROVIDER_RESPONSE_INVALID"));
      await pool.query("update app.transfers set \"to\"=$1", [payee]);
      assert.equal((await readFactsOf(pool, lookup))!.length, 3, "control: decodes again");
    });
    await t.test("reindexing is PROVIDER_ERROR; a held table times out each 1 s attempt, retried once, then PROVIDER_ERROR", async () => {
      await progress(102, 102, false);
      await assert.rejects(readFactsOf(pool, lookup), code("PROVIDER_ERROR"));
      await progress(102, 102);
      const holder = await pool.connect();
      try {
        await holder.query("begin"); await holder.query("lock table app.chain_logs in access exclusive mode");
        const started = performance.now();
        await assert.rejects(readFactsOf(pool, lookup, { timeoutMs: 300 }), code("PROVIDER_ERROR"));
        const elapsed = performance.now() - started;
        assert(elapsed >= 600 && elapsed < 1_500, `two bounded attempts, not one and not a hang: ${Math.round(elapsed)} ms`);
      } finally { await holder.query("rollback"); holder.release(); }
      assert.equal((await readFactsOf(pool, lookup))!.length, 3);
    });
    await t.test("awaitBlock returns once Ponder reaches the block with its views ready, and refuses after its polls", async () => {
      await progress(99, 120);
      setTimeout(() => void progress(100, 120), 250);
      assert.equal((await awaitIndexedBlock(pool, chainId, 100n, { polls: 10, intervalMs: 100 })).indexedBlock, "100");
      const started = performance.now();
      await assert.rejects(awaitIndexedBlock(pool, chainId, 500n, { polls: 3, intervalMs: 100 }), code("PROVIDER_ERROR"));
      assert(performance.now() - started >= 300, "it polled for the whole bound before refusing");
      await progress(600, 600, false);
      await assert.rejects(awaitIndexedBlock(pool, chainId, 500n, { polls: 2, intervalMs: 50 }), code("PROVIDER_ERROR"), "reindexing: views not ready");
      await pool.query("update app.indexer_progress set indexed_block_hash='0xnope', ready=true");
      await assert.rejects(awaitIndexedBlock(pool, chainId, 500n, { polls: 5, intervalMs: 50 }), code("PROVIDER_RESPONSE_INVALID"), "an undecodable checkpoint is not waited out");
    });
  } finally { await pool.end(); }
});

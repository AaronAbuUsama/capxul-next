import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import type { Sql } from "../src/platform/db.ts";
import { awaitIndexedBlock, IndexerError, readFactsOf } from "../src/shared/door.ts";

// Component control on a disposable loopback PG17, with the app views' columns as bind-indexer creates them (Core #59);
// the selected-stack proof is the Shared runner's on a real Ponder world.
const url = process.env.INDEXER_TEST_ADMIN_URL;
if (!url || new URL(url).pathname !== "/indexer_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("INDEXER_TEST_ADMIN_URL must name a dedicated loopback indexer_test database");
}
const code = (value: string) => (error: unknown) => error instanceof IndexerError && error.code === value;
const timed = async (run: () => Promise<unknown>) => { const started = performance.now(); await run().catch(() => {}); return performance.now() - started; };

test("indexer awaitBlock and factsOf: finality, one snapshot, receipt order, decoding, and reads bounded in Postgres", { timeout: 60_000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const caller = new pg.Client({ connectionString: url }); await caller.connect();
  // The caller's own transaction, as a process holds it; READ COMMITTED, so each statement sees the latest commit.
  const inTx = async <T>(run: (sql: Sql) => Promise<T>) => {
    await caller.query("begin");
    try { return await run(caller); } finally { await caller.query("rollback"); }
  };
  const chainId = 84532, tx = `0x${"ab".repeat(32)}`, other = `0x${"cd".repeat(32)}`, bh = `0x${"11".repeat(32)}`;
  const log = (ordinal: number, hash = tx, block = 100, blockHash = bh) => ({ log_id: `${chainId}:${hash}:${ordinal}`, chain_id: chainId,
    block_number: block, block_hash: blockHash, block_time: 1_800_000_000_000, tx_hash: hash, tx_log_ordinal: ordinal, log_index: 40 + ordinal });
  const columns = "log_id text primary key, chain_id int, block_number numeric, block_hash text, block_time numeric, tx_hash text, tx_log_ordinal int, log_index int";
  await pool.query(`create schema app;
    create table app.indexer_progress (chain_id int primary key, indexed_block numeric, indexed_block_hash text, indexed_block_time numeric,
      head_block numeric, head_seen_at numeric, ready boolean, build_id text, updated_at numeric);
    create table app.chain_payments (${columns}, payment_id text, sender text, recipient text, token text, amount numeric, kind int, document_hash text);
    create table app.transfers (${columns}, token text, from_address text, to_address text, amount numeric);
    create table app.user_operations (${columns}, user_op_hash text, sender text, paymaster text, nonce_key text, nonce_sequence text,
      success boolean, actual_gas_cost numeric, actual_gas_used numeric);
    create table app.chain_logs (${columns}, contract text, event text, args jsonb)`);
  const progress = (indexed: number, head: number, ready = true, hash = bh) => pool.query(`insert into app.indexer_progress values ($1,$2,$3,1,$4,1,$5,'build-1',1)
    on conflict (chain_id) do update set indexed_block=excluded.indexed_block, indexed_block_hash=excluded.indexed_block_hash,
    head_block=excluded.head_block, ready=excluded.ready`, [chainId, indexed, hash, head, ready]);
  const insert = (table: string, row: Record<string, unknown>) => {
    const keys = Object.keys(row);
    return pool.query(`insert into app.${table} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
  };
  const safe = `0x${"5a".repeat(20)}`, usdc = `0x${"0c".repeat(20)}`, payee = `0x${"9e".repeat(20)}`;
  // One real-shaped settlement in receipt order: Transfer (0), PaymentSent (1), UserOperationEvent (2), and an unrelated tx.
  const settlement = async (hash = tx, block = 100, hashes: string[] = [bh, bh, bh]) => {
    await insert("transfers", { ...log(0, hash, block, hashes[0]), token: usdc, from_address: safe, to_address: payee, amount: "874750000" });
    await insert("chain_payments", { ...log(1, hash, block, hashes[1]), payment_id: `0x${"77".repeat(32)}`, sender: safe, recipient: payee, token: usdc,
      amount: "874750000", kind: 0, document_hash: `0x${"88".repeat(32)}` });
    await insert("user_operations", { ...log(2, hash, block, hashes[2]), user_op_hash: `0x${"99".repeat(32)}`, sender: safe, paymaster: `0x${"aa".repeat(20)}`,
      nonce_key: "0", nonce_sequence: "7", success: true, actual_gas_cost: "1", actual_gas_used: "2" });
  };
  await settlement();
  await insert("chain_logs", { ...log(0, other), contract: "hats", event: "TransferSingle", args: { id: "1" } });
  const lookup = { chainId, txHash: tx.toUpperCase().replace("0X", "0x") as `0x${string}`, block: 100n, finalityDepth: 2 };
  const facts = (input = lookup, options = {}) => inTx((sql) => readFactsOf(sql, input, options));
  try {
    await t.test("not final at the depth below both the indexed block and the head: null, so the caller waits", async () => {
      await progress(101, 120);
      assert.equal(await facts(), null, "100 + 2 > 101");
      await progress(130, 101);
      assert.equal(await facts(), null, "100 + 2 > the head Ponder last saw");
    });
    await t.test("final: every fact of that one transaction, in receipt order, decoded as its event", async () => {
      await progress(102, 102);
      const found = await facts();
      assert.deepEqual(found!.map((f) => [f.kind, f.txLogOrdinal]), [["transfer", 0], ["payment", 1], ["userOperation", 2]]);
      const [transfer, payment, op] = found!;
      assert.deepEqual(transfer?.kind === "transfer" && [transfer.from, transfer.to, transfer.amount], [safe, payee, "874750000"]);
      assert.equal(payment?.kind === "payment" && payment.recipient, payee);
      assert.deepEqual(op?.kind === "userOperation" && [op.nonceKey, op.nonceSequence, op.success], ["0", "7", true]);
      assert.deepEqual(await facts({ ...lookup, txHash: `0x${"ee".repeat(32)}` }), [], "a final transaction with no indexed facts is an empty answer, not null");
    });
    await t.test("finality is judged on the block the facts are in when re-inclusion moved them later", async () => {
      const moved = `0x${"ac".repeat(32)}`;
      await settlement(moved, 110);
      await progress(111, 111);
      assert.equal(await facts({ ...lookup, txHash: moved as `0x${string}` }), null, "receipt said 100, but the facts are at 110: 110 + 2 > 111");
      await progress(112, 112);
      assert.equal((await facts({ ...lookup, txHash: moved as `0x${string}` }))!.length, 3);
    });
    await t.test("facts that disagree on their block, or sit on the indexed block under another hash, are PROVIDER_RESPONSE_INVALID", async () => {
      await progress(130, 130);
      const split = `0x${"ad".repeat(32)}`, forked = `0x${"ae".repeat(32)}`, stale = `0x${"af".repeat(32)}`;
      await insert("transfers", { ...log(0, split, 105), token: usdc, from_address: safe, to_address: payee, amount: "1" });
      await insert("chain_logs", { ...log(1, split, 106), contract: "payments", event: "PaymentSent", args: {} });
      await assert.rejects(facts({ ...lookup, txHash: split as `0x${string}` }), code("PROVIDER_RESPONSE_INVALID"), "two block numbers");
      await settlement(forked, 105, [bh, `0x${"12".repeat(32)}`, bh]);
      await assert.rejects(facts({ ...lookup, txHash: forked as `0x${string}` }), code("PROVIDER_RESPONSE_INVALID"), "one block number, two hashes");
      await settlement(stale, 130, [`0x${"13".repeat(32)}`, `0x${"13".repeat(32)}`, `0x${"13".repeat(32)}`]);
      await assert.rejects(facts({ ...lookup, txHash: stale as `0x${string}`, finalityDepth: 0 }), code("PROVIDER_RESPONSE_INVALID"), "indexed block 130 has another hash");
    });
    await t.test("two facts on one log, or a fact that does not decode, is PROVIDER_RESPONSE_INVALID", async () => {
      await progress(102, 102);
      await insert("chain_logs", { ...log(1), contract: "payments", event: "PaymentSent", args: {} });
      await assert.rejects(facts(), code("PROVIDER_RESPONSE_INVALID"), "a well-formed second fact claims receipt ordinal 1");
      await pool.query("delete from app.chain_logs where log_id=$1", [`${chainId}:${tx}:1`]);
      await pool.query("update app.transfers set to_address='not-an-address' where tx_hash=$1", [tx]);
      await assert.rejects(facts(), code("PROVIDER_RESPONSE_INVALID"));
      await pool.query("update app.transfers set to_address=$1 where tx_hash=$2", [payee, tx]);
      assert.equal((await facts())!.length, 3, "control: decodes again");
    });
    await t.test("progress and facts are one snapshot: a reindex right after the progress read cannot answer [] for a final transaction", async () => {
      let reindex: (() => Promise<unknown>) | undefined = () => pool.query("delete from app.transfers where tx_hash=$1", [tx]);
      const watched = { query: async (text: string, values?: unknown[]) => {
        const answer = await caller.query(text, values);
        if (/from app\.indexer_progress/.test(text) && reindex) { const run = reindex; reindex = undefined; await run(); }
        return answer;
      } } as unknown as Sql;
      await caller.query("begin");
      try { assert.equal((await readFactsOf(watched, lookup))!.length, 3, "the facts of the progress row's snapshot"); }
      finally { await caller.query("rollback"); }
      await insert("transfers", { ...log(0), token: usdc, from_address: safe, to_address: payee, amount: "874750000" });
    });
    await t.test("each 1 s attempt is cancelled in Postgres; two attempts 100 ms apart, then PROVIDER_ERROR; the caller's transaction is usable at once", async () => {
      await progress(102, 102, false);
      await assert.rejects(facts(), code("PROVIDER_ERROR"), "reindexing: views not ready");
      await progress(102, 102);
      const holder = await pool.connect();
      try {
        await holder.query("begin"); await holder.query("lock table app.chain_logs in access exclusive mode");
        await caller.query("begin");
        const elapsed = await timed(() => assert.rejects(readFactsOf(caller, lookup, { timeoutMs: 400 }), code("PROVIDER_ERROR")));
        assert(elapsed >= 900 && elapsed < 1_300, `two 400 ms attempts and one 100 ms pause, not one, three or no pause: ${Math.round(elapsed)} ms`);
        assert.equal((await caller.query("select 1 as ok")).rows[0].ok, 1, "rolled back to the savepoint: the transaction still answers");
        assert.equal((await caller.query("show statement_timeout")).rows[0].statement_timeout, "0", "and the bound did not outlive the read");
        const rollback = await timed(() => caller.query("rollback"));
        assert(rollback < 200, `nothing was left queued before the caller's ROLLBACK: ${Math.round(rollback)} ms`);
      } finally { await holder.query("rollback"); holder.release(); }
      assert.equal((await facts())!.length, 3);
      await assert.rejects(readFactsOf(pool, lookup), (error) => !(error instanceof IndexerError) && /caller's transaction/.test(String(error)),
        "outside a transaction it cannot be bounded, so it does not read");
      await assert.rejects(facts({ ...lookup, txHash: "0x12" as `0x${string}` }), code("INVALID_INPUT"));
    });
    await t.test("awaitBlock returns once Ponder reaches the block with its views ready, and refuses within its deadline", async () => {
      await progress(99, 120);
      setTimeout(() => void progress(100, 120), 250);
      assert.equal((await inTx((sql) => awaitIndexedBlock(sql, chainId, 100n, { timeoutMs: 2_000, intervalMs: 100 }))).indexedBlock, "100");
      const late = await timed(() => inTx((sql) => assert.rejects(awaitIndexedBlock(sql, chainId, 500n, { timeoutMs: 300, intervalMs: 100 }), code("PROVIDER_ERROR"))));
      assert(late >= 300 && late < 450, `it waited out its 300 ms and no longer: ${Math.round(late)} ms`);
      await progress(600, 600, false);
      await inTx((sql) => assert.rejects(awaitIndexedBlock(sql, chainId, 500n, { timeoutMs: 200, intervalMs: 50 }), code("PROVIDER_ERROR"), "reindexing: views not ready"));
      const holder = await pool.connect();
      try {
        await holder.query("begin"); await holder.query("lock table app.indexer_progress in access exclusive mode");
        const held = await timed(() => inTx((sql) => assert.rejects(awaitIndexedBlock(sql, chainId, 500n, { timeoutMs: 300, intervalMs: 50 }), code("PROVIDER_ERROR"))));
        assert(held >= 300 && held < 450, `a held progress table cannot stretch the deadline: ${Math.round(held)} ms`);
      } finally { await holder.query("rollback"); holder.release(); }
      await pool.query("update app.indexer_progress set indexed_block_hash='0xnope', ready=true");
      await inTx((sql) => assert.rejects(awaitIndexedBlock(sql, chainId, 500n, { timeoutMs: 5_000, intervalMs: 50 }), code("PROVIDER_RESPONSE_INVALID"), "an undecodable checkpoint is not waited out"));
      for (const options of [{ intervalMs: Number.NaN }, { timeoutMs: 0 }, { timeoutMs: 1.5 }]) {
        await inTx((sql) => assert.rejects(awaitIndexedBlock(sql, chainId, 1n, options), code("INVALID_INPUT"), JSON.stringify(options)));
      }
      await inTx((sql) => assert.rejects(awaitIndexedBlock(sql, chainId, "1e3", {}), code("INVALID_INPUT")));
    });
  } finally { await caller.end(); await pool.end(); }
});

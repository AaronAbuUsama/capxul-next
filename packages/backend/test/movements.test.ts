import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { createTestClient, encodeFunctionData, http, keccak256, parseAbi, stringToHex, type Abi, type Hex } from "viem";
import { connect, send } from "../../devnet/src/modules/chain/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { migrateApprovals } from "../src/approvals/door.ts";
import { migrate as migrateBooks } from "../src/books/door.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { followTransfer, listTransferWork, migratePayments, type MovementMemo } from "../src/payments/door.ts";

if (!process.env.CORE_PROOF_DIR || process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("movement controls require a named disposable real Ponder/v4 world");

const erc20 = parseAbi(["function mint(address to,uint256 amount)", "function transfer(address to,uint256 amount) returns (bool)",
  "function approve(address spender,uint256 amount) returns (bool)"]);

test("movements book each side's outside money, set aside a side's own Payment, and follow a real reorg", async () => {
  const fixture = JSON.parse(await readFile(`${process.env.CORE_PROOF_DIR}/fixture.json`, "utf8"));
  const record = JSON.parse(await readFile(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const artifacts = JSON.parse(await readFile(new URL("../../contracts/abi/abi.json", import.meta.url), "utf8"));
  const chain = await connect(process.env.RPC_URL!);
  const control = createTestClient({ mode: "anvil", transport: http(process.env.RPC_URL!) });
  const adminUrl = new URL(process.env.PG_ADMIN_URL!); adminUrl.pathname = new URL(process.env.DATABASE_URL!).pathname;
  const admin = new pg.Client({ connectionString: adminUrl.href }), sql = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL! });
  await admin.connect(); await sql.connect();
  const org = { kind: "organization", id: `movement-org-${crypto.randomUUID()}` } as const;
  const person = { kind: "person", id: `movement-person-${crypto.randomUUID()}` } as const;
  const orgSafe = testKey("directorOne").address.toLowerCase(), personSafe = testKey("directorTwo").address.toLowerCase();
  const token = { address: (fixture.token as string).toLowerCase(), symbol: "USDC", decimals: 6 };
  const memos: MovementMemo[] = [];
  const context = (at: number, fail = false) => ({ at, traceId: org.id, storeMemo: async (same: unknown, memo: MovementMemo) => {
    assert.equal(same, sql, "the Memo is stored on the Movement's own transaction");
    if (fail) throw new Error("documents store failed"); memos.push(memo);
  } });
  const logOf = async (tx: Hex, blockHash?: string, depth = 4n) => {
    for (let n = 0; n < 300; n++) {
      const row = (await sql.query("select * from app.transfers where tx_hash=$1 and token=$2", [tx.toLowerCase(), token.address])).rows[0];
      const head = (await sql.query("select indexed_block,ready from app.indexer_progress")).rows[0];
      if (row && (!blockHash || row.block_hash !== blockHash) && head?.ready && BigInt(head.indexed_block) >= BigInt(row.block_number) + depth) return row;
      await setTimeout(100);
    }
    throw new Error("the actual Transfer must reach Ponder; no source row is synthesized");
  };
  const follow = async (log: { log_id: string; block_hash: string }, finality: number, at: number, fail = false) => {
    await sql.query("begin");
    try {
      const done = await followTransfer(sql, { chainId: chain.chainId, finality, token, logId: log.log_id, blockHash: log.block_hash }, context(at, fail));
      await sql.query("commit"); return done;
    } catch (error) { await sql.query("rollback"); throw error; }
  };
  const rows = async (tx: string) => (await sql.query(`select owner_kind,owner_id,side,status,amount_raw,counterparty from app.movements
    where tx_hash=$1 order by owner_kind,side`, [tx])).rows;
  const events = async (tx: string) => (await sql.query(`select event from app.transition_outbox where event->>'name'='movement_transitioned'
    and event->'props'->>'tx_hash'=$1 order by seq`, [tx])).rows.map((r) => r.event);
  const facts = async (key: string) => {
    await sql.query("begin");
    await sql.query("select set_config('app.org_id',$1,true),set_config('app.owner_id',$1,true)", [org.id]);
    const found = (await sql.query("select kind,amount_raw,money_key,source_kind from app.book_facts where org_id=$1 and money_key=$2 order by seq", [org.id, key])).rows;
    await sql.query("commit"); return found;
  };
  try {
    await admin.query("begin"); await migrateOutbox(admin); await migrateApprovals(admin); await migratePayments(admin); await migrateBooks(admin); await admin.query("commit");
    await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at) values
      ($1,'organization','active',$2,'organization',$1,1,1),($3,'person','active',$4,'person',$3,1,1)`, [org.id, orgSafe, person.id, personSafe]);
    const deposit = await send(chain, { from: testKey("deployer").key, to: token.address as Hex,
      data: encodeFunctionData({ abi: erc20, functionName: "mint", args: [orgSafe as Hex, 5_000_000n] }) });
    const direct = await send(chain, { from: testKey("directorOne").key, to: token.address as Hex,
      data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [personSafe as Hex, 1_000_000n] }) });
    const payments = record.contracts.Payments.address as Hex, paymentsAbi = artifacts.contracts.Payments.abi as Abi;
    await send(chain, { from: testKey("directorOne").key, to: token.address as Hex,
      data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [payments, 700_000n] }) });
    const item = { paymentId: `0x${"0".repeat(64)}` as Hex, recipient: personSafe as Hex, token: token.address as Hex, amount: 700_000n, kind: 1,
      documentHash: fixture.documentHash as Hex, jobNonce: keccak256(stringToHex(org.id)), executor: `0x${"0".repeat(40)}` as Hex };
    const id = await chain.client.readContract({ address: payments, abi: paymentsAbi, functionName: "paymentId", args: [item] }) as Hex;
    const paid = await send(chain, { from: testKey("directorOne").key, to: payments,
      data: encodeFunctionData({ abi: paymentsAbi, functionName: "send", args: [{ ...item, paymentId: id }] }) });
    // The org's own Payment to a bare address: it explains the org's side only, never the person's (old M1).
    await sql.query(`insert into app.payments(owner_id,owner_kind,id,origin,route,status,kind,chain_id,chain_payment_id,job_nonce,
      payer_safe,payer_label,payee_safe,payee_label,token_address,asset,decimals,amount_raw,document_hash,created_at,updated_at)
      values ($1,'organization',$2,'prepared','budget','submitted',1,$3,$4,$5,$6,'Org',$7,'Person',$8,'USDC',6,'700000',$9,1,1)`,
    [org.id, `payment_${org.id}`, chain.chainId, id.toLowerCase(), item.jobNonce, orgSafe, personSafe, token.address, fixture.documentHash]);
    await control.mine({ blocks: 4 }); // Anvil mines only on transactions; give every Transfer its depth.
    const [d, t, p] = [await logOf(deposit), await logOf(direct), await logOf(paid)];
    const at = Number(p.block_time) + 60_000;
    const work = (await listTransferWork(sql, { chainId: chain.chainId, finality: 0, token: token.address, limit: 1000 })).map((w) => w.log_id);
    for (const log of [d, t, p]) assert(work.includes(log.log_id));

    await assert.rejects(follow(t, 0, at, true), /documents store failed/);
    assert.deepEqual([await rows(t.tx_hash), await events(t.tx_hash), memos], [[], [], []], "a failed Memo rolls back the Movements and events");
    assert.deepEqual(await follow(d, 0, at), { recorded: 1, restored: 0, removed: 0 });
    assert.deepEqual(await follow(t, 0, at), { recorded: 2, restored: 0, removed: 0 });
    assert.deepEqual(await follow(p, 0, at), { recorded: 1, restored: 0, removed: 0 });
    assert.deepEqual(await rows(d.tx_hash), [{ owner_kind: "organization", owner_id: org.id, side: "in", status: "recorded", amount_raw: "5000000", counterparty: `0x${"0".repeat(40)}` }]);
    assert.deepEqual((await rows(t.tx_hash)).map((r) => [r.owner_id, r.side]), [[org.id, "out"], [person.id, "in"]]);
    assert.deepEqual((await rows(p.tx_hash)).map((r) => [r.owner_id, r.side]), [[person.id, "in"]]);
    const [event] = await events(d.tx_hash);
    assert.deepEqual([event.machine, event.entity_id, event.trace_id, event.at], ["movement", `${chain.chainId}:${d.tx_hash}:${d.log_index}:in`, org.id, at]);
    assert.deepEqual(event.props, { from: null, to: "recorded", transition: "record", owner_kind: "organization", owner_id: org.id,
      chain_id: chain.chainId, tx_hash: d.tx_hash, log_index: d.log_index, side: "in" });
    const key = (l: typeof d) => `transfer:${chain.chainId}:${l.tx_hash}:${l.log_index}`;
    assert.deepEqual(await facts(key(d)), [{ kind: "deposit_received", amount_raw: "5000000", money_key: key(d), source_kind: "movement" }]);
    assert.deepEqual((await facts(key(t))).map((f) => f.kind), ["payment_sent_outside"]);
    assert.deepEqual(await facts(key(p)), [], "a Payment's own Transfer is never the payer's outside money");
    assert.deepEqual(memos.map((m) => m.participants.map((x) => [x.safe, x.role])), [[[orgSafe, "payee"]], [[orgSafe, "payer"], [personSafe, "payee"]], [[personSafe, "payee"]]]);
    assert.equal(memos[1]!.content.reference, key(t));

    assert.deepEqual(await follow(t, 0, at + 1), { recorded: 0, restored: 0, removed: 0 }, "a replayed occurrence writes nothing");
    assert.equal((await events(t.tx_hash)).length, 2);
    assert(!(await listTransferWork(sql, { chainId: chain.chainId, finality: 0, token: token.address, limit: 1000 })).some((w) => w.log_id === t.log_id));

    // A real reorg at finality 2: record, remove when the chain drops it, restore when the same signed Transfer returns.
    const checkpoint = await control.snapshot();
    const wallet = chain.walletFor(testKey("directorOne").key);
    const raw = await wallet.signTransaction(await wallet.prepareTransactionRequest({ to: token.address as Hex,
      data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [personSafe as Hex, 2_000_000n] }) }));
    const again = await chain.client.sendRawTransaction({ serializedTransaction: raw });
    // Record at exactly the finality depth, inside the confirm window (twice the depth) a reorg can still reach.
    await chain.client.waitForTransactionReceipt({ hash: again }); await control.mine({ blocks: 2 });
    const first = await logOf(again, undefined, 2n);
    assert.deepEqual(await follow(first, 2, at + 2), { recorded: 2, restored: 0, removed: 0 });
    await control.revert({ id: checkpoint }); await control.mine({ blocks: 8 });
    for (let n = 0; n < 300; n++) {
      const gone = !(await sql.query("select 1 from app.transfers where log_id=$1 and block_hash=$2", [first.log_id, first.block_hash])).rowCount;
      const head = (await sql.query("select indexed_block,ready from app.indexer_progress")).rows[0];
      if (gone && head?.ready && BigInt(head.indexed_block) >= BigInt(first.block_number) + 4n) break;
      await setTimeout(100);
    }
    assert((await listTransferWork(sql, { chainId: chain.chainId, finality: 2, token: token.address, limit: 1000 })).some((w) => w.block_hash === first.block_hash));
    assert.deepEqual(await follow(first, 2, at + 3), { recorded: 0, restored: 0, removed: 2 });
    assert.deepEqual((await rows(first.tx_hash)).map((r) => r.status), ["removed", "removed"]);
    assert.deepEqual((await facts(key(first))).map((f) => f.kind), ["payment_sent_outside", "reversed"]);
    await chain.client.sendRawTransaction({ serializedTransaction: raw });
    await chain.client.waitForTransactionReceipt({ hash: again }); await control.mine({ blocks: 4 });
    const back = await logOf(again, first.block_hash);
    assert.equal(back.log_index, first.log_index, "the same Transfer, re-included at the same position");
    assert.deepEqual(await follow(back, 2, at + 4), { recorded: 0, restored: 2, removed: 0 });
    assert.deepEqual((await events(first.tx_hash)).map((e) => [e.props.side, e.props.transition]),
      [["out", "record"], ["in", "record"], ["out", "remove"], ["in", "remove"], ["out", "restore"], ["in", "restore"]]);
    assert.deepEqual((await facts(key(first))).map((f) => f.kind), ["payment_sent_outside", "reversed", "payment_sent_outside"]);
    assert.equal(memos.length, 4, "a restored Movement keeps its immutable Memo");
  } finally { await admin.end(); await sql.end(); }
});

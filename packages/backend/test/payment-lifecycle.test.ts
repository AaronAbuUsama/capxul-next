import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { createTestClient, http, keccak256, stringToHex, type Abi } from "viem";
import { connect } from "../../devnet/src/modules/chain/service.ts";
import { pay } from "../../devnet/src/modules/company/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { bindIndexer } from "../src/bind-indexer.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { migrate as migrateBooks } from "../src/books/door.ts";
import { followPayment, migratePayments, readPayment } from "../src/payments/door.ts";

if (!process.env.CORE_PROOF_DIR || process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("payment lifecycle controls require a named disposable real Ponder/v4 world");

test("indexed settlement compares exact terms and commits source event and SQL book effect together", async () => {
  const fixture = JSON.parse(await readFile(`${process.env.CORE_PROOF_DIR}/fixture.json`, "utf8"));
  const record = JSON.parse(await readFile(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const installer = JSON.parse(await readFile(new URL("../../contracts/out/Installer.sol/Installer.json", import.meta.url), "utf8"));
  const chain = await connect(process.env.RPC_URL!);
  const control = createTestClient({ mode: "anvil", transport: http(process.env.RPC_URL!) });
  const checkpoint = await control.snapshot();
  const nonce = keccak256(stringToHex(crypto.randomUUID()));
  const paid = await pay({ chain, record, installerAbi: installer.abi as Abi }, { key: testKey("second").key,
    budget: BigInt(fixture.department), to: testKey("payee").address, amount: 1_234_567n, kind: 1,
    documentHash: fixture.documentHash, jobNonce: nonce });
  if (!paid.ok) throw new Error(paid.detail);
  const adminUrl = new URL(process.env.PG_ADMIN_URL!);
  adminUrl.pathname = new URL(process.env.DATABASE_URL!).pathname;
  const admin = new pg.Client({ connectionString: adminUrl.href });
  const worker = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL! });
  await admin.connect(); await worker.connect();
  const owner = { kind: "organization", id: `settlement-${crypto.randomUUID()}` } as const;
  const payeeOrg = `recipient-principal-${crypto.randomUUID()}`;
  const payerParty = `payer-directory-${crypto.randomUUID()}`, payeeParty = `recipient-directory-${crypto.randomUUID()}`;
  const id = `payment_${crypto.randomUUID()}`;
  try {
    await admin.query("begin");
    await bindIndexer(admin); await migratePayments(admin); await migrateOutbox(admin); await migrateBooks(admin);
    await admin.query("commit");
    let fact;
    for (let attempt = 0; attempt < 200; attempt++) {
      fact = (await worker.query("select * from app.chain_payments where payment_id=$1", [paid.paymentId.toLowerCase()])).rows[0];
      if (fact) break;
      await setTimeout(100);
    }
    assert(fact, "actual PaymentSent must reach Ponder, never synthesize a source row");
    assert.equal(fact.sender, fixture.safe.toLowerCase());
    assert.equal(fact.recipient, testKey("payee").address.toLowerCase());
    assert.equal(fact.token, fixture.token.toLowerCase());
    assert.equal(fact.amount, "1234567");
    const context = { at: Number(fact.block_time) + 60_000, traceId: "settlement-source-control" };
    const facts = async (org: string = owner.id) => {
      await worker.query("select set_config('app.org_id',$1,true),set_config('app.owner_id',$1,true)", [org]);
      const rows = (await worker.query("select * from app.book_facts where reference_kind='payment' and reference_id=$1 and org_id=$2 order by seq", [id, org])).rows;
      await worker.query("select set_config('app.org_id',$1,true),set_config('app.owner_id',$1,true)", [owner.id]);
      return rows;
    };
    await worker.query("begin");
    await worker.query("select set_config('app.org_id',$1,true),set_config('app.owner_kind','organization',true),set_config('app.owner_id',$1,true)", [owner.id]);
    // Directory Party IDs are deliberately different from the principal IDs on either side.
    await worker.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
      values ($1,'organization','active',$2,'organization',$3,1,1),($4,'organization','active',$5,'organization',$6,1,1)`,
    [payerParty, fixture.safe.toLowerCase(), owner.id, payeeParty, testKey("payee").address.toLowerCase(), payeeOrg]);
    await worker.query(`insert into app.payments(owner_id,owner_kind,id,origin,route,status,kind,chain_id,chain_payment_id,job_nonce,
      payer_safe,payer_label,payee_safe,payee_label,token_address,asset,decimals,amount_raw,document_hash,created_at,updated_at,payee_kind,payee_id)
      values ($1,'organization',$2,'prepared','budget','prepared',1,$3,$4,$5,$6,'Payer',$7,'Payee',$8,'USDC',6,'1234568',$9,1,1,'organization',$10)`,
    [owner.id, id, chain.chainId, paid.paymentId.toLowerCase(), nonce, fixture.safe.toLowerCase(), testKey("payee").address.toLowerCase(), fixture.token.toLowerCase(), fixture.documentHash, payeeOrg]);
    const events = async () => (await worker.query("select event from app.transition_outbox where event->>'entity_id'=$1 order by seq", [id])).rows.map((r) => r.event);
    await worker.query("savepoint mismatch");
    const wrong = await followPayment(worker, owner, id, { chainId: chain.chainId, finality: 0 }, context);
    assert.equal(wrong?.status, "mismatched"); assert.equal(wrong?.mismatch, "amount");
    assert.deepEqual(await facts(), []);
    assert.equal((await events())[0].props.transition, "mismatch");
    await worker.query("rollback to savepoint mismatch");
    await worker.query("update app.payments set amount_raw='1234567' where id=$1", [id]);
    await worker.query("savepoint failed_book");
    await followPayment(worker, owner, id, { chainId: chain.chainId, finality: 0 }, context);
    assert.equal((await facts()).length, 1, "the actual Books door wrote the money fact before caller rollback");
    await worker.query("rollback to savepoint failed_book");
    assert.equal((await readPayment(worker, owner, id))?.status, "prepared");
    assert.equal((await events()).length, 0);
    assert.deepEqual(await facts(), []);
    const settled = await followPayment(worker, owner, id, { chainId: chain.chainId, finality: 0 }, context);
    assert.equal(settled?.status, "settled"); assert.equal(settled?.settled_tx_hash, paid.txHash.toLowerCase());
    assert.equal(settled?.settled_at, Number(fact.block_time));
    const [event] = await events();
    assert.equal(event.name, "payment_transitioned"); assert.equal(event.at, context.at);
    assert.deepEqual(event.props, { from: "prepared", to: "settled", transition: "settle", payment_id: id,
      owner_kind: "organization", owner_id: owner.id, command_id: null, route: "budget", outcome: null });
    await worker.query("commit");
    await worker.query("begin");
    await worker.query("select set_config('app.org_id',$1,true),set_config('app.owner_kind','organization',true),set_config('app.owner_id',$1,true)", [owner.id]);
    await followPayment(worker, owner, id, { chainId: chain.chainId, finality: 0 }, { ...context, at: context.at + 1 });
    assert.deepEqual(await events(), [event], "replay keeps the durable event's identity and timestamp");
    const [book] = await facts();
    assert.equal(book.amount_raw, "1234567"); assert.equal(book.kind, "payment_settled");
    assert.equal(book.money_key, `payment:${paid.paymentId.toLowerCase()}`);
    assert.equal(book.occurred_at, Number(fact.block_time)); assert.equal(book.recorded_at, context.at);
    assert.equal(book.tx_hash, paid.txHash.toLowerCase()); assert.equal(book.log_index, fact.log_index);
    assert.equal(book.source_kind, "payment"); assert.equal(book.source_id, id);
    assert.equal(book.party_id, payeeParty);
    const [incoming] = await facts(payeeOrg);
    assert.equal(incoming.party_id, payerParty);
    assert.equal(incoming.kind, "payment_received"); assert.equal(incoming.amount_raw, "1234567");
    assert.equal(book.usd_value, null); assert.equal(book.usd_rate, null); assert.equal(book.usd_source, null);
    assert.equal((await facts()).length, 1);
    await worker.query("commit");
    await control.revert({ id: checkpoint });
    await control.mine({ blocks: 3 });
    let removed = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const progress = (await worker.query("select * from app.indexer_progress where chain_id=$1", [chain.chainId])).rows[0];
      const source = (await worker.query("select 1 from app.chain_payments where payment_id=$1", [paid.paymentId.toLowerCase()])).rowCount;
      if (!source && progress?.ready && BigInt(progress.indexed_block) >= BigInt(fact.block_number)) { removed = true; break; }
      await setTimeout(100);
    }
    assert(removed, "actual chain revert must remove the fact through Ponder rollback before following it");
    await worker.query("begin");
    await worker.query("select set_config('app.org_id',$1,true),set_config('app.owner_kind','organization',true),set_config('app.owner_id',$1,true)", [owner.id]);
    const reopened = await followPayment(worker, owner, id, { chainId: chain.chainId, finality: 0 }, { ...context, at: context.at + 2000 });
    assert.equal(reopened?.status, "submitted"); assert.equal(reopened?.settled_tx_hash, null);
    const reversed = await facts();
    assert.equal(reversed.length, 2); assert.deepEqual(reversed[0], book, "the original money fact is retained unchanged");
    assert.equal(reversed[1].kind, "reversed"); assert.equal(reversed[1].reverses_fact_id, book.fact_id);
    assert.equal(reversed[1].amount_raw, book.amount_raw); assert.equal(reversed[1].money_key, book.money_key);
    const incomingReversed = await facts(payeeOrg);
    assert.deepEqual(incomingReversed[0], incoming);
    assert.equal(incomingReversed[1].reverses_fact_id, incoming.fact_id);
    assert.equal(incomingReversed[1].party_id, payerParty);
    assert.deepEqual((await events()).map((e) => e.props.transition), ["settle", "unsettle"]);
    await followPayment(worker, owner, id, { chainId: chain.chainId, finality: 0 }, { ...context, at: context.at + 3000 });
    assert.deepEqual(await facts(), reversed);
  } finally {
    await worker.query("rollback"); await admin.query("rollback");
    await admin.query("delete from app.transition_outbox where event->>'owner_id'=$1", [owner.id]);
    await admin.query("delete from app.payment_processes where owner_id=$1 and payment_id=$2", [owner.id, id]);
    await admin.query("delete from app.payments where owner_id=$1 and id=$2", [owner.id, id]);
    await admin.query("delete from app.book_annotations where owner_kind='organization' and owner_id=any($1)", [[owner.id, payeeOrg]]);
    await admin.query("delete from app.book_facts where org_id=any($1)", [[owner.id, payeeOrg]]);
    await admin.query("delete from app.book_feeds where org_id=any($1)", [[owner.id, payeeOrg]]);
    await admin.query("delete from app.parties where party_id=any($1)", [[payerParty, payeeParty]]);
    await worker.end(); await admin.end();
  }
});

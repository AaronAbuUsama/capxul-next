import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { createPublicClient, encodeFunctionData, http, parseAbi, type Address } from "viem";
import { localPrivateKeySigner } from "../../sdk/src/access/door.ts";
import { connect } from "../../devnet/src/modules/chain/service.ts";
import { execSafe } from "../../devnet/src/modules/protocol/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { Database } from "../src/platform/db.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { authenticate, migrateAccess, sendCode, verifyCode } from "../src/access/door.ts";
import { admit, migrateAccounts, observeClaim, personalSafe, routeAccounts } from "../src/accounts/door.ts";
import { personalSafeAddress } from "../src/platform/safe.ts";
import { readIndexerHead } from "../src/shared/door.ts";

// Native component proof of the personal Safe `claim` transition on real Postgres + Ponder + v4 Anvil.
// Not selected-stack acceptance: profile guard and invitation admission below are labelled component controls.
const url = process.env.CLAIM_TEST_ADMIN_URL, rpc = process.env.CLAIM_TEST_RPC, dir = process.env.CORE_PROOF_DIR;
const tenant = process.env.DATABASE_URL, worker = process.env.WORKER_DATABASE_URL;
if (!url || !rpc || !dir || !tenant || !worker || process.env.CAPXUL_DISPOSABLE !== "true" ||
    ![url, rpc, tenant, worker].every((u) => ["localhost", "127.0.0.1"].includes(new URL(u).hostname))) {
  throw new Error("Disposable loopback PG/Ponder/v4 world, restricted role URLs and CORE_PROOF_DIR required");
}

test("setup advances claiming→collecting only on the indexed, final, still-sole-owner CapxulSafeClaimed", async () => {
  const fixture = JSON.parse(readFileSync(`${dir}/fixture.json`, "utf8"));
  const deployment = JSON.parse(readFileSync(`${dir}/deployment.json`, "utf8"));
  assert.equal(fixture.disposable, true);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  // Component provisioning of the lane schemas (production wiring of migrate.ts is integrator-owned).
  await admin.query("begin");
  await migrateOutbox(admin);
  await migrateAccess(admin); await migrateAccounts(admin);
  await admin.query("commit");
  const db = new Database(tenant!, worker!);
  const chain = createPublicClient({ transport: http(rpc) });
  const chainConfig = { chainId: deployment.chainId as number, finalityDepth: 0 };
  const events = async (personId: string) => (await admin.query(`select event from app.transition_outbox
    where event->>'name'='personal_safe_transitioned' and event->>'entity_id'=$1 order by seq`, [personId])).rows.map((r) => r.event);
  try {
    // Independent expectation: the real chain log and receipt, not the projection under test.
    const logs = await chain.getLogs({ address: deployment.companiesHouse,
      event: parseAbi(["event CapxulSafeClaimed(address indexed safe,address indexed signer,bool deployed)"])[0]!,
      args: { safe: fixture.founderSafe }, fromBlock: BigInt(deployment.deployedBlock), toBlock: "latest" });
    assert.equal(logs.length, 1);
    const receipt = await chain.getTransactionReceipt({ hash: logs[0]!.transactionHash });
    const claimBlock = await chain.getBlock({ blockHash: receipt.blockHash });
    const founder = testKey("founder"), second = testKey("second");
    assert.equal(logs[0]!.args.signer!.toLowerCase(), founder.address.toLowerCase());

    const config = { companiesHouse: deployment.companiesHouse as Address, namespace: "capxul:devnet:email:v1" };
    const email = "founder@core.test";
    assert.equal(personalSafeAddress(config, email), fixture.founderSafe.toLowerCase(), "email-derived Safe is the claimed founder Safe");
    const now = Number((await chain.getBlock()).timestamp) * 1000;
    const signIn = async (mailbox: string) => {
      let code = "";
      await db.transaction("", (sql) => sendCode(sql, { email: mailbox }, {
        async send(m) { code = m.text!.match(/\b\d{6}\b/)![0]; return { id: randomUUID() }; } }, now), true);
      const result = await db.transaction("", (sql) => verifyCode(sql, { email: mailbox, code, client: "claim-proof" }, config, now + 1), true);
      assert(result.ok); return result.value;
    };
    const services = { companiesHouse: config.companiesHouse, setupUrl: "https://component.invalid/setup",
      catalogue: { "beta-access": { target: "person", money: false } } as const, async requireProfile() {} };
    const start = async (login: { token: string; personId: string }, mailbox: string, signer: Address) => {
      await db.transaction("", (sql) => admit(sql, { email: mailbox, via: "invitation", ref: "claim-proof" }, "claim-proof", now), true);
      return db.transaction("", (sql) => routeAccounts(sql, "/accounts/setup/start", { signer }, login.token, services, now + 2), true);
    };
    const observe = (personId: string, extra: Partial<typeof chainConfig> = {}) =>
      db.transaction("", (sql) => observeClaim(sql, personId, { ...chainConfig, ...extra }, `observe-${randomUUID()}`, now + 10), true);

    const login = await signIn(email);
    assert.equal(login.safe, fixture.founderSafe.toLowerCase());
    assert.deepEqual((await start(login, email, founder.address))!.body, { safe: login.safe, status: "claiming", attempt: 1 });
    const claiming = await db.transaction("", (sql) => personalSafe(sql, login.personId), true);
    assert.equal(claiming!.status, "claiming"); assert.equal(claiming!.claim_tx_hash, null);
    assert.deepEqual((await events(login.personId)).map((e) => e.props.transition), ["start"]);

    // Control: an unclaimed mailbox's Safe has no occurrence, so its setup stays claiming with no event.
    const otherEmail = `unclaimed-${randomUUID().slice(0, 8)}@core.test`, other = await signIn(otherEmail);
    await start(other, otherEmail, founder.address);
    assert.equal((await observe(other.personId)).status, "claiming");
    assert.deepEqual((await events(other.personId)).map((e) => e.props.transition), ["start"]);

    // Control: finality not yet reached leaves it claiming, with no synthetic hash/block/time or event.
    const head = await db.transaction("", (sql) => readIndexerHead(sql, chainConfig.chainId), true);
    const cutoff = BigInt(head.indexedBlock) < BigInt(head.headBlock) ? BigInt(head.indexedBlock) : BigInt(head.headBlock);
    const unreached = Number(cutoff - receipt.blockNumber) + 1;
    assert.deepEqual(await observe(login.personId, { finalityDepth: unreached }), claiming);

    // Control: real owner change indexed by Ponder; the original occurrence no longer admits the claim.
    const world = await connect(rpc!);
    const swap = async (from: typeof founder, to: typeof second) => {
      const tx = await execSafe(world, fixture.founderSafe, { to: fixture.founderSafe, data: encodeFunctionData({
        abi: parseAbi(["function swapOwner(address prevOwner,address oldOwner,address newOwner)"]), functionName: "swapOwner",
        args: ["0x0000000000000000000000000000000000000001", from.address, to.address] }) },
      [localPrivateKeySigner({ privateKey: from.key })], testKey("deployer").key);
      const mined = await chain.getTransactionReceipt({ hash: tx });
      const deadline = Date.now() + 30_000;
      while (BigInt((await db.transaction("", (sql) => readIndexerHead(sql, chainConfig.chainId), true)).indexedBlock) < mined.blockNumber) {
        assert(Date.now() < deadline, "real Ponder must index the owner change");
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    await swap(founder, second);
    try { assert.deepEqual(await observe(login.personId), claiming, "lost sole ownership keeps setup claiming"); }
    finally { await swap(second, founder); }
    assert.deepEqual((await events(login.personId)).map((e) => e.props.transition), ["start"]);

    // The transition: actual occurrence hash, block and chain time; world time for updated_at and the event.
    const collecting = await observe(login.personId);
    assert.equal(collecting.status, "collecting");
    assert.equal(collecting.claim_tx_hash, receipt.transactionHash.toLowerCase());
    assert.equal(Number(collecting.claimed_block), Number(receipt.blockNumber));
    assert.equal(Number(collecting.claimed_at), Number(claimBlock.timestamp) * 1000);
    assert.equal(Number(collecting.updated_at), now + 10);
    const emitted = await events(login.personId);
    assert.deepEqual(emitted.map((e) => e.props.transition), ["start", "claim"]);
    assert.deepEqual({ from: emitted[1].props.from, to: emitted[1].props.to, safe: emitted[1].props.safe, at: emitted[1].at },
      { from: "claiming", to: "collecting", safe: login.safe, at: now + 10 });

    // Repeat observation changes nothing; the public read projects the claimed Safe.
    assert.deepEqual(await observe(login.personId), collecting);
    assert.equal((await events(login.personId)).length, 2);
    const check = await db.transaction("", (sql) => routeAccounts(sql, "/accounts/setup/check", {}, login.token, services, now + 11), true);
    assert.deepEqual(check!.body, { setupState: "ready", setupUrl: null, next: null, safe: login.safe, claimed: true, collected: 0 });
    // Tenant isolation of the claimed row.
    await db.transaction("", async (sql) => {
      await authenticate(sql, login.token, now + 12);
      assert.equal((await personalSafe(sql, login.personId))!.status, "collecting", "positive control: the owner's own session reads it");
      await authenticate(sql, other.token, now + 12);
      assert.equal(await personalSafe(sql, login.personId), null);
    });
  } finally { await db.close(); await admin.end(); }
});

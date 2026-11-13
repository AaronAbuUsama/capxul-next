import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { createPublicClient, encodeFunctionData, http, parseAbi, type Address } from "viem";
import { localPrivateKeySigner } from "../../sdk/src/access/door.ts";
import { connect } from "../../devnet/src/modules/chain/service.ts";
import { execSafe } from "../../devnet/src/modules/protocol/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { IndexerError, readIndexerHead, readPersonalSafeClaim } from "../src/shared/door.ts";

const url = process.env.CLAIM_TEST_ADMIN_URL;
const rpc = process.env.CLAIM_TEST_RPC;
const dir = process.env.CORE_PROOF_DIR;
if (!url || !rpc || !dir || process.env.CAPXUL_DISPOSABLE !== "true" ||
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
    !["localhost", "127.0.0.1"].includes(new URL(rpc).hostname)) {
  throw new Error("Disposable loopback PG/Ponder/v4 world and CORE_PROOF_DIR required");
}

test("indexed claim admission uses the real occurrence, finality and exact Party scope", async () => {
  const fixture = JSON.parse(readFileSync(`${dir}/fixture.json`, "utf8"));
  assert.equal(fixture.disposable, true);
  const deployment = JSON.parse(readFileSync(`${dir}/deployment.json`, "utf8"));
  const chain = createPublicClient({ transport: http(rpc) });
  // Derive the expected identity from the actual chain event/receipt, not the projection under test.
  const logs = await chain.getLogs({ address: deployment.companiesHouse,
    event: parseAbi(["event CapxulSafeClaimed(address indexed safe,address indexed signer,bool deployed)"])[0]!,
    args: { safe: fixture.founderSafe }, fromBlock: BigInt(deployment.deployedBlock), toBlock: "latest" });
  assert.equal(logs.length, 1);
  const log = logs[0]!;
  const receipt = await chain.getTransactionReceipt({ hash: log.transactionHash });
  const block = await chain.getBlock({ blockHash: receipt.blockHash });
  assert.equal(receipt.status, "success");
  const expected = { txHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash, blockTime: Number(block.timestamp) * 1000 };
  const input = { chainId: deployment.chainId, safe: fixture.founderSafe as Address,
    signer: log.args.signer!, finalityDepth: 0 };
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("begin");
    await sql.query("set local role capxul_worker");
    const head = await readIndexerHead(sql, input.chainId);
    assert.equal(head.ready, true);
    const indexedBlock = await chain.getBlock({ blockNumber: BigInt(head.indexedBlock) });
    assert.equal(head.indexedBlockHash, indexedBlock.hash);
    assert.equal(head.indexedBlockTime, Number(indexedBlock.timestamp) * 1000);
    assert.deepEqual(await readPersonalSafeClaim(sql, input), expected, "adoption locates the original claim without a new tx");
    assert.deepEqual(await readPersonalSafeClaim(sql, { ...input, txHash: expected.txHash }), expected);
    const cutoff = BigInt(head.indexedBlock) < BigInt(head.headBlock) ? BigInt(head.indexedBlock) : BigInt(head.headBlock);
    const depth = Number(cutoff - receipt.blockNumber);
    assert(depth > 0);
    assert.deepEqual(await readPersonalSafeClaim(sql, { ...input, finalityDepth: depth }), expected);
    assert.equal(await readPersonalSafeClaim(sql, { ...input, finalityDepth: depth + 1 }), null);
    assert.equal(await readPersonalSafeClaim(sql, { ...input, txHash: fixture.agentTx }), null);
    assert.equal(await readPersonalSafeClaim(sql, { ...input, signer: fixture.agentSigner }), null);
    assert.equal(await readPersonalSafeClaim(sql, { ...input, safe: fixture.safe, signer: fixture.founderSafe }), null,
      "current sole ownership of a company Safe is not a personal claim");
    await assert.rejects(readIndexerHead(sql, input.chainId + 1), (e: unknown) => e instanceof IndexerError && e.code === "PROVIDER_ERROR");
    await sql.query("reset role");
    await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
      values ('shared-claim-proof','person','active',$1,'person','shared-claim-proof',0,0)`, [input.safe.toLowerCase()]);
    await sql.query("set local role capxul_core");
    const scope = async (kind: string, id: string) => {
      await sql.query("select set_config('app.owner_kind',$1,true),set_config('app.owner_id',$2,true)", [kind, id]);
      return readPersonalSafeClaim(sql, input);
    };
    assert.deepEqual(await scope("person", "shared-claim-proof"), expected);
    assert.equal(await scope("organization", "shared-claim-proof"), null, "same id of another owner kind grants nothing");
    assert.equal(await scope("person", "outsider"), null);
    assert.equal(await scope("", ""), null);
    await sql.query("reset role");
    await sql.query("update app.parties set state='released' where party_id='shared-claim-proof'");
    await sql.query("set local role capxul_core");
    assert.equal(await scope("person", "shared-claim-proof"), null);

    await sql.query("reset role; set local role capxul_worker");
    const world = await connect(rpc!);
    const founder = testKey("founder"), second = testKey("second");
    assert.equal(founder.address.toLowerCase(), input.signer.toLowerCase());
    const swap = async (from: typeof founder, to: typeof second) => execSafe(world, input.safe, {
      to: input.safe, data: encodeFunctionData({ abi: parseAbi(["function swapOwner(address prevOwner,address oldOwner,address newOwner)"]),
        functionName: "swapOwner", args: ["0x0000000000000000000000000000000000000001", from.address, to.address] }),
    }, [localPrivateKeySigner({ privateKey: from.key })], testKey("deployer").key);
    const caughtUp = async (tx: Awaited<ReturnType<typeof swap>>) => {
      const mined = await chain.getTransactionReceipt({ hash: tx });
      const deadline = Date.now() + 30_000;
      while (BigInt((await readIndexerHead(sql, input.chainId)).indexedBlock) < mined.blockNumber) {
        assert(Date.now() < deadline, "real Ponder must index the owner change");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    const changed = await swap(founder, second);
    try {
      await caughtUp(changed);
      assert.equal(await readPersonalSafeClaim(sql, input), null, "the original claim is insufficient after its signer loses ownership");
      assert.equal(await readPersonalSafeClaim(sql, { ...input, signer: second.address }), null,
        "a new sole owner has no claim occurrence merely by owning the Safe");
    } finally { await caughtUp(await swap(second, founder)); }
    assert.deepEqual(await readPersonalSafeClaim(sql, input), expected);
  } finally { await sql.query("rollback"); await sql.end(); }
});

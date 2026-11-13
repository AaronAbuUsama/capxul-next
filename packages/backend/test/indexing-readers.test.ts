import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { readHatAt, readHatTransfersInTx, readHatWearersAt, readWearerHatsAt, readSafeApprovals, readSafeExecution, readSafeOwnersAt } from "../src/indexing/door.ts";

if (!process.env.CORE_PROOF_DIR || process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("indexing reader controls require a named disposable real Ponder/v4 world");

test("finalized Safe and hat readers return exact log facts and refuse a newer projection as history", async () => {
  const fixture = JSON.parse(await readFile(`${process.env.CORE_PROOF_DIR}/fixture.json`, "utf8"));
  const sql = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL! });
  await sql.connect();
  try {
    const safe = fixture.safe.toLowerCase(), founder = fixture.founderSafe.toLowerCase(), second = testKey("second").address.toLowerCase();
    const head = (await sql.query("select chain_id,indexed_block from app.indexer_progress")).rows[0];
    const chainId = head.chain_id, beyond = Number(head.indexed_block) + 1;
    // A seeded Board call: the founder Safe approves the company Safe's hash, then the company Safe executes it.
    const approved = (await sql.query(`select e.*,a.block_number as approved_block from ponder.safe_executions e
      join ponder.safe_approvals a on a.safe_address=e.safe_address and a.safe_tx_hash=e.safe_tx_hash and a.owner=$2
      where e.safe_address=$1 order by e.safe_nonce limit 1`, [safe, founder])).rows[0];
    assert(approved, "the seeded Board path approves by hash before executing");
    const execution = await readSafeExecution(sql, { chainId, safe: fixture.safe, nonce: String(approved.safe_nonce), finality: 0 });
    assert.deepEqual([execution?.log_id, execution?.safe_tx_hash, execution?.nonce, execution?.success, execution?.block_number],
      [approved.log_id, approved.safe_tx_hash, String(approved.safe_nonce), approved.success, String(approved.block_number)]);
    // The devnet relayer executes with approved-hash signatures; the founder's Safe was the only owner, threshold 1.
    assert.deepEqual([execution?.msg_sender, execution?.threshold], [testKey("deployer").address.toLowerCase(), 1]);
    assert.equal(await readSafeExecution(sql, { chainId, safe, nonce: String(approved.safe_nonce), finality: beyond }), null);
    assert.equal(await readSafeExecution(sql, { chainId, safe, nonce: "999999", finality: 0 }), null);
    await assert.rejects(readSafeExecution(sql, { chainId, safe, nonce: (1n << 256n).toString(), finality: 0 }), /INVALID_INPUT/);

    const at = BigInt(approved.approved_block);
    const owners = (block?: bigint) => readSafeApprovals(sql, { chainId, safe, safeTxHash: approved.safe_tx_hash, finality: 0,
      ...(block === undefined ? {} : { atBlock: block.toString() }) });
    assert.deepEqual((await owners(at - 1n)).map((a) => a.owner), [], "an approval after atBlock is not yet an approval");
    assert.deepEqual((await owners(at)).map((a) => a.owner), [founder]);
    assert.deepEqual((await owners()).map((a) => a.owner), [founder]);

    const state = await readSafeOwnersAt(sql, { chainId, safe, finality: 0 });
    assert.deepEqual([state?.owners, state?.threshold, state?.kind], [[founder], 1, "company"]);
    const updated = BigInt(state!.updated_block);
    assert.equal((await readSafeOwnersAt(sql, { chainId, safe, atBlock: updated.toString(), finality: 0 }))?.updated_block, state!.updated_block);
    await assert.rejects(readSafeOwnersAt(sql, { chainId, safe, atBlock: (updated - 1n).toString(), finality: 0 }), /HISTORICAL_UNAVAILABLE: safe-owners/);
    assert.equal(await readSafeOwnersAt(sql, { chainId, safe: testKey("stranger").address, finality: 0 }), null);

    const hat = await readHatAt(sql, { chainId, hatId: fixture.hat, finality: 0 });
    assert.deepEqual([hat?.hat_id, hat?.company_safe, hat?.max_supply], [BigInt(fixture.hat).toString(), safe, "2"]);
    await assert.rejects(readHatAt(sql, { chainId, hatId: fixture.hat, atBlock: (BigInt(hat!.updated_block) - 1n).toString(), finality: 0 }),
      /HISTORICAL_UNAVAILABLE: chain-hats/);
    const wearers = await readHatWearersAt(sql, { chainId, hatId: fixture.hat, finality: 0 });
    assert.equal(wearers.find((w) => w.wearer === second)?.wearing, true);
    const worn = await readWearerHatsAt(sql, { chainId, wearer: second, companySafe: safe, finality: 0 });
    assert.deepEqual(worn.filter((w) => w.hat_id === BigInt(fixture.hat).toString()).map((w) => [w.details, w.wearing]), [[hat!.details, true]]);
    assert.deepEqual(await readWearerHatsAt(sql, { chainId, wearer: second, companySafe: founder, finality: 0 }), [], "another company's hats stay out");
    await assert.rejects(readWearerHatsAt(sql, { chainId, wearer: second, companySafe: safe, atBlock: (BigInt(worn[0]!.updated_block) - 1n).toString(), finality: 0 }),
      /HISTORICAL_UNAVAILABLE/);

    // A module-ruled hat changes wearers and status with no Hats event: every indexed hat reader refuses it.
    const ruled = (await sql.query("select hat_id,live from app.chain_hats where company_safe=$1 and details=$2", [safe, fixture.moduleHatDetails])).rows[0];
    assert.equal(ruled?.live, true, "Ponder marks the hat whose eligibility answers Hats");
    assert.equal((await sql.query("select live from app.chain_hats where company_safe=$1 and details=$2", [safe, hat!.details])).rows[0].live, false,
      "a hat whose eligibility and toggle are the company Safe stays evented");
    const ruledId = BigInt(ruled.hat_id).toString();
    await assert.rejects(readHatAt(sql, { chainId, hatId: ruledId, finality: 0 }), /HISTORICAL_UNAVAILABLE: hat .* module/);
    await assert.rejects(readHatWearersAt(sql, { chainId, hatId: ruledId, finality: 0 }), /HISTORICAL_UNAVAILABLE: hat .* module/);

    // A person's or unscoped tenant session would see row-filtered projections as complete lists: refused.
    const tenant = new pg.Client({ connectionString: process.env.DATABASE_URL! });
    await tenant.connect();
    try {
      await assert.rejects(readWearerHatsAt(tenant, { chainId, wearer: second, companySafe: safe, finality: 0 }), /FORBIDDEN/);
      await tenant.query("begin");
      await tenant.query("select set_config('app.owner_kind','person',true),set_config('app.owner_id','someone',true)");
      await assert.rejects(readHatWearersAt(tenant, { chainId, hatId: fixture.hat, finality: 0 }), /FORBIDDEN/);
      await assert.rejects(readHatAt(tenant, { chainId, hatId: fixture.hat, finality: 0 }), /FORBIDDEN/);
      await tenant.query("rollback");
    } finally { await tenant.end(); }

    const grant = (await sql.query(`select tx_hash,log_id from app.chain_logs where contract='hats' and event='TransferSingle'
      and args->>'to'=$1 and args->>'id'=$2 order by block_number limit 1`, [second, BigInt(fixture.hat).toString()])).rows[0];
    const minted = await readHatTransfersInTx(sql, { chainId, txHash: grant.tx_hash, hatId: fixture.hat, finality: 0 });
    assert.deepEqual(minted.map((m) => [m.log_id, m.from, m.to, m.value]), [[grant.log_id, `0x${"0".repeat(40)}`, second, "1"]]);
    assert.deepEqual(await readHatTransfersInTx(sql, { chainId, txHash: grant.tx_hash, hatId: (BigInt(fixture.hat) + 1n).toString(), finality: 0 }), []);
    assert.deepEqual(await readHatTransfersInTx(sql, { chainId, txHash: grant.tx_hash, hatId: fixture.hat, finality: beyond }), []);
  } finally { await sql.end(); }
});

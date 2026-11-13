import type { Sql } from "../platform/db.ts";
import type { ChainFact } from "../approvals/door.ts";

/** The nonce, not the expected hash, finds a final foreign operation that displaced the carrier. */
export async function readChainFact(sql: Sql, input: {
  chainId: number; sender: string; nonce: string; finality: number;
}): Promise<ChainFact | null> {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1 || !Number.isSafeInteger(input.finality) || input.finality < 0 ||
      !/^0x[0-9a-fA-F]{40}$/.test(input.sender) || !/^\d+$/.test(input.nonce) || BigInt(input.nonce) >= 1n << 256n)
    throw new Error("INVALID_INPUT: indexed carrier identity");
  const progress = (await sql.query("select indexed_block,ready from app.indexer_progress where chain_id=$1", [input.chainId])).rows[0];
  if (!progress?.ready) throw new Error("INDEXER_NOT_READY: canonical indexed head required");
  const nonce = BigInt(input.nonce);
  const fact = (await sql.query(`select * from app.user_operations where chain_id=$1 and sender=$2
    and nonce_key=$3 and nonce_sequence=$4 and block_number<=$5`,
  [input.chainId, input.sender.toLowerCase(), (nonce >> 64n).toString(), (nonce & ((1n << 64n) - 1n)).toString(),
    (BigInt(progress.indexed_block) - BigInt(input.finality)).toString()])).rows[0];
  if (!fact) return null;
  return { chain_id: fact.chain_id, sender: fact.sender, nonce: ((BigInt(fact.nonce_key) << 64n) | BigInt(fact.nonce_sequence)).toString(),
    user_op_hash: fact.user_op_hash, success: fact.success, transaction_hash: fact.tx_hash, block_number: Number(fact.block_number) };
}

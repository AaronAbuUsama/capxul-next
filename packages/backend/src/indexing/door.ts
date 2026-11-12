import type { Sql } from "../platform/db.ts";

/** Chain provenance only. Org/person/department labels come from their authoritative directories. */
export interface HatTransferFact {
  log_id: string; chain_id: number; block_number: string; block_hash: string; block_time: number;
  tx_hash: string; tx_log_ordinal: number; log_index: number; company_safe: string;
  hat_id: string; operator: string; from: string; to: string; value: string;
}

/** Read one durable occurrence on the caller's Sql; no checkout, transaction, RPC or directory copy. */
export async function readHatTransfer(sql: Sql, input: {
  chainId: number; logId: string; companySafe: string; finality: number;
}): Promise<HatTransferFact | null> {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1 || !Number.isSafeInteger(input.finality) || input.finality < 0)
    throw new Error("INVALID_INPUT: indexed hat occurrence");
  const progress = (await sql.query("select indexed_block,ready from app.indexer_progress where chain_id=$1", [input.chainId])).rows[0];
  if (!progress?.ready) throw new Error("INDEXER_NOT_READY: canonical indexed head required");
  const log = (await sql.query(`select * from app.chain_logs where chain_id=$1 and log_id=$2
    and contract='hats' and event='TransferSingle' and block_number<=$3`,
  [input.chainId, input.logId, (BigInt(progress.indexed_block) - BigInt(input.finality)).toString()])).rows[0];
  if (!log) return null;
  const hatId = BigInt(log.args.id).toString();
  const companySafe = input.companySafe.toLowerCase();
  const hat = (await sql.query(`select 1 from app.chain_hats where chain_id=$1 and hat_id=$2 and company_safe=$3`,
    [input.chainId, `0x${BigInt(hatId).toString(16).padStart(64, "0")}`, companySafe])).rowCount;
  if (!hat) return null;
  return { log_id: log.log_id, chain_id: log.chain_id, block_number: String(log.block_number), block_hash: log.block_hash,
    block_time: Number(log.block_time), tx_hash: log.tx_hash, tx_log_ordinal: log.tx_log_ordinal, log_index: log.log_index,
    company_safe: companySafe, hat_id: hatId, operator: log.args.operator, from: log.args.from, to: log.args.to, value: log.args.value };
}

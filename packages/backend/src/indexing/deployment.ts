import type { Sql } from "../platform/db.ts";

export interface MoneyDeploymentFact {
  log_id: string; chain_id: number; block_number: string; block_hash: string; block_time: number;
  tx_hash: string; tx_log_ordinal: number; log_index: number; safe: string; founder_safe: string;
  board_top_hat: string; shareholders_top_hat: string; director_hat: string; officer_hats: string[]; roles: string; gate: string;
}

/** Numeric deployment provenance only; no native officer/Department names are inferred. */
export async function readMoneyDeployment(sql: Sql, input: {
  chainId: number; logId: string; companySafe: string; finality: number;
}): Promise<MoneyDeploymentFact | null> {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1 || !Number.isSafeInteger(input.finality) || input.finality < 0 ||
      !/^0x[0-9a-fA-F]{40}$/.test(input.companySafe)) throw new Error("INVALID_INPUT: deployment occurrence");
  const progress = (await sql.query("select indexed_block,ready from app.indexer_progress where chain_id=$1", [input.chainId])).rows[0];
  if (!progress?.ready) throw new Error("INDEXER_NOT_READY: canonical indexed head required");
  const log = (await sql.query(`select * from app.chain_logs where chain_id=$1 and log_id=$2 and contract='installer'
    and event='MoneyDeployed' and args->>'safe'=$3 and block_number<=$4`,
  [input.chainId, input.logId, input.companySafe.toLowerCase(), (BigInt(progress.indexed_block) - BigInt(input.finality)).toString()])).rows[0];
  if (!log) return null;
  const a = log.args, d = a.deployment;
  return { log_id: log.log_id, chain_id: log.chain_id, block_number: String(log.block_number), block_hash: log.block_hash,
    block_time: Number(log.block_time), tx_hash: log.tx_hash, tx_log_ordinal: log.tx_log_ordinal, log_index: log.log_index,
    safe: a.safe, founder_safe: a.founderSafe, board_top_hat: BigInt(d.boardTopHat).toString(),
    shareholders_top_hat: BigInt(d.shareholdersTopHat).toString(), director_hat: BigInt(d.directorHat).toString(),
    officer_hats: d.officerHats.map((hat: string) => BigInt(hat).toString()), roles: d.roles, gate: d.gate };
}

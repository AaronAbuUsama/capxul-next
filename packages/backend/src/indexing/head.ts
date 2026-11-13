import type { Sql } from "../platform/db.ts";

export const address = (value: string, what: string) => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`INVALID_INPUT: ${what}`);
  return value.toLowerCase();
};
export const uint = (value: string, what: string) => {
  if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) >= 1n << 256n) throw new Error(`INVALID_INPUT: ${what}`);
  return BigInt(value);
};
/** Hat ids are decimal at the door and 32-byte hex in the projections. */
export const hatKey = (hatId: string) => `0x${uint(hatId, "hat id").toString(16).padStart(64, "0")}`;

/** Canonical indexed head minus the caller's finality depth, on the caller's Sql. */
export async function indexedCutoff(sql: Sql, chainId: number, finality: number): Promise<bigint> {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !Number.isSafeInteger(finality) || finality < 0)
    throw new Error("INVALID_INPUT: indexed read");
  const progress = (await sql.query("select indexed_block,ready from app.indexer_progress where chain_id=$1", [chainId])).rows[0];
  if (!progress?.ready) throw new Error("INDEXER_NOT_READY: canonical indexed head required");
  return BigInt(progress.indexed_block) - BigInt(finality);
}
/**
 * The worker, or the session of the Organization whose non-released Party is this company Safe. Any other session would
 * read row-level-filtered projections (another company's rows hidden) as if they were complete, so it is refused rather
 * than answered with a partial list.
 */
export async function companyScope(sql: Sql, companySafe: string): Promise<void> {
  const s = (await sql.query("select current_user as role,current_setting('app.owner_kind',true) as kind,current_setting('app.owner_id',true) as id")).rows[0];
  if (s.role === "capxul_worker") return;
  const own = s.kind === "organization" && s.id && (await sql.query(`select 1 from app.parties where owner_kind='organization' and owner_id=$1
    and safe_address=$2 and state<>'released'`, [s.id, companySafe])).rowCount;
  if (!own) throw new Error("FORBIDDEN: company hat reads need the worker or the session of the Organization that owns that Safe");
}
/** An explicit block never reaches past the finalized cutoff. */
export const atOrCutoff = (cutoff: bigint, atBlock?: string) => {
  if (atBlock === undefined) return cutoff;
  const at = uint(atBlock, "block");
  return at < cutoff ? at : cutoff;
};

export interface LogFact {
  log_id: string; chain_id: number; block_number: string; block_hash: string; block_time: number;
  tx_hash: string; tx_log_ordinal: number; log_index: number;
}
export const logFact = (row: Record<string, any>): LogFact => ({ log_id: row.log_id, chain_id: row.chain_id,
  block_number: String(row.block_number), block_hash: row.block_hash, block_time: Number(row.block_time),
  tx_hash: row.tx_hash, tx_log_ordinal: row.tx_log_ordinal, log_index: row.log_index });

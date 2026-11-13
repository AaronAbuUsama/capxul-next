import type { Sql } from "../platform/db.ts";
import { address, atOrCutoff, indexedCutoff, logFact, type LogFact, uint } from "./head.ts";

/** `msg_sender` and `threshold` are SafeL2's additionalInfo: the caller (an owner signing with v=1 emits no ApproveHash) and the threshold checked. */
export interface SafeExecutionFact extends LogFact { safe: string; safe_tx_hash: string; nonce: string; success: boolean; msg_sender: string; threshold: number }
export interface SafeApprovalFact extends LogFact { safe: string; safe_tx_hash: string; owner: string }
export interface SafeOwnersFact {
  safe_address: string; chain_id: number; kind: string; deployed: boolean; owners: string[]; threshold: number; nonce: string;
  modules: string[]; guard: string | null; founder_safe: string | null; agent_owner: string | null; frozen: boolean; removed: boolean;
  updated_block: string;
}

/** One finalized execution, found by the Safe nonce it used. */
export async function readSafeExecution(sql: Sql, input: { chainId: number; safe: string; nonce: string; finality: number }): Promise<SafeExecutionFact | null> {
  const safe = address(input.safe, "Safe"), nonce = uint(input.nonce, "Safe nonce");
  const cutoff = await indexedCutoff(sql, input.chainId, input.finality);
  const row = (await sql.query(`select * from app.safe_executions where chain_id=$1 and safe_address=$2 and safe_nonce=$3
    and block_number<=$4`, [input.chainId, safe, nonce.toString(), cutoff.toString()])).rows[0];
  return row ? { ...logFact(row), safe, safe_tx_hash: row.safe_tx_hash, nonce: String(row.safe_nonce), success: row.success,
    msg_sender: row.msg_sender, threshold: Number(row.threshold) } : null;
}

/** Every finalized ApproveHash of that Safe transaction at or before atBlock, in chain order. */
export async function readSafeApprovals(sql: Sql, input: {
  chainId: number; safe: string; safeTxHash: string; atBlock?: string; finality: number;
}): Promise<SafeApprovalFact[]> {
  const safe = address(input.safe, "Safe");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.safeTxHash)) throw new Error("INVALID_INPUT: Safe transaction hash");
  const at = atOrCutoff(await indexedCutoff(sql, input.chainId, input.finality), input.atBlock);
  return (await sql.query(`select * from app.safe_approvals where chain_id=$1 and safe_address=$2 and safe_tx_hash=$3
    and block_number<=$4 order by block_number,log_index`, [input.chainId, safe, input.safeTxHash.toLowerCase(), at.toString()]))
    .rows.map((r) => ({ ...logFact(r), safe, safe_tx_hash: r.safe_tx_hash, owner: r.owner }));
}

/** The current projection row only if it has not changed after atBlock; never a newer state as an older one. */
export async function readSafeOwnersAt(sql: Sql, input: { chainId: number; safe: string; atBlock?: string; finality: number }): Promise<SafeOwnersFact | null> {
  const safe = address(input.safe, "Safe");
  const at = atOrCutoff(await indexedCutoff(sql, input.chainId, input.finality), input.atBlock);
  const row = (await sql.query("select * from app.safe_owners where chain_id=$1 and safe_address=$2", [input.chainId, safe])).rows[0];
  if (!row) return null;
  if (BigInt(row.updated_block) > at) throw new Error(`HISTORICAL_UNAVAILABLE: safe-owners changed after block ${at}`);
  return { safe_address: row.safe_address, chain_id: row.chain_id, kind: row.kind, deployed: row.deployed, owners: row.owners,
    threshold: row.threshold, nonce: String(row.nonce), modules: row.modules, guard: row.guard, founder_safe: row.founder_safe,
    agent_owner: row.agent_owner, frozen: row.frozen, removed: row.removed, updated_block: String(row.updated_block) };
}

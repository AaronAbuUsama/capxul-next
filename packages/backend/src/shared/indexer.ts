import { isAddress, type Address, type Hex } from "viem";
import type { Sql } from "../platform/db.ts";

export class IndexerError extends Error {
  readonly code: "PROVIDER_ERROR" | "PROVIDER_RESPONSE_INVALID" | "INVALID_INPUT";
  constructor(code: IndexerError["code"]) { super(`Indexer refused: ${code}`); this.name = "IndexerError"; this.code = code; }
}
export type IndexerProgress = {
  chainId: number; indexedBlock: string; indexedBlockHash: Hex; indexedBlockTime: number;
  headBlock: string; headSeenAt: number; ready: boolean; buildId: string; updatedAt: number;
};
export type IndexedClaim = { txHash: Hex; blockNumber: string; blockHash: Hex; blockTime: number };
export type ClaimLookup = { chainId: number; safe: Address; signer: Address; txHash?: Hex; finalityDepth: number };

const invalid = () => new IndexerError("PROVIDER_RESPONSE_INVALID");
function integer(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  throw invalid();
}
function milliseconds(value: unknown): number {
  const n = Number(integer(value));
  if (!Number.isSafeInteger(n)) throw invalid();
  return n;
}
function hash(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw invalid();
  return value.toLowerCase() as Hex;
}
function progress(row: Record<string, unknown> | undefined, chainId: number): IndexerProgress {
  if (!row) throw new IndexerError("PROVIDER_ERROR");
  if (row.chain_id !== chainId || typeof row.ready !== "boolean" || typeof row.build_id !== "string" || !row.build_id) throw invalid();
  return { chainId, indexedBlock: integer(row.indexed_block).toString(), indexedBlockHash: hash(row.indexed_block_hash),
    indexedBlockTime: milliseconds(row.indexed_block_time), headBlock: integer(row.head_block).toString(),
    headSeenAt: milliseconds(row.head_seen_at), ready: row.ready, buildId: row.build_id, updatedAt: milliseconds(row.updated_at) };
}

/** Same caller SQL, no new transaction, raw Ponder read, or manufactured progress. */
export async function readIndexerHead(sql: Sql, chainId: number): Promise<IndexerProgress> {
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new IndexerError("INVALID_INPUT");
  try { return progress((await sql.query("select * from app.indexer_progress where chain_id=$1", [chainId])).rows[0], chainId); }
  catch (error) { if (error instanceof IndexerError) throw error; throw new IndexerError("PROVIDER_ERROR"); }
}

/** Admission for setup/adoption, NOT a historical owners/approvals snapshot. All reads use one SQL snapshot. */
export async function readPersonalSafeClaim(sql: Sql, input: ClaimLookup): Promise<IndexedClaim | null> {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1 || !Number.isSafeInteger(input.finalityDepth) || input.finalityDepth < 0 ||
      !isAddress(input.safe) || !isAddress(input.signer) || (input.txHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(input.txHash))) {
    throw new IndexerError("INVALID_INPUT");
  }
  try {
    const row = (await sql.query(`select p.*, c.tx_hash as claim_tx_hash,c.block_number as claim_block,
      c.block_hash as claim_block_hash,c.block_time as claim_block_time,
      o.owners,o.threshold,o.deployed,o.updated_block as owner_updated_block
      from app.indexer_progress p
      left join lateral (select tx_hash,block_number,block_hash,block_time,log_index from app.chain_logs
        where chain_id=p.chain_id and contract='companies-house-claimer' and event='CapxulSafeClaimed'
        and args->>'safe'=$2 and args->>'signer'=$3 and ($4::text is null or tx_hash=$4)
        order by block_number desc,log_index desc limit 1) c on true
      left join app.safe_owners o on o.chain_id=p.chain_id and o.safe_address=$2
      where p.chain_id=$1`, [input.chainId, input.safe.toLowerCase(), input.signer.toLowerCase(), input.txHash?.toLowerCase() ?? null])).rows[0];
    const head = progress(row, input.chainId);
    if (!head.ready) throw new IndexerError("PROVIDER_ERROR");
    if (!row.claim_tx_hash || row.deployed !== true || !Array.isArray(row.owners) || row.owners.length !== 1 ||
        row.threshold !== 1 || typeof row.owners[0] !== "string" || row.owners[0].toLowerCase() !== input.signer.toLowerCase()) return null;
    const indexed = BigInt(head.indexedBlock), seen = BigInt(head.headBlock), block = integer(row.claim_block);
    const cutoff = indexed < seen ? indexed : seen;
    if (block + BigInt(input.finalityDepth) > cutoff || integer(row.owner_updated_block) > indexed) return null;
    const blockHash = hash(row.claim_block_hash);
    if (block === indexed && blockHash !== head.indexedBlockHash) throw invalid();
    return { txHash: hash(row.claim_tx_hash), blockNumber: block.toString(), blockHash, blockTime: milliseconds(row.claim_block_time) };
  } catch (error) {
    if (error instanceof IndexerError) throw error;
    throw new IndexerError("PROVIDER_ERROR");
  }
}

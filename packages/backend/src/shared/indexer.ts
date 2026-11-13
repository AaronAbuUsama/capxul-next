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

/**
 * integration indexer, awaitBlock: polls Ponder's progress once a second until it has indexed `block` with its views
 * ready, for at most `polls` seconds (10). Counts polls rather than reading a clock. Reindexing, a lag past the deadline
 * or a Postgres that never answers is PROVIDER_ERROR; a checkpoint that does not decode is PROVIDER_RESPONSE_INVALID.
 */
export async function awaitIndexedBlock(sql: Sql, chainId: number, block: bigint | string,
  options: { polls?: number; intervalMs?: number } = {}): Promise<IndexerProgress> {
  const target = integerOr(block, () => new IndexerError("INVALID_INPUT"));
  const polls = options.polls ?? 10, intervalMs = options.intervalMs ?? 1_000;
  for (let poll = 0; ; poll++) {
    try {
      const head = await readIndexerHead(sql, chainId);
      if (head.ready && BigInt(head.indexedBlock) >= target) return head;
    } catch (error) {
      if (error instanceof IndexerError && error.code !== "PROVIDER_ERROR") throw error;
    }
    if (poll >= polls) throw new IndexerError("PROVIDER_ERROR");
    await new Promise((done) => setTimeout(done, intervalMs));
  }
}

export type IndexedFact = {
  logId: string; blockNumber: string; blockHash: Hex; blockTime: number; txLogOrdinal: number; logIndex: number;
} & (
  | { kind: "payment"; paymentId: Hex; sender: Address; recipient: Address; token: Address; amount: string; paymentKind: number; documentHash: Hex }
  | { kind: "transfer"; token: Address; from: Address; to: Address; amount: string }
  | { kind: "userOperation"; userOpHash: Hex; sender: Address; paymaster: Address; nonce: string; success: boolean; actualGasCost: string; actualGasUsed: string }
  | { kind: "log"; contract: string; event: string; args: Record<string, unknown> }
);
export type FactsLookup = { chainId: number; txHash: Hex; block: bigint | string; finalityDepth: number };

function integerOr(value: unknown, refuse: () => Error): bigint {
  try { return integer(value); } catch { throw refuse(); }
}
const address = (value: unknown): Address => {
  if (typeof value !== "string" || !isAddress(value)) throw invalid();
  return value.toLowerCase() as Address;
};
const word = (value: unknown, bytes: number): Hex => {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)) throw invalid();
  return value.toLowerCase() as Hex;
};
const smallInteger = (value: unknown): number => {
  const n = Number(integer(value));
  if (!Number.isSafeInteger(n)) throw invalid();
  return n;
};

/** One row of the four fact views as its event; anything that does not decode is PROVIDER_RESPONSE_INVALID. */
function fact(row: Record<string, unknown>, chainId: number, txHash: Hex): IndexedFact {
  const ordinal = smallInteger(row.tx_log_ordinal);
  if (row.chain_id !== chainId || hash(row.tx_hash) !== txHash || row.log_id !== `${chainId}:${txHash}:${ordinal}`) throw invalid();
  const base = { logId: row.log_id as string, blockNumber: integer(row.block_number).toString(), blockHash: hash(row.block_hash),
    blockTime: milliseconds(row.block_time), txLogOrdinal: ordinal, logIndex: smallInteger(row.log_index) };
  switch (row.kind) {
    case "payment": return { ...base, kind: "payment", paymentId: word(row.payment_id, 32), sender: address(row.sender), recipient: address(row.recipient),
      token: address(row.token), amount: integer(row.amount).toString(), paymentKind: smallInteger(row.payment_kind), documentHash: word(row.document_hash, 32) };
    case "transfer": return { ...base, kind: "transfer", token: address(row.token), from: address(row.sender), to: address(row.recipient), amount: integer(row.amount).toString() };
    case "userOperation":
      if (typeof row.success !== "boolean") throw invalid();
      return { ...base, kind: "userOperation", userOpHash: word(row.user_op_hash, 32), sender: address(row.sender), paymaster: address(row.paymaster),
        nonce: integer(row.nonce).toString(), success: row.success, actualGasCost: integer(row.actual_gas_cost).toString(), actualGasUsed: integer(row.actual_gas_used).toString() };
    case "log":
      if (typeof row.contract !== "string" || !row.contract || typeof row.event !== "string" || !row.event ||
          typeof row.args !== "object" || row.args === null || Array.isArray(row.args)) throw invalid();
      return { ...base, kind: "log", contract: row.contract, event: row.event, args: row.args as Record<string, unknown> };
    default: throw invalid();
  }
}

const FACTS = `select 'payment' as kind, log_id, chain_id, block_number, block_hash, block_time, tx_hash, tx_log_ordinal, log_index,
    payment_id, sender, recipient, token, amount, kind as payment_kind, document_hash, null::text as user_op_hash, null::text as paymaster,
    null::numeric as nonce, null::boolean as success, null::numeric as actual_gas_cost, null::numeric as actual_gas_used,
    null::text as contract, null::text as event, null::jsonb as args from app.chain_payments where chain_id=$1 and tx_hash=$2
  union all select 'transfer', log_id, chain_id, block_number, block_hash, block_time, tx_hash, tx_log_ordinal, log_index,
    null, "from", "to", token, amount, null, null, null, null, null, null, null, null, null, null, null from app.transfers where chain_id=$1 and tx_hash=$2
  union all select 'userOperation', log_id, chain_id, block_number, block_hash, block_time, tx_hash, tx_log_ordinal, log_index,
    null, sender, null, null, null, null, null, user_op_hash, paymaster, nonce, success, actual_gas_cost, actual_gas_used, null, null, null
    from app.user_operations where chain_id=$1 and tx_hash=$2
  union all select 'log', log_id, chain_id, block_number, block_hash, block_time, tx_hash, tx_log_ordinal, log_index,
    null, null, null, null, null, null, null, null, null, null, null, null, null, contract, event, args from app.chain_logs where chain_id=$1 and tx_hash=$2
  order by tx_log_ordinal`;

/**
 * integration indexer, factsOf: every indexed fact of one transaction (payments, transfers, user operations and the
 * contract events Ponder keeps), in receipt order, once `block` is final at `finalityDepth` below both the indexed block
 * and the chain head Ponder last saw; null while it is not final yet, so the caller waits (awaitIndexedBlock) and is never
 * answered with nothing. Each read has 1 s and one retry; a Postgres that does not answer is PROVIDER_ERROR, and a fact
 * that does not decode, or two facts on one log, is PROVIDER_RESPONSE_INVALID.
 */
export async function readFactsOf(sql: Sql, input: FactsLookup, options: { timeoutMs?: number } = {}): Promise<IndexedFact[] | null> {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1 || !Number.isSafeInteger(input.finalityDepth) || input.finalityDepth < 0 ||
      typeof input.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) throw new IndexerError("INVALID_INPUT");
  const block = integerOr(input.block, () => new IndexerError("INVALID_INPUT"));
  const txHash = input.txHash.toLowerCase() as Hex, timeoutMs = options.timeoutMs ?? 1_000;
  const read = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new IndexerError("PROVIDER_ERROR")), timeoutMs); });
    try {
      return await Promise.race([(async () => {
        const head = progress((await sql.query("select * from app.indexer_progress where chain_id=$1", [input.chainId])).rows[0], input.chainId);
        const rows = (await sql.query(FACTS, [input.chainId, txHash])).rows as Record<string, unknown>[];
        return { head, rows };
      })(), late]);
    } finally { clearTimeout(timer); }
  };
  let answer: Awaited<ReturnType<typeof read>> | undefined;
  for (let attempt = 0; answer === undefined; attempt++) {
    try { answer = await read(); }
    catch (error) {
      if (error instanceof IndexerError && error.code !== "PROVIDER_ERROR") throw error;
      if (attempt >= 1) throw new IndexerError("PROVIDER_ERROR");
    }
  }
  const { head, rows } = answer;
  if (!head.ready) throw new IndexerError("PROVIDER_ERROR");
  const indexed = BigInt(head.indexedBlock), seen = BigInt(head.headBlock);
  if (block + BigInt(input.finalityDepth) > (indexed < seen ? indexed : seen)) return null;
  const facts = rows.map((row) => fact(row, input.chainId, txHash));
  if (new Set(facts.map((f) => f.txLogOrdinal)).size !== facts.length) throw invalid();
  return facts;
}

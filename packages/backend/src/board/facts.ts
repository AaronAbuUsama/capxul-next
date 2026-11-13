import type { Address, Hex } from "viem";
import type { Sql } from "../platform/db.ts";
import type { SettlementFacts } from "./carry.ts";
import type { BoardFacts } from "./runtime.ts";
import { integer } from "./types.ts";

type Log = { block_number: string; tx_hash: string };
/** The source owners' readers Board composes from: Core's indexing door and Organizations' admitted deployment. */
export type BoardReaders = {
  readAdmittedDeployment(sql: Sql, input: { orgId: string; chainId: number }): Promise<{
    safe_address: string; gate_address: string; director_hat: string } | null>;
  readSafeOwnersAt(sql: Sql, input: { chainId: number; safe: string; atBlock?: string; finality: number }): Promise<{
    safe_address: string; deployed: boolean; owners: string[]; threshold: number; nonce: string } | null>;
  readHatAt(sql: Sql, input: { chainId: number; hatId: string; atBlock?: string; finality: number }): Promise<{
    company_safe: string; supply: string; max_supply: string } | null>;
  readHatWearersAt(sql: Sql, input: { chainId: number; hatId: string; atBlock?: string; finality: number }): Promise<{ wearer: string; wearing: boolean }[]>;
  readSafeApprovals(sql: Sql, input: { chainId: number; safe: string; safeTxHash: string; atBlock?: string; finality: number }): Promise<{ owner: string }[]>;
  readSafeExecution(sql: Sql, input: { chainId: number; safe: string; nonce: string; finality: number }): Promise<(Log & {
    safe_tx_hash: string; success: boolean }) | null>;
  readHatTransfersInTx(sql: Sql, input: { chainId: number; txHash: string; hatId: string; finality: number }): Promise<{ from: string; to: string; value: string }[]>;
};

const low = (a: string) => a.toLowerCase() as Address;

/**
 * Current planning reads at the indexed head (finality 0): the live public mutations re-read owners, threshold, nonce and
 * Gate validity at one RPC block anyway. Officer hats stay null until the admitted deployment binds them
 * (board.officer-hat-unbound); no install order or Hat details are read as a permission.
 */
export function boardFacts(r: BoardReaders, hasOffice: BoardFacts["hasOffice"]): BoardFacts {
  return {
    deployment: async (sql, org, chainId) => {
      const d = await r.readAdmittedDeployment(sql, { orgId: org, chainId });
      return d && { safe_address: low(d.safe_address), gate_address: low(d.gate_address), director_hat: d.director_hat,
        books_hat: null, invoicing_hat: null, people_hat: null };
    },
    safe: async (sql, chainId, address) => {
      const s = await r.readSafeOwnersAt(sql, { chainId, safe: address, finality: 0 });
      return s && { safe_address: low(s.safe_address), owners: s.owners.map(low), threshold: integer(s.threshold), nonce: integer(s.nonce), deployed: s.deployed };
    },
    wearers: async (sql, chainId, hat, owners) => {
      const wearing = new Set((await r.readHatWearersAt(sql, { chainId, hatId: hat, finality: 0 })).filter((w) => w.wearing).map((w) => low(w.wearer)));
      return owners.map(low).filter((o) => wearing.has(o));
    },
    approvals: async (sql, chainId, safe, hash, owners) => {
      const approved = new Set((await r.readSafeApprovals(sql, { chainId, safe, safeTxHash: hash, finality: 0 })).map((a) => low(a.owner)));
      return owners.map(low).filter((o) => approved.has(o));
    },
    hat: async (sql, chainId, hat, safe) => {
      const h = await r.readHatAt(sql, { chainId, hatId: hat, finality: 0 });
      return h && low(h.company_safe) === low(safe) ? { supply: BigInt(h.supply), max_supply: BigInt(h.max_supply) } : null;
    },
    hasOffice,
  };
}

/** Finalized, log-backed settlement reads. The settled threshold is recorded only when the indexer can prove it. */
export function settlementFacts(r: BoardReaders, finality: number): SettlementFacts {
  return {
    execution: async (sql, chainId, safe, nonce, depth) => {
      const e = await r.readSafeExecution(sql, { chainId, safe, nonce: String(nonce), finality: depth });
      if (!e) return null;
      const block = integer(e.block_number);
      let threshold: number | null = null;
      try {
        threshold = (await r.readSafeOwnersAt(sql, { chainId, safe, atBlock: String(block - 1), finality: depth }))?.threshold ?? null;
      } catch (error) {
        if (!(error instanceof Error && error.message.startsWith("HISTORICAL_UNAVAILABLE"))) throw error;
      }
      return { safe_tx_hash: low(e.safe_tx_hash) as Hex, success: e.success, tx_hash: low(e.tx_hash) as Hex, user_op_hash: null, block_number: block, threshold };
    },
    approvalsAt: async (sql, chainId, safe, hash, block) =>
      [...new Set((await r.readSafeApprovals(sql, { chainId, safe, safeTxHash: hash, atBlock: String(block), finality })).map((a) => low(a.owner)))],
    hatMoved: async (sql, chainId, txHash, hat, from, to) =>
      (await r.readHatTransfersInTx(sql, { chainId, txHash, hatId: hat, finality }))
        .some((t) => low(t.from) === low(from) && low(t.to) === low(to) && BigInt(t.value) === 1n),
  };
}

import { parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { Sql } from "../platform/db.ts";
import type { SettlementFacts } from "./carry.ts";
import type { BoardFacts } from "./runtime.ts";
import { integer } from "./types.ts";

type Log = { block_number: string; tx_hash: string };
/** The source owners' readers Board composes from: Core's indexing door and Organizations' admitted deployment. Property
 * function types (not method shorthand) keep parameters contravariant, so a reader that needs more input fails tsc. */
export type BoardReaders = {
  readAdmittedDeployment: (sql: Sql, input: { orgId: string; chainId: number }) => Promise<{
    safe_address: string; gate_address: string; director_hat: string } | null>;
  readSafeOwnersAt: (sql: Sql, input: { chainId: number; safe: string; atBlock?: string; finality: number }) => Promise<{
    safe_address: string; deployed: boolean; owners: string[]; threshold: number; nonce: string } | null>;
  readHatAt: (sql: Sql, input: { chainId: number; hatId: string; companySafe: string; atBlock?: string; finality: number }) => Promise<{
    supply: string; max_supply: string } | null>;
  readHatWearersAt: (sql: Sql, input: { chainId: number; hatId: string; companySafe: string; atBlock?: string; finality: number }) => Promise<{
    wearer: string; wearing: boolean }[]>;
  readSafeApprovals: (sql: Sql, input: { chainId: number; safe: string; safeTxHash: string; atBlock?: string; finality: number }) => Promise<{ owner: string }[]>;
  readSafeExecution: (sql: Sql, input: { chainId: number; safe: string; nonce: string; finality: number }) => Promise<(Log & {
    safe_tx_hash: string; success: boolean; msg_sender: string; threshold: number }) | null>;
  readHatTransfersInTx: (sql: Sql, input: { chainId: number; txHash: string; hatId: string; finality: number }) => Promise<{ from: string; to: string; value: string }[]>;
  readWearerHatsAt: (sql: Sql, input: { chainId: number; wearer: string; companySafe: string; atBlock?: string; finality: number }) => Promise<{ hat_id: string; details: string; wearing: boolean | null }[]>;
};

const low = (a: string) => a.toLowerCase() as Address;
const hatsAbi = parseAbi(["function isWearerOfHat(address wearer,uint256 hat) view returns (bool)",
  "function viewHat(uint256 hat) view returns (string details,uint32 maxSupply,uint32 supply,address eligibility,address toggle,string imageURI,uint16 lastHatId,bool mutable_,bool active)"]);
/** Core refuses a hat whose eligibility or toggle is a module (an Elections clone): its wearers move with no Hats event. */
const moduleRuled = (error: unknown) => error instanceof Error && /^HISTORICAL_UNAVAILABLE: hat \d+ is ruled by a module/.test(error.message);
/** Hats itself, read live, for exactly what Core cannot index. */
export type LiveHats = { client: PublicClient; hats: Address };
async function live<T>(read: Promise<T>): Promise<T> {
  try { return await read; } catch { throw new Error("PROVIDER_ERROR: could not read Hats live"); }
}

/**
 * Current planning reads at the indexed head (finality 0): the live public mutations re-read owners, threshold, nonce and
 * Gate validity at one RPC block anyway. Officer hats stay null until the admitted deployment binds them
 * (board.officer-hat-unbound); no install order or Hat details are read as a permission. An office is a worn company hat
 * whose details begin `office:`, which budgets writes into department and team hats (board.people-hat-role-conflict).
 * A module-ruled hat (Core refuses it, or answers wearing null) is read live from Hats.
 */
export function boardFacts(r: BoardReaders, hats: LiveHats): BoardFacts {
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
    wearers: async (sql, chainId, safe, hat, owners) => {
      let indexed;
      try { indexed = await r.readHatWearersAt(sql, { chainId, hatId: hat, companySafe: safe, finality: 0 }); } catch (error) {
        if (!moduleRuled(error)) throw error;
        const worn = await live(Promise.all(owners.map((o) => hats.client.readContract({ address: hats.hats, abi: hatsAbi,
          functionName: "isWearerOfHat", args: [o, BigInt(hat)] }))));
        return owners.map(low).filter((_, i) => worn[i]);
      }
      const wearing = new Set(indexed.filter((w) => w.wearing).map((w) => low(w.wearer)));
      return owners.map(low).filter((o) => wearing.has(o));
    },
    approvals: async (sql, chainId, safe, hash, owners) => {
      const approved = new Set((await r.readSafeApprovals(sql, { chainId, safe, safeTxHash: hash, finality: 0 })).map((a) => low(a.owner)));
      return owners.map(low).filter((o) => approved.has(o));
    },
    hat: async (sql, chainId, hat, safe, blockNumber) => {
      let h;
      // BoardFacts.hat's invariant: the id is one of this Organization's admitted deployment hats, so the live read is the
      // company's own hat although Hats' viewHat names no company.
      try { h = await r.readHatAt(sql, { chainId, hatId: hat, companySafe: safe, finality: 0 }); } catch (error) {
        if (!moduleRuled(error)) throw error;
        const [, maxSupply, supply] = await live(hats.client.readContract({ address: hats.hats, abi: hatsAbi, functionName: "viewHat",
          args: [BigInt(hat)], blockNumber }));
        return { supply: BigInt(supply), max_supply: BigInt(maxSupply) };
      }
      return h && { supply: BigInt(h.supply), max_supply: BigInt(h.max_supply) };
    },
    hasOffice: async (sql, chainId, safe, wearer, blockNumber) => {
      const offices = (await r.readWearerHatsAt(sql, { chainId, wearer, companySafe: safe, finality: 0 })).filter((h) => h.details.startsWith("office:"));
      if (offices.some((h) => h.wearing === true)) return true;
      const unknown = offices.filter((h) => h.wearing === null);
      const worn = await live(Promise.all(unknown.map((h) => hats.client.readContract({ address: hats.hats, abi: hatsAbi,
        functionName: "isWearerOfHat", args: [wearer, BigInt(h.hat_id)], blockNumber }))));
      return worn.some(Boolean);
    },
  };
}

/** Finalized, log-backed settlement reads at the carry world's one finality depth. Sender and threshold come from the
 * execution's own SafeL2 additionalInfo, never from a later Safe-state projection. */
export function settlementFacts(r: BoardReaders): SettlementFacts {
  return {
    execution: async (sql, chainId, safe, nonce, finality) => {
      const e = await r.readSafeExecution(sql, { chainId, safe, nonce: String(nonce), finality });
      return e && { safe_tx_hash: low(e.safe_tx_hash) as Hex, success: e.success, tx_hash: low(e.tx_hash) as Hex, user_op_hash: null,
        block_number: integer(e.block_number), sender: low(e.msg_sender), threshold: integer(e.threshold) };
    },
    approvalsAt: async (sql, chainId, safe, hash, block, finality) =>
      [...new Set((await r.readSafeApprovals(sql, { chainId, safe, safeTxHash: hash, atBlock: String(block), finality })).map((a) => low(a.owner)))],
    hatMoved: async (sql, chainId, txHash, hat, from, to, finality) =>
      (await r.readHatTransfersInTx(sql, { chainId, txHash, hatId: hat, finality }))
        .some((t) => low(t.from) === low(from) && low(t.to) === low(to) && BigInt(t.value) === 1n),
  };
}

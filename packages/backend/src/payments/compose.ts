import type { Database, Sql } from "../platform/db.ts";
import { indexerState } from "../platform/diagnostics.ts";
import { erc20Abi, type Address } from "viem";
import { readPayment } from "./door.ts";
import { listPaymentWork, wakePaymentChain } from "./work.ts";
import { reconcilePayment, type ReconciledPayment } from "./reconcile.ts";

/** Business time on the caller's transaction. Composition supplies the world clock; payments never reads devnet. */
export type WorldNow = (sql: Sql) => Promise<number>;
export interface PaymentsWorkConfig { ponder: string; rpc: string; chainId: number; finality: number; limit?: number }
/** Shared's chain-rpc `readContract`, bound by composition (payments imports no other concept's code). */
export type ReadContract = (input: { address: Address; abi: typeof erc20Abi; functionName: "balanceOf"; args: readonly [Address];
  blockNumber: bigint }) => Promise<unknown>;
export type PaymentsTick = { skipped: string } | { woken: number; reconciled: number; blocked: number; failed: number };

/**
 * Payments' background work for Core's worker tick: wake waits on indexed progress, then resume each due Payment in its own
 * owner transaction. It does nothing at all unless diagnostics' indexerState is ready. The `indexer_progress.ready` the
 * doors check is Ponder's lock state only, which a Ponder killed while locked keeps; this gate adds Ponder's own /ready,
 * the chain head and the indexed head's last advance, so no reconcile or send runs from a frozen head.
 */
export function paymentsWork(db: Database, config: PaymentsWorkConfig, worldNow: WorldNow, readContract: ReadContract,
  readiness: typeof indexerState = indexerState) {
  const limit = config.limit ?? 100;
  return {
    name: "payments",
    async tick(): Promise<PaymentsTick> {
      const index = await readiness(db, config.ponder, config.chainId, config.rpc);
      if (!index.ready) return { skipped: index.reason };
      const at = await db.transaction("", (sql) => worldNow(sql), true);
      const woken = await db.transaction("", (sql) => wakePaymentChain(sql, config.chainId, at), true);
      const due = await db.transaction("", (sql) => listPaymentWork(sql, { at, limit }), true);
      // The finalized block every source read of this tick uses; a balance is read there, never at latest.
      const block = BigInt(index.head!) - BigInt(config.finality);
      let reconciled = 0, blocked = 0, failed = 0;
      for (const w of due) {
        if (w.chain_id !== config.chainId) continue;
        const owner = { kind: w.owner_kind, id: w.owner_id };
        try {
          // A scheduled personal Payment's day-ahead check needs its paying Safe's actual balance, read over RPC at the
          // finalized block and outside the Payment's own transaction (reconcile takes it as context, never from a request).
          const p = await db.ownerTransaction(owner, (sql) => readPayment(sql, owner, w.payment_id), true);
          const balance = p?.route === "personal" && p.status === "scheduled" ? {
            chainId: config.chainId, safe: p.payer_safe, token: p.token_address, blockNumber: block.toString(),
            raw: String(await readContract({ address: p.token_address as Address, abi: erc20Abi, functionName: "balanceOf",
              args: [p.payer_safe as Address], blockNumber: block })),
          } : undefined;
          const r: ReconciledPayment = await db.ownerTransaction(owner, (sql) => reconcilePayment(sql, owner, w.payment_id,
            { chainId: config.chainId, finality: config.finality }, { at, traceId: w.trace_id, ...(balance ? { balance } : {}) }), true);
          if (r.blocked) blocked++; else reconciled++;
        } catch (error) {
          failed++;
          console.error(`Core payments ${w.owner_kind}:${w.owner_id}/${w.payment_id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { woken, reconciled, blocked, failed };
    },
  };
}

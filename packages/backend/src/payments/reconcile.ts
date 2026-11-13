import type { Sql } from "../platform/db.ts";
import { readApproval } from "../approvals/door.ts";
import { change, followPayment, type PaymentContext } from "./lifecycle.ts";
import type { Owner, Payment } from "./types.ts";

export interface ReconcileContext extends PaymentContext {
  /** Actual paying Safe balance read outside the source transaction, never request-body funding. */
  balance?: { chainId: number; safe: string; token: string; raw: string; blockNumber: string };
}
export interface ReconciledPayment { payment: Payment | null; blocked: "personal_funding" | "budget_executor" | null }

/** One due instance, one caller worker transaction. Lock Payment, then its wait; Books feed locks come last. */
export async function reconcilePayment(sql: Sql, owner: Owner, id: string, input: {
  chainId: number; finality: number;
}, context: ReconcileContext): Promise<ReconciledPayment> {
  if (!Number.isSafeInteger(context.at) || context.at < 0 || !Number.isSafeInteger(input.finality) || input.finality < 0)
    throw new Error("INVALID_INPUT: payment reconciliation context");
  let payment = (await sql.query<Payment>("select * from app.payments where owner_kind=$1 and owner_id=$2 and id=$3 for update",
    [owner.kind, owner.id, id])).rows[0] ?? null;
  const key = [owner.kind, owner.id, id];
  if (!payment) return { payment: null, blocked: null };
  if (payment.chain_id !== input.chainId) throw new Error("INVALID_INPUT: payment chain differs");
  const process = (await sql.query(`select wake_at from app.payment_processes
    where owner_kind=$1 and owner_id=$2 and payment_id=$3 for update`, key)).rows[0];
  if (!process || process.wake_at === null || process.wake_at > context.at) return { payment, blocked: null };
  const progress = (await sql.query("select indexed_block,ready from app.indexer_progress where chain_id=$1", [input.chainId])).rows[0];
  if (!progress?.ready) throw new Error("INDEXER_NOT_READY: canonical indexed head required");
  const head = BigInt(progress.indexed_block), cutoff = head - BigInt(input.finality);
  let wakeAt: number | null = null, awaitBlock: string | null = (head + 1n).toString();
  let blocked: ReconciledPayment["blocked"] = null;
  if (payment.status === "prepared" && payment.pay_at !== null) {
    const approval = payment.approval_id ? await readApproval(sql, payment.approval_id) : null;
    if (payment.route === "personal") {
      if (approval?.state === "signed") payment = await change(sql, payment, "schedule", "scheduled", {}, context);
    } else if (payment.route === "budget") {
      const reservations = (await sql.query(`select args from app.chain_logs where chain_id=$1 and contract='budgets'
        and event='PaymentScheduled' and args->>'safe'=$2 and args->>'budgetId'=$3 and args->>'jobNonce'=$4
        and block_number<=$5 order by block_number,log_index`,
      [input.chainId, payment.payer_safe, payment.budget_id, payment.job_nonce, cutoff.toString()])).rows;
      if (reservations.length > 1) throw new Error("WRONG_STATE: ambiguous budget reservation");
      const a = reservations[0]?.args;
      if (a) {
        if (a.to !== payment.payee_safe || BigInt(a.amount) !== BigInt(payment.amount_raw) || Number(a.kind) !== payment.kind ||
            a.documentHash !== payment.document_hash || BigInt(a.payAt) !== BigInt(Math.floor(payment.pay_at / 1000)))
          throw new Error("WRONG_STATE: budget reservation differs from Payment");
        payment = await change(sql, payment, "schedule", "scheduled", { scheduled_id: String(a.scheduledId) }, context);
      }
    }
  }
  if (["prepared", "scheduled", "due"].includes(payment.status) && payment.scheduled_id) {
    const cancelled = (await sql.query(`select 1 from app.chain_logs where chain_id=$1 and contract='budgets'
      and event='ScheduleCancelled' and args->>'safe'=$2 and args->>'budgetId'=$3 and args->>'scheduledId'=$4
      and block_number<=$5`, [input.chainId, payment.payer_safe, payment.budget_id, payment.scheduled_id, cutoff.toString()])).rowCount;
    if (cancelled) payment = await change(sql, payment, "cancel", "cancelled", { outcome: "budget_cancelled" }, context);
  }
  if (payment.status === "scheduled" && payment.pay_at !== null) {
    const dueAt = payment.pay_at - 86_400_000;
    if (context.at < dueAt) wakeAt = dueAt;
    else {
      let shortfall: Payment["shortfall"] = null;
      if (payment.route === "personal") {
        const balance = context.balance;
        if (!balance) blocked = "personal_funding";
        else {
          if (balance.chainId !== payment.chain_id || balance.safe.toLowerCase() !== payment.payer_safe ||
              balance.token.toLowerCase() !== payment.token_address || !/^\d+$/.test(balance.raw) || !/^\d+$/.test(balance.blockNumber))
            throw new Error("INVALID_INPUT: paying Safe balance identity");
          if (BigInt(balance.raw) < BigInt(payment.amount_raw)) shortfall = "balance_too_low";
        }
      }
      if (!blocked) payment = await change(sql, payment, "come_due", "due", { shortfall }, context);
    }
  }
  // Settlement owns the Books call and is last among business effects. A carrier never fabricates it.
  payment = await followPayment(sql, owner, id, input, context);
  if (!payment) return { payment: null, blocked: null };
  if (["settled", "mismatched"].includes(payment.status)) {
    blocked = null; wakeAt = null;
    const confirmed = BigInt(payment.settled_block_number!) + 2n * BigInt(input.finality);
    awaitBlock = confirmed > head ? confirmed.toString() : null;
  } else if (["cancelled", "needs_retry"].includes(payment.status)) {
    blocked = null; wakeAt = null; awaitBlock = null;
  } else if (payment.status === "due" && payment.route === "budget" && payment.pay_at !== null) {
    if (context.at < payment.pay_at) wakeAt = payment.pay_at;
    // No generic executor-key capability is published. Do not pretend an intent sent a transaction.
    else blocked = "budget_executor";
  }
  if (awaitBlock === null && wakeAt === null && payment.status !== "needs_retry")
    await sql.query("delete from app.payment_processes where owner_kind=$1 and owner_id=$2 and payment_id=$3", key);
  else await sql.query(`update app.payment_processes set wake_at=$4,await_block=$5
    where owner_kind=$1 and owner_id=$2 and payment_id=$3`, [...key, wakeAt, awaitBlock]);
  return { payment, blocked };
}

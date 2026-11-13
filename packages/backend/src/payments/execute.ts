import type { Sql } from "../platform/db.ts";
import { ServiceSignerError, type BudgetsExecutor, type ExecuteReceipt } from "../shared/door.ts";
import { change, type PaymentContext } from "./lifecycle.ts";
import type { Owner, Payment } from "./types.ts";

/** The process's `pay-day` wait: hourly while the chain refuses `Budgets.execute`. */
export const EXECUTE_RETRY_MS = 3_600_000;
/** A sent execute not mined yet is looked up again by its key a minute later; the executor rebroadcasts a dropped one. */
export const EXECUTE_LOOKUP_MS = 60_000;

/** One due budget Payment's current `Budgets.execute` attempt. A mined revert consumes the key; the next attempt gets a new one. */
export interface BudgetExecution { owner: Owner; payment_id: string; chain_id: number; scheduled_id: string; attempt: number; key: string }
export type ExecutionAnswer =
  | { kind: "paid"; receipt: ExecuteReceipt }
  | { kind: "reverted"; receipt: ExecuteReceipt }
  | { kind: "refused"; revert: string | null }
  | { kind: "pending"; hash: string };

export const executionKey = (chainId: number, scheduledId: string, attempt: number) => `budget-execute:${chainId}:${scheduledId}:${attempt}`;

/**
 * Outside any transaction: looks the attempt up by its key and sends it once when nothing is recorded. A simulation
 * revert records nothing (`refused`); a mined revert or a success without this id's ScheduledPaid is `reverted`.
 */
export async function executeOnce(executor: Pick<BudgetsExecutor, "send" | "lookup">, execution: BudgetExecution): Promise<ExecutionAnswer> {
  let found = await executor.lookup({ key: execution.key });
  if (!found.hash) {
    try { await executor.send({ key: execution.key, scheduledId: BigInt(execution.scheduled_id) }); }
    catch (error) {
      if (error instanceof ServiceSignerError && error.code === "TRANSACTION_FAILED" && !error.hash) return { kind: "refused", revert: error.revert ?? null };
      throw error;
    }
    found = await executor.lookup({ key: execution.key });
  }
  if (!found.receipt) return { kind: "pending", hash: found.hash! };
  return { kind: found.receipt.status === "success" && found.receipt.paymentId ? "paid" : "reverted", receipt: found.receipt };
}

/**
 * One caller worker transaction after `executeOnce`. Locks the Payment, then its wait, and applies the answer only to the
 * attempt it was for: paid → `submit` (settlement still waits for the indexed PaymentSent); refused → the same attempt an
 * hour later; reverted → the next attempt an hour later; pending → looked up again shortly.
 */
export async function recordExecution(sql: Sql, execution: BudgetExecution, answer: ExecutionAnswer, context: PaymentContext): Promise<Payment | null> {
  if (!Number.isSafeInteger(context.at) || context.at < 0) throw new Error("INVALID_INPUT: authoritative execution time required");
  const key = [execution.owner.kind, execution.owner.id, execution.payment_id];
  let payment = (await sql.query<Payment>("select * from app.payments where owner_kind=$1 and owner_id=$2 and id=$3 for update", key)).rows[0] ?? null;
  const process = (await sql.query("select execute_attempt from app.payment_processes where owner_kind=$1 and owner_id=$2 and payment_id=$3 for update", key)).rows[0];
  // A later wake already moved it (settled, cancelled) or this answer is for an older attempt: it changes nothing.
  if (!payment || !process || payment.status !== "due" || payment.route !== "budget" || payment.scheduled_id !== execution.scheduled_id ||
      payment.chain_id !== execution.chain_id || process.execute_attempt !== execution.attempt) return payment;
  if (answer.kind === "paid") {
    if (answer.receipt.chainId !== payment.chain_id || answer.receipt.scheduledId !== payment.scheduled_id ||
        answer.receipt.paymentId!.toLowerCase() !== payment.chain_payment_id.toLowerCase())
      throw new Error("WRONG_STATE: executed payment differs from Payment");
    payment = await change(sql, payment, "submit", "submitted", {}, context);
  } else {
    const [attempt, wakeAt] = answer.kind === "reverted" ? [execution.attempt + 1, context.at + EXECUTE_RETRY_MS]
      : answer.kind === "refused" ? [execution.attempt, context.at + EXECUTE_RETRY_MS] : [execution.attempt, context.at + EXECUTE_LOOKUP_MS];
    await sql.query(`update app.payment_processes set execute_attempt=$4,wake_at=$5,await_block=null
      where owner_kind=$1 and owner_id=$2 and payment_id=$3`, [...key, attempt, wakeAt]);
  }
  return payment;
}

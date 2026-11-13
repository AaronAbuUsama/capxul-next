import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";
import type { Owner, Payment } from "./types.ts";
export type { Owner, Payment, PaymentTransitionProps } from "./types.ts";
export { followPayment, approvalTerminal, type PaymentContext, type PaymentFact } from "./lifecycle.ts";
export { prepareCommand, type PrepareCommand, type PrepareContext, type PreparedCommand, type PreparedItem } from "./prepare.ts";
export { listPaymentWork, wakePaymentChain, onApprovalTransition, type PaymentWork } from "./work.ts";
export { reconcilePayment, type ReconcileContext, type ReconciledPayment } from "./reconcile.ts";

/** Called by the admin migrator inside its existing transaction, never during resume. */
export async function migratePayments(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

/** An owner-qualified identity is required even for a worker following an outbox event. */
export async function readPayment(sql: Sql, owner: Owner, paymentId: string): Promise<Payment | null> {
  return (await sql.query<Payment>("select * from app.payments where owner_kind=$1 and owner_id=$2 and id=$3", [owner.kind, owner.id, paymentId])).rows[0] ?? null;
}

export async function readCommandPayments(sql: Sql, owner: Owner, commandId: string): Promise<Payment[]> {
  return (await sql.query<Payment>("select * from app.payments where owner_kind=$1 and owner_id=$2 and command_id=$3 order by created_at,id", [owner.kind, owner.id, commandId])).rows;
}

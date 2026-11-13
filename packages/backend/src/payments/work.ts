import type { Sql } from "../platform/db.ts";
import type { TransitionEvent } from "../platform/outbox.ts";
import type { Owner, Payment } from "./types.ts";

export interface PaymentWork { owner_kind: Owner["kind"]; owner_id: string; payment_id: string; chain_id: number; trace_id: string }

/** Birth/retry and source transitions commit this wake on the same caller transaction. */
export async function wakePayment(sql: Sql, payment: Pick<Payment, "owner_kind" | "owner_id" | "id" | "chain_id">, at: number, traceId: string) {
  if (!Number.isSafeInteger(at) || at < 0) throw new Error("INVALID_INPUT: authoritative payment wake time required");
  await sql.query(`insert into app.payment_processes(owner_kind,owner_id,payment_id,chain_id,trace_id,wake_at)
    values ($1,$2,$3,$4,$5,$6) on conflict(owner_kind,owner_id,payment_id) do update
    set wake_at=least(app.payment_processes.wake_at,excluded.wake_at),trace_id=excluded.trace_id`,
  [payment.owner_kind, payment.owner_id, payment.id, payment.chain_id, traceId, at]);
}

/** Read-only enumeration; each identity is resumed in a separate source transaction. No pool or lease here. */
export async function listPaymentWork(sql: Sql, input: { at: number; limit: number }): Promise<PaymentWork[]> {
  if (!Number.isSafeInteger(input.at) || input.at < 0 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000)
    throw new Error("INVALID_INPUT: bounded payment work required");
  return (await sql.query<PaymentWork>(`select owner_kind,owner_id,payment_id,chain_id,trace_id from app.payment_processes
    where wake_at<=$1 order by wake_at,owner_kind,owner_id,payment_id limit $2`, [input.at, input.limit])).rows;
}

/** Called on observed indexed progress, including rollback; never manufactures readiness or a guessed head. */
export async function wakePaymentChain(sql: Sql, chainId: number, at: number): Promise<number> {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !Number.isSafeInteger(at) || at < 0)
    throw new Error("INVALID_INPUT: payment chain wake");
  return (await sql.query(`update app.payment_processes w set wake_at=least(w.wake_at,$2)
    from app.indexer_progress p where p.chain_id=$1 and p.ready and w.chain_id=p.chain_id
      and w.await_block<=p.indexed_block`, [chainId, at])).rowCount ?? 0;
}

/** Shared relay supplies the committed event and owns consume/effect/ACK; do not wrap another consume. */
export async function onApprovalTransition(sql: Sql, event: TransitionEvent): Promise<void> {
  if (event.name !== "approval_transitioned" || event.machine !== "approval" || event.props.opener !== "payments") return;
  const p = event.props;
  if (typeof p.approval_id !== "string" || p.approval_id !== event.entity_id ||
      !["payment", "payment-command"].includes(String(p.subject_kind)) || typeof p.subject_id !== "string")
    throw new Error("INVALID_INPUT: payment carrier source identity");
  const rows = (await sql.query<Payment>(`select * from app.payments where approval_id=$1
    and (($2='payment' and id=$3) or ($2='payment-command' and command_id=$3)) order by owner_kind,owner_id,id for update`,
  [p.approval_id, p.subject_kind, p.subject_id])).rows;
  for (const row of rows) await wakePayment(sql, row, event.at, event.trace_id);
}

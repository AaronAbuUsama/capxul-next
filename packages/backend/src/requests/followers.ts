import type { Sql } from "../platform/db.ts";
import { consume, emit, type TransitionEvent } from "../platform/outbox.ts";
import type { Request, RequestState } from "./types.ts";

/** Narrow structural read result from payments' owning door, not a copied payment record. */
export type ReadPayment = (sql: Sql, owner: { kind: "person" | "organization"; id: string }, id: string) => Promise<{
  id: string; owner_kind: "person" | "organization"; owner_id: string; chain_payment_id: string; status: string;
} | null>;

/** Read the final indexed balance at the request's ending block, not a cached/current balance. Null means not indexed yet. */
export type ReadEscrowAtEnd = (sql: Sql, request: Request) => Promise<string | null>;

/** Composition passes a committed outbox identity, devnet's worldNow (requests does not import devnet) and
 * payments.readPayment; source+effect ACK commit together, the ACK at the world's now read on this transaction. */
export async function followPayment(sql: Sql, eventId: string, worldNow: (sql: Sql) => Promise<number>, readPayment: ReadPayment, readEscrowAtEnd?: ReadEscrowAtEnd): Promise<boolean> {
  return consume(sql, "requests.lifecycle.payment-followers", eventId, (sameSql, event) => onPaymentTransition(sameSql, event, readPayment, readEscrowAtEnd), await worldNow(sql));
}

/** Shared relay already owns consume/effect/ACK: use this handler there, not a nested consume. */
export async function onPaymentTransition(sameSql: Sql, event: TransitionEvent, readPayment: ReadPayment, readEscrowAtEnd?: ReadEscrowAtEnd): Promise<void> {
    if (event.name !== "payment_transitioned" || event.machine !== "payment") return;
    const p = event.props;
    if (!["settle", "unsettle", "cancel"].includes(String(p.transition))) return;
    if ((p.owner_kind !== "person" && p.owner_kind !== "organization") || typeof p.owner_id !== "string" || typeof p.payment_id !== "string" ||
        event.entity_id !== p.payment_id || event.owner_kind !== p.owner_kind || event.owner_id !== p.owner_id) throw new Error("INVALID_INPUT: payment transition identity");
    const payment = await readPayment(sameSql, { kind: p.owner_kind, id: p.owner_id }, p.payment_id);
    if (!payment || payment.id !== p.payment_id || payment.owner_kind !== p.owner_kind || payment.owner_id !== p.owner_id) throw new Error("INVALID_INPUT: payment transition source");
    const row = (await sameSql.query("select * from app.requests where chain_payment_id=$1 for update", [payment.chain_payment_id])).rows[0] as Request | undefined;
    if (!row || (row.payment_id !== payment.id && !(p.transition === "settle" && row.payment_id === null && row.escrow_address))) return;
    let to: RequestState, transition: string;
    if (p.transition === "settle") {
      if (payment.status !== "settled" || !["paying", "cancelled", "expired"].includes(row.status)) return;
      if (row.status !== "paying") {
        if (!row.escrow_address) return;
        const held = await readEscrowAtEnd?.(sameSql, row);
        // Do not ACK the source until its historical guard can actually be verified.
        if (held == null) throw new Error("WRONG_STATE: verification_unavailable");
        if (BigInt(held) < BigInt(row.amount_raw)) return;
      }
      to = "paid"; transition = "settle";
    } else if (p.transition === "unsettle") {
      if (row.status !== "paid" || row.deposit_id !== null || payment.status === "settled") return;
      to = "paying"; transition = "unsettle";
    } else {
      if (row.status !== "paying" || payment.status !== "cancelled") return;
      to = "open"; transition = "reopen";
    }
    await sameSql.query(`update app.requests set status=$4,updated_at=$5,payment_id=$6,
      chain_payment_id=$7,pay_key=$8 where owner_kind=$1 and owner_id=$2 and request_id=$3`,
    [row.owner_kind, row.owner_id, row.request_id, to, event.at, to === "open" ? null : payment.id,
      to === "open" ? null : row.chain_payment_id, to === "open" ? null : row.pay_key]);
    await requestEvent(sameSql, event, row, to, transition);
}

async function requestEvent(sql: Sql, source: TransitionEvent, row: Request, to: RequestState, transition: string) {
  await emit(sql, {
    id: `request:${row.request_id}:${source.id}`, name: "request_transitioned", machine: "request", entity_id: row.request_id,
    owner_kind: row.owner_kind, owner_id: row.owner_id, actor: source.actor, trace_id: source.trace_id, at: source.at,
    props: { from: row.status, to, transition, request_id: row.request_id, owner_kind: row.owner_kind, owner_id: row.owner_id,
      kind: row.kind, payer_kind: row.payer_kind },
  });
}

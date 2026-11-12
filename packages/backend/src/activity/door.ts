import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";

export type Owner = { kind: "person" | "organization"; id: string };
export const paymentTransitions = ["open", "schedule", "come_due", "escrow", "submit", "settle", "mismatch", "unsettle", "lapse", "retry", "cancel"] as const;
type PaymentStatus = "prepared" | "scheduled" | "due" | "escrowed" | "submitted" | "needs_retry" | "settled" | "mismatched" | "cancelled";
type Common = { owner_kind: Owner["kind"]; owner_id: string; transition: string };
export type PaymentEvent = {
  id: string; at: number; name: "payment_transitioned";
  props: Common & {
    payment_id: string; from: PaymentStatus | null; to: PaymentStatus; command_id: string | null;
    route: "personal" | "budget" | "board" | "claim_escrow" | "chain";
    outcome: "declined" | "refused" | "rejected" | "expired" | "displaced" | "reverted" | "window_closed" | "voided" | "budget_cancelled" | "refunded" | "withdrawn" | null;
  };
};
export type MovementEvent = {
  id: string; at: number; name: "movement_transitioned";
  props: Common & {
    from: "recorded" | "removed" | null; to: "recorded" | "removed";
    chain_id: number; tx_hash: string; log_index: number; side: "in" | "out";
  };
};
export type ActivityEvent = PaymentEvent | MovementEvent;

/** Called only by explicit world creation/migration, never on restart or restore. */
export async function migrateActivity(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

/** Dispatch after the source transaction commits. Caller commits the effect and its consumer ACK together. */
export async function note(sql: Sql, event: ActivityEvent): Promise<void> {
  const p = event.props;
  let owners: Owner[] = [{ kind: p.owner_kind, id: p.owner_id }];
  let rowId: string, rowKind: "payment" | "movement";
  if (event.name === "payment_transitioned") {
    if (!paymentTransitions.includes(event.props.transition as typeof paymentTransitions[number])) throw new Error("ACTIVITY_TRANSITION: unknown payment transition");
    const payment = (await sql.query(`select owner_kind,owner_id,payee_kind,payee_id from app.payments
      where owner_kind=$1 and owner_id=$2 and id=$3`, [p.owner_kind, p.owner_id, event.props.payment_id])).rows[0];
    if (!payment) throw new Error("ACTIVITY_SOURCE_MISSING: payment not visible to consumer");
    if (payment.payee_kind === "person" || payment.payee_kind === "organization") {
      owners.push({ kind: payment.payee_kind, id: payment.payee_id });
    }
    rowId = event.props.payment_id; rowKind = "payment";
  } else {
    // Removal/restoration changes the live Movement read, not the append-only change log.
    if (p.transition !== "record") return;
    rowId = `${event.props.chain_id}:${event.props.tx_hash}:${event.props.log_index}:${event.props.side}`;
    rowKind = "movement";
  }
  // A self-payment has one side. Global lock order also prevents reciprocal payments deadlocking.
  owners = [...new Map(owners.map((o) => [JSON.stringify([o.kind, o.id]), o])).entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, owner]) => owner);
  for (const owner of owners) {
    await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify(["activity", owner.kind, owner.id])]);
  }
  for (const owner of owners) {
    await sql.query(`insert into app.activity_changes
      (owner_id,owner_kind,seq,row_kind,row_id,change,transition,"from","to",event_id,changed_at)
      select $1,$2,coalesce(max(seq),0)+1,$3,$4,
        case when count(*) filter (where row_kind=$3 and row_id=$4)>0 then 'updated' else 'new' end,
        $5,$6,$7,$8,$9 from app.activity_changes where owner_id=$1 and owner_kind=$2
      on conflict (owner_id,owner_kind,event_id) do nothing`,
    [owner.id, owner.kind, rowKind, rowId, p.transition, p.from, p.to, event.id, event.at]);
  }
}

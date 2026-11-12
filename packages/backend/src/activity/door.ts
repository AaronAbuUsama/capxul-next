import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";
import type { TransitionEvent } from "../platform/outbox.ts";

export type Owner = { kind: "person" | "organization"; id: string };
export const paymentTransitions = ["open", "schedule", "come_due", "escrow", "submit", "settle", "mismatch", "unsettle", "lapse", "retry", "cancel"] as const;

/** Called only by explicit world creation/migration, never on restart or restore. */
export async function migrateActivity(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

/** Dispatch after the source transaction commits. Caller commits the effect and its consumer ACK together. */
export async function note(sql: Sql, event: TransitionEvent): Promise<void> {
  const p = event.props;
  if ((p.owner_kind !== "person" && p.owner_kind !== "organization") || typeof p.owner_id !== "string" || !p.owner_id ||
      event.owner_kind !== p.owner_kind || event.owner_id !== p.owner_id ||
      typeof p.transition !== "string" || (p.from !== null && typeof p.from !== "string") || typeof p.to !== "string") {
    throw new Error("ACTIVITY_SOURCE_INVALID: transition owner and state required");
  }
  let owners: Owner[] = [{ kind: p.owner_kind, id: p.owner_id }];
  let rowId: string, rowKind: "payment" | "movement";
  if (event.name === "payment_transitioned") {
    if (event.machine !== "payment" || typeof p.payment_id !== "string" || !p.payment_id || event.entity_id !== p.payment_id ||
        !paymentTransitions.includes(p.transition as typeof paymentTransitions[number])) {
      throw new Error("ACTIVITY_TRANSITION: invalid payment transition");
    }
    const payment = (await sql.query(`select owner_kind,owner_id,payee_kind,payee_id from app.payments
      where owner_kind=$1 and owner_id=$2 and id=$3`, [p.owner_kind, p.owner_id, p.payment_id])).rows[0];
    if (!payment) throw new Error("ACTIVITY_SOURCE_MISSING: payment not visible to consumer");
    if (payment.payee_kind === "person" || payment.payee_kind === "organization") {
      owners.push({ kind: payment.payee_kind, id: payment.payee_id });
    }
    rowId = p.payment_id; rowKind = "payment";
  } else if (event.name === "movement_transitioned" && event.machine === "movement") {
    // Removal/restoration changes the live Movement read, not the append-only change log.
    if (p.transition === "remove" || p.transition === "restore") return;
    if (p.transition !== "record" || !Number.isSafeInteger(p.chain_id) || !Number.isSafeInteger(p.log_index) ||
        typeof p.tx_hash !== "string" || (p.side !== "in" && p.side !== "out")) {
      throw new Error("ACTIVITY_TRANSITION: invalid movement transition");
    }
    rowId = `${p.chain_id}:${p.tx_hash}:${p.log_index}:${p.side}`;
    rowKind = "movement";
  } else {
    throw new Error("ACTIVITY_TRANSITION: unsupported source event");
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
      select $1,$2,coalesce((select seq from app.activity_changes
        where owner_id=$1 and owner_kind=$2 order by seq desc limit 1),0)+1,$3,$4,
        case when exists(select 1 from app.activity_changes
          where owner_id=$1 and owner_kind=$2 and row_kind=$3 and row_id=$4) then 'updated' else 'new' end,
        $5,$6,$7,$8,$9
      on conflict (owner_id,owner_kind,event_id) do nothing`,
    [owner.id, owner.kind, rowKind, rowId, p.transition, p.from, p.to, event.id, event.at]);
  }
}

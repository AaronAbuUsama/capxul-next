// organizations.add-bought-seats and .return-bought-seats (blueprint/organizations/procedures.ts): Payments invokes
// them inside its settling or reopening transaction. They lock the Organization row, never open a transaction and
// make no outside call.
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";

export type BoughtSeats = {
  org_id: string; payment_id: string; command_id: string; seats: number; chain_id: number; token_address: string;
  asset: string; amount_raw: string; bought_by_party_id: string; tx_hash: string; block_number: number;
};

async function locked(sql: Sql, orgId: string) {
  return (await sql.query<{ seat_limit: number }>("select seat_limit from app.organizations where org_id=$1 for update", [orgId])).rows[0];
}
async function transitioned(sql: Sql, p: { org_id: string; payment_id: string; seats: number }, from: string | null, to: string,
  transition: string, now: number, trace: string) {
  await emit(sql, { id: `seat-purchase:${p.org_id}:${p.payment_id}:${transition}:${now}`, name: "seat_purchase_transitioned",
    machine: "seat-purchase", entity_id: `${p.org_id}:${p.payment_id}`, owner_kind: "organization", owner_id: p.org_id, actor: null,
    trace_id: trace, at: now, props: { from, to, transition, org_id: p.org_id, payment_id: p.payment_id, seats: p.seats } });
}

/** A Payment already counted adds nothing; a returned one is counted again. */
export async function addBoughtSeats(sql: Sql, p: BoughtSeats, now: number, trace: string) {
  const int = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!trace || !p || !Number.isSafeInteger(p.seats) || p.seats < 1 || p.seats > 1000 || !p.payment_id || !p.command_id ||
    !int(p.chain_id) || !int(p.block_number) || !/^0x[0-9a-fA-F]{40}$/.test(p.token_address) || !/^[0-9]+$/.test(p.amount_raw) ||
    !p.asset || !p.bought_by_party_id || !/^0x[0-9a-fA-F]{64}$/.test(p.tx_hash)) throw new Error("INVALID_INPUT: seat purchase");
  const org = await locked(sql, p.org_id);
  if (!org) throw new Error("INVALID_INPUT: unknown Organization");
  const row = (await sql.query("select status from app.org_seat_purchases where org_id=$1 and payment_id=$2", [p.org_id, p.payment_id])).rows[0];
  if (row?.status === "counted") return { org_id: p.org_id, payment_id: p.payment_id, seat_limit: org.seat_limit, added: false };
  const limit = org.seat_limit + p.seats;
  await sql.query("update app.organizations set seat_limit=$2,seat_limit_raised_by='purchase',seat_limit_raised_at=$3,updated_at=$3 where org_id=$1",
    [p.org_id, limit, now]);
  if (row) {
    await sql.query(`update app.org_seat_purchases set status='counted',limit_after=$3,tx_hash=$4,block_number=$5,counted_at=$6,
      returned_at=null,updated_at=$6 where org_id=$1 and payment_id=$2`, [p.org_id, p.payment_id, limit, p.tx_hash.toLowerCase(), p.block_number, now]);
    await transitioned(sql, p, "returned", "counted", "add_again", now, trace);
  } else {
    await sql.query(`insert into app.org_seat_purchases(org_id,payment_id,command_id,seats,status,chain_id,token_address,asset,amount_raw,
      bought_by_party_id,limit_after,tx_hash,block_number,counted_at,created_at,updated_at)
      values($1,$2,$3,$4,'counted',$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$13)`, [p.org_id, p.payment_id, p.command_id, p.seats, p.chain_id,
      p.token_address.toLowerCase(), p.asset, p.amount_raw, p.bought_by_party_id, limit, p.tx_hash.toLowerCase(), p.block_number, now]);
    await transitioned(sql, p, null, "counted", "add", now, trace);
  }
  return { org_id: p.org_id, payment_id: p.payment_id, seat_limit: limit, added: true };
}

/** A reorg reopened the Payment: its seats leave the limit. Already returned, or no purchase, is a no-op. */
export async function returnBoughtSeats(sql: Sql, p: { org_id: string; payment_id: string }, now: number, trace: string) {
  if (!trace || !p?.org_id || !p.payment_id) throw new Error("INVALID_INPUT: seat purchase");
  const org = await locked(sql, p.org_id);
  const row = org && (await sql.query<{ status: string; seats: number }>("select status,seats from app.org_seat_purchases where org_id=$1 and payment_id=$2",
    [p.org_id, p.payment_id])).rows[0];
  if (!org || !row || row.status !== "counted") return { org_id: p.org_id, payment_id: p.payment_id, seat_limit: org?.seat_limit ?? 0, returned: false };
  const limit = org.seat_limit - row.seats;
  await sql.query("update app.organizations set seat_limit=$2,updated_at=$3 where org_id=$1", [p.org_id, limit, now]);
  await sql.query("update app.org_seat_purchases set status='returned',returned_at=$3,updated_at=$3 where org_id=$1 and payment_id=$2", [p.org_id, p.payment_id, now]);
  await transitioned(sql, { ...p, seats: row.seats }, "counted", "returned", "take_back", now, trace);
  return { org_id: p.org_id, payment_id: p.payment_id, seat_limit: limit, returned: true };
}

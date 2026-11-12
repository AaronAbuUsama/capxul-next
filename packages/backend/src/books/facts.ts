import { randomUUID } from "node:crypto";
import type { Sql } from "../platform/db.ts";

export type Reference = { kind: "payment" | "movement"; id: string };
export type PartyType = "Customer" | "Supplier" | "Employee" | "Shareholder";
export type DocumentRef = {
  reference_doctype: "Sales Invoice" | "Purchase Invoice" | "Journal Entry" | "Expense Claim" |
    "Employee Advance" | "Payroll Entry" | "Sales Order" | "Purchase Order";
  reference_name: string; allocated_amount: string | null;
};
export type Against = {
  account?: string; suggestion?: string; same_as?: Reference;
  party?: { type: PartyType; id: string }; cost_center?: string; project?: string; references?: readonly DocumentRef[];
};
export type MoneySide = {
  org_id: string;
  kind: "payment_settled" | "payment_received" | "deposit_received" | "payment_sent_outside" | "payout_returned";
  direction: "in" | "out"; money_key: string; reference: Reference;
  source: { kind: "payment" | "deposit" | "payout" | "movement" | "agreement" | "asset" | "payroll_run"; id: string };
  asset_id: string; symbol: string; decimals: number; amount_raw: string; fee_raw?: string; priced: boolean;
  usd?: { value: string; rate: string; source: string };
  counterparty: string | null; party_id: string | null;
  chain_id: number; block_number: number; block_time: number; tx_hash: string; log_index: number | null;
  safe_address: string; actor: { kind: "person" | "agent" | "system"; id: string | null }; against?: Against;
};

/** Only the supplied transaction is used. Restore its owner context after a multi-organization call. */
export async function withFeeds<T>(sql: Sql, orgs: readonly string[], at: number, run: () => Promise<T>, create = true): Promise<T> {
  const before = (await sql.query(`select current_setting('app.org_id',true) as org,
    current_setting('app.owner_kind',true) as kind,current_setting('app.owner_id',true) as id`)).rows[0]!;
  for (const org of [...new Set(orgs)].sort()) {
    await selectOrganization(sql, org);
    if (create) await sql.query(`insert into app.book_feeds (org_id,last_seq,created_at,updated_at)
      values ($1,0,$2,$2) on conflict do nothing`, [org, at]);
    await sql.query("select last_seq from app.book_feeds where org_id=$1 for update", [org]);
  }
  // Do not issue SQL on a failed transaction: PostgreSQL's caller rollback restores local settings.
  const result = await run();
  await sql.query(`select set_config('app.org_id',$1,true),set_config('app.owner_kind',$2,true),
    set_config('app.owner_id',$3,true)`, [before.org ?? "", before.kind ?? "", before.id ?? ""]);
  return result;
}

export async function selectOrganization(sql: Sql, org: string) {
  await sql.query(`select set_config('app.org_id',$1,true),set_config('app.owner_kind','organization',true),
    set_config('app.owner_id',$1,true)`, [org]);
}

/** All callers hold the feed lock; no fact can reserve a number outside its writer's transaction. */
export async function appendFact(sql: Sql, org: string, at: number, fields: Record<string, unknown>) {
  const { seq } = (await sql.query(`update app.book_feeds set last_seq=last_seq+1,updated_at=$2
    where org_id=$1 returning last_seq as seq`, [org, at])).rows[0]!;
  const fact = { ...fields, org_id: org, fact_id: fields.fact_id ?? `fact_${randomUUID()}`, seq,
    recorded_at: at, rows: fields.rows ?? [] };
  return (await sql.query(`insert into app.book_facts
    select f.* from jsonb_populate_record(null::app.book_facts,$1::jsonb) f returning *`, [JSON.stringify(fact)])).rows[0]!;
}

export async function standing(sql: Sql, org: string, key: string) {
  return (await sql.query(`select f.* from app.book_facts f
    where f.org_id=$1 and f.money_key=$2 and f.kind<>'reversed'
      and not exists (select 1 from app.book_facts r where r.org_id=f.org_id and r.reverses_fact_id=f.fact_id)
    order by f.generation desc limit 1`, [org, key])).rows[0];
}

export async function reverseStanding(sql: Sql, org: string, fact: Record<string, unknown>, seenAt: number, at: number) {
  return appendFact(sql, org, at, { ...fact, fact_id: `${fact.fact_id}_rev`, kind: "reversed", occurred_at: seenAt,
    reverses_fact_id: fact.fact_id, actor_kind: "system", actor_id: null });
}

export async function reverseMoneyFact(sql: Sql, input: {
  money_key: string; org_ids: readonly string[]; seen_at: number; reason: "reorganized" | "claimed_by_payment";
}, context: { at: number; traceId: string }) {
  const reversed: string[] = [];
  await withFeeds(sql, input.org_ids, context.at, async () => {
    for (const org of [...new Set(input.org_ids)].sort()) {
      await selectOrganization(sql, org);
      const fact = await standing(sql, org, input.money_key);
      if (fact) reversed.push((await reverseStanding(sql, org, fact, input.seen_at, context.at)).fact_id);
    }
  }, false);
  return { reversed };
}

/** Feed locks exclude replay, reversal and attribution races, including different invokers. */
export async function recordSide(sql: Sql, side: MoneySide, at: number) {
  const org = side.org_id;
  await selectOrganization(sql, org);
  const old = await standing(sql, org, side.money_key);
  if (old && !(old.source_kind === "movement" && side.source.kind !== "movement")) {
    return { unchanged: old.fact_id as string };
  }
  const superseded = old ? (await reverseStanding(sql, org, old, side.block_time, at)).fact_id as string : undefined;
  const generation = Number((await sql.query(`select coalesce(max(generation),0)+1 as n
    from app.book_facts where org_id=$1 and money_key=$2`, [org, side.money_key])).rows[0]!.n);
  const usd = side.priced ? side.usd : undefined;
  const fact = await appendFact(sql, org, at, {
    kind: side.kind, occurred_at: side.block_time, money_key: side.money_key, generation,
    reference_kind: side.reference.kind, reference_id: side.reference.id,
    direction: side.direction, asset_id: side.asset_id, symbol: side.symbol, decimals: side.decimals,
    amount_raw: side.amount_raw, fee_raw: side.fee_raw ?? null,
    usd_value: usd?.value ?? null, usd_rate: usd?.rate ?? null, usd_source: usd?.source ?? null,
    safe_address: side.safe_address, counterparty: side.counterparty, party_id: side.party_id,
    source_kind: side.source.kind, source_id: side.source.id,
    chain_id: side.chain_id, block_number: side.block_number, tx_hash: side.tx_hash, log_index: side.log_index,
    actor_kind: side.actor.kind, actor_id: side.actor.id,
  });
  return { recorded: fact.fact_id as string, superseded };
}

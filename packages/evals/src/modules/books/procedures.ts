import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Database } from "../../../../backend/src/platform/db.ts";
import type { MoneySide } from "../../../../backend/src/books/door.ts";

/** The side that recorded a standing settlement fact, for re-recording it or templating others. */
export function sideOf(org: string, fact: Record<string, any>, amount: string): MoneySide {
  return {
    org_id: org, kind: "payment_settled", direction: fact.direction, money_key: fact.money_key,
    reference: { kind: fact.reference_kind, id: fact.reference_id }, source: { kind: fact.source_kind, id: fact.source_id },
    asset_id: fact.asset_id, symbol: fact.symbol, decimals: fact.decimals, amount_raw: amount,
    priced: fact.usd_value !== null, ...(fact.fee_raw === null ? {} : { fee_raw: fact.fee_raw }),
    ...(fact.usd_value === null ? {} : { usd: { value: fact.usd_value, rate: fact.usd_rate, source: fact.usd_source } }),
    counterparty: fact.counterparty, party_id: fact.party_id, chain_id: fact.chain_id, block_number: fact.block_number,
    block_time: fact.occurred_at, tx_hash: fact.tx_hash, log_index: fact.log_index, safe_address: fact.safe_address,
    actor: { kind: fact.actor_kind, id: fact.actor_id },
  };
}

/** Exercises both writes on actual selected-world money, without changing the retained payment/GL. */
export async function atomic(db: Database, org: string, txHash: string, amount: string, at: number) {
  const { recordMoneyFact, reverseMoneyFact } = await import("../../../../backend/src/books/door.ts");
  const read = () => db.transaction(org, async (sql) => ({
    facts: (await sql.query("select * from app.book_facts where org_id=$1 order by seq", [org])).rows,
    annotations: (await sql.query("select * from app.book_annotations where owner_kind='organization' and owner_id=$1 order by reference_kind,reference_id", [org])).rows,
    feed: (await sql.query("select * from app.book_feeds where org_id=$1", [org])).rows,
  }));
  const before = await read();
  const fact = before.facts.find((f) => f.tx_hash === txHash && f.kind === "payment_settled" &&
    !before.facts.some((r) => r.reverses_fact_id === f.fact_id));
  assert(fact, "original real settlement must already have its committed money fact");
  assert.equal(fact.amount_raw, amount, "independent selected payment amount");
  const side = sideOf(org, fact, amount);
  const context = { at, traceId: randomUUID().replaceAll("-", "") };
  const reversal = { money_key: side.money_key, org_ids: [org], seen_at: at, reason: "reorganized" as const };
  const rolledBack = new Error("intentional caller rollback");
  let inTransaction: unknown;
  await assert.rejects(db.transaction(org, async (sql) => {
    const reversed = await reverseMoneyFact(sql, reversal, context);
    assert.equal(reversed.reversed.length, 1);
    const restored = await recordMoneyFact(sql, { sides: [side] }, context);
    assert.equal(restored.recorded.length, 1);
    const writes = (await sql.query("select * from app.book_facts where org_id=$1 and seq>$2 order by seq", [org, fact.seq])).rows;
    assert(writes.some((r) => r.fact_id === `${fact.fact_id}_rev` && r.reverses_fact_id === fact.fact_id));
    assert(writes.some((r) => r.fact_id === restored.recorded[0] && r.generation === fact.generation + 1));
    inTransaction = { reversed, restored, writes };
    assert.deepEqual(await read(), before, "another connection cannot see either uncommitted procedure");
    throw rolledBack;
  }), (error) => error === rolledBack);
  assert.deepEqual(await read(), before, "both procedures and feed must roll back with the invoker");
  const replay = await db.transaction(org, (sql) => recordMoneyFact(sql, { sides: [side] }, context));
  assert.deepEqual(replay, { recorded: [], unchanged: [fact.fact_id], superseded: [] });
  assert.deepEqual(await read(), before, "committed replay is inert");
  return { context, inTransaction, before, after: await read(), replay };
}

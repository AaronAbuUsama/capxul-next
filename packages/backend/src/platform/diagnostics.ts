import type { Database } from "./db.ts";

export async function indexerState(db: Database, url: string, chainId: number, rpc: string, observe = false) {
  const [response, head, chainHead] = await Promise.all([
    fetch(`${url}/ready`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false),
    db.worker.query("select * from ponder.indexer_progress where chain_id=$1", [chainId]).then((r) => r.rows[0], () => undefined),
    fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }), signal: AbortSignal.timeout(2000) })
      .then((r) => r.json()).then((b: any) => BigInt(b.result).toString(), () => null),
  ]);
  if (observe && head) await db.worker.query(`insert into app.indexer_observation (chain_id,indexed_block) values ($1,$2)
    on conflict (chain_id) do update set indexed_block=excluded.indexed_block,
      last_advance_at=case when app.indexer_observation.indexed_block<>excluded.indexed_block then now() else app.indexer_observation.last_advance_at end`, [chainId, head.indexed_block]);
  const observation = (await db.worker.query("select last_advance_at from app.indexer_observation where chain_id=$1", [chainId])).rows[0];
  const stale = head && observation && chainHead && BigInt(chainHead) > BigInt(head.indexed_block) && Date.now() - new Date(observation.last_advance_at).getTime() > 60_000;
  const reason = !response ? "Ponder readiness endpoint is unavailable" : !head ? "Ponder has no indexed head" : !chainHead ? "chain head is unavailable" : !observation ? "indexed head has no host-time observation" : BigInt(head.indexed_block) > BigInt(chainHead) ? "indexed head is ahead of the chain" : stale ? "indexed head has not advanced for 60 seconds while chain moves" : "";
  return { ready: !reason, reason, head: head ? Number(head.indexed_block) : null, chainHead: chainHead ? Number(chainHead) : null,
    indexedBlockHash: head?.indexed_block_hash ?? null, lastAdvanceAt: observation?.last_advance_at ?? null, observedAt: new Date().toISOString() };
}
export async function alerts(db: Database, org: string, ponder: string, chain: number, rpc: string) {
  const index = await indexerState(db, ponder, chain, rpc);
  return db.transaction(org, async (sql) => {
    const pending = (await sql.query(`select count(*)::int as count,min(created_at) as oldest from app.site_events where org_id=$1 and state='pending'`, [org])).rows[0]!;
    const events = (await sql.query("select event_key,seq,last_error from app.site_events where org_id=$1 and state='pending' order by seq", [org])).rows;
    const parked = (await sql.query("select event_key,kind,last_error as reason from app.site_events where org_id=$1 and state='parked' and kind in ('payment_sent','founder_capital','deposit_received') order by seq", [org])).rows;
    const stuck = pending.oldest && Date.now() - new Date(pending.oldest).getTime() > 300_000;
    return { observedAt: index.observedAt, alerts: [
      { id: "indexer_unready", active: !index.ready, ...index },
      { id: "delivery_stuck", active: !!stuck, reason: stuck ? "an unacknowledged event is older than 300 seconds" : "", observedAt: index.observedAt, oldestDueAt: pending.oldest, pending: pending.count, events },
      { id: "money_event_parked", active: parked.length > 0, reason: parked.length ? "the site parked a money event" : "", observedAt: index.observedAt, events: parked },
    ] };
  });
}

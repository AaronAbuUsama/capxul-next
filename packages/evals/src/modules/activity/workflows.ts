import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { note, paymentTransitions } from "../../../../backend/src/activity/door.ts";
import type { Database, Sql } from "../../../../backend/src/platform/db.ts";
import { consume, type TransitionEvent } from "../../../../backend/src/platform/outbox.ts";

const CONSUMER = "activity.changes";
const SAMPLE = 20;
export const idempotentChecks = paymentTransitions.map((t) => [t, `ACTIVITY.note-payment-${t.replace(/_/g, "-")}.idempotent`] as const);

const feedKey = (kind: string, id: string) => JSON.stringify([kind, id]);
const feedRows = (sql: Sql, feeds: [string, string][]) => sql.query(`select * from app.activity_changes
  where (owner_kind,owner_id) in (select * from unnest($1::text[],$2::text[])) order by owner_kind,owner_id,seq`,
[feeds.map((f) => f[0]), feeds.map((f) => f[1])]).then((r) => r.rows);

/**
 * Real `transition` events this run's Payment lifecycle committed and the relay acknowledged: each was noted once in each
 * feed holding its Payment, and a second run with the same event id changes nothing, whether it meets the consumer's ACK
 * or (as if the ACK were lost) only the change log's `by-owner-event` key. Every redelivery rolls back.
 */
export async function idempotent(database: Database, dir: string, transition: string) {
  const events = (await database.worker.query(`select o.event from app.transition_outbox o
    join app.transition_acks a on a.consumer=$1 and a.event_id=o.id
    where o.event->>'name'='payment_transitioned' and o.event->>'machine'='payment' and o.event->'props'->>'transition'=$2
    order by o.seq limit $3`, [CONSUMER, transition, SAMPLE])).rows.map((r) => r.event as TransitionEvent);
  assert(events.length > 0, `no acknowledged ${transition} transition in this run`);
  const evidence = [];
  for (const event of events) {
    const p = event.props as Record<string, string | null>;
    const client = await database.worker.connect();
    try {
      await client.query("begin");
      const payment = (await client.query("select owner_kind,owner_id,payee_kind,payee_id from app.payments where owner_kind=$1 and owner_id=$2 and id=$3",
        [p.owner_kind, p.owner_id, p.payment_id])).rows[0];
      assert(payment, "acknowledged transition has a Payment");
      const feeds = new Map<string, [string, string]>([[feedKey(payment.owner_kind, payment.owner_id), [payment.owner_kind, payment.owner_id]]]);
      if (payment.payee_kind === "person" || payment.payee_kind === "organization") feeds.set(feedKey(payment.payee_kind, payment.payee_id), [payment.payee_kind, payment.payee_id]);
      // Hold the feeds as the appender does, so the live relay cannot append between the two reads.
      for (const key of [...feeds.keys()].sort()) {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify(["activity", ...JSON.parse(key)])]);
      }
      const noted = (await client.query("select * from app.activity_changes where event_id=$1 order by owner_kind,owner_id", [event.id])).rows;
      assert.deepEqual(noted.map((r) => feedKey(r.owner_kind, r.owner_id)).sort(), [...feeds.keys()].sort());
      for (const row of noted) {
        assert.deepEqual([row.row_kind, row.row_id, row.transition, row.from, row.to, row.changed_at],
          ["payment", p.payment_id, transition, p.from, p.to, event.at]);
        const earlier = (await client.query(`select 1 from app.activity_changes where owner_kind=$1 and owner_id=$2
          and row_kind='payment' and row_id=$3 and seq<$4 limit 1`, [row.owner_kind, row.owner_id, p.payment_id, row.seq])).rowCount;
        assert.equal(row.change, earlier ? "updated" : "new");
      }
      const before = await feedRows(client, [...feeds.values()]);
      assert.equal(await consume(client, CONSUMER, event.id, note), false);
      await note(client, event);
      assert.deepEqual(await feedRows(client, [...feeds.values()]), before);
      evidence.push({ event: event.id, payment: p.payment_id, feeds: noted.map((r) => ({ owner_kind: r.owner_kind, owner_id: r.owner_id, seq: Number(r.seq), change: r.change })) });
    } finally { await client.query("rollback"); client.release(); }
  }
  writeFileSync(join(dir, `idempotent-${transition}.json`), JSON.stringify(evidence) + "\n");
}

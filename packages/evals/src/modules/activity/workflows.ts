import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { note, paymentTransitions } from "../../../../backend/src/activity/door.ts";
import type { Database, Sql } from "../../../../backend/src/platform/db.ts";
import type { TransitionEvent } from "../../../../backend/src/platform/outbox.ts";

const CONSUMER = "activity.changes";
const SAMPLE = 20;
export const idempotentChecks = paymentTransitions.map((t) => [t, `ACTIVITY.note-payment-${t.replace(/_/g, "-")}.idempotent`] as const);
export const resumeChecks = paymentTransitions.map((t) => [t, `ACTIVITY.note-payment-${t.replace(/_/g, "-")}.resume`] as const);

const feedKey = (kind: string, id: string) => JSON.stringify([kind, id]);
const feedRows = (sql: Sql, feeds: [string, string][]) => sql.query(`select * from app.activity_changes
  where (owner_kind,owner_id) in (select * from unnest($1::text[],$2::text[])) order by owner_kind,owner_id,seq`,
[feeds.map((f) => f[0]), feeds.map((f) => f[1])]).then((r) => r.rows);

/**
 * Real `transition` events the relay acknowledged during this run (the newest first): each was noted once in each feed
 * holding its Payment, and a second run with the same event id, as if its ACK were lost, changes nothing because of the
 * change log's `by-owner-event` key. Every redelivery rolls back.
 */
export async function idempotent(database: Database, dir: string, transition: string, runStartedAt: string) {
  // Scoped by the database clock's ACK time, not the event's `at`: world time can be stopped or warped, and a restored
  // world's baseline events were acknowledged before this run started.
  const events = (await database.worker.query(`select o.event from app.transition_outbox o
    join app.transition_acks a on a.consumer=$1 and a.event_id=o.id
    where o.event->>'name'='payment_transitioned' and o.event->>'machine'='payment' and o.event->'props'->>'transition'=$2
      and a.acked_at>=$4::timestamptz
    order by o.seq desc limit $3`, [CONSUMER, transition, SAMPLE, runStartedAt])).rows.map((r) => r.event as TransitionEvent);
  assert(events.length > 0, `no ${transition} transition acknowledged in this run`);
  const evidence = [];
  for (const event of events) {
    const client = await database.worker.connect();
    try {
      await client.query("begin");
      const { feeds, noted } = await checkNoted(client, event, transition);
      const before = await feedRows(client, feeds);
      await note(client, event);
      assert.deepEqual(await feedRows(client, feeds), before);
      evidence.push({ event: event.id, payment: event.entity_id, feeds: noted });
    } finally { await client.query("rollback"); client.release(); }
  }
  writeFileSync(join(dir, `idempotent-${transition}.json`), JSON.stringify(evidence) + "\n");
}

/** In the caller's transaction, holding the feeds' locks: the event was noted exactly once in each feed holding its Payment. */
async function checkNoted(client: Sql, event: TransitionEvent, transition: string) {
  const p = event.props as Record<string, string | null>;
  assert.equal(p.transition, transition);
  const payment = (await client.query("select owner_kind,owner_id,payee_kind,payee_id from app.payments where owner_kind=$1 and owner_id=$2 and id=$3",
    [p.owner_kind, p.owner_id, p.payment_id])).rows[0];
  assert(payment, "acknowledged transition has a Payment");
  const feeds = new Map<string, [string, string]>([[feedKey(payment.owner_kind, payment.owner_id), [payment.owner_kind, payment.owner_id]]]);
  if (payment.payee_kind === "person" || payment.payee_kind === "organization") feeds.set(feedKey(payment.payee_kind, payment.payee_id), [payment.payee_kind, payment.payee_id]);
  // Hold the feeds as the appender does, so the live relay cannot append between the reads.
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
  return { feeds: [...feeds.values()], noted: noted.map((r) => ({ owner_kind: r.owner_kind, owner_id: r.owner_id, seq: Number(r.seq), change: r.change })) };
}

/** What `world fixture resume-kill activity.changes` printed: the event whose effect died with Core before its ACK. */
export type ResumeFault = { consumer: string; eventId: string; event: string; transition: string; reachedAt: number;
  killed: { pid: number; signal: string; at: number }; restarted: { pid: number; readyAt: number } };

const world = (config: string, ...args: string[]) => JSON.parse(execFileSync("pnpm", ["--silent", "capxul", "world", "fixture", ...args, "--config", config, "--json"],
  { encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").at(-1)!);

/**
 * Arms Activity's consumer for the next `transition` delivery only, drives one real transition of that kind through the
 * world's public-path payment fixture, and lets the fault mount kill Core between the appender and its ACK, then
 * restart and resume it. If the drive fails, `resume-kill` still runs so the unclaimed arm times out and is removed.
 */
export function driveResume(config: string, transition: string): ResumeFault {
  world(config, "resume-arm", CONSUMER, "--event", "payment_transitioned", "--transition", transition);
  try { world(config, "payment", transition); }
  catch (error) { try { world(config, "resume-kill", CONSUMER); } catch { /* the arm is removed on its timeout */ } throw error; }
  return world(config, "resume-kill", CONSUMER);
}

/**
 * The armed `transition` event's appender was killed with its effect uncommitted and unacknowledged; the restarted
 * relay redelivered it, and it finished with the same result an uninterrupted run gives: one ACK, committed after the
 * kill, exactly one change per holding feed with the event's fields, and each feed's `seq` still gapless.
 */
export async function resumed(database: Database, dir: string, transition: string, fault: ResumeFault) {
  assert.equal(fault.consumer, CONSUMER);
  assert.deepEqual([fault.event, fault.transition], ["payment_transitioned", transition]);
  assert.equal(fault.killed.signal, "SIGKILL");
  assert.notEqual(fault.restarted.pid, fault.killed.pid);
  const client = await database.worker.connect();
  try {
    await client.query("begin isolation level repeatable read");
    const event = (await client.query("select event from app.transition_outbox where id=$1", [fault.eventId])).rows[0]?.event as TransitionEvent | undefined;
    assert(event && event.name === "payment_transitioned" && event.machine === "payment", "faulted event is a payment transition");
    const acks = (await client.query("select (extract(epoch from acked_at)*1000)::float8 as at from app.transition_acks where consumer=$1 and event_id=$2",
      [CONSUMER, fault.eventId])).rows;
    assert.equal(acks.length, 1);
    assert(acks[0].at > fault.killed.at, "the ACK committed after the kill, by the restarted relay");
    const { feeds, noted } = await checkNoted(client, event, transition);
    const gaps = (await client.query(`select owner_kind,owner_id,count(*)::int as n,max(seq)::int as top from app.activity_changes
      where (owner_kind,owner_id) in (select * from unnest($1::text[],$2::text[])) group by 1,2`, [feeds.map((f) => f[0]), feeds.map((f) => f[1])])).rows;
    assert(gaps.length === feeds.length && gaps.every((g) => g.n === g.top), "every holding feed's seq is gapless");
    writeFileSync(join(dir, `resume-${transition}.json`), JSON.stringify({ fault, feeds: noted }) + "\n");
  } finally { await client.query("rollback"); client.release(); }
}
